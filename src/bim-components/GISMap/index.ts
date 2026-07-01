import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { krovakToWgs84, wgs84ToKrovak } from "./krovak";

export interface GISMapData {
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  scale: number;
  crsName: string;
}

export type MapSourceType = "offline" | "osm" | "carto-light";

export const MapSourceUrls: Record<MapSourceType, string> = {
  "offline": "/map-tiles/{z}/{x}/{y}.png",
  "osm": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "carto-light": "https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png"
};


export class GISMapComponent extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "cf2b4b24-b152-4416-a36c-94a0d9b4b0e5" as const;

  readonly onDisposed = new OBC.Event();
  
  // Three.js elements
  private _world: OBC.World | null = null;
  mapGroup = new THREE.Group();
  private _tileCache = new Map<string, THREE.Mesh>();
  private _textureLoader = new THREE.TextureLoader();

  // Settings state
  private _enabled = false;
  private _opacity = 0.3;
  private _heightOffset = -0.5; // Default slightly below 0 to avoid Z-fighting
  private _zoom = 15;
  private _tileUrlTemplate = "/map-tiles/{z}/{x}/{y}.png"; // Offline tile directory default
  private _gridSize = 5; // 5x5 grid around center
  private _mapSource: MapSourceType = "offline";


  // Georeferencing parameters
  private _mapData: GISMapData | null = null;

  // Custom manual settings fallback
  manualData: GISMapData = {
    eastings: -634016.937824,
    northings: -1168325.998753,
    orthogonalHeight: 200,
    xAxisAbscissa: 0.878091, // cos(331.4129 deg)
    xAxisOrdinate: -0.478494, // sin(331.4129 deg)
    scale: 1.0,
    crsName: "EPSG:5514"
  };

  constructor(components: OBC.Components) {
    super(components);
    this.mapGroup.name = "GIS_Map_Group";
    this.mapGroup.visible = this._enabled;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (this._enabled !== value) {
      this._enabled = value;
      this.mapGroup.visible = value;
      if (value && this._world) {
        this.updateMapTiles();
      }
    }
  }

  get opacity(): number {
    return this._opacity;
  }

  set opacity(value: number) {
    this._opacity = value;
    this.mapGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          if (mat instanceof THREE.Material) {
            mat.opacity = value;
            mat.transparent = value < 1.0;
            mat.needsUpdate = true;
          }
        }
      }
    });
  }

  get heightOffset(): number {
    return this._heightOffset;
  }

  set heightOffset(value: number) {
    this._heightOffset = value;
    this.mapGroup.position.y = value;
  }

  get zoom(): number {
    return this._zoom;
  }

  set zoom(value: number) {
    if (this._zoom !== value) {
      this._zoom = value;
      if (this._enabled) {
        this.updateMapTiles();
      }
    }
  }

  get mapSource(): MapSourceType {
    return this._mapSource;
  }

  set mapSource(value: MapSourceType) {
    if (this._mapSource !== value) {
      this._mapSource = value;
      this._tileUrlTemplate = MapSourceUrls[value];
      if (this._enabled) {
        this.updateMapTiles();
      }
    }
  }


  get tileUrlTemplate(): string {
    return this._tileUrlTemplate;
  }

  set tileUrlTemplate(value: string) {
    if (this._tileUrlTemplate !== value) {
      this._tileUrlTemplate = value;
      if (this._enabled) {
        this.updateMapTiles();
      }
    }
  }

  get gridSize(): number {
    return this._gridSize;
  }

  set gridSize(value: number) {
    if (this._gridSize !== value) {
      this._gridSize = value;
      if (this._enabled) {
        this.updateMapTiles();
      }
    }
  }

  get mapData(): GISMapData | null {
    return this._mapData;
  }

  init(world: OBC.World) {
    this._world = world;
    this._world.scene.three.add(this.mapGroup);
    this.mapGroup.position.y = this._heightOffset;
  }

  dispose() {
    this.clearMap();
    if (this._world) {
      this._world.scene.three.remove(this.mapGroup);
    }
    this.onDisposed.trigger();
  }

  /**
   * Parses IfcMapConversion & IfcProjectedCRS directly from the raw IFC STEP buffer.
   * This is the reliable approach since getItemsOfCategories() does not index
   * non-geometry meta-entities like IfcMapConversion in the fragments model.
   *
   * Call this right after ifcLoader.load() or fragments.core.load() where the
   * raw IFC bytes are available (ifc-list.ts load functions).
   */
  detectGeorefFromBuffer(buffer: Uint8Array): boolean {
    try {
      const text = new TextDecoder().decode(buffer);

      // ── IfcProjectedCRS: first parameter is the CRS name string ──────────────
      // Format: #NNN= IFCPROJECTEDCRS('CRS_NAME', ...);
      const crsMatch = text.match(/#\d+=\s*IFCPROJECTEDCRS\s*\(\s*'([^']+)'/i);
      const crsName = crsMatch ? crsMatch[1] : "EPSG:5514";

      // ── IfcMapConversion: params 3-8 are eastings/northings/height/vectors/scale ──
      // Format: #NNN= IFCMAPCONVERSION(#src, #tgt, eastings, northings, height, xAbs, xOrd, scale);
      // Values may be integers, floats, or scientific notation; nulls are '$'
      const paramRe = /[-\d.E+]+|\$/gi;
      const mcBlockMatch = text.match(
        /#\d+=\s*IFCMAPCONVERSION\s*\(([^)]+)\)/i
      );

      if (!mcBlockMatch) return false;

      // Extract all tokens from the parenthesised block
      const tokens = mcBlockMatch[1].match(paramRe) ?? [];
      // tokens[0] = SourceCRS ref (e.g. "#193"), tokens[1] = TargetCRS ref
      // tokens[2..7] = eastings, northings, height, xAbscissa, xOrdinate, scale
      const parse = (t: string | undefined, def: number) =>
        !t || t === "$" ? def : Number(t);

      this._mapData = {
        eastings:         parse(tokens[2], 0),
        northings:        parse(tokens[3], 0),
        orthogonalHeight: parse(tokens[4], 0),
        xAxisAbscissa:    parse(tokens[5], 1.0),
        xAxisOrdinate:    parse(tokens[6], 0.0),
        scale:            parse(tokens[7], 1.0),
        crsName,
      };


      // Mirror into manual fallback
      this.manualData = { ...this._mapData };

      // Refresh settings UI
      if (typeof (window as any).refreshGISMapSettingsCard === "function") {
        (window as any).refreshGISMapSettingsCard();
      }
      if (typeof (window as any).refreshGISMapSettingsSection === "function") {
        (window as any).refreshGISMapSettingsSection();
      }

      if (this._enabled) this.updateMapTiles();
      return true;

    } catch (err) {
      console.error("[GISMap] Error parsing IFC buffer for georeferencing:", err);
      return false;
    }
  }




  /**
   * Helper math to convert slippy map tile to Longitude & Latitude
   */
  private tileToLonLat(x: number, y: number, z: number) {
    const n = Math.pow(2, z);
    const lon = (x / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const lat = (latRad * 180) / Math.PI;
    return { lon, lat };
  }

  /**
   * Helper math to convert Longitude & Latitude to slippy map tile
   */
  private lonLatToTile(lon: number, lat: number, z: number) {
    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, z);
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    return { x, y };
  }

  /**
   * Convert EPSG:5514 plane coordinates to Three.js scene coordinates
   */
  private crsToThree(easting: number, northing: number, data: GISMapData): THREE.Vector3 {
    // Rotation values
    const A = data.xAxisAbscissa;
    const B = data.xAxisOrdinate;
    const L = Math.sqrt(A * A + B * B);
    const cosTheta = L > 0 ? A / L : 1;
    const sinTheta = L > 0 ? B / L : 0;

    const E = data.eastings;
    const N = data.northings;
    const S = data.scale;

    // Relative offset from Map Conversion origin
    const deltaX = (easting - E) / S;
    const deltaY = (northing - N) / S;

    // Apply rotation (inverse Map Conversion coordinate transform)
    const xIfc = deltaX * cosTheta + deltaY * sinTheta;
    const yIfc = -deltaX * sinTheta + deltaY * cosTheta;
    const zIfc = 0; // Relative height to orthogonal height is 0 for ground plane

    // Map IFC local axes to Three.js axes:
    // Three X = IFC X
    // Three Y = IFC Z (Up)
    // Three Z = -IFC Y
    return new THREE.Vector3(xIfc, zIfc, -yIfc);
  }

  /**
   * Clear and dispose of loaded tile resources
   */
  clearMap() {
    this._tileCache.forEach((mesh) => {
      this.mapGroup.remove(mesh);
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (material.map) material.map.dispose();
      material.dispose();
    });
    this._tileCache.clear();
  }

  /**
   * Re-calculates and renders the map tiles around the georeferenced center
   */
  updateMapTiles() {
    if (!this._world) return;

    this.clearMap();

    // Use detected georeferencing or manual fallback settings
    const activeData = this._mapData || this.manualData;

    // Step 1: Convert the center georeferenced coordinate (Eastings, Northings) to Latitude/Longitude
    let lonCenter = 14.41; // Fallbacks
    let latCenter = 50.08;
    try {
      const [lon, lat] = krovakToWgs84(activeData.eastings, activeData.northings);
      lonCenter = lon;
      latCenter = lat;
    } catch (err) {
      console.error("[GISMap] Failed to convert EPSG:5514 coordinates:", err);
    }

    // Step 2: Compute slippy map tile index of the center
    const centerTile = this.lonLatToTile(lonCenter, latCenter, this._zoom);
    // Step 3: Draw a grid of tiles around the center
    const halfGrid = Math.floor(this._gridSize / 2);
    
    for (let dx = -halfGrid; dx <= halfGrid; dx++) {
      for (let dy = -halfGrid; dy <= halfGrid; dy++) {
        const tx = centerTile.x + dx;
        const ty = centerTile.y + dy;
        this.loadTile(tx, ty, this._zoom, activeData);
      }
    }
  }

  /**
   * Create plane geometry and load texture for a specific tile
   */
  private loadTile(tx: number, ty: number, z: number, data: GISMapData) {
    const tileKey = `${z}_${tx}_${ty}`;

    // Get WGS84 coordinates of the four corners of this tile
    const tl = this.tileToLonLat(tx, ty, z);
    const tr = this.tileToLonLat(tx + 1, ty, z);
    const br = this.tileToLonLat(tx + 1, ty + 1, z);
    const bl = this.tileToLonLat(tx, ty + 1, z);

    const tlEPSG = wgs84ToKrovak(tl.lon, tl.lat);
    const trEPSG = wgs84ToKrovak(tr.lon, tr.lat);
    const brEPSG = wgs84ToKrovak(br.lon, br.lat);
    const blEPSG = wgs84ToKrovak(bl.lon, bl.lat);

    // Map EPSG:5514 corners to Three.js local space
    const pTL = this.crsToThree(tlEPSG[0], tlEPSG[1], data);
    const pTR = this.crsToThree(trEPSG[0], trEPSG[1], data);
    const pBR = this.crsToThree(brEPSG[0], brEPSG[1], data);
    const pBL = this.crsToThree(blEPSG[0], blEPSG[1], data);

    // Create a custom skewed BufferGeometry representing this tile
    const vertices = new Float32Array([
      pTL.x, pTL.y, pTL.z, // 0: Top-Left
      pTR.x, pTR.y, pTR.z, // 1: Top-Right
      pBR.x, pBR.y, pBR.z, // 2: Bottom-Right
      pBL.x, pBL.y, pBL.z, // 3: Bottom-Left
    ]);

    const uvs = new Float32Array([
      0, 1, // TL
      1, 1, // TR
      1, 0, // BR
      0, 0, // BL
    ]);

    const indices = [0, 3, 2, 0, 2, 1];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Map URL parsing
    const url = this._tileUrlTemplate
      .replace("{z}", String(z))
      .replace("{x}", String(tx))
      .replace("{y}", String(ty));

    // Create texture and material
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: this._opacity < 1.0,
      opacity: this._opacity,
      depthWrite: false, // Prevents interfering with building depths
    });

    this._textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => {
        // Log error and apply dummy placeholder texture
        console.warn(`[GISMap] Failed to load map tile image: ${url}`);
        
        // Draw a placeholder checkered/outline texture for offline visual helper
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.strokeStyle = "#4e6a8e";
          ctx.lineWidth = 2;
          ctx.strokeRect(0, 0, 128, 128);
          ctx.fillStyle = "rgba(78, 106, 142, 0.1)";
          ctx.fillRect(0, 0, 128, 128);
          ctx.fillStyle = "#4e6a8e";
          ctx.font = "12px monospace";
          ctx.fillText(`x:${tx}`, 10, 30);
          ctx.fillText(`y:${ty}`, 10, 50);
          ctx.fillText(`z:${z}`, 10, 70);
        }
        const texture = new THREE.CanvasTexture(canvas);
        material.map = texture;
        material.needsUpdate = true;
      }
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Map_Tile_${tileKey}`;
    this.mapGroup.add(mesh);
    this._tileCache.set(tileKey, mesh);
  }
}

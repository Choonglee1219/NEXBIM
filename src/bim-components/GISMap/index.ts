import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { krovakToWgs84 } from "./krovak";
import { normalizeIfcSitePlacement, parseStepArguments, parseDmsToDecimal } from "./georef-defense";
export * from "./georef-defense";

export interface GISMapData {
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  scale: number;
  crsName: string;
  sourceType?: "IFC4_MAP_CONVERSION" | "LEGACY_IFC_SITE" | "MANUAL";
  latitude?: number;
  longitude?: number;
}

export type MapSourceType = "offline" | "osm" | "carto-light";

export const MapSourceUrls: Record<MapSourceType, string> = {
  "offline": "/map-tiles/{z}/{x}/{y}.png",
  "osm": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "carto-light": "https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png"
};

export const DEFAULT_MANUAL_GEOREF: Readonly<GISMapData> = {
  eastings: -634016.937824,
  northings: -1168325.998753,
  orthogonalHeight: 389.400,
  xAxisAbscissa: 0.878091,
  xAxisOrdinate: -0.478494,
  scale: 1.0,
  crsName: "EPSG:5514",
  sourceType: "MANUAL",
};

export class GISMapComponent extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "cf2b4b24-b152-4416-a36c-94a0d9b4b0e5" as const;

  readonly onDisposed = new OBC.Event();
  readonly onGeorefChanged = new OBC.Event<GISMapData | null>();

  // Three.js elements
  private _world: OBC.World | null = null;
  mapGroup = new THREE.Group();
  private _tileCache = new Map<string, THREE.Mesh>();
  private _textureLoader = new THREE.TextureLoader();

  // Settings state
  private _enabled = false;
  private _opacity = 0.3;
  private _heightOffset = -0.5;
  private _zoom = 15;
  private _tileUrlTemplate = "/map-tiles/{z}/{x}/{y}.png";
  private _gridSize = 5;
  private _mapSource: MapSourceType = "offline";

  // Georeferencing parameters
  private _mapData: GISMapData | null = null;
  private _modelsGeoref = new Map<string, GISMapData>();
  private _modelsAvailableGeoref = new Map<string, { ifc4?: GISMapData; legacy?: GISMapData }>();
  private _globalAvailableGeoref: { ifc4?: GISMapData; legacy?: GISMapData } | null = null;

  // Custom manual settings fallback
  manualData: GISMapData = { ...DEFAULT_MANUAL_GEOREF };

  constructor(components: OBC.Components) {
    super(components);
    this.mapGroup.name = "GIS_Map_Group";
    this.mapGroup.visible = this._enabled;
  }

  private _fragmentsListenerAttached = false;

  private setupFragmentsListener() {
    if (this._fragmentsListenerAttached) return;
    try {
      const fragments = this.components.get(OBC.FragmentsManager);
      if (fragments?.initialized) {
        this._fragmentsListenerAttached = true;
        fragments.list.onItemDeleted.add((id) => {
          this._modelsGeoref.delete(id);
          this._modelsAvailableGeoref.delete(id);
          if (fragments.list.size === 0) {
            this.resetGeoref();
          } else {
            this.applyGISTransforms();
          }
        });
      }
    } catch (_) { }
  }

  get modelsGeoref(): ReadonlyMap<string, GISMapData> {
    return this._modelsGeoref;
  }

  get modelsAvailableGeoref(): ReadonlyMap<string, { ifc4?: GISMapData; legacy?: GISMapData }> {
    return this._modelsAvailableGeoref;
  }

  get globalAvailableGeoref(): { ifc4?: GISMapData; legacy?: GISMapData } | null {
    return this._globalAvailableGeoref;
  }

  /**
   * Switches the applied georeference type for all loaded models
   */
  setModelGeorefType(
    modelId: string | null | undefined,
    type: "IFC4_MAP_CONVERSION" | "LEGACY_IFC_SITE" | "MANUAL",
    customManualData?: GISMapData
  ): boolean {
    if (type === "MANUAL") {
      if (customManualData) {
        this.manualData = { ...customManualData, sourceType: "MANUAL" };
      } else if (!this.manualData || this.manualData.sourceType !== "MANUAL") {
        this.manualData = { ...DEFAULT_MANUAL_GEOREF };
      }
      const manualTarget: GISMapData = { ...this.manualData };
      if (!modelId) {
        for (const [id] of this._modelsAvailableGeoref) {
          this._modelsGeoref.set(id, manualTarget);
        }
      } else {
        this._modelsGeoref.set(modelId, manualTarget);
      }
      this._mapData = manualTarget;
      this.onGeorefChanged.trigger(manualTarget);
      this.applyGISTransforms();
      if (this._enabled) {
        this.updateMapTiles();
      }
      if (typeof window !== "undefined" && typeof (window as any).refreshGISMapSettingsSection === "function") {
        (window as any).refreshGISMapSettingsSection();
      }
      return true;
    }

    if (!modelId) {
      for (const [id, avail] of this._modelsAvailableGeoref) {
        const target = type === "IFC4_MAP_CONVERSION" ? avail.ifc4 : avail.legacy;
        if (target) this._modelsGeoref.set(id, target);
      }
    } else {
      const avail = this._modelsAvailableGeoref.get(modelId) || this._globalAvailableGeoref;
      if (avail) {
        const target = type === "IFC4_MAP_CONVERSION" ? avail.ifc4 : avail.legacy;
        if (target) this._modelsGeoref.set(modelId, target);
      }
    }

    // Set primary anchor target
    let firstLoadedId: string | undefined = undefined;
    try {
      const fragments = this.components.get(OBC.FragmentsManager);
      if (fragments?.initialized && fragments.list) {
        firstLoadedId = Array.from(fragments.list.keys())[0];
      }
    } catch (_) {}

    const primaryTarget = (firstLoadedId && this._modelsGeoref.get(firstLoadedId))
      || (modelId && this._modelsGeoref.get(modelId))
      || (type === "IFC4_MAP_CONVERSION" ? this._globalAvailableGeoref?.ifc4 : this._globalAvailableGeoref?.legacy);

    if (primaryTarget) {
      this._mapData = primaryTarget;
      this.onGeorefChanged.trigger(primaryTarget);
    }

    this.applyGISTransforms();
    if (this._enabled) {
      this.updateMapTiles();
    }

    if (typeof window !== "undefined" && typeof (window as any).refreshGISMapSettingsSection === "function") {
      (window as any).refreshGISMapSettingsSection();
    }
    return true;
  }

  registerModelGeoref(modelId: string, data: GISMapData) {
    this._modelsGeoref.set(modelId, data);
    if (!this._mapData) {
      this._mapData = data;
    }
    this.setupFragmentsListener();
    this.applyGISTransforms();
    if (this._enabled) {
      this.updateMapTiles();
    }
  }

  applyGISTransforms() {
    this.setupFragmentsListener();
    let fragments: OBC.FragmentsManager;
    try {
      fragments = this.components.get(OBC.FragmentsManager);
      if (!fragments.initialized) return;
    } catch (_) {
      return;
    }

    for (const [id] of fragments.list) {
      this.applyGISTransformToModel(id);
    }
  }

  applyGISTransformToModel(modelId: string) {
    let fragments: OBC.FragmentsManager;
    try {
      fragments = this.components.get(OBC.FragmentsManager);
      if (!fragments.initialized) return;
    } catch (_) {
      return;
    }

    const model = fragments.list.get(modelId);
    if (!model || !model.object) return;

    const anchorData = this._mapData || this.manualData;
    const data = this._modelsGeoref.get(modelId) || anchorData;

    const toMeters = (v: number | undefined) => {
      if (v === undefined || isNaN(v)) return 0;
      return Math.abs(v) > 10_000_000 ? v / 1000 : v;
    };

    // Metric offset from Project Anchor: Three.js +X = East, -Z = North, +Y = Height
    const deltaX = toMeters(data.eastings) - toMeters(anchorData.eastings);
    const deltaZ = -(toMeters(data.northings) - toMeters(anchorData.northings));
    const deltaY = toMeters(data.orthogonalHeight) - toMeters(anchorData.orthogonalHeight);

    if (this._enabled && (data.sourceType === "IFC4_MAP_CONVERSION" || data.sourceType === "MANUAL")) {
      const phi = (data.xAxisAbscissa !== undefined && data.xAxisOrdinate !== undefined)
        ? Math.atan2(data.xAxisOrdinate, data.xAxisAbscissa)
        : 0;
      model.object.position.set(deltaX, deltaY, deltaZ);
      model.object.rotation.set(0, phi, 0);
    } else {
      model.object.position.set(deltaX, deltaY, deltaZ);
      model.object.rotation.set(0, 0, 0);
    }

    model.object.updateMatrix();
    model.object.updateMatrixWorld(true);
  }

  resetGeoref() {
    this._mapData = null;
    this._modelsGeoref.clear();
    this._modelsAvailableGeoref.clear();
    this._globalAvailableGeoref = null;
    this.applyGISTransforms();
    this.onGeorefChanged.trigger(null);
    if (typeof window !== "undefined" && typeof (window as any).refreshGISMapSettingsSection === "function") {
      (window as any).refreshGISMapSettingsSection();
    }
    if (this._enabled && this._world) {
      this.updateMapTiles();
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (this._enabled !== value) {
      this._enabled = value;
      this.mapGroup.visible = value;
      this.applyGISTransforms();
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
  detectGeorefFromBuffer(buffer: Uint8Array, modelId?: string): boolean {
    try {
      let text = new TextDecoder().decode(buffer);
      let mcBlockMatch = text.match(
        /#\d+\s*=\s*IFCMAPCONVERSION\s*\(([^;]+)\)\s*;/i
      );

      // ── IfcProjectedCRS: first parameter is the CRS name string ──────────────
      // Format: #NNN= IFCPROJECTEDCRS('CRS_NAME', ...);
      const crsMatch = text.match(/#\d+\s*=\s*IFCPROJECTEDCRS\s*\(\s*'([^']+)'/i);
      const crsName = crsMatch ? crsMatch[1] : "EPSG:5514";

      // Also extract WGS84 RefLatitude / RefLongitude from IfcSite if available
      let siteLat: number | undefined = undefined;
      let siteLon: number | undefined = undefined;
      const siteMatch = text.match(/#\d+\s*=\s*IFCSITE\s*\(([^;]+)\)\s*;/i);
      if (siteMatch) {
        const siteArgs = parseStepArguments(siteMatch[1]);
        if (siteArgs.length >= 11) {
          const lat = parseDmsToDecimal(siteArgs[9]);
          const lon = parseDmsToDecimal(siteArgs[10]);
          if (lat !== null && lon !== null) {
            siteLat = lat;
            siteLon = lon;
          }
        }
      }

      let ifc4Georef: GISMapData | null = null;
      let legacyGeoref: GISMapData | null = null;

      // 1. Check IfcMapConversion (IFC4 standard)
      if (mcBlockMatch) {
        const mcArgs = parseStepArguments(mcBlockMatch[1]);
        const parseVal = (str: string | undefined, def: number) => {
          if (!str || str === "$") return def;
          const n = parseFloat(str);
          return isNaN(n) ? def : n;
        };

        ifc4Georef = {
          eastings: parseVal(mcArgs[2], 0),
          northings: parseVal(mcArgs[3], 0),
          orthogonalHeight: parseVal(mcArgs[4], 0),
          xAxisAbscissa: parseVal(mcArgs[5], 1.0),
          xAxisOrdinate: parseVal(mcArgs[6], 0.0),
          scale: parseVal(mcArgs[7], 1.0),
          crsName,
          sourceType: "IFC4_MAP_CONVERSION",
          latitude: siteLat,
          longitude: siteLon,
        };
      }

      // 2. Check Legacy IfcSite georeference (IfcSite.ObjectPlacement / TrueNorth / DMS)
      const { legacySiteGeoref } = normalizeIfcSitePlacement(buffer);
      if (legacySiteGeoref) {
        legacyGeoref = {
          eastings: legacySiteGeoref.eastings,
          northings: legacySiteGeoref.northings,
          orthogonalHeight: legacySiteGeoref.orthogonalHeight,
          xAxisAbscissa: legacySiteGeoref.xAxisAbscissa,
          xAxisOrdinate: legacySiteGeoref.xAxisOrdinate,
          scale: 1.0,
          crsName: "EPSG:5514",
          sourceType: "LEGACY_IFC_SITE",
          latitude: legacySiteGeoref.latitude,
          longitude: legacySiteGeoref.longitude,
        };
      }

      // 3. If neither detected, set default manualData as active georeference
      if (!ifc4Georef && !legacyGeoref) {
        console.log("[GISMap] No georeferencing detected in file. Defaulting to MANUAL with default coordinates.");
        this._globalAvailableGeoref = null;
        const manualTarget: GISMapData = {
          ...this.manualData,
          sourceType: "MANUAL",
        };
        this._mapData = manualTarget;
        if (modelId) {
          this._modelsGeoref.set(modelId, manualTarget);
        }
        this.onGeorefChanged.trigger(manualTarget);
        this.applyGISTransforms();
        if (typeof window !== "undefined" && typeof (window as any).refreshGISMapSettingsSection === "function") {
          (window as any).refreshGISMapSettingsSection();
        }
        return false;
      }

      // 4. Save available georeferences for dual-type manual selection
      const dualEntry = {
        ifc4: ifc4Georef || undefined,
        legacy: legacyGeoref || undefined,
      };
      this._globalAvailableGeoref = dualEntry;
      if (modelId) {
        this._modelsAvailableGeoref.set(modelId, dualEntry);
      }

      // 5. Default priority:
      // If legacy IfcSite georeference contains large global coordinates (> 100,000m / 100km),
      // prioritize it so legacy global building placements are placed at their actual locations!
      let chosenGeoref: GISMapData;
      if (legacyGeoref && (!ifc4Georef || Math.abs(legacyGeoref.eastings) > 100000 || Math.abs(legacyGeoref.northings) > 100000)) {
        chosenGeoref = legacyGeoref;
      } else {
        chosenGeoref = ifc4Georef || legacyGeoref || { ...this.manualData, sourceType: "MANUAL" };
      }

      if (ifc4Georef && legacyGeoref) {
        console.log(
          `[GISMap] Dual georeferencing detected for model '${modelId || "active"}': Both IFC4 and Legacy IfcSite are available. Defaulting to ${chosenGeoref.sourceType}. User can toggle in settings.`
        );
      } else {
        console.log(`[GISMap] Georeferencing detected: ${chosenGeoref.sourceType}`);
      }

      // Set anchor data from the first loaded model
      if (!this._mapData) {
        this._mapData = chosenGeoref;
      }
      if (modelId) {
        this.registerModelGeoref(modelId, chosenGeoref);
      }
      this.onGeorefChanged.trigger(this._mapData || chosenGeoref);

      // Refresh settings UI
      if (typeof window !== "undefined" && typeof (window as any).refreshGISMapSettingsSection === "function") {
        (window as any).refreshGISMapSettingsSection();
      }

      this.applyGISTransforms();
      if (this._enabled) {
        this.updateMapTiles();
      }
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
   * Converts WGS84 Longitude & Latitude to Three.js scene coordinates (meters)
   * relative to the anchor origin (lon0, lat0).
   * Resulting in a perfectly orthogonal, untilted, straight map canvas!
   */
  private wgs84ToThree(lon: number, lat: number, lon0: number, lat0: number): THREE.Vector3 {
    const R = 6378137.0; // WGS84 semi-major axis in meters
    const rad = Math.PI / 180;
    const cosLat0 = Math.cos(lat0 * rad);

    // Easting distance in meters (+X = East)
    const x = (lon - lon0) * rad * R * cosLat0;
    // Northing distance in meters (-Z = North in Three.js standard)
    const z = -(lat - lat0) * rad * R;

    return new THREE.Vector3(x, 0, z);
  }

  /**
   * Clear and dispose of loaded tile resources
   */
  clearMap() {
    let post: any = null;
    if (this._world && this._world.renderer && "postproduction" in this._world.renderer) {
      post = (this._world.renderer as any).postproduction;
    }

    this._tileCache.forEach((mesh) => {
      this.mapGroup.remove(mesh);
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (post && post.excludedObjectsPass) {
        post.excludedObjectsPass.removeExcludedMaterial(material);
      }
      mesh.geometry.dispose();
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
    const sanitize = (v: number) => (Math.abs(v) > 10_000_000 ? v / 1000 : v);
    const eCenter = sanitize(activeData.eastings);
    const nCenter = sanitize(activeData.northings);

    // Step 1: Convert the center georeferenced coordinate (Eastings, Northings) to Latitude/Longitude
    let lonCenter = 14.41; // Fallbacks
    let latCenter = 50.08;

    try {
      const [lon, lat] = krovakToWgs84(eCenter, nCenter);
      lonCenter = lon;
      latCenter = lat;
    } catch (err) {
      console.error("[GISMap] Failed to convert EPSG:5514 coordinates:", err);
      if (activeData.latitude !== undefined && activeData.longitude !== undefined) {
        latCenter = activeData.latitude;
        lonCenter = activeData.longitude;
      }
    }

    // Step 2: Compute slippy map tile index of the center
    const centerTile = this.lonLatToTile(lonCenter, latCenter, this._zoom);
    // Step 3: Draw a grid of tiles around the center
    const halfGrid = Math.floor(this._gridSize / 2);

    for (let dx = -halfGrid; dx <= halfGrid; dx++) {
      for (let dy = -halfGrid; dy <= halfGrid; dy++) {
        const tx = centerTile.x + dx;
        const ty = centerTile.y + dy;
        this.loadTile(tx, ty, this._zoom, lonCenter, latCenter);
      }
    }
  }

  /**
   * Create plane geometry and load texture for a specific tile (straight orthogonal rectangle)
   */
  private loadTile(tx: number, ty: number, z: number, lonCenter: number, latCenter: number) {
    const tileKey = `${z}_${tx}_${ty}`;

    // Get WGS84 coordinates of the four corners of this tile
    const tl = this.tileToLonLat(tx, ty, z);
    const tr = this.tileToLonLat(tx + 1, ty, z);
    const br = this.tileToLonLat(tx + 1, ty + 1, z);
    const bl = this.tileToLonLat(tx, ty + 1, z);

    // Map WGS84 corners directly to straight Three.js orthogonal space
    const pTL = this.wgs84ToThree(tl.lon, tl.lat, lonCenter, latCenter);
    const pTR = this.wgs84ToThree(tr.lon, tr.lat, lonCenter, latCenter);
    const pBR = this.wgs84ToThree(br.lon, br.lat, lonCenter, latCenter);
    const pBL = this.wgs84ToThree(bl.lon, bl.lat, lonCenter, latCenter);

    // Create a perfectly straight rectangular BufferGeometry representing this tile
    const vertices = new Float32Array([
      pTL.x, 0, pTL.z, // 0: Top-Left
      pTR.x, 0, pTR.z, // 1: Top-Right
      pBR.x, 0, pBR.z, // 2: Bottom-Right
      pBL.x, 0, pBL.z, // 3: Bottom-Left
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

    // Exclude this specific mesh material from postproduction outlines
    if (this._world && this._world.renderer && "postproduction" in this._world.renderer) {
      const post = (this._world.renderer as any).postproduction;
      if (post && post.excludedObjectsPass) {
        post.excludedObjectsPass.addExcludedMaterial(material);
      }
    }
  }
}

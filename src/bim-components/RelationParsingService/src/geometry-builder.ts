import * as THREE from "three";
import * as WebIFC from "web-ifc";
import { ModelRelationData } from "./types";

let ifcApiInstance: WebIFC.IfcAPI | null = null;

/**
 * WebIFC API 싱글톤 인스턴스를 반환합니다.
 */
export async function getSharedWebIfcApi(): Promise<WebIFC.IfcAPI> {
  if (!ifcApiInstance) {
    const api = new WebIFC.IfcAPI();
    try {
      api.SetWasmPath("/node_modules/web-ifc/");
      await api.Init();
      ifcApiInstance = api;
    } catch (err) {
      console.warn("[RelationParsingService] Local wasm failed, trying unpkg CDN fallback:", err);
      const fallbackApi = new WebIFC.IfcAPI();
      fallbackApi.SetWasmPath("https://unpkg.com/web-ifc@0.0.77/");
      await fallbackApi.Init();
      ifcApiInstance = fallbackApi;
    }
  }
  return ifcApiInstance;
}

export interface GeometryBuildResult {
  openingsGroup: THREE.Group;
  spatialZonesGroup: THREE.Group;
}

// 🎨 재사용 가능한 공유 머티리얼 싱글톤 (메모리 절약 & 드로우콜 최적화)
const SHARED_MATERIALS = {
  opening: new THREE.MeshStandardMaterial({
    color: new THREE.Color("#f59e0b"),
    transparent: true,
    opacity: 0.45,
    roughness: 0.2,
    metalness: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  openingEdge: new THREE.LineBasicMaterial({
    color: new THREE.Color("#d97706"),
    transparent: true,
    opacity: 0.9,
    linewidth: 1,
  }),
  zone: new THREE.MeshStandardMaterial({
    color: new THREE.Color("#9d4edd"),
    transparent: true,
    opacity: 0.3,
    roughness: 0.3,
    metalness: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  zoneEdge: new THREE.LineBasicMaterial({
    color: new THREE.Color("#c77dff"),
    transparent: true,
    opacity: 0.8,
    linewidth: 1,
  }),
};

/**
 * WebIFC PlacedGeometry로부터 Three.js BufferGeometry 및 엣지 라인을 고속 빌드합니다.
 */
function buildBufferGeometryAndLine(
  api: WebIFC.IfcAPI,
  modelID: number,
  placed: WebIFC.PlacedGeometry,
  material: THREE.Material,
  edgeMaterial: THREE.Material,
  userData: any,
  renderOrder = 10
): { mesh: THREE.Mesh; line: THREE.LineSegments } {
  const geom = api.GetGeometry(modelID, placed.geometryExpressID);
  const rawVerts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
  const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
  const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation);

  const numVerts = Math.floor(rawVerts.length / 6);
  const positions = new Float32Array(numVerts * 3);
  const normals = new Float32Array(numVerts * 3);

  for (let j = 0, p = 0; j < rawVerts.length; j += 6, p += 3) {
    positions[p] = rawVerts[j];
    positions[p + 1] = rawVerts[j + 1];
    positions[p + 2] = rawVerts[j + 2];
    normals[p] = rawVerts[j + 3];
    normals[p + 1] = rawVerts[j + 4];
    normals[p + 2] = rawVerts[j + 5];
  }

  const bufferGeo = new THREE.BufferGeometry();
  bufferGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  bufferGeo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  bufferGeo.setIndex(Array.from(indices));
  bufferGeo.applyMatrix4(matrix);

  const mesh = new THREE.Mesh(bufferGeo, material);
  mesh.renderOrder = renderOrder;
  mesh.userData = userData;

  const edges = new THREE.EdgesGeometry(bufferGeo, 24);
  const line = new THREE.LineSegments(edges, edgeMaterial);
  line.renderOrder = renderOrder + 1;

  return { mesh, line };
}

/**
 * 원본 IFC 바이너리로부터 IfcOpeningElement 및 IfcSpatialZone의 3D 지오메트리를 생성합니다.
 */
export async function buildModelGeometries(
  ifcBuffer: Uint8Array,
  modelId: string,
  relationData: ModelRelationData
): Promise<GeometryBuildResult> {
  const api = await getSharedWebIfcApi();
  const openingsGroup = new THREE.Group();
  openingsGroup.name = `Openings_${modelId}`;

  const spatialZonesGroup = new THREE.Group();
  spatialZonesGroup.name = `SpatialZones_${modelId}`;

  let modelID: number | null = null;

  try {
    modelID = api.OpenModel(ifcBuffer, {
      COORDINATE_TO_ORIGIN: false,
      USE_FAST_BOOLS: true,
    } as any);

    // 1. IfcOpeningElement 3D 메쉬 생성
    for (const [expressId, opData] of relationData.openings.entries()) {
      try {
        const flatMesh = api.GetFlatMesh(modelID, expressId);
        if (!flatMesh || flatMesh.geometries.size() === 0) continue;

        const elemGroup = new THREE.Group();
        elemGroup.name = `Opening_${expressId}`;
        elemGroup.userData = {
          modelId,
          expressId,
          type: "IFCOPENINGELEMENT",
          name: opData.name || `Opening #${expressId}`,
          parentExpressId: opData.parentExpressId,
          fillingExpressIds: opData.fillingExpressIds,
        };

        for (let i = 0; i < flatMesh.geometries.size(); i++) {
          const placed = flatMesh.geometries.get(i);
          const { mesh, line } = buildBufferGeometryAndLine(
            api,
            modelID,
            placed,
            SHARED_MATERIALS.opening,
            SHARED_MATERIALS.openingEdge,
            elemGroup.userData,
            10
          );
          elemGroup.add(mesh);
          elemGroup.add(line);
        }

        if (elemGroup.children.length > 0) {
          openingsGroup.add(elemGroup);
        }
      } catch (e) {
        // 개별 복합 개구부 파싱 오류 격리
      }
    }

    // 2. IfcSpatialZone 3D 메쉬 생성
    const tempVec = new THREE.Vector3();

    for (const [expressId, zoneData] of relationData.spatialZones.entries()) {
      try {
        let hasDirectMesh = false;
        try {
          const flatMesh = api.GetFlatMesh(modelID, expressId);
          if (flatMesh && flatMesh.geometries.size() > 0) {
            const zoneGroup = new THREE.Group();
            zoneGroup.name = `SpatialZone_${expressId}`;
            zoneGroup.userData = {
              modelId,
              expressId,
              type: "IFCSPATIALZONE",
              name: zoneData.name || zoneData.longName || `SpatialZone #${expressId}`,
              referencedElementIds: zoneData.referencedElementIds,
            };

            for (let i = 0; i < flatMesh.geometries.size(); i++) {
              const placed = flatMesh.geometries.get(i);
              const { mesh, line } = buildBufferGeometryAndLine(
                api,
                modelID,
                placed,
                SHARED_MATERIALS.zone,
                SHARED_MATERIALS.zoneEdge,
                zoneGroup.userData,
                5
              );
              zoneGroup.add(mesh);
              zoneGroup.add(line);
            }

            if (zoneGroup.children.length > 0) {
              spatialZonesGroup.add(zoneGroup);
              hasDirectMesh = true;
            }
          }
        } catch (err) { }

        // 직접 메쉬가 없고 참조 부재들이 있는 경우: Bounding Box 볼륨 박스 자동 생성
        if (!hasDirectMesh && zoneData.referencedElementIds.length > 0) {
          const zoneBox = new THREE.Box3();
          let count = 0;

          for (const refId of zoneData.referencedElementIds) {
            try {
              const refMesh = api.GetFlatMesh(modelID, refId);
              if (!refMesh) continue;
              for (let i = 0; i < refMesh.geometries.size(); i++) {
                const placed = refMesh.geometries.get(i);
                const geom = api.GetGeometry(modelID, placed.geometryExpressID);
                const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
                const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation);

                for (let j = 0; j < verts.length; j += 6) {
                  tempVec.set(verts[j], verts[j + 1], verts[j + 2]).applyMatrix4(matrix);
                  zoneBox.expandByPoint(tempVec);
                  count++;
                }
              }
            } catch (err) { }
          }

          if (count > 0 && !zoneBox.isEmpty()) {
            const size = new THREE.Vector3();
            zoneBox.getSize(size);
            size.addScalar(0.2); // 시각적 여유 패딩

            const center = new THREE.Vector3();
            zoneBox.getCenter(center);

            const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
            boxGeo.translate(center.x, center.y, center.z);

            const zoneGroup = new THREE.Group();
            zoneGroup.name = `SpatialZone_Box_${expressId}`;
            zoneGroup.userData = {
              modelId,
              expressId,
              type: "IFCSPATIALZONE",
              name: zoneData.name || zoneData.longName || `SpatialZone #${expressId}`,
              referencedElementIds: zoneData.referencedElementIds,
            };

            const mesh = new THREE.Mesh(boxGeo, SHARED_MATERIALS.zone);
            mesh.userData = zoneGroup.userData;
            mesh.renderOrder = 5;
            zoneGroup.add(mesh);

            const edges = new THREE.EdgesGeometry(boxGeo);
            const line = new THREE.LineSegments(edges, SHARED_MATERIALS.zoneEdge);
            line.renderOrder = 6;
            zoneGroup.add(line);

            spatialZonesGroup.add(zoneGroup);
          }
        }
      } catch (e) {
        // 개별 공간 구역 오류 격리
      }
    }
  } finally {
    if (modelID !== null) {
      try {
        api.CloseModel(modelID);
      } catch (e) { }
    }
  }

  return { openingsGroup, spatialZonesGroup };
}

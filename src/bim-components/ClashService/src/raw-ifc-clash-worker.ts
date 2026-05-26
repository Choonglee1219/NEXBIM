import * as THREE from "three";
import * as WebIFC from "web-ifc";
import { checkOBBIntersection, getBVH, meshesIntersect, meshMinDist } from "./obb-collision";

// Worker 메모리 상주형 데이터 캐시
let ifcApi: WebIFC.IfcAPI | null = null;
const modelGeometryCache = new Map<string, Map<number, any>>();
const bvhCache = new Map<string, any>();

async function getIfcApi() {
  if (!ifcApi) {
    ifcApi = new WebIFC.IfcAPI();
    ifcApi.SetWasmPath("/node_modules/web-ifc/");
    await ifcApi.Init();
  }
  return ifcApi;
}

self.onmessage = async (e) => {
  const { action, modelId } = e.data;

  // 모델 삭제 시 캐시 메모리를 정리합니다.
  if (action === "clear" && modelId) {
    modelGeometryCache.delete(modelId);
    for (const key of bvhCache.keys()) {
      if (key.startsWith(`${modelId}-`)) {
        bvhCache.delete(key);
      }
    }
    return;
  }

  if (action === "detect") {
    const { jobId, modelsData, setA, setB, isSelfClash, options } = e.data;
  
    try {
      const api = await getIfcApi();

      const toSet = (obj: any) => {
        if (!obj) return new Set<number>();
        if (obj instanceof Set) return obj;
        if (Array.isArray(obj)) return new Set<number>(obj);
        if (typeof obj === "object") return new Set<number>(Object.keys(obj).map(Number));
        return new Set<number>();
      };

      const mapA = new Map<string, Set<number>>();
      for (const [mId, ids] of Object.entries(setA || {})) mapA.set(mId, toSet(ids));

      const mapB = new Map<string, Set<number>>();
      for (const [mId, ids] of Object.entries(setB || {})) mapB.set(mId, toSet(ids));

      // 1. 아직 캐싱되지 않은 모델만 한 번 파싱합니다.
      for (const model of modelsData) {
        if (modelGeometryCache.has(model.id)) continue;
        if (!model.buffer) continue; // 메인 스레드가 이미 캐싱되었다고 판단하여 버퍼를 생략한 경우
        
        const elementsMap = new Map<number, any>();
        const modelID = api.OpenModel(new Uint8Array(model.buffer), { USE_FAST_BOOLS: true } as any);

        const skipTypes = new Set([3588315303, 3856911033, 2769231204, 1674181508, 3009204131]);
        const skipGeoEids = new Set<number>();
        for (const stid of skipTypes) {
          try {
            const stids = api.GetLineIDsWithType(modelID, stid);
            for (let stj = 0; stj < stids.size(); stj++) {
              skipGeoEids.add(stids.get(stj));
            }
          } catch (e) {}
        }
        api.StreamAllMeshes(modelID, (ifcMesh) => {
          const expressID = ifcMesh.expressID;
          if (skipGeoEids.has(expressID)) return;

          const trisChunks: Float32Array[] = [];
          let totalLength = 0;
          const worldBox = new THREE.Box3();
          let obb: any = null;

          for (let i = 0; i < ifcMesh.geometries.size(); i++) {
            const placed = ifcMesh.geometries.get(i);
            
            const c = placed.color;
            if (c && c.w < 0.05) continue;

            const geom = api.GetGeometry(modelID, placed.geometryExpressID);
            const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
            const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
            const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation);

            const localBox = new THREE.Box3();
            const v = new THREE.Vector3();

            const chunk = new Float32Array(indices.length * 3);
            let chunkOffset = 0;

            for (let j = 0; j < verts.length; j += 6) {
              v.set(verts[j], verts[j + 1], verts[j + 2]);
              localBox.expandByPoint(v);
            }

            for (let j = 0; j < indices.length; j += 3) {
              const idx0 = indices[j] * 6;
              const idx1 = indices[j + 1] * 6;
              const idx2 = indices[j + 2] * 6;

              const v0 = new THREE.Vector3(verts[idx0], verts[idx0+1], verts[idx0+2]).applyMatrix4(matrix);
              const v1 = new THREE.Vector3(verts[idx1], verts[idx1+1], verts[idx1+2]).applyMatrix4(matrix);
              const v2 = new THREE.Vector3(verts[idx2], verts[idx2+1], verts[idx2+2]).applyMatrix4(matrix);

              chunk[chunkOffset++] = v0.x; chunk[chunkOffset++] = v0.y; chunk[chunkOffset++] = v0.z;
              chunk[chunkOffset++] = v1.x; chunk[chunkOffset++] = v1.y; chunk[chunkOffset++] = v1.z;
              chunk[chunkOffset++] = v2.x; chunk[chunkOffset++] = v2.y; chunk[chunkOffset++] = v2.z;
              worldBox.expandByPoint(v0);
              worldBox.expandByPoint(v1);
              worldBox.expandByPoint(v2);
            }

            if (i === 0 && !localBox.isEmpty()) {
              const center = new THREE.Vector3();
              localBox.getCenter(center);
              center.applyMatrix4(matrix);

              const me = matrix.elements;
              const vX = new THREE.Vector3(me[0], me[1], me[2]);
              const vY = new THREE.Vector3(me[4], me[5], me[6]);
              const vZ = new THREE.Vector3(me[8], me[9], me[10]);

              const scaleX = vX.length();
              const scaleY = vY.length();
              const scaleZ = vZ.length();

              if (scaleX > 0) vX.divideScalar(scaleX); else vX.set(1, 0, 0);
              if (scaleY > 0) vY.divideScalar(scaleY); else vY.set(0, 1, 0);
              if (scaleZ > 0) vZ.divideScalar(scaleZ); else vZ.set(0, 0, 1);

              const size = new THREE.Vector3();
              localBox.getSize(size).multiplyScalar(0.5);

              obb = {
                center,
                axes: [vX, vY, vZ],
                halfSizes: [
                  (size.x * scaleX) || 0.001,
                  (size.y * scaleY) || 0.001,
                  (size.z * scaleZ) || 0.001
                ]
              };
            }

            trisChunks.push(chunk);
            totalLength += chunk.length;

            try { (geom as any).delete(); } catch(e) {}
          }

          let mergedTris: Float32Array | null = null;
          if (totalLength > 0) {
            mergedTris = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of trisChunks) {
              mergedTris.set(chunk, offset);
              offset += chunk.length;
            }
          }

          if (obb && mergedTris) {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            
            const center = obb.center.clone(); 
            const axes = obb.axes;
            const v = new THREE.Vector3();
            for (let k = 0; k < mergedTris.length; k += 3) {
              v.set(mergedTris[k], mergedTris[k+1], mergedTris[k+2]);
              v.sub(center);
              const dx = v.dot(axes[0]);
              const dy = v.dot(axes[1]);
              const dz = v.dot(axes[2]);
              if (dx < minX) minX = dx; if (dx > maxX) maxX = dx;
              if (dy < minY) minY = dy; if (dy > maxY) maxY = dy;
              if (dz < minZ) minZ = dz; if (dz > maxZ) maxZ = dz;
            }
            const shiftX = (minX + maxX) / 2;
            const shiftY = (minY + maxY) / 2;
            const shiftZ = (minZ + maxZ) / 2;
            
            obb.center.add(axes[0].clone().multiplyScalar(shiftX));
            obb.center.add(axes[1].clone().multiplyScalar(shiftY));
            obb.center.add(axes[2].clone().multiplyScalar(shiftZ));
            
            obb.halfSizes[0] = Math.max((maxX - minX) / 2, 0.001);
            obb.halfSizes[1] = Math.max((maxY - minY) / 2, 0.001);
            obb.halfSizes[2] = Math.max((maxZ - minZ) / 2, 0.001);
          }

          if (obb && mergedTris) {
            elementsMap.set(expressID, {
              obb, aabb: { min: worldBox.min, max: worldBox.max }, tris: mergedTris, modelId: model.id, expressID
            });
          }
        });

        api.CloseModel(modelID);
        modelGeometryCache.set(model.id, elementsMap);
      }

      // 2. 캐싱된 전체 형상 데이터에서 이번 검사 대상(Set A, Set B)만 필터링합니다.
      const itemsA: any[] = [];
      const itemsB: any[] = [];

      for (const [mId, expressIds] of mapA.entries()) {
        const elementsMap = modelGeometryCache.get(mId);
        if (elementsMap) {
          for (const eid of expressIds) {
            const data = elementsMap.get(eid);
            if (data) itemsA.push(data);
          }
        }
      }

      const targetB = isSelfClash ? itemsA : itemsB;
      if (!isSelfClash) {
        for (const [mId, expressIds] of mapB.entries()) {
          const elementsMap = modelGeometryCache.get(mId);
          if (elementsMap) {
            for (const eid of expressIds) {
              const data = elementsMap.get(eid);
              if (data) itemsB.push(data);
            }
          }
        }
      }

      // Broad-Phase 최적화: 1D Sweep and Prune 알고리즘 적용을 위해 X축(min.x) 기준으로 정렬
      itemsA.sort((a, b) => a.aabb.min.x - b.aabb.min.x);
      if (!isSelfClash) targetB.sort((a, b) => a.aabb.min.x - b.aabb.min.x);

      // 3. OBB 및 BVH 충돌 검사 (연산 로직은 이전과 동일)
      const results: any[] = [];
      const checkedPairs = new Set<string>();
      const cl = options.clearance || 0;

      for (let i = 0; i < itemsA.length; i++) {
        const itemA = itemsA[i];
        const startJ = isSelfClash ? i + 1 : 0;
        
        for (let j = startJ; j < targetB.length; j++) {
          const itemB = targetB[j];
          
          if (itemB.aabb.min.x > itemA.aabb.max.x + cl) break;
          if (itemA.aabb.min.x > itemB.aabb.max.x + cl) continue;

          if (itemA.aabb.min.y > itemB.aabb.max.y + cl || itemA.aabb.max.y < itemB.aabb.min.y - cl ||
              itemA.aabb.min.z > itemB.aabb.max.z + cl || itemA.aabb.max.z < itemB.aabb.min.z - cl) {
            continue;
          }

          if (itemA.modelId === itemB.modelId && itemA.expressID === itemB.expressID) continue;

          const pairId1 = `${itemA.modelId}-${itemA.expressID}`;
          const pairId2 = `${itemB.modelId}-${itemB.expressID}`;
          const pairKey = pairId1 < pairId2 ? `${pairId1}::${pairId2}` : `${pairId2}::${pairId1}`;
          
          if (checkedPairs.has(pairKey)) continue;

          if (checkOBBIntersection(itemA.obb, itemB.obb, options)) {
            let bvhA = bvhCache.get(pairId1);
            if (bvhA === undefined) {
              bvhA = getBVH(itemA.tris);
              bvhCache.set(pairId1, bvhA);
            }

            let bvhB = bvhCache.get(pairId2);
            if (bvhB === undefined) {
              bvhB = getBVH(itemB.tris);
              bvhCache.set(pairId2, bvhB);
            }

            let isActualClash = false;
            let position = new THREE.Vector3().addVectors(itemA.obb.center, itemB.obb.center).multiplyScalar(0.5);

            if (options.clearance && options.clearance > 0) {
              const softPairBuf = [0,0,0,0,0,0];
              const dist = meshMinDist(itemA.tris, itemB.tris, options.clearance, softPairBuf);
              if (dist <= options.clearance) {
                isActualClash = true;
                position.set((softPairBuf[0] + softPairBuf[3]) / 2, (softPairBuf[1] + softPairBuf[4]) / 2, (softPairBuf[2] + softPairBuf[5]) / 2);
              }
            } else {
              if (bvhA && bvhB) {
                const intersection = meshesIntersect(bvhA, bvhB, itemA.aabb, itemB.aabb);
                if (intersection) {
                  isActualClash = true;
                  position.set(intersection[0], intersection[1], intersection[2]);
                }
              }
            }

            if (isActualClash) {
              checkedPairs.add(pairKey);

              if (Number.isNaN(position.x) || Number.isNaN(position.y) || Number.isNaN(position.z)) {
                position = new THREE.Vector3().addVectors(itemA.obb.center, itemB.obb.center).multiplyScalar(0.5);
                if (Number.isNaN(position.x)) position.set(0, 0, 0);
              }

              results.push({
                id1: { modelId: itemA.modelId, expressID: itemA.expressID, obb: itemA.obb, aabb: itemA.aabb },
                id2: { modelId: itemB.modelId, expressID: itemB.expressID, obb: itemB.obb, aabb: itemB.aabb },
                position: { x: position.x, y: position.y, z: position.z }
              });
            }
          }
        }
      }
      
      // 연산이 완료되면 Worker 인스턴스를 죽이지 않고 메시지만 회신합니다.
      self.postMessage({ jobId, results });
    } catch (error: any) {
      self.postMessage({ jobId, error: error.message });
    }
  }
};
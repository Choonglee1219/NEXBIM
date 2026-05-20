import * as THREE from "three";
import * as WebIFC from "web-ifc";
import { checkOBBIntersection, getBVH, meshesIntersect, meshMinDist } from "./obb-collision";

self.onmessage = async (e) => {
  const { modelsData, setA, setB, isSelfClash, options } = e.data;
  
  // 1. web-ifc 초기화 및 모델 파싱
  const ifcApi = new WebIFC.IfcAPI();
  ifcApi.SetWasmPath("/node_modules/web-ifc/");
  await ifcApi.Init();

  const elementsData = new Map();
  // 각 모델의 오프닝 관계(Voider-Filler)를 저장할 맵
  const allModelVoiders = new Map<string, Map<number, Set<number>>>();

  // Main Thread에서 넘어온 Set이 일반 객체로 풀릴 수 있으므로 복원 (Rehydration)
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

  for (const model of modelsData) {
    const modelID = ifcApi.OpenModel(new Uint8Array(model.buffer), { USE_FAST_BOOLS: true } as any);
    const idsA = mapA.get(model.id);
    const idsB = mapB.get(model.id);

    // 오프닝 관통으로 인한 오탐지를 필터링하기 위해 IFC 관계를 사전 처리합니다.
    const voiderToFillersMap = new Map<number, Set<number>>();
    try {
      const openingData = new Map<number, { voider: number, fillers: Set<number> }>();

      // 1. 어떤 요소가 오프닝을 '채우는지' 관계(IfcRelFillsElement)를 찾습니다.
      const relFills = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELFILLSELEMENT);
      for (let i = 0; i < relFills.size(); i++) {
        const rel = await ifcApi.GetLine(modelID, relFills.get(i));
        if (rel.RelatingOpeningElement?.value && rel.RelatedBuildingElement?.value) {
          const openingId = rel.RelatingOpeningElement.value;
          const fillerId = rel.RelatedBuildingElement.value;
          if (!openingData.has(openingId)) {
            openingData.set(openingId, { voider: -1, fillers: new Set() });
          }
          openingData.get(openingId)!.fillers.add(fillerId);
        }
      }

      // 2. 어떤 요소가 오프닝에 의해 '뚫리는지' 관계(IfcRelVoidsElement)를 찾습니다.
      const relVoids = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELVOIDSELEMENT);
      for (let i = 0; i < relVoids.size(); i++) {
        const rel = await ifcApi.GetLine(modelID, relVoids.get(i));
        if (rel.RelatingBuildingElement?.value && rel.RelatedOpeningElement?.value) {
          const voiderId = rel.RelatingBuildingElement.value;
          const openingId = rel.RelatedOpeningElement.value;
          if (openingData.has(openingId)) {
            openingData.get(openingId)!.voider = voiderId;
          }
        }
      }

      // 3. 최종적으로 '뚫리는 요소(Voider) ID -> 채우는 요소(Filler) ID Set' 맵을 생성합니다.
      for (const data of openingData.values()) {
        if (data.voider !== -1 && data.fillers.size > 0) {
          if (!voiderToFillersMap.has(data.voider)) voiderToFillersMap.set(data.voider, new Set());
          data.fillers.forEach(filler => voiderToFillersMap.get(data.voider)!.add(filler));
        }
      }
    } catch (err) {}
    allModelVoiders.set(model.id, voiderToFillersMap);

    // 오프닝(Opening), 공간(Space) 등 형상이 없는/가상의 요소를 필터링하여 오탐지(Ghost Clash) 방지
    const skipTypes = new Set([3588315303, 3856911033, 2769231204, 1674181508, 3009204131]);
    const skipGeoEids = new Set<number>();
    for (const stid of skipTypes) {
      try {
        const stids = ifcApi.GetLineIDsWithType(modelID, stid);
        for (let stj = 0; stj < stids.size(); stj++) {
          skipGeoEids.add(stids.get(stj));
        }
      } catch (e) {}
    }

    // 2. 순수 기하 데이터 추출 (ClashControl.io 방식 그대로)
    ifcApi.StreamAllMeshes(modelID, (ifcMesh) => {
      const expressID = ifcMesh.expressID;

      // 오프닝(구멍을 파기 위한 투명 덩어리) 등이 간섭 검사에 참여하지 않도록 배제
      if (skipGeoEids.has(expressID)) return;

      const inA = idsA && idsA.has(expressID);
      const inB = idsB && idsB.has(expressID);

      // 타겟 Set에 속하지 않은 요소는 기하를 추출하지 않고 건너뜁니다.
      if (!inA && !inB) return;

      const trisArray: number[] = [];
      const worldBox = new THREE.Box3();
      let obb: any = null;

      for (let i = 0; i < ifcMesh.geometries.size(); i++) {
        const placed = ifcMesh.geometries.get(i);
        
        // 원본 로직 복원: 투명도(Alpha)가 0.05 미만인 유령 기하(오프닝, 빈 공간 바운딩 등)는 완전히 무시합니다.
        const c = placed.color;
        if (c && c.w < 0.05) continue;

        const geom = ifcApi.GetGeometry(modelID, placed.geometryExpressID);
        
        // web-ifc의 원본 메모리 배열 참조
        const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation);

        const localBox = new THREE.Box3();
        const v = new THREE.Vector3();

        // Vertex 추출 (1개의 Vertex는 x,y,z, nx,ny,nz 6개의 Float로 구성됨)
        for (let j = 0; j < verts.length; j += 6) {
          v.set(verts[j], verts[j + 1], verts[j + 2]);
          localBox.expandByPoint(v);
        }

        // Triangle 구성 및 월드 좌표 변환
        for (let j = 0; j < indices.length; j += 3) {
          const idx0 = indices[j] * 6;
          const idx1 = indices[j + 1] * 6;
          const idx2 = indices[j + 2] * 6;

          const v0 = new THREE.Vector3(verts[idx0], verts[idx0+1], verts[idx0+2]).applyMatrix4(matrix);
          const v1 = new THREE.Vector3(verts[idx1], verts[idx1+1], verts[idx1+2]).applyMatrix4(matrix);
          const v2 = new THREE.Vector3(verts[idx2], verts[idx2+1], verts[idx2+2]).applyMatrix4(matrix);

          trisArray.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
          worldBox.expandByPoint(v0);
          worldBox.expandByPoint(v1);
          worldBox.expandByPoint(v2);
        }

        // 첫 번째 배치를 기준으로 로컬 Box에서 정확한 OBB 축 추출
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

        // 메모리 누수를 방지하기 위해 생성된 Geometry C++ 메모리를 해제합니다.
        try { (geom as any).delete(); } catch(e) {}
      }

      // 추출된 모든 삼각형(정점)을 기준으로, 첫 번째 조각의 회전축(방향)을 유지하면서 크기를 가장 타이트하게 맞춘 정밀 OBB 생성
      if (obb && trisArray.length > 0) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        const center = obb.center.clone(); // 임시로 복제
        const axes = obb.axes;
        const v = new THREE.Vector3();
        for (let k = 0; k < trisArray.length; k += 3) {
          v.set(trisArray[k], trisArray[k+1], trisArray[k+2]);
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

      if (obb && trisArray.length > 0) {
        elementsData.set(`${model.id}-${expressID}`, {
          obb, aabb: { min: worldBox.min, max: worldBox.max }, tris: new Float32Array(trisArray), modelId: model.id, expressID, inA, inB
        });
      }
    });

    ifcApi.CloseModel(modelID);
  }

  // 3. OBB 및 BVH 충돌 검사
  const results: any[] = [];
  const checkedPairs = new Set<string>();
  const bvhCache = new Map<string, any>();

  const itemsA: any[] = [];
  const itemsB: any[] = [];

  // 추출된 객체를 Set A와 Set B 배열로 분류
  for (const data of elementsData.values()) {
    if (data.inA) itemsA.push(data);
    if (data.inB && !isSelfClash) itemsB.push(data);
  }

  const targetB = isSelfClash ? itemsA : itemsB;

  // Broad-Phase 최적화: 1D Sweep and Prune 알고리즘 적용을 위해 X축(min.x) 기준으로 정렬
  itemsA.sort((a, b) => a.aabb.min.x - b.aabb.min.x);
  if (!isSelfClash) targetB.sort((a, b) => a.aabb.min.x - b.aabb.min.x);

  const cl = options.clearance || 0;

  // O(N log N)에 수렴하는 검사 루프
  for (let i = 0; i < itemsA.length; i++) {
    const itemA = itemsA[i];
    const startJ = isSelfClash ? i + 1 : 0;
    
    for (let j = startJ; j < targetB.length; j++) {
      const itemB = targetB[j];
      
      // Sweep and Prune (X축): itemB의 최소 X가 itemA의 최대 X 범위를 벗어났다면, 
      // targetB가 정렬되어 있으므로 남은 itemB들도 무조건 겹치지 않음 -> 루프 즉시 탈출
      if (itemB.aabb.min.x > itemA.aabb.max.x + cl) break;
      
      // 서로 다른 모델 간(Set A vs Set B) 검사 시 itemA의 X가 itemB보다 작은 경우는 건너뜀
      if (itemA.aabb.min.x > itemB.aabb.max.x + cl) continue;

      // AABB 고속 사전 검사 (Y축, Z축 겹침 확인)
      // 무거운 OBB SAT 검사를 수행하기 전에 직육면체 겹침 여부를 확인하여 연산을 최소화합니다.
      if (itemA.aabb.min.y > itemB.aabb.max.y + cl || itemA.aabb.max.y < itemB.aabb.min.y - cl ||
          itemA.aabb.min.z > itemB.aabb.max.z + cl || itemA.aabb.max.z < itemB.aabb.min.z - cl) {
        continue;
      }

      if (itemA.modelId === itemB.modelId && itemA.expressID === itemB.expressID) continue;

      const pairId1 = `${itemA.modelId}-${itemA.expressID}`;
      const pairId2 = `${itemB.modelId}-${itemB.expressID}`;
      const pairKey = pairId1 < pairId2 ? `${pairId1}::${pairId2}` : `${pairId2}::${pairId1}`;
      
      if (checkedPairs.has(pairKey)) continue;

      // OBB (Broad-Phase) 검사 통과 시에만 BVH (Narrow-Phase) 검사
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

        const tolerance = options.tolerance ?? 0;

        // Soft Clash vs Hard Clash 정밀 검사 분기
        if (options.clearance && options.clearance > 0) {
          const softPairBuf = [0,0,0,0,0,0];
          // 이격 거리 검사 시에는 허용 오차(tolerance)를 적용하여 불필요한 오탐지를 줄입니다.
          const dist = meshMinDist(itemA.tris, itemB.tris, options.clearance, softPairBuf);
          if (dist <= options.clearance - tolerance) {
            isActualClash = true;
            position.set((softPairBuf[0] + softPairBuf[3]) / 2, (softPairBuf[1] + softPairBuf[4]) / 2, (softPairBuf[2] + softPairBuf[5]) / 2);
          }
        } else {
          if (bvhA && bvhB) {
            const intersection = meshesIntersect(bvhA, bvhB, itemA.aabb, itemB.aabb);
            // Hard-clash 검사 시, 실제 침투 깊이(penetration depth)가 허용 오차(tolerance)보다 클 때만 간섭으로 판정합니다.
            // intersection[3]은 bvhTraverseAll에서 계산된 최대 침투 깊이입니다.
            if (intersection && intersection[3] > tolerance) {
              isActualClash = true;
              position.set(intersection[0], intersection[1], intersection[2]);
            }
          }
        }

        if (isActualClash) {
          // 실제 간섭이지만, 오프닝을 통한 정상적인 관통인지 확인합니다.
          let isOpeningClash = false;
          const voidersA = allModelVoiders.get(itemA.modelId);
          if (voidersA?.get(itemA.expressID)?.has(itemB.expressID)) {
            isOpeningClash = true;
          }
          if (!isOpeningClash) {
            const voidersB = allModelVoiders.get(itemB.modelId);
            if (voidersB?.get(itemB.expressID)?.has(itemA.expressID)) {
              isOpeningClash = true;
            }
          }

          // 오프닝을 통한 관통이 아닐 경우에만 최종 간섭으로 처리합니다.
          if (!isOpeningClash) {
            checkedPairs.add(pairKey);

            // NaN 값이 발생하여 Three.js 카메라 이동 시 앱이 멈추는 현상 방지 (방어 코드)
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
  }
  
  self.postMessage({ results });
};
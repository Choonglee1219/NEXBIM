import * as THREE from "three";

export interface OBB {
  center: THREE.Vector3;
  axes: THREE.Vector3[];
  halfSizes: number[];
}

export interface ClashOptions {
  clearance?: number;
  tolerance?: number;
}

export interface ClashResult {
  id: string;
  elements: string[];
  position: THREE.Vector3;
}

/**
 * OBB(Oriented Bounding Box) 간의 충돌을 SAT 알고리즘으로 판정합니다.
 * @param obb1 첫 번째 OBB
 * @param obb2 두 번째 OBB
 * @param options 간섭 검토 옵션 (여유 거리, 허용 오차)
 * @returns 충돌 여부 (boolean)
 */
export function checkOBBIntersection(
  obb1: OBB,
  obb2: OBB,
  options: ClashOptions = {}
): boolean {
  const clearance = options.clearance ?? 0;
  // 허용 오차(tolerance)를 적용하여 작은 겹침이나 이격 거리를 무시합니다.
  // clearance: 이격 거리 검사 시 필요한 최소 거리
  // tolerance: 무시할 수 있는 오차 범위
  const tolerance = options.tolerance ?? 0;
  const totalMargin = clearance - tolerance;

  // 1. 중심점 간의 거리 벡터 계산
  const diff = new THREE.Vector3().subVectors(obb2.center, obb1.center);

  // 2. 15개의 분리축(Axes) 검사 (각 OBB의 축 3개씩 + 외적축 9개)
  const candidateAxes = getCandidateAxes(obb1, obb2);

  // 3. 분리축 투영(Projection) 검사
  for (const axis of candidateAxes) {
    const dist = Math.abs(diff.dot(axis));
    const projectionSum =
      getProjectionRadius(obb1, axis) + getProjectionRadius(obb2, axis);

    if (dist > projectionSum + totalMargin) {
      return false; // 분리축 발견 -> 겹치지 않음 (충돌 아님)
    }
  }
  return true; // 모든 축에서 겹침 -> 충돌 발생
}

/**
 * 두 OBB의 기본 축 6개와 서로 외적하여 생성된 9개의 축을 합쳐 총 15개의 검사 후보 분리축을 생성합니다.
 */
export function getCandidateAxes(obb1: OBB, obb2: OBB): THREE.Vector3[] {
  const axes = [...obb1.axes, ...obb2.axes];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const cross = new THREE.Vector3().crossVectors(obb1.axes[i], obb2.axes[j]);
      // 축이 평행하여 외적 값이 0이 되는 경우는 제외
      if (cross.lengthSq() > 1e-6) {
        axes.push(cross.normalize());
      }
    }
  }
  return axes;
}

/**
 * 특정 축(Axis)에 대해 OBB를 투영했을 때의 반지름(절반 길이)을 계산합니다.
 */
export function getProjectionRadius(obb: OBB, axis: THREE.Vector3): number {
  return (
    obb.halfSizes[0] * Math.abs(obb.axes[0].dot(axis)) +
    obb.halfSizes[1] * Math.abs(obb.axes[1].dot(axis)) +
    obb.halfSizes[2] * Math.abs(obb.axes[2].dot(axis))
  );
}

/**
 * Three.js Mesh로부터 OBB 데이터를 추출합니다.
 */
export function getElementOBB(mesh: THREE.Mesh): OBB {
  if (!mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox();
  }

  const box = mesh.geometry.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  center.applyMatrix4(mesh.matrixWorld);

  // 모델의 회전과 스케일이 포함된 축(Basis) 추출
  const matrix = mesh.matrixWorld.elements;
  const vX = new THREE.Vector3(matrix[0], matrix[1], matrix[2]);
  const vY = new THREE.Vector3(matrix[4], matrix[5], matrix[6]);
  const vZ = new THREE.Vector3(matrix[8], matrix[9], matrix[10]);

  // 각 방향별 실제 스케일값
  const scaleX = vX.length();
  const scaleY = vY.length();
  const scaleZ = vZ.length();

  // 스케일이 0일 경우 정규화 시 NaN이 발생하는 것을 방지
  if (scaleX > 0) vX.divideScalar(scaleX); else vX.set(1, 0, 0);
  if (scaleY > 0) vY.divideScalar(scaleY); else vY.set(0, 1, 0);
  if (scaleZ > 0) vZ.divideScalar(scaleZ); else vZ.set(0, 0, 1);

  const size = new THREE.Vector3();
  box.getSize(size).multiplyScalar(0.5);

  return {
    center,
    axes: [vX, vY, vZ],
    halfSizes: [
      (size.x * scaleX) || 0.001,
      (size.y * scaleY) || 0.001,
      (size.z * scaleZ) || 0.001
    ]
  };
}

/**
 * 두 OBB의 중심점을 기반으로 대략적인 충돌 위치를 추정합니다.
 */
export function calculateClashPoint(obb1: OBB, obb2: OBB): THREE.Vector3 {
  return new THREE.Vector3().addVectors(obb1.center, obb2.center).multiplyScalar(0.5);
}

// ============================================================================
// BVH 및 Triangle 정밀 교차 검사 로직 (reference_clash.html 복제)
// ============================================================================

export interface BVHNode {
  mnx: number; mny: number; mnz: number;
  mxx: number; mxy: number; mxz: number;
  lo?: number; hi?: number; idx?: Int32Array;
  cnt?: number;
  left?: BVHNode; right?: BVHNode;
}

export interface BVH {
  tris: Float32Array;
  root: BVHNode;
}

export function buildBVHNode(tris: Float32Array, indices: Int32Array, lo: number, hi: number): BVHNode {
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = lo; i < hi; i++) {
    const o = indices[i] * 9;
    for (let v = 0; v < 3; v++) {
      const vx = tris[o + v * 3], vy = tris[o + v * 3 + 1], vz = tris[o + v * 3 + 2];
      if (vx < mnx) mnx = vx; if (vx > mxx) mxx = vx;
      if (vy < mny) mny = vy; if (vy > mxy) mxy = vy;
      if (vz < mnz) mnz = vz; if (vz > mxz) mxz = vz;
    }
  }
  const node: BVHNode = { mnx, mny, mnz, mxx, mxy, mxz };
  if (hi - lo <= 4) {
    node.lo = lo; node.hi = hi; node.idx = indices;
    return node;
  }
  const dx = mxx - mnx, dy = mxy - mny, dz = mxz - mnz;
  const axis = (dx >= dy && dx >= dz) ? 0 : (dy >= dz) ? 1 : 2;
  const sub = Array.prototype.slice.call(indices, lo, hi) as number[];
  sub.sort((a, b) => {
    return (tris[a * 9 + axis] + tris[a * 9 + 3 + axis] + tris[a * 9 + 6 + axis]) -
           (tris[b * 9 + axis] + tris[b * 9 + 3 + axis] + tris[b * 9 + 6 + axis]);
  });
  for (let i = lo; i < hi; i++) indices[i] = sub[i - lo];
  const mid = (lo + hi) >> 1;
  node.cnt = hi - lo;
  node.left = buildBVHNode(tris, indices, lo, mid);
  node.right = buildBVHNode(tris, indices, mid, hi);
  return node;
}

export function getBVH(tris: Float32Array): BVH | null {
  if (!tris || tris.length === 0) return null;
  const n = tris.length / 9;
  const indices = new Int32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  return { tris, root: buildBVHNode(tris, indices, 0, n) };
}

const _ttIvalA = new Float64Array(8);
const _ttIvalB = new Float64Array(8);

export function triTriTest(tA: Float32Array, oA: number, tB: Float32Array, oB: number): number[] | null {
  const a0x=tA[oA],a0y=tA[oA+1],a0z=tA[oA+2]; const a1x=tA[oA+3],a1y=tA[oA+4],a1z=tA[oA+5]; const a2x=tA[oA+6],a2y=tA[oA+7],a2z=tA[oA+8];
  const b0x=tB[oB],b0y=tB[oB+1],b0z=tB[oB+2]; const b1x=tB[oB+3],b1y=tB[oB+4],b1z=tB[oB+5]; const b2x=tB[oB+6],b2y=tB[oB+7],b2z=tB[oB+8];

  const e1x=b1x-b0x,e1y=b1y-b0y,e1z=b1z-b0z;
  const e2x=b2x-b0x,e2y=b2y-b0y,e2z=b2z-b0z;
  const n2x=e1y*e2z-e1z*e2y, n2y=e1z*e2x-e1x*e2z, n2z=e1x*e2y-e1y*e2x;
  const nl2=n2x*n2x+n2y*n2y+n2z*n2z;
  if(nl2<1e-10) return null;
  const d2=-(n2x*b0x+n2y*b0y+n2z*b0z);
  const da0=n2x*a0x+n2y*a0y+n2z*a0z+d2; const da1=n2x*a1x+n2y*a1y+n2z*a1z+d2; const da2=n2x*a2x+n2y*a2y+n2z*a2z+d2;
  const eps2 = 1e-6 * Math.sqrt(nl2);
  if(da0>eps2&&da1>eps2&&da2>eps2) return null;
  if(da0<-eps2&&da1<-eps2&&da2<-eps2) return null;

  const f1x=a1x-a0x,f1y=a1y-a0y,f1z=a1z-a0z;
  const f2x=a2x-a0x,f2y=a2y-a0y,f2z=a2z-a0z;
  const n1x=f1y*f2z-f1z*f2y, n1y=f1z*f2x-f1x*f2z, n1z=f1x*f2y-f1y*f2x;
  const nl1=n1x*n1x+n1y*n1y+n1z*n1z;
  if(nl1<1e-10) return null;
  const d1=-(n1x*a0x+n1y*a0y+n1z*a0z);
  const db0=n1x*b0x+n1y*b0y+n1z*b0z+d1; const db1=n1x*b1x+n1y*b1y+n1z*b1z+d1; const db2=n1x*b2x+n1y*b2y+n1z*b2z+d1;
  const eps1 = 1e-6 * Math.sqrt(nl1);
  if(db0>eps1&&db1>eps1&&db2>eps1) return null;
  if(db0<-eps1&&db1<-eps1&&db2<-eps1) return null;

  const Dx=n1y*n2z-n1z*n2y, Dy=n1z*n2x-n1x*n2z, Dz=n1x*n2y-n1y*n2x;
  const ax=Math.abs(Dx), ay=Math.abs(Dy), az=Math.abs(Dz);
  let proj: (x: number, y: number, z: number) => number;
  if(ax>=ay&&ax>=az) proj=(x,_y,_z)=>x; else if(ay>=az) proj=(_x,y,_z)=>y; else proj=(_x,_y,z)=>z;

  function interval(out: Float64Array, v0x:number,v0y:number,v0z:number,v1x:number,v1y:number,v1z:number,v2x:number,v2y:number,v2z:number,dd0:number,dd1:number,dd2:number) {
    let i0x,i0y,i0z,i1x,i1y,i1z,i2x,i2y,i2z,di0,di1,di2;
    if(dd0*dd1>0){i0x=v2x;i0y=v2y;i0z=v2z;i1x=v0x;i1y=v0y;i1z=v0z;i2x=v1x;i2y=v1y;i2z=v1z;di0=dd2;di1=dd0;di2=dd1;}
    else if(dd0*dd2>0){i0x=v1x;i0y=v1y;i0z=v1z;i1x=v0x;i1y=v0y;i1z=v0z;i2x=v2x;i2y=v2y;i2z=v2z;di0=dd1;di1=dd0;di2=dd2;}
    else{i0x=v0x;i0y=v0y;i0z=v0z;i1x=v1x;i1y=v1y;i1z=v1z;i2x=v2x;i2y=v2y;i2z=v2z;di0=dd0;di1=dd1;di2=dd2;}
    const p0=proj(i0x,i0y,i0z), p1=proj(i1x,i1y,i1z), p2=proj(i2x,i2y,i2z);
    const r1=di0/(di0-di1), r2=di0/(di0-di2);
    const t1=p0+(p1-p0)*r1; const t2=p0+(p2-p0)*r2;
    const q1x=i0x+(i1x-i0x)*r1, q1y=i0y+(i1y-i0y)*r1, q1z=i0z+(i1z-i0z)*r1;
    const q2x=i0x+(i2x-i0x)*r2, q2y=i0y+(i2y-i0y)*r2, q2z=i0z+(i2z-i0z)*r2;
    if(t1<t2){out[0]=t1;out[1]=t2;out[2]=q1x;out[3]=q1y;out[4]=q1z;out[5]=q2x;out[6]=q2y;out[7]=q2z;}
    else{out[0]=t2;out[1]=t1;out[2]=q2x;out[3]=q2y;out[4]=q2z;out[5]=q1x;out[6]=q1y;out[7]=q1z;}
  }
  
  interval(_ttIvalA,a0x,a0y,a0z,a1x,a1y,a1z,a2x,a2y,a2z,da0,da1,da2);
  interval(_ttIvalB,b0x,b0y,b0z,b1x,b1y,b1z,b2x,b2y,b2z,db0,db1,db2);
  if(_ttIvalA[0]>=_ttIvalB[1]||_ttIvalB[0]>=_ttIvalA[1]) return null;
  
  const oMin=Math.max(_ttIvalA[0],_ttIvalB[0]), oMax=Math.min(_ttIvalA[1],_ttIvalB[1]);
  const src=_ttIvalA[1]-_ttIvalA[0]>=_ttIvalB[1]-_ttIvalB[0]?_ttIvalA:_ttIvalB;
  const len=src[1]-src[0];
  if(len<1e-12) return [src[2],src[3],src[4],0];
  const rMin=(oMin-src[0])/len, rMax=(oMax-src[0])/len;
  const pMinX=src[2]+(src[5]-src[2])*rMin, pMinY=src[3]+(src[6]-src[3])*rMin, pMinZ=src[4]+(src[7]-src[4])*rMin;
  const pMaxX=src[2]+(src[5]-src[2])*rMax, pMaxY=src[3]+(src[6]-src[3])*rMax, pMaxZ=src[4]+(src[7]-src[4])*rMax;
  const sdx=pMaxX-pMinX, sdy=pMaxY-pMinY, sdz=pMaxZ-pMinZ;
  return [(pMinX+pMaxX)/2, (pMinY+pMaxY)/2, (pMinZ+pMaxZ)/2, Math.sqrt(sdx*sdx+sdy*sdy+sdz*sdz)];
}

export function bvhTraverseAll(nA: BVHNode, trisA: Float32Array, nB: BVHNode, trisB: Float32Array, pts: number[], maxPts: number, maxDepth: number[], earlyExit: boolean) {
  if (pts.length >= maxPts * 3) return;
  if (nA.mnx>nB.mxx||nA.mxx<nB.mnx||nA.mny>nB.mxy||nA.mxy<nB.mny||nA.mnz>nB.mxz||nA.mxz<nB.mnz) return;
  
  if (nA.lo !== undefined && nB.lo !== undefined) {
    for (let i = nA.lo; i < nA.hi! && pts.length < maxPts * 3; i++) {
      for (let j = nB.lo; j < nB.hi! && pts.length < maxPts * 3; j++) {
        const cp = triTriTest(trisA, nA.idx![i] * 9, trisB, nB.idx![j] * 9);
        if (cp) { pts.push(cp[0], cp[1], cp[2]); if (cp[3] > maxDepth[0]) maxDepth[0] = cp[3]; if (earlyExit) return; }
      }
    }
    return;
  }
  if (nB.lo !== undefined || (nA.lo === undefined && (nA.cnt || 1) >= (nB.cnt || 1))) {
    bvhTraverseAll(nA.left!, trisA, nB, trisB, pts, maxPts, maxDepth, earlyExit);
    if (earlyExit && pts.length) return;
    bvhTraverseAll(nA.right!, trisA, nB, trisB, pts, maxPts, maxDepth, earlyExit);
  } else {
    bvhTraverseAll(nA, trisA, nB.left!, trisB, pts, maxPts, maxDepth, earlyExit);
    if (earlyExit && pts.length) return;
    bvhTraverseAll(nA, trisA, nB.right!, trisB, pts, maxPts, maxDepth, earlyExit);
  }
}

export function meshesIntersect(bA: BVH | null, bB: BVH | null, boxA: {min: THREE.Vector3, max: THREE.Vector3}, boxB: {min: THREE.Vector3, max: THREE.Vector3}): number[] | false {
  if (!bA || !bB) return false;
  const probe: number[] = [], probeDepth = [0];
  bvhTraverseAll(bA.root, bA.tris, bB.root, bB.tris, probe, 1, probeDepth, true);
  if (probe.length === 0) return false;
  
  const pts: number[] = [], maxDepth = [0];
  // 성능을 위해 24개만 찾던 것을 128개로 늘려, 전체 교차 다면체를 아우르는 
  // 정밀한 도심(Centroid)을 계산할 수 있도록 샘플링 해상도를 대폭 높입니다.
  bvhTraverseAll(bA.root, bA.tris, bB.root, bB.tris, pts, 128, maxDepth, false);
  if (pts.length === 0) return false;

  const margin = 0.01; // 10mm tolerance
  const valid: number[] = [];
  
  for (let i = 0; i < pts.length; i += 3) {
    const px = pts[i], py = pts[i+1], pz = pts[i+2];
    // 원본 방식: 발견된 교차점이 각 실제 객체의 AABB 바운딩 박스 내부에 존재하는지 10mm 오차를 두고 엄격히 검증
    if (px >= boxA.min.x - margin && px <= boxA.max.x + margin &&
        py >= boxA.min.y - margin && py <= boxA.max.y + margin &&
        pz >= boxA.min.z - margin && pz <= boxA.max.z + margin &&
        px >= boxB.min.x - margin && px <= boxB.max.x + margin &&
        py >= boxB.min.y - margin && py <= boxB.max.y + margin &&
        pz >= boxB.min.z - margin && pz <= boxB.max.z + margin) {
      valid.push(pts[i], pts[i+1], pts[i+2]);
    }
  }

  if (valid.length === 0) return false;

  let sx = 0, sy = 0, sz = 0; const n = valid.length / 3;
  for (let i = 0; i < valid.length; i += 3) { sx += valid[i]; sy += valid[i+1]; sz += valid[i+2]; }
  return [sx / n, sy / n, sz / n, maxDepth[0]];
}

// ============================================================================
// Spatial Hash를 이용한 정밀 정점 간 이격 거리(Soft Clash) 계산 로직
// ============================================================================

export class SpatialHash {
  cs: number;
  inv: number;
  map: Map<number, number[]>;

  constructor(cellSize: number) {
    this.cs = cellSize;
    this.inv = 1 / cellSize;
    this.map = new Map();
  }

  _hkey(ix: number, iy: number, iz: number) {
    return (((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0);
  }

  insert(verts: Float32Array) {
    for (let i = 0; i < verts.length; i += 3) {
      const k = this._hkey(Math.floor(verts[i] * this.inv), Math.floor(verts[i+1] * this.inv), Math.floor(verts[i+2] * this.inv));
      let bucket = this.map.get(k);
      if (!bucket) { bucket = []; this.map.set(k, bucket); }
      bucket.push(i);
    }
  }

  minDistSq(px: number, py: number, pz: number, verts: Float32Array, out?: number[]) {
    let best = Infinity;
    const cx = Math.floor(px * this.inv), cy = Math.floor(py * this.inv), cz = Math.floor(pz * this.inv);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.map.get(this._hkey(cx+dx, cy+dy, cz+dz));
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b++) {
            const idx = bucket[b];
            const ex = px - verts[idx], ey = py - verts[idx + 1], ez = pz - verts[idx + 2];
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 < best) {
              best = d2;
              if (out) { out[0]=px; out[1]=py; out[2]=pz; out[3]=verts[idx]; out[4]=verts[idx+1]; out[5]=verts[idx+2]; }
            }
          }
        }
      }
    }
    return best;
  }
}

export function meshMinDist(trisA: Float32Array, trisB: Float32Array, thresholdM: number, outPair?: number[]): number {
  const cs = Math.max(thresholdM || 0.05, 0.02);
  let gridVerts, queryVerts;
  if (trisA.length <= trisB.length) { gridVerts = trisA; queryVerts = trisB; }
  else { gridVerts = trisB; queryVerts = trisA; }

  const grid = new SpatialHash(cs);
  grid.insert(gridVerts);
  const tSq = thresholdM * thresholdM;
  let minSq = Infinity;
  const step = queryVerts.length > 30000 ? 3 * Math.ceil(queryVerts.length / 30000) : 3;

  let bq0=0, bq1=0, bq2=0, bg0=0, bg1=0, bg2=0;
  for (let i = 0; i < queryVerts.length; i += step) {
    const d2 = grid.minDistSq(queryVerts[i], queryVerts[i + 1], queryVerts[i + 2], gridVerts, outPair);
    if (d2 < minSq) {
      minSq = d2;
      if (outPair) { bq0=outPair[0]; bq1=outPair[1]; bq2=outPair[2]; bg0=outPair[3]; bg1=outPair[4]; bg2=outPair[5]; }
      if (minSq <= tSq && !outPair) return Math.sqrt(minSq);
    }
  }
  if (outPair) { outPair[0]=bq0; outPair[1]=bq1; outPair[2]=bq2; outPair[3]=bg0; outPair[4]=bg1; outPair[5]=bg2; }
  return Math.sqrt(minSq);
}
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { ClashOptions } from "./src/obb-collision";
import { Highlighter } from "../Highlighter";
import { setModelTransparent } from "../../ui-templates/toolbars/viewer-toolbar";
import { BCFTopics } from "../BCFTopics";
import { appState } from "../../globals";

export interface ViewpointClippingPlane {
  location: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

export interface ClashResult {
  id1: { modelId: string; expressID: number; obb?: any };
  id2: { modelId: string; expressID: number; obb?: any };
  position: THREE.Vector3;
  camera_view_point?: { x: number; y: number; z: number };
  camera_direction?: { x: number; y: number; z: number };
  camera_up_vector?: { x: number; y: number; z: number };
  clipping_planes?: ViewpointClippingPlane[];
}

/**
 * Client-Side Clash Detection Service for OpenBIM Components
 */
export class ClashService extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "e456950d-bcba-4f18-bc1c-5d18d4513dbf" as const;
  
  enabled = true;
  readonly onDisposed = new OBC.Event<string>();
  private _workers: Worker[] = [];
  private _workerCacheStatus = new Map<Worker, Set<string>>();
  private _jobCounter = 0;
  private _pendingJobs = new Map<number, { resolve: Function; reject: Function }>();
  private _originalIfcBuffers = new Map<string, Uint8Array>();

  private _clashMarker?: THREE.Mesh;
  private _clashMarkersGroup?: THREE.Group;
  private readonly CLASH_PALETTE = [
    "#C00000", "#00B050", "#0070C0", "#FFC000", "#7030A0", 
    "#FF66CC", "#00CCFF", "#FF9933", "#99CC00", "#3399FF"
  ];

  constructor(components: OBC.Components) {
    super(components);
    components.add(ClashService.uuid, this);

    // 모델이 지워질 때 캐시된 버퍼도 함께 삭제하여 메모리 누수를 방지합니다.
    const fragments = components.get(OBC.FragmentsManager);
    fragments.list.onItemDeleted.add((modelId: string) => {
      this.removeIfcBuffer(modelId);
    });
  }

  public addIfcBuffer(modelId: string, buffer: Uint8Array) {
    this._originalIfcBuffers.set(modelId, buffer);
  }

  public getIfcBuffer(modelId: string): Uint8Array | undefined {
    return this._originalIfcBuffers.get(modelId);
  }

  public removeIfcBuffer(modelId: string) {
    this._originalIfcBuffers.delete(modelId);
    for (const worker of this._workers) {
      worker.postMessage({ action: "clear", modelId });
      this._workerCacheStatus.get(worker)?.delete(modelId);
    }
  }

  private _initWorkers() {
    if (this._workers.length === 0) {
      const numWorkers = Math.min(navigator.hardwareConcurrency || 4, 4); // 최대 4코어 분산 (메모리 낭비 방지)
      for (let i = 0; i < numWorkers; i++) {
        const worker = new Worker(new URL('./src/raw-ifc-clash-worker.ts', import.meta.url), { type: 'module' });
        this._workerCacheStatus.set(worker, new Set<string>());
        
        worker.onmessage = (e) => {
        const { jobId, results, error } = e.data;
        const job = this._pendingJobs.get(jobId);
        if (job) {
          this._pendingJobs.delete(jobId);
          if (error) {
            job.reject(new Error(error));
          } else {
            // Worker에서 넘어온 raw 결과를 Three.js 객체(Vector3)와 BCF 카메라 데이터로 매핑
            const transformedResults = results.map((r: any) => {
              const pos = new THREE.Vector3(r.position.x, r.position.y, r.position.z);
              if (r.id1.obb) r.id1.obb.center = new THREE.Vector3(r.id1.obb.center.x, r.id1.obb.center.y, r.id1.obb.center.z);
              if (r.id2.obb) r.id2.obb.center = new THREE.Vector3(r.id2.obb.center.x, r.id2.obb.center.y, r.id2.obb.center.z);
              
              const bx = pos.x; const by = -pos.z; const bz = pos.y;
              const D = 1.5; 
              const clipping_planes: ViewpointClippingPlane[] = [
                { location: { x: bx + D, y: by, z: bz }, direction: { x: 1, y: 0, z: 0 } },
                { location: { x: bx - D, y: by, z: bz }, direction: { x: -1, y: 0, z: 0 } },
                { location: { x: bx, y: by + D, z: bz }, direction: { x: 0, y: 1, z: 0 } },
                { location: { x: bx, y: by - D, z: bz }, direction: { x: 0, y: -1, z: 0 } },
                { location: { x: bx, y: by, z: bz + D }, direction: { x: 0, y: 0, z: 1 } },
                { location: { x: bx, y: by, z: bz - D }, direction: { x: 0, y: 0, z: -1 } },
              ];
              const cx = bx + 2; const cy = by - 2; const cz = bz + 2;
              const dirVec = new THREE.Vector3(bx - cx, by - cy, bz - cz).normalize();
              
              return { ...r, position: pos, camera_view_point: { x: cx, y: cy, z: cz }, camera_direction: { x: dirVec.x, y: dirVec.y, z: dirVec.z }, camera_up_vector: { x: 0, y: 0, z: 1 }, clipping_planes };
            });
            job.resolve(transformedResults);
          }
        }
      };
      worker.onerror = (err) => {
        for (const job of this._pendingJobs.values()) job.reject(err);
        this._pendingJobs.clear();
      };
        this._workers.push(worker);
      }
    }
  }

  async dispose() {
    // 진행 중인 모든 백그라운드 연산(워커) 즉시 강제 종료 (메모리 누수 방지)
    for (const worker of this._workers) {
      worker.terminate();
    }
    this._workers = [];
    this._workerCacheStatus.clear();

    for (const job of this._pendingJobs.values()) {
      job.reject(new Error("ClashService disposed"));
    }
    this._pendingJobs.clear();

    if (this._clashMarker) {
      const worlds = this.components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;
      if (world) world.scene.three.remove(this._clashMarker);
      this._clashMarker.geometry.dispose();
      (this._clashMarker.material as THREE.Material).dispose();
    }

    this.clearClashMarkers();

    this.onDisposed.trigger(ClashService.uuid);
    this.onDisposed.reset();
  }

  /**
   * 지정된 두 객체 맵(ModelIdMap) 간의 간섭을 검토합니다.
   */
  async detectClashes(
    setA: OBC.ModelIdMap,
    setB: OBC.ModelIdMap,
    options: ClashOptions = {}
  ): Promise<ClashResult[]> {
    const isSelfClash = setA === setB;

    // 1. 간섭 검토 대상 모델 ID 추출
    const targetModelIds = new Set<string>([
      ...Object.keys(setA),
      ...(isSelfClash ? [] : Object.keys(setB)),
    ]);

    const modelsData: { id: string; buffer: ArrayBuffer }[] = [];

    // 2. 캐싱된 원본 IFC 버퍼 가져오기
    for (const modelId of targetModelIds) {
      const uint8Buffer = this.getIfcBuffer(modelId);
      if (uint8Buffer) {
        // Uint8Array의 복사본(ArrayBuffer)을 생성하여 워커로 전송 (메인 스레드 메모리 소유권 유지)
        modelsData.push({ id: modelId, buffer: uint8Buffer.slice().buffer });
      } else {
        console.warn(`[ClashService] 모델의 원본 IFC 버퍼를 찾을 수 없습니다. (ModelID: ${modelId})`);
      }
    }

    if (modelsData.length === 0) {
      console.warn("⚠️ [ClashService] 유효한 IFC 버퍼가 없어 간섭 검토를 중단합니다.");
      return [];
    }

    // 3. 워커 풀(Worker Pool)을 초기화하고 멀티스레드 분산 처리를 위한 청크(Chunk) 분할
    this._initWorkers();

    const flatSetA: { modelId: string, id: number }[] = [];
    for (const [modelId, ids] of Object.entries(setA)) {
      for (const id of ids) {
        flatSetA.push({ modelId, id });
      }
    }

    if (flatSetA.length === 0) return [];

    // 전체 검사 대상 요소를 현재 띄워진 워커 개수만큼 균등 분할합니다.
    const numWorkers = Math.min(this._workers.length, flatSetA.length);
    const chunkSize = Math.ceil(flatSetA.length / numWorkers);
    const promises: Promise<ClashResult[]>[] = [];

    for (let i = 0; i < numWorkers; i++) {
      const chunk = flatSetA.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length === 0) continue;

      const subSetA: OBC.ModelIdMap = {};
      for (const item of chunk) {
        if (!subSetA[item.modelId]) subSetA[item.modelId] = new Set();
        subSetA[item.modelId].add(item.id);
      }

      const worker = this._workers[i];
      const cacheStatus = this._workerCacheStatus.get(worker)!;

      // 지능적 버퍼 전송: 각 워커가 이미 캐싱한 모델이라면 거대한 ArrayBuffer를 전송하지 않습니다.
      const modelsDataForWorker: { id: string; buffer?: ArrayBuffer }[] = [];
      for (const modelId of targetModelIds) {
        if (!cacheStatus.has(modelId)) {
          const uint8Buffer = this.getIfcBuffer(modelId);
          if (uint8Buffer) {
            modelsDataForWorker.push({ id: modelId, buffer: uint8Buffer.slice().buffer });
            cacheStatus.add(modelId);
          }
        } else {
          modelsDataForWorker.push({ id: modelId }); // ID만 전송 (Worker는 이미 캐싱함)
        }
      }

      const jobId = ++this._jobCounter;
      promises.push(new Promise((resolve, reject) => {
        this._pendingJobs.set(jobId, { resolve, reject });
        // 분산 처리 시 isSelfClash를 강제로 false로 설정하여 각 워커가 할당받은 부분 집합(subSetA)과 전체 집합(setB)을 누락 없이 교차 검증하도록 합니다.
        worker.postMessage({ action: "detect", jobId, modelsData: modelsDataForWorker, setA: subSetA, setB, isSelfClash: false, options });
      }));
    }

    // 모든 워커의 병렬 연산 결과를 기다린 후 배열로 합칩니다. (Reduce)
    const resultsArray = await Promise.all(promises);
    const flatResults = resultsArray.flat();

    // 분산 처리로 인해 발생할 수 있는 중복 결과(A-B, B-A 교차)를 최종 병합(Deduplication)합니다.
    const uniqueResults: ClashResult[] = [];
    const seen = new Set<string>();

    for (const res of flatResults) {
      const id1 = `${res.id1.modelId}-${res.id1.expressID}`;
      const id2 = `${res.id2.modelId}-${res.id2.expressID}`;
      // 순서에 상관없이 동일한 쌍을 유니크하게 필터링
      const key = id1 < id2 ? `${id1}::${id2}` : `${id2}::${id1}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueResults.push(res);
      }
    }

    return uniqueResults;
  }

  /**
   * 실제 간섭 지점(충돌 좌표)에 투시되는 빨간색 3D 마커를 렌더링합니다.
   */
  public drawClashMarker(position: THREE.Vector3) {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (!world) return;

    if (!this._clashMarker) {
      const geometry = new THREE.SphereGeometry(0.4, 16, 16); // 반지름 0.2m 크기의 구체
      // 깊이 테스트(depthTest)를 꺼서 콘크리트 벽/바닥 안에 있어도 마커가 투시되어 보이게 만듭니다.
      const material = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, opacity: 0.85 });
      this._clashMarker = new THREE.Mesh(geometry, material);
      this._clashMarker.name = "ClashMarker";
      world.scene.three.add(this._clashMarker);
    }
    this._clashMarker.position.copy(position);
    this._clashMarker.visible = true;
  }

  /**
   * 현재 표시 중인 전체 간섭 목록의 위치들에 다중 마커(InstancedMesh)를 렌더링합니다.
   */
  public drawClashMarkers(markers: (THREE.Vector3 | { position: THREE.Vector3, color?: THREE.Color })[]) {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (!world) return;

    this.clearClashMarkers();

    if (markers.length === 0) return;

    if (!this._clashMarkersGroup) {
      this._clashMarkersGroup = new THREE.Group();
      this._clashMarkersGroup.name = "ClashMarkersGroup";
      world.scene.three.add(this._clashMarkersGroup);
    }

    const geometry = new THREE.SphereGeometry(0.2, 16, 16);
    // 마커의 개별 색상(InstanceColor)을 정상적으로 렌더링하기 위해 기본 Material 색상을 흰색(0xffffff)으로 설정합니다.
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 });
    
    const instancedMesh = new THREE.InstancedMesh(geometry, material, markers.length);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < markers.length; i++) {
      const item = markers[i];
      let pos: THREE.Vector3;
      let col: THREE.Color | undefined;
      
      if (item instanceof THREE.Vector3) {
        pos = item;
      } else {
        pos = item.position;
        col = item.color;
      }

      dummy.position.copy(pos);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
      instancedMesh.setColorAt(i, col || new THREE.Color(0xff0000));
    }

    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    this._clashMarkersGroup.add(instancedMesh);
    this._clashMarkersGroup.visible = true;
  }

  public clearClashMarkers() {
    if (this._clashMarkersGroup) {
      this._clashMarkersGroup.children.forEach((child) => {
        if (child instanceof THREE.InstancedMesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this._clashMarkersGroup.clear();
      this._clashMarkersGroup.visible = false;
    }
    if (this._clashMarker) {
      this._clashMarker.visible = false;
    }
  }

  /**
   * 충돌하는 두 객체에 각각 고유한 색상을 적용합니다.
   */
  private async applyClashColor(res: ClashResult, highlighter: Highlighter) {
    await highlighter.clear("select");
    for (const color of this.CLASH_PALETTE) {
      await highlighter.clear(color);
    }

    // 배열을 활용하여 처리 대상과 색상을 유연하게 매핑
    const targets = [
      { id: res.id1, color: this.CLASH_PALETTE[0] },
      { id: res.id2, color: this.CLASH_PALETTE[1] }
    ];

    for (const { id, color } of targets) {
      if (!highlighter.styles.has(color)) {
        highlighter.styles.set(color, {
          color: new THREE.Color(color),
          renderedFaces: 1,
          opacity: 0.5,
          transparent: true,
          depthTest: true,
        });
      }
      
      await highlighter.highlightByID(color, { [id.modelId]: new Set([id.expressID]) }, false, false);
    }
  }

  /**
   * 그룹에 포함된 모든 충돌 객체들에 대해 각각 고유한 색상을 적용합니다.
   */
  private async applyClashGroupColors(results: ClashResult[], highlighter: Highlighter) {
    await highlighter.clear("select");
    for (const color of this.CLASH_PALETTE) {
      await highlighter.clear(color);
    }

    // 고유 객체 목록 추출
    const uniqueObjects = new Map<string, { modelId: string, expressID: number }>();
    for (const res of results) {
      uniqueObjects.set(`${res.id1.modelId}-${res.id1.expressID}`, res.id1);
      uniqueObjects.set(`${res.id2.modelId}-${res.id2.expressID}`, res.id2);
    }

    let colorIndex = 0;
    for (const obj of uniqueObjects.values()) {
      const color = this.CLASH_PALETTE[colorIndex % this.CLASH_PALETTE.length];
      
      if (!highlighter.styles.has(color)) {
        highlighter.styles.set(color, {
          color: new THREE.Color(color),
          renderedFaces: 1,
          opacity: 0.5,
          transparent: true,
          depthTest: true,
        });
      }
      
      await highlighter.highlightByID(color, { [obj.modelId]: new Set([obj.expressID]) }, false, false);
      colorIndex++;
    }
  }

  async selectClashObjects(res: ClashResult) {
    const highlighter = this.components.get(Highlighter);
    const map: OBC.ModelIdMap = {};
    if (!map[res.id1.modelId]) map[res.id1.modelId] = new Set();
    map[res.id1.modelId].add(res.id1.expressID);
    if (!map[res.id2.modelId]) map[res.id2.modelId] = new Set();
    map[res.id2.modelId].add(res.id2.expressID);

    await highlighter.clear("select");
    await highlighter.highlightByID("select", map);
    if (highlighter.events.select.onHighlight) {
      highlighter.events.select.onHighlight.trigger(map);
    }
  }

  async moveToClash(res: ClashResult) {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const highlighter = this.components.get(Highlighter);

    if (!world) return;

    if (world.camera && world.camera.hasCameraControls()) {
      await world.camera.controls.setLookAt(
        res.position.x + 5, res.position.y + 2, res.position.z + 5,
        res.position.x, res.position.y, res.position.z,
        true
      );
      world.camera.controls.update(0);
      await this.applyClashColor(res, highlighter);
      setModelTransparent(this.components);

      // 해당 간섭 마커 표시
      this.clearClashMarkers();
      this.drawClashMarker(res.position);
    }
  }

  async moveToClashGroup(groupPosition: THREE.Vector3, results: ClashResult[]) {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const highlighter = this.components.get(Highlighter);

    if (!world) return;

    if (world.camera && world.camera.hasCameraControls()) {
      await world.camera.controls.setLookAt(
        groupPosition.x + 5, groupPosition.y + 2, groupPosition.z + 5,
        groupPosition.x, groupPosition.y, groupPosition.z,
        true
      );
      world.camera.controls.update(0);
      await this.applyClashGroupColors(results, highlighter);
      setModelTransparent(this.components);

      // 해당 그룹 간섭 마커들 표시
      this.clearClashMarkers();
      this.drawClashMarkers(results.map(r => r.position));
    }
  }

  async saveToTopic(res: ClashResult) {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const highlighter = this.components.get(Highlighter);
    const bcfTopics = this.components.get(BCFTopics);

    if (!world) return;

    // 1. 카메라 이동 및 객체 선택 (기존 moveToClash 로직 통합)
    if (world.camera && world.camera.hasCameraControls()) {
      await world.camera.controls.setLookAt(
        res.position.x + 5, res.position.y + 2, res.position.z + 5,
        res.position.x, res.position.y, res.position.z,
        true
      );
      world.camera.controls.update(0);
      await this.applyClashColor(res, highlighter);
      setModelTransparent(this.components);
    }

    // 2. 하이라이트 색상이 렌더링에 반영될 수 있도록 최소한의 지연 대기
    await new Promise((resolve) => setTimeout(resolve, 10));

    let capturedViewpoint: any = null;
    let capturedSnapshot: string | null = null;

    if (typeof (bcfTopics as any).captureViewpoint === "function") {
      const capture = await (bcfTopics as any).captureViewpoint();
      capturedViewpoint = capture.viewpoint;
      capturedSnapshot = capture.snapshot;
    } else {
      // Fallback
      if (world.renderer) {
        world.renderer.three.render(world.scene.three, world.camera.three);
        capturedSnapshot = world.renderer.three.domElement.toDataURL("image/jpeg", 0.4);
      }
      const viewpoints = this.components.get(OBC.Viewpoints);
      capturedViewpoint = viewpoints.create();
      capturedViewpoint.title = `Clash at ${res.position.x.toFixed(2)}, ${res.position.y.toFixed(2)}, ${res.position.z.toFixed(2)}`;
      capturedViewpoint.world = world;
      await capturedViewpoint.updateCamera();
    }

    if (capturedViewpoint) {
      const fragments = this.components.get(OBC.FragmentsManager);
      const map1 = { [res.id1.modelId]: new Set([res.id1.expressID]) };
      const map2 = { [res.id2.modelId]: new Set([res.id2.expressID]) };
      
      const guids1 = await fragments.modelIdMapToGuids(map1);
      const guids2 = await fragments.modelIdMapToGuids(map2);
      
      if (!capturedViewpoint.selectionComponents) capturedViewpoint.selectionComponents = new Set();
      for (const guid of guids1) capturedViewpoint.selectionComponents.add(guid);
      for (const guid of guids2) capturedViewpoint.selectionComponents.add(guid);
      
      if (!capturedViewpoint.componentColors) capturedViewpoint.componentColors = new Map();
      capturedViewpoint.componentColors.set("C00000", guids1);
      capturedViewpoint.componentColors.set("00B050", guids2);
    }

    // 3. 토픽(Topic) 생성
    try {
      const topicId = `clash-${Date.now()}`;
      const cat1 = (res.id1 as any).category || "Unknown";
      const cat2 = (res.id2 as any).category || "Unknown";
      const title = `Clash: ${cat1}(${res.id1.expressID}) vs ${cat2}(${res.id2.expressID})`;
      const description = `Detected clash at X: ${res.position.x.toFixed(2)}, Y: ${res.position.y.toFixed(2)}, Z: ${res.position.z.toFixed(2)}`;
      
      const formattedPosition = new THREE.Vector3(
        Number(res.position.x.toFixed(2)),
        Number(res.position.y.toFixed(2)),
        Number(res.position.z.toFixed(2))
      );

      // ThatOpen의 공식 API를 우선적으로 사용하여 안전한 토픽 객체 생성
      let newTopic: any = null;
      if (bcfTopics._bcf && typeof bcfTopics._bcf.create === "function") {
         newTopic = bcfTopics._bcf.create();
      } else if (typeof (bcfTopics as any).create === "function") {
         newTopic = (bcfTopics as any).create();
      }

      if (newTopic) {
         newTopic.title = title;
         newTopic.description = description;
         newTopic.creationAuthor = appState.currentUser || "System";
         newTopic.topicType = "Clash";
         newTopic.topicStatus = "Open";
         newTopic.clashPoint = formattedPosition;
         newTopic.guid1 = res.id1.expressID;
         newTopic.guid2 = res.id2.expressID;
         newTopic.category1 = cat1;
         newTopic.category2 = cat2;
         if (capturedViewpoint) {
            if (!newTopic.viewpoints) newTopic.viewpoints = new Set();
            newTopic.viewpoints.add(capturedViewpoint.guid);
         }
         if (capturedSnapshot) newTopic.snapshot = capturedSnapshot;
         
         if (!bcfTopics.list.has(newTopic.guid)) bcfTopics.list.set(newTopic.guid, newTopic);
      } else if ((bcfTopics as any).createTopic) {
         (bcfTopics as any).createTopic({ title, description, clashResult: res, viewpoint: capturedViewpoint, snapshot: capturedSnapshot });
      } else {
         newTopic = {
            guid: topicId,
            title,
            description,
            creationAuthor: appState.currentUser || "System",
            creationDate: new Date().toISOString(),
            topicType: "Clash",
            topicStatus: "Open",
            viewpoints: new Set<string>(), // 에러 방지: 뷰포인트 컨테이너 초기화
            labels: new Set<string>(),
            comments: [],
            clashPoint: formattedPosition,
            guid1: res.id1.expressID,
            guid2: res.id2.expressID,
            category1: cat1,
            category2: cat2,
            snapshot: capturedSnapshot,
         };
         if (capturedViewpoint) newTopic.viewpoints.add(capturedViewpoint.guid);
         bcfTopics.list.set(topicId, newTopic as any);
      }
      
      bcfTopics.onRefresh.trigger();
      alert(`간섭 결과가 BCF 토픽으로 생성되었습니다!\n제목: ${title}`);
    } catch (e) {
      console.error(e);
      alert("BCF 토픽 생성 중 오류가 발생했습니다.");
    }
  }

  async saveGroupToTopic(groupPosition: THREE.Vector3, results: ClashResult[]) {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const highlighter = this.components.get(Highlighter);
    const bcfTopics = this.components.get(BCFTopics);

    if (!world) return;

    // 1. 카메라 이동 및 다중 객체 고유 색상 하이라이트 적용
    if (world.camera && world.camera.hasCameraControls()) {
      await world.camera.controls.setLookAt(
        groupPosition.x + 5, groupPosition.y + 2, groupPosition.z + 5,
        groupPosition.x, groupPosition.y, groupPosition.z,
        true
      );
      world.camera.controls.update(0);
      await this.applyClashGroupColors(results, highlighter);
      setModelTransparent(this.components);
    }

    // 2. 렌더링 반영을 위한 짧은 대기 후 스냅샷/뷰포인트 캡처
    await new Promise((resolve) => setTimeout(resolve, 10));

    let capturedViewpoint: any = null;
    let capturedSnapshot: string | null = null;

    if (typeof (bcfTopics as any).captureViewpoint === "function") {
      const capture = await (bcfTopics as any).captureViewpoint();
      capturedViewpoint = capture.viewpoint;
      capturedSnapshot = capture.snapshot;
    } else {
      if (world.renderer) {
        world.renderer.three.render(world.scene.three, world.camera.three);
        capturedSnapshot = world.renderer.three.domElement.toDataURL("image/jpeg", 0.4);
      }
      const viewpoints = this.components.get(OBC.Viewpoints);
      capturedViewpoint = viewpoints.create();
      capturedViewpoint.title = `Group Clash at ${groupPosition.x.toFixed(2)}, ${groupPosition.y.toFixed(2)}, ${groupPosition.z.toFixed(2)}`;
      capturedViewpoint.world = world;
      await capturedViewpoint.updateCamera();
    }

    if (capturedViewpoint) {
      const fragments = this.components.get(OBC.FragmentsManager);
      if (!capturedViewpoint.selectionComponents) capturedViewpoint.selectionComponents = new Set();
      if (!capturedViewpoint.componentColors) capturedViewpoint.componentColors = new Map();

      // 그룹 내 모든 객체에 대해 BCF 뷰포인트용 GUID 및 색상 매핑
      const uniqueObjects = new Map<string, { modelId: string, expressID: number }>();
      for (const res of results) {
        uniqueObjects.set(`${res.id1.modelId}-${res.id1.expressID}`, res.id1);
        uniqueObjects.set(`${res.id2.modelId}-${res.id2.expressID}`, res.id2);
      }

      let colorIndex = 0;
      for (const obj of uniqueObjects.values()) {
        const colorHex = this.CLASH_PALETTE[colorIndex % this.CLASH_PALETTE.length].replace("#", "");
        const map = { [obj.modelId]: new Set([obj.expressID]) };
        const guids = await fragments.modelIdMapToGuids(map);
        
        for (const guid of guids) capturedViewpoint.selectionComponents.add(guid);
        
        if (!capturedViewpoint.componentColors.has(colorHex)) {
          capturedViewpoint.componentColors.set(colorHex, new Set());
        }
        const colorSet = capturedViewpoint.componentColors.get(colorHex);
        for (const guid of guids) colorSet.add(guid);
        
        colorIndex++;
      }
    }

    // 3. 그룹 전용 BCF 토픽 생성
    try {
      const entities = new Set<string>();
      results.forEach(res => {
        entities.add((res.id1 as any).category || "Unknown");
        entities.add((res.id2 as any).category || "Unknown");
      });
      const entityStr = Array.from(entities).join(", ");
      const title = `Group Clash: ${entityStr} (${results.length} items)`;
      const description = `Grouped clash detected at X: ${groupPosition.x.toFixed(2)}, Y: ${groupPosition.y.toFixed(2)}, Z: ${groupPosition.z.toFixed(2)}`;
      
      const formattedPosition = new THREE.Vector3(
        Number(groupPosition.x.toFixed(2)),
        Number(groupPosition.y.toFixed(2)),
        Number(groupPosition.z.toFixed(2))
      );

      // 기존 토픽 생성 로직을 재사용하되 단일 항목의 경우와 달리 처리합니다.
      const topicId = `clash-group-${Date.now()}`;

      let newTopic: any = null;
      if (bcfTopics._bcf && typeof bcfTopics._bcf.create === "function") {
         newTopic = bcfTopics._bcf.create();
      } else if (typeof (bcfTopics as any).create === "function") {
         newTopic = (bcfTopics as any).create();
      }

      if (newTopic) {
         newTopic.title = title;
         newTopic.description = description;
         newTopic.creationAuthor = appState.currentUser || "System";
         newTopic.topicType = "Clash";
         newTopic.topicStatus = "Open";
         newTopic.clashPoint = formattedPosition;
         // 그룹의 특성상 첫 번째 객체 정보를 대표값으로 저장
         newTopic.guid1 = results[0].id1.expressID;
         newTopic.guid2 = results[0].id2.expressID;
         newTopic.category1 = (results[0].id1 as any).category || "Unknown";
         newTopic.category2 = (results[0].id2 as any).category || "Unknown";
         if (capturedViewpoint) {
            if (!newTopic.viewpoints) newTopic.viewpoints = new Set();
            newTopic.viewpoints.add(capturedViewpoint.guid);
         }
         if (capturedSnapshot) newTopic.snapshot = capturedSnapshot;
         
         if (!bcfTopics.list.has(newTopic.guid)) bcfTopics.list.set(newTopic.guid, newTopic);
      } else if ((bcfTopics as any).createTopic) {
         (bcfTopics as any).createTopic({ title, description, clashResult: results[0], viewpoint: capturedViewpoint, snapshot: capturedSnapshot });
      } else {
         newTopic = {
            guid: topicId,
            title,
            description,
            creationAuthor: appState.currentUser || "System",
            creationDate: new Date().toISOString(),
            topicType: "Clash",
            topicStatus: "Open",
            viewpoints: new Set<string>(),
            labels: new Set<string>(),
            comments: [],
            clashPoint: formattedPosition,
            guid1: results[0].id1.expressID,
            guid2: results[0].id2.expressID,
            category1: (results[0].id1 as any).category || "Unknown",
            category2: (results[0].id2 as any).category || "Unknown",
            snapshot: capturedSnapshot,
         };
         if (capturedViewpoint) newTopic.viewpoints.add(capturedViewpoint.guid);
         bcfTopics.list.set(topicId, newTopic as any);
      }
      
      bcfTopics.onRefresh.trigger();
      alert(`간섭 그룹이 BCF 토픽으로 성공적으로 생성되었습니다!\n제목: ${title}`);
    } catch (e) {
      console.error(e);
      alert("BCF 토픽 생성 중 오류가 발생했습니다.");
    }
  }

  async saveAllToTopics(results: ClashResult[]) {
    const bcfTopics = this.components.get(BCFTopics);
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const viewpoints = this.components.get(OBC.Viewpoints);
    const highlighter = this.components.get(Highlighter);

    if (!results || results.length === 0) return;

    let addedCount = 0;

    // 일괄 생성 시 성능 극대화를 위해 무거운 개별 객체 하이라이트 및 투명화 생략
    await highlighter.clear("select");
    for (const color of this.CLASH_PALETTE) {
      await highlighter.clear(color);
    }

    // 일괄 생성 시 애니메이션을 끄고 즉시 이동하여 빠르게 스냅샷을 촬영합니다.
    for (const res of results) {
      const topicId = `clash-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const cat1 = (res.id1 as any).category || "Unknown";
      const cat2 = (res.id2 as any).category || "Unknown";
      const title = `Clash: ${cat1}(${res.id1.expressID}) vs ${cat2}(${res.id2.expressID})`;
      const description = `Detected clash at X: ${res.position.x.toFixed(2)}, Y: ${res.position.y.toFixed(2)}, Z: ${res.position.z.toFixed(2)}`;
      
      const formattedPosition = new THREE.Vector3(
        Number(res.position.x.toFixed(2)),
        Number(res.position.y.toFixed(2)),
        Number(res.position.z.toFixed(2))
      );

      let capturedViewpoint: any = null;
      let capturedSnapshot: string | null = null;

      if (world && world.camera && world.camera.hasCameraControls()) {
        await world.camera.controls.setLookAt(
          res.position.x + 5, res.position.y + 2, res.position.z + 5,
          res.position.x, res.position.y, res.position.z,
          false
        );
        world.camera.controls.update(0); // 카메라 매트릭스 강제 업데이트 (엉뚱한 스냅샷 방지)

        // 강제 동기 렌더링 및 캡처 (속도를 위해 JPEG, 품질 0.1)
        if (world.renderer) {
          world.renderer.three.render(world.scene.three, world.camera.three);
          capturedSnapshot = world.renderer.three.domElement.toDataURL("image/jpeg", 0.1);
        }

        // 뷰포인트 수동 생성 (captureViewpoint 내부의 중복 캡처 및 지연 방지)
        capturedViewpoint = viewpoints.create();
        capturedViewpoint.title = title;
        capturedViewpoint.world = world;
        await capturedViewpoint.updateCamera();

        if (capturedViewpoint) {
          const fragments = this.components.get(OBC.FragmentsManager);
          const map1 = { [res.id1.modelId]: new Set([res.id1.expressID]) };
          const map2 = { [res.id2.modelId]: new Set([res.id2.expressID]) };
          
          const guids1 = await fragments.modelIdMapToGuids(map1);
          const guids2 = await fragments.modelIdMapToGuids(map2);
          
          if (!capturedViewpoint.selectionComponents) capturedViewpoint.selectionComponents = new Set();
          for (const guid of guids1) capturedViewpoint.selectionComponents.add(guid);
          for (const guid of guids2) capturedViewpoint.selectionComponents.add(guid);
          
          if (!capturedViewpoint.componentColors) capturedViewpoint.componentColors = new Map();
          capturedViewpoint.componentColors.set("C00000", guids1);
          capturedViewpoint.componentColors.set("00B050", guids2);
        }
      }

      let newTopic: any = null;
      if (bcfTopics._bcf && typeof bcfTopics._bcf.create === "function") {
         newTopic = bcfTopics._bcf.create();
      } else if (typeof (bcfTopics as any).create === "function") {
         newTopic = (bcfTopics as any).create();
      }

      if (newTopic) {
         newTopic.title = title;
         newTopic.description = description;
         newTopic.creationAuthor = appState.currentUser || "System";
         newTopic.topicType = "Clash";
         newTopic.topicStatus = "Open";
         newTopic.clashPoint = formattedPosition;
         newTopic.guid1 = res.id1.expressID;
         newTopic.guid2 = res.id2.expressID;
         newTopic.category1 = cat1;
         newTopic.category2 = cat2;
         
         if (capturedViewpoint) {
            if (!newTopic.viewpoints) newTopic.viewpoints = new Set();
            newTopic.viewpoints.add(capturedViewpoint.guid);
         }
         if (capturedSnapshot) newTopic.snapshot = capturedSnapshot;
         
         if (!bcfTopics.list.has(newTopic.guid)) bcfTopics.list.set(newTopic.guid, newTopic);
         addedCount++;
      } else {
         newTopic = {
            guid: topicId,
            title,
            description,
            creationAuthor: appState.currentUser || "System",
            creationDate: new Date().toISOString(),
            topicType: "Clash",
            topicStatus: "Open",
            viewpoints: new Set<string>(), 
            labels: new Set<string>(),
            comments: [],
            clashPoint: formattedPosition,
            guid1: res.id1.expressID,
            guid2: res.id2.expressID,
            category1: cat1,
            category2: cat2,
            snapshot: capturedSnapshot,
         };
         if (capturedViewpoint) newTopic.viewpoints.add(capturedViewpoint.guid);
         bcfTopics.list.set(topicId, newTopic as any);
         addedCount++;
      }
    }
    
    // 처리 완료 후 하이라이트 초기화 및 뷰 복구
    await highlighter.clear("select");
    for (const color of this.CLASH_PALETTE) {
      await highlighter.clear(color);
    }
    bcfTopics.onRefresh.trigger();
    alert(`총 ${addedCount}개의 간섭 결과가 BCF 토픽으로 일괄 생성되었습니다!`);
  }
}

export * from "./src/clash-matrix";
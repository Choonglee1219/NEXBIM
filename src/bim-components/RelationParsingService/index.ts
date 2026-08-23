import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import { SharedIFC } from "../SharedIFC";
import { ModelRelationData } from "./src/types";
import { parseIfcStepRelations } from "./src/step-parser";
import { buildModelGeometries, GeometryBuildResult } from "./src/geometry-builder";

export * from "./src/types";
export * from "./src/step-parser";
export * from "./src/geometry-builder";

export class RelationParsingService extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "5b82c19e-9d24-4f81-bb03-e89c086d9a12" as const;

  enabled = true;

  readonly onRelationsParsed = new OBC.Event<{ modelKey: string; data: ModelRelationData }>();
  readonly onOpeningsVisibilityChanged = new OBC.Event<boolean>();
  readonly onSpatialZonesVisibilityChanged = new OBC.Event<boolean>();
  readonly onDisposed = new OBC.Event<string>();

  private _modelRelationsCache = new Map<string, ModelRelationData>();
  private _parsingPromises = new Map<string, Promise<ModelRelationData>>();

  private _geometryCache = new Map<string, GeometryBuildResult>();
  private _geometryPromises = new Map<string, Promise<GeometryBuildResult>>();

  private _openingsSceneGroup = new THREE.Group();
  private _spatialZonesSceneGroup = new THREE.Group();

  public get openingsSceneGroup(): THREE.Group {
    return this._openingsSceneGroup;
  }

  public get spatialZonesSceneGroup(): THREE.Group {
    return this._spatialZonesSceneGroup;
  }

  isOpeningsVisible = false;
  isSpatialZonesVisible = false;

  private _highlightMeshes = new Map<string, THREE.Mesh[]>();

  constructor(components: OBC.Components) {
    super(components);
    components.add(RelationParsingService.uuid, this);

    this._openingsSceneGroup.name = "NEXBIM_IfcOpenings_Group";
    this._openingsSceneGroup.visible = false;

    this._spatialZonesSceneGroup.name = "NEXBIM_IfcSpatialZones_Group";
    this._spatialZonesSceneGroup.visible = false;

    this._initFragmentsListener();
  }

  private _initFragmentsListener() {
    const fragments = this.components.get(OBC.FragmentsManager);
    fragments.list.onItemDeleted.add((e: any) => {
      const modelId = e?.id || (typeof e === "string" ? e : undefined);
      if (modelId) {
        this.clearCache(modelId);
      }
    });
  }

  private _getWorld(): OBC.World | null {
    const worlds = this.components.get(OBC.Worlds);
    for (const world of worlds.list.values()) {
      if (world.scene?.three) return world;
    }
    return null;
  }

  private _ensureSceneAttached() {
    const world = this._getWorld();
    if (world?.scene?.three) {
      if (!world.scene.three.children.includes(this._openingsSceneGroup)) {
        world.scene.three.add(this._openingsSceneGroup);
      }
      if (!world.scene.three.children.includes(this._spatialZonesSceneGroup)) {
        world.scene.three.add(this._spatialZonesSceneGroup);
      }
    }
  }

  getCustomMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    if (this._openingsSceneGroup.visible) {
      this._openingsSceneGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
    }
    if (this._spatialZonesSceneGroup.visible) {
      this._spatialZonesSceneGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
    }
    return meshes;
  }

  getAllCustomMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    this._openingsSceneGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    this._spatialZonesSceneGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    return meshes;
  }

  getCustomMeshByExpressId(_modelKey: string, expressId: number): THREE.Object3D | null {
    let target: THREE.Object3D | null = null;
    const findInGroup = (group: THREE.Group) => {
      group.traverse((child) => {
        if (target) return;
        if (child.userData && child.userData.expressId === expressId) {
          target = child;
        }
      });
    };
    findInGroup(this._openingsSceneGroup);
    if (!target) findInGroup(this._spatialZonesSceneGroup);
    return target;
  }

  async dispose() {
    this.hideOpenings();
    this.hideSpatialZones();

    this._disposeGroup(this._openingsSceneGroup);
    this._disposeGroup(this._spatialZonesSceneGroup);

    const world = this._getWorld();
    if (world?.scene?.three) {
      world.scene.three.remove(this._openingsSceneGroup);
      world.scene.three.remove(this._spatialZonesSceneGroup);
    }

    this._modelRelationsCache.clear();
    this._parsingPromises.clear();
    this._geometryCache.clear();
    this._geometryPromises.clear();
    this._directIfcBuffers.clear();

    this.onRelationsParsed.reset();
    this.onOpeningsVisibilityChanged.reset();
    this.onSpatialZonesVisibilityChanged.reset();
    this.onDisposed.trigger(RelationParsingService.uuid);
    this.onDisposed.reset();
  }

  private _disposeGroup(group: THREE.Group) {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        if (child.geometry) child.geometry.dispose();
      }
    });
    group.clear();
  }

  clearCache(modelKey?: string) {
    if (modelKey) {
      this._modelRelationsCache.delete(modelKey);
      this._parsingPromises.delete(modelKey);
      this._directIfcBuffers.delete(modelKey);

      if (this._geometryCache.has(modelKey)) {
        const geo = this._geometryCache.get(modelKey)!;
        this._openingsSceneGroup.remove(geo.openingsGroup);
        this._spatialZonesSceneGroup.remove(geo.spatialZonesGroup);
        this._disposeGroup(geo.openingsGroup);
        this._disposeGroup(geo.spatialZonesGroup);
        this._geometryCache.delete(modelKey);
      }
      this._geometryPromises.delete(modelKey);
    } else {
      this._modelRelationsCache.clear();
      this._parsingPromises.clear();
      this._directIfcBuffers.clear();
      this._disposeGroup(this._openingsSceneGroup);
      this._disposeGroup(this._spatialZonesSceneGroup);
      this._geometryCache.clear();
      this._geometryPromises.clear();
    }
  }

  getModelKey(model: FRAGS.FragmentsModel | any): string {
    if (!model) return "default";
    return (
      (model as any).modelId ||
      (model as any).uuid ||
      (model as any).name ||
      String((model as any).dbId || "default")
    );
  }

  getRelationsByModelKey(modelKey: string): ModelRelationData | undefined {
    return this._modelRelationsCache.get(modelKey);
  }

  async getModelRelations(model: FRAGS.FragmentsModel | any): Promise<ModelRelationData> {
    const modelKey = this.getModelKey(model);

    if (this._modelRelationsCache.has(modelKey)) {
      const cached = this._modelRelationsCache.get(modelKey)!;
      if (cached.openings.size > 0 || cached.spatialZones.size > 0) {
        return cached;
      }
    }

    if (this._parsingPromises.has(modelKey)) {
      return this._parsingPromises.get(modelKey)!;
    }

    const parsePromise = this._loadAndParse(model, modelKey);
    this._parsingPromises.set(modelKey, parsePromise);

    try {
      const result = await parsePromise;
      this._modelRelationsCache.set(modelKey, result);
      this._parsingPromises.delete(modelKey);
      this.onRelationsParsed.trigger({ modelKey, data: result });
      return result;
    } catch (err) {
      this._parsingPromises.delete(modelKey);
      console.warn(`[RelationParsingService] Failed to parse relations for model: ${modelKey}`, err);
      const emptyData: ModelRelationData = {
        modelKey,
        openings: new Map(),
        elementToOpenings: new Map(),
        openingToParent: new Map(),
        openingToFillings: new Map(),
        fillingToOpening: new Map(),
        spatialZones: new Map(),
        elementToZones: new Map(),
        zoneToElements: new Map(),
      };
      return emptyData;
    }
  }

  private _directIfcBuffers = new Map<string, Uint8Array>();

  /**
   * 직접 IFC 버퍼(Uint8Array)를 등록하여 네트워크 호출 없이 즉시 파싱할 수 있도록 지원합니다.
   */
  public addIfcBuffer(modelKey: string, buffer: Uint8Array) {
    this._directIfcBuffers.set(modelKey, buffer);
    const cached = this._modelRelationsCache.get(modelKey);
    if (!cached || (cached.openings.size === 0 && cached.spatialZones.size === 0)) {
      this._modelRelationsCache.delete(modelKey);
      this._parsingPromises.delete(modelKey);
    }
  }

  private async _getIfcBuffer(model: any): Promise<{ name: string; content: Uint8Array } | null> {
    if (!model) return null;

    // 0. model 객체 자체에 버퍼 속성이 있는 경우 (최우선)
    if (model.ifcBuffer instanceof Uint8Array && model.ifcBuffer.length > 0) {
      return { name: model.name || "model.ifc", content: model.ifcBuffer };
    }
    if (model.rawBuffer instanceof Uint8Array && model.rawBuffer.length > 0) {
      return { name: model.name || "model.ifc", content: model.rawBuffer };
    }

    const modelKey = this.getModelKey(model);
    const rawModelId = (model as any).modelId || (model as any).uuid;
    const modelName = (model as any).name;

    // 1. 직접 등록된 버퍼 확인 (Direct In-Memory Buffer)
    if (this._directIfcBuffers.has(modelKey)) {
      return { name: modelName || "model.ifc", content: this._directIfcBuffers.get(modelKey)! };
    }
    if (rawModelId && this._directIfcBuffers.has(rawModelId)) {
      return { name: modelName || "model.ifc", content: this._directIfcBuffers.get(rawModelId)! };
    }
    if (modelName && this._directIfcBuffers.has(modelName)) {
      return { name: modelName, content: this._directIfcBuffers.get(modelName)! };
    }

    // 2. ClashService에 캐싱된 메모리 버퍼 확인
    try {
      const clashService = this.components.get<any>({ uuid: "e456950d-bcba-4f18-bc1c-5d18d4513dbf" } as any);
      if (clashService && typeof clashService.getIfcBuffer === "function") {
        const memBuf =
          clashService.getIfcBuffer(modelKey) ||
          (rawModelId ? clashService.getIfcBuffer(rawModelId) : undefined) ||
          (modelName ? clashService.getIfcBuffer(modelName) : undefined);
        if (memBuf && memBuf.length > 0) {
          return { name: modelName || "model.ifc", content: memBuf };
        }
      }
    } catch (e) {}

    // 3. SharedIFC DB 조회 (네트워크)
    const sharedIFC = new SharedIFC();
    let ifcData: { name: string; content: Uint8Array } | null = null;

    const dbId =
      (model as any).dbId ||
      (rawModelId ? sharedIFC.getIfcIdByModelUUID(rawModelId) : undefined) ||
      sharedIFC.getIfcIdByModelUUID(modelKey);

    if (dbId) {
      try {
        ifcData = await sharedIFC.loadIFC(dbId);
      } catch (e) {}
    }

    if (!ifcData && modelName) {
      try {
        await sharedIFC.loadIFCFiles();
        const matched = sharedIFC.list.find(
          (f) => f.name === modelName || modelName.includes(f.name) || f.name.includes(modelName)
        );
        if (matched) {
          ifcData = await sharedIFC.loadIFC(matched.id);
        }
      } catch (e) {}
    }

    return ifcData;
  }

  private async _loadAndParse(model: any, modelKey: string): Promise<ModelRelationData> {
    const ifcData = await this._getIfcBuffer(model);
    if (ifcData && ifcData.content) {
      const text = new TextDecoder().decode(ifcData.content);
      const parsed = parseIfcStepRelations(text, modelKey);
      if (parsed.openings.size > 0 || parsed.spatialZones.size > 0) {
        console.log(`[RelationParsingService] Parsed ${parsed.openings.size} openings and ${parsed.spatialZones.size} spatial zones for ${modelKey}`);
      }
      return parsed;
    }

    return {
      modelKey,
      openings: new Map(),
      elementToOpenings: new Map(),
      openingToParent: new Map(),
      openingToFillings: new Map(),
      fillingToOpening: new Map(),
      spatialZones: new Map(),
      elementToZones: new Map(),
      zoneToElements: new Map(),
    };
  }

  // --- 3D Geometry Rendering & Visibility Methods ---

  async ensureModelGeometries(model: FRAGS.FragmentsModel | any): Promise<GeometryBuildResult | null> {
    const modelKey = this.getModelKey(model);

    if (this._geometryCache.has(modelKey)) {
      return this._geometryCache.get(modelKey)!;
    }

    if (this._geometryPromises.has(modelKey)) {
      return this._geometryPromises.get(modelKey)!;
    }

    const relData = await this.getModelRelations(model);
    const ifcData = await this._getIfcBuffer(model);

    if (!ifcData || !ifcData.content) return null;

    const buildPromise = buildModelGeometries(ifcData.content, modelKey, relData);
    this._geometryPromises.set(modelKey, buildPromise);

    try {
      const result = await buildPromise;
      this._geometryCache.set(modelKey, result);
      this._geometryPromises.delete(modelKey);

      this._openingsSceneGroup.add(result.openingsGroup);
      this._spatialZonesSceneGroup.add(result.spatialZonesGroup);

      this._ensureSceneAttached();
      return result;
    } catch (err) {
      this._geometryPromises.delete(modelKey);
      console.warn(`[RelationParsingService] Failed to build geometries for model: ${modelKey}`, err);
      return null;
    }
  }

  async showOpenings() {
    this._ensureSceneAttached();
    const fragments = this.components.get(OBC.FragmentsManager);
    for (const model of fragments.list.values()) {
      await this.ensureModelGeometries(model);
    }
    this._openingsSceneGroup.visible = true;
    this.isOpeningsVisible = true;
    this.onOpeningsVisibilityChanged.trigger(true);
    await fragments.core.update(true);
  }

  hideOpenings() {
    this._openingsSceneGroup.visible = false;
    this.isOpeningsVisible = false;
    this.onOpeningsVisibilityChanged.trigger(false);
  }

  async toggleOpenings(visible?: boolean): Promise<boolean> {
    const target = visible !== undefined ? visible : !this.isOpeningsVisible;
    if (target) {
      await this.showOpenings();
    } else {
      this.hideOpenings();
    }
    return this.isOpeningsVisible;
  }

  async showSpatialZones() {
    this._ensureSceneAttached();
    const fragments = this.components.get(OBC.FragmentsManager);
    for (const model of fragments.list.values()) {
      await this.ensureModelGeometries(model);
    }
    this._spatialZonesSceneGroup.visible = true;
    this.isSpatialZonesVisible = true;
    this.onSpatialZonesVisibilityChanged.trigger(true);
    await fragments.core.update(true);
  }

  hideSpatialZones() {
    this._spatialZonesSceneGroup.visible = false;
    this.isSpatialZonesVisible = false;
    this.onSpatialZonesVisibilityChanged.trigger(false);
  }

  async toggleSpatialZones(visible?: boolean): Promise<boolean> {
    const target = visible !== undefined ? visible : !this.isSpatialZonesVisible;
    if (target) {
      await this.showSpatialZones();
    } else {
      this.hideSpatialZones();
    }
    return this.isSpatialZonesVisible;
  }

  // --- Highlighting Integration with Custom Meshes ---

  applySelectionHighlight(
    name: string,
    selectionMap: { [modelId: string]: Set<number> },
    materialDefinition?: any
  ) {
    if (!this._highlightMeshes.has(name)) {
      this._highlightMeshes.set(name, []);
    }
    const currentHighlights = this._highlightMeshes.get(name)!;

    for (const mesh of currentHighlights) {
      if (mesh.parent) mesh.parent.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    }
    currentHighlights.length = 0;

    if (!selectionMap || Object.keys(selectionMap).length === 0) return;

    const highlightColor = materialDefinition?.color || new THREE.Color("#f59e0b");
    const highlightMat = new THREE.MeshBasicMaterial({
      color: highlightColor,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    for (const modelKey in selectionMap) {
      const expressIds = selectionMap[modelKey];
      for (const expressId of expressIds) {
        const customObj = this.getCustomMeshByExpressId(modelKey, expressId);
        if (customObj) {
          customObj.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
              const hMesh = new THREE.Mesh(child.geometry.clone(), highlightMat);
              hMesh.renderOrder = 999;
              hMesh.applyMatrix4(child.matrixWorld);
              const world = this._getWorld();
              if (world?.scene?.three) {
                world.scene.three.add(hMesh);
                currentHighlights.push(hMesh);
              }
            }
          });
        }
      }
    }
  }

  clearSelectionHighlight(name?: string) {
    if (name) {
      const meshes = this._highlightMeshes.get(name);
      if (meshes) {
        for (const mesh of meshes) {
          if (mesh.parent) mesh.parent.remove(mesh);
          if (mesh.geometry) mesh.geometry.dispose();
        }
        meshes.length = 0;
      }
    } else {
      for (const [_, meshes] of this._highlightMeshes) {
        for (const mesh of meshes) {
          if (mesh.parent) mesh.parent.remove(mesh);
          if (mesh.geometry) mesh.geometry.dispose();
        }
      }
      this._highlightMeshes.clear();
    }
  }
}

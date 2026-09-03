import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import { SharedIFC } from "../SharedIFC";
import { ModelRelationData, IfcOpeningElementData, IfcSpatialZoneData } from "./src/types";
import { parseIfcStepRelations } from "./src/step-parser";
import { buildModelGeometries, GeometryBuildResult } from "./src/geometry-builder";

export * from "./src/types";
export * from "./src/step-parser";
export * from "./src/geometry-builder";

export class RelationParsingService extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "5b82c19e-9d24-4f81-bb03-e89c086d9a12" as const;

  enabled = true;
  readonly onDisposed = new OBC.Event<string>();
  readonly onRelationsParsed = new OBC.Event<{ modelKey: string; data: ModelRelationData }>();
  readonly onOpeningsVisibilityChanged = new OBC.Event<boolean>();
  readonly onSpatialZonesVisibilityChanged = new OBC.Event<boolean>();

  private _modelRelationsCache = new Map<string, ModelRelationData>();
  private _parsingPromises = new Map<string, Promise<ModelRelationData>>();
  private _directIfcBuffers = new Map<string, Uint8Array>();

  // 3D 지오메트리 메쉬 캐시 및 씬 그룹
  private _geometryCache = new Map<string, GeometryBuildResult>();
  private _geometryPromises = new Map<string, Promise<GeometryBuildResult>>();
  private _openingsSceneGroup = new THREE.Group();
  private _spatialZonesSceneGroup = new THREE.Group();

  get openingsSceneGroup(): THREE.Group {
    return this._openingsSceneGroup;
  }

  get spatialZonesSceneGroup(): THREE.Group {
    return this._spatialZonesSceneGroup;
  }

  isOpeningsVisible = false;
  isSpatialZonesVisible = false;

  private _selectedMeshes = new Set<THREE.Mesh>();
  private _customStyleMaterials = new Map<string, THREE.Material>();
  private _meshStyles = new Map<THREE.Mesh, Map<string, THREE.Material>>();
  private _defaultMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  private _selectMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8fbc0c"),
    transparent: true,
    opacity: 0.7,
    roughness: 0.2,
    metalness: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  constructor(components: OBC.Components) {
    super(components);
    components.add(RelationParsingService.uuid, this);

    this._openingsSceneGroup.name = "NEXBIM_IfcOpenings_Group";
    this._openingsSceneGroup.visible = false;

    this._spatialZonesSceneGroup.name = "NEXBIM_IfcSpatialZones_Group";
    this._spatialZonesSceneGroup.visible = false;

    // 모델 삭제 시 캐시 자동 청소 (메모리 누수 방지)
    const fragments = components.get(OBC.FragmentsManager);
    fragments.list.onItemDeleted.add((e: any) => {
      const modelId = e?.modelId || (typeof e === "string" ? e : null);
      if (modelId) this.clearCache(modelId);
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
    this._directIfcBuffers.clear();
    this._geometryCache.clear();
    this._geometryPromises.clear();

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
        if (child instanceof THREE.Mesh) {
          this._selectedMeshes.delete(child);
          this._meshStyles.delete(child);
          this._defaultMaterials.delete(child);
        }
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
    const candidateKeys = [
      modelKey,
      (model as any)?.modelId,
      (model as any)?.uuid,
      (model as any)?.name,
      String((model as any)?.dbId || "")
    ].filter(Boolean) as string[];

    for (const key of candidateKeys) {
      if (this._modelRelationsCache.has(key)) {
        const cached = this._modelRelationsCache.get(key)!;
        if (cached.openings.size > 0 || cached.spatialZones.size > 0) return cached;
      }
    }

    if (this._parsingPromises.has(modelKey)) {
      return this._parsingPromises.get(modelKey)!;
    }

    const parsePromise = this._loadAndParse(model, modelKey);
    this._parsingPromises.set(modelKey, parsePromise);

    try {
      const result = await parsePromise;
      for (const key of candidateKeys) this._modelRelationsCache.set(key, result);
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
      for (const key of candidateKeys) this._modelRelationsCache.set(key, emptyData);
      return emptyData;
    }
  }

  public addIfcBuffer(modelKey: string, buffer: Uint8Array) {
    if (!modelKey || !buffer) return;
    this._directIfcBuffers.set(modelKey, buffer);
  }

  public async getIfcBuffer(model: any): Promise<{ name: string; content: Uint8Array } | null> {
    return this._getIfcBuffer(model);
  }

  private async _getIfcBuffer(model: any): Promise<{ name: string; content: Uint8Array } | null> {
    const modelKey = this.getModelKey(model);
    const rawModelId = (model as any).modelId;
    const modelName = (model as any).name;
    const rawUuid = (model as any).uuid;

    const keysToCheck = [modelKey, rawModelId, modelName, rawUuid].filter(Boolean) as string[];

    // 1. 직접 메모리 캐시 확인
    for (const k of keysToCheck) {
      if (this._directIfcBuffers.has(k)) {
        return { name: modelName || "model.ifc", content: this._directIfcBuffers.get(k)! };
      }
    }

    // 2. ClashService 캐시 확인
    try {
      const clashService = this.components.get<any>({ uuid: "e456950d-bcba-4f18-bc1c-5d18d4513dbf" } as any);
      if (clashService && typeof clashService.getIfcBuffer === "function") {
        for (const k of keysToCheck) {
          const memBuf = clashService.getIfcBuffer(k);
          if (memBuf && memBuf.length > 0) return { name: modelName || "model.ifc", content: memBuf };
        }
      }
    } catch (e) { }

    // 3. SharedIFC DB 조회
    const sharedIFC = new SharedIFC();
    let ifcData: { name: string; content: Uint8Array } | null = null;

    const dbId =
      (model as any).dbId ||
      (rawModelId ? sharedIFC.getIfcIdByModelUUID(rawModelId) : undefined) ||
      sharedIFC.getIfcIdByModelUUID(modelKey);

    if (dbId) {
      try {
        ifcData = await sharedIFC.loadIFC(dbId);
      } catch (e) { }
    }

    if (!ifcData && modelName) {
      try {
        await sharedIFC.loadIFCFiles();
        const matched = sharedIFC.list.find(
          (f) => f.name === modelName || modelName.includes(f.name) || f.name.includes(modelName)
        );
        if (matched) ifcData = await sharedIFC.loadIFC(matched.id);
      } catch (e) { }
    }

    return ifcData;
  }

  private async _loadAndParse(model: any, modelKey: string): Promise<ModelRelationData> {
    const ifcData = await this._getIfcBuffer(model);
    if (ifcData && ifcData.content) {
      const text = new TextDecoder().decode(ifcData.content);
      return parseIfcStepRelations(text, modelKey);
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
    if (target) await this.showOpenings();
    else this.hideOpenings();
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
    if (target) await this.showSpatialZones();
    else this.hideSpatialZones();
    return this.isSpatialZonesVisible;
  }

  // --- Internal Scene Traversal Helper ---

  private _forEachCustomMesh(
    modelIdMap: OBC.ModelIdMap | null,
    callback: (mesh: THREE.Mesh, expressId: number, modelId: string, type: "openings" | "spatialZones") => void
  ) {
    const checkGroup = (group: THREE.Group, type: "openings" | "spatialZones") => {
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const uData = child.userData || child.parent?.userData;
        if (!uData || uData.expressId === undefined) return;
        const meshModelId = uData.modelId || "default";
        const meshExpressId = uData.expressId as number;

        if (modelIdMap) {
          const ids = modelIdMap[meshModelId];
          if (!ids || !ids.has(meshExpressId)) return;
        }

        callback(child, meshExpressId, meshModelId, type);
      });
    };

    checkGroup(this._openingsSceneGroup, "openings");
    checkGroup(this._spatialZonesSceneGroup, "spatialZones");
  }

  // --- Bounding Box & Selection Focus Helpers ---

  async getBoundingBox(modelIdMap: OBC.ModelIdMap): Promise<THREE.Box3 | null> {
    const box = new THREE.Box3();
    let count = 0;
    const fragments = this.components.get(OBC.FragmentsManager);

    for (const modelId in modelIdMap) {
      const model = fragments.list.get(modelId);
      if (model) await this.ensureModelGeometries(model);
    }

    this._forEachCustomMesh(modelIdMap, (mesh) => {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const meshBox = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        box.union(meshBox);
        count++;
      }
    });

    return count > 0 && !box.isEmpty() ? box : null;
  }

  async highlightElements(modelIdMap: OBC.ModelIdMap, autoShow = true) {
    let hasOpenings = false;
    let hasZones = false;

    this._forEachCustomMesh(modelIdMap, (_mesh, _id, _mId, type) => {
      if (type === "openings") hasOpenings = true;
      if (type === "spatialZones") hasZones = true;
    });

    if (autoShow) {
      if (hasOpenings && !this.isOpeningsVisible) await this.showOpenings();
      if (hasZones && !this.isSpatialZonesVisible) await this.showSpatialZones();
    }
  }

  applySelectionHighlight(styleName: string, modelIdMap: OBC.ModelIdMap, styleDef?: any) {
    let styleMaterial: THREE.Material;

    if (styleName === "select") {
      styleMaterial = this._selectMaterial;
    } else {
      if (this._customStyleMaterials.has(styleName)) {
        styleMaterial = this._customStyleMaterials.get(styleName)!;
      } else {
        let color: THREE.Color;
        let opacity = 0.6;
        if (styleDef?.color instanceof THREE.Color) {
          color = styleDef.color;
          opacity = typeof styleDef.opacity === "number" ? styleDef.opacity : 0.6;
        } else {
          try {
            color = new THREE.Color(styleName);
          } catch (e) {
            color = new THREE.Color("#00ff00");
          }
        }
        styleMaterial = new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity: Math.max(opacity, 0.4),
          roughness: 0.2,
          metalness: 0.1,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        this._customStyleMaterials.set(styleName, styleMaterial);
      }
    }

    if (styleName === "select") this.clearSelectionHighlight("select");

    this._forEachCustomMesh(modelIdMap, (mesh) => {
      if (!this._defaultMaterials.has(mesh)) {
        this._defaultMaterials.set(mesh, mesh.material);
      }
      let meshStyles = this._meshStyles.get(mesh);
      if (!meshStyles) {
        meshStyles = new Map();
        this._meshStyles.set(mesh, meshStyles);
      }
      meshStyles.set(styleName, styleMaterial);
      mesh.material = styleMaterial;
      this._selectedMeshes.add(mesh);
    });
  }

  clearSelectionHighlight(styleName?: string) {
    if (!styleName) {
      for (const mesh of this._selectedMeshes) {
        const defaultMat = this._defaultMaterials.get(mesh);
        if (defaultMat) mesh.material = defaultMat;
      }
      this._meshStyles.clear();
      this._selectedMeshes.clear();
      this._defaultMaterials.clear();
      return;
    }

    for (const mesh of Array.from(this._selectedMeshes)) {
      const meshStyles = this._meshStyles.get(mesh);
      if (meshStyles) {
        meshStyles.delete(styleName);
        if (meshStyles.size === 0) {
          const defaultMat = this._defaultMaterials.get(mesh);
          if (defaultMat) mesh.material = defaultMat;
          this._selectedMeshes.delete(mesh);
        } else {
          const activeStyleMat = meshStyles.get("select") || meshStyles.values().next().value;
          if (activeStyleMat) mesh.material = activeStyleMat;
        }
      }
    }
  }

  // --- Convenience Helper Methods ---

  getOpeningsForElement(modelKey: string, expressId: number): IfcOpeningElementData[] {
    const relData = this._modelRelationsCache.get(modelKey);
    if (!relData) return [];
    const openingIds = relData.elementToOpenings.get(expressId) || [];
    return openingIds.map((id) => relData.openings.get(id) || { expressId: id, fillingExpressIds: [] });
  }

  getParentForOpening(modelKey: string, openingExpressId: number): number | null {
    return this._modelRelationsCache.get(modelKey)?.openingToParent.get(openingExpressId) ?? null;
  }

  getFillingsForOpening(modelKey: string, openingExpressId: number): number[] {
    return this._modelRelationsCache.get(modelKey)?.openingToFillings.get(openingExpressId) || [];
  }

  getOpeningForFilling(modelKey: string, fillingExpressId: number): number | null {
    return this._modelRelationsCache.get(modelKey)?.fillingToOpening.get(fillingExpressId) ?? null;
  }

  getSpatialZones(modelKey: string): IfcSpatialZoneData[] {
    const relData = this._modelRelationsCache.get(modelKey);
    return relData ? Array.from(relData.spatialZones.values()) : [];
  }

  getZonesForElement(modelKey: string, expressId: number): IfcSpatialZoneData[] {
    const relData = this._modelRelationsCache.get(modelKey);
    if (!relData) return [];
    const zoneIds = relData.elementToZones.get(expressId) || [];
    return zoneIds.map((id) => relData.spatialZones.get(id) || { expressId: id, referencedElementIds: [] });
  }

  getReferencedElementsForZone(modelKey: string, zoneExpressId: number): number[] {
    return this._modelRelationsCache.get(modelKey)?.zoneToElements.get(zoneExpressId) || [];
  }
}

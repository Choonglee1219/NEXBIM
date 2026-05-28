import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as TWEEN from "@tweenjs/tween.js";
import { Highlighter } from "../Highlighter";
import { CustomBoxSelector } from "../../ui-components/BoxSelection";

interface FloorGroupData {
  modelId: string;
  storeyName: string;
  originalElevation: number;
  originalCenter: THREE.Vector3;
  group: THREE.Group;
}

export class FloorExploder {
  private components: OBC.Components;
  public isExploded = false;
  public yScale: number = 5;
  public isGhostMode = false;
  
  private storeyData: FloorGroupData[] = [];
  private originalHiddenItems: OBC.ModelIdMap = {};
  private currentProgress = 0;
  private currentTween: TWEEN.Tween<any> | null = null;
  private _tweenInitialized = false;
  private _interactionInitialized = false;

  private allHologramMeshes: THREE.Mesh[] = [];
  private highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fbc0c,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  private ghostMaterial = new THREE.MeshStandardMaterial({
    color: 0x2FA4D7,
    transparent: true,
    opacity: 0.1,
    depthWrite: false
  });
  private hiddenItemMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  constructor(components: OBC.Components) {
    this.components = components;
    const fragments = this.components.get(OBC.FragmentsManager);
    fragments.list.onItemSet.add(this.onModelChanged);
    fragments.list.onItemDeleted.add(this.onModelChanged);
  }

  private onModelChanged = () => {
    this.storeyData = [];
    this.allHologramMeshes = [];
  }

  public async toggleExplode(): Promise<boolean> {
    await this.prepareStoreyData();

    if (this.storeyData.length === 0) {
      console.warn("분류된 층(Storey) 데이터를 찾을 수 없습니다.");
      return false;
    }

    this.setupTweenUpdate();

    if (this.currentTween) {
      this.currentTween.stop();
    }

    const targetExploded = !this.isExploded;
    const endProgress = targetExploded ? 1 : 0;

    const hider = this.components.get(OBC.Hider);
    const fragments = this.components.get(OBC.FragmentsManager);
    const highlighter = this.components.get(Highlighter);

    if (targetExploded) {
      highlighter.config.selectEnabled = false;
      
      CustomBoxSelector.isActive = true;
      CustomBoxSelector.onIntersect = this.handleBoxSelection.bind(this);

      for (const data of this.storeyData) {
        const model = fragments.list.get(data.modelId);
        if (model && data.group.parent !== model.object) {
          model.object.add(data.group);
        }
      }
      await hider.set(false, this.originalHiddenItems);
      this.setupInteraction(); // 펼쳐질 때 상호작용(더블클릭) 이벤트 등록
    }

    this.currentTween = new TWEEN.Tween({ p: this.currentProgress })
      .to({ p: endProgress }, 1000)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate((obj) => {
        this.currentProgress = obj.p;
        this.applyExplodeProgress(obj.p);
      })
      .onComplete(async () => {
        this.isExploded = targetExploded;
        
        if (!targetExploded) {
          
          highlighter.config.selectEnabled = true;
          
          CustomBoxSelector.isActive = false;
          CustomBoxSelector.onIntersect = null;

          await hider.set(true, this.originalHiddenItems);
          for (const data of this.storeyData) {
            const model = fragments.list.get(data.modelId);
            if (model && data.group.parent === model.object) {
              model.object.remove(data.group);
            }
          }
        }
        
        this.fitCameraToScene();
      })
      .start();
    return true;
  }

  public setScales(yScale: number) {
    this.yScale = yScale;
    if (this.isExploded || this.currentProgress > 0) {
      this.applyExplodeProgress(this.currentProgress);
    }
  }

  private setupTweenUpdate() {
    if (this._tweenInitialized) return;
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (world && world.renderer) {
      world.renderer.onBeforeUpdate.add(() => {
        TWEEN.update();
      });
      this._tweenInitialized = true;
    }
  }

  private applyExplodeProgress(progress: number) {
    for (const group of this.storeyData) {
      const offsetY = group.originalElevation * (this.yScale - 1) * progress;
      group.group.position.set(0, offsetY, 0);
    }
  }

  private syncHologramHighlight = () => {
    if (!this.isExploded) return;
    const highlighter = this.components.get(Highlighter);
    const selection = highlighter.selection["select"] || {};
    const hasSelection = !OBC.ModelIdMapUtils.isEmpty(selection);

    const selectStyle = highlighter.styles.get("select");
    if (selectStyle && selectStyle.color) {
      this.highlightMaterial.color.copy(selectStyle.color as THREE.Color);
    }

    for (const mesh of this.allHologramMeshes) {
      const { modelId, localId, originalMaterial } = mesh.userData;
      if (hasSelection && selection[modelId]?.has(localId)) {
        mesh.material = this.highlightMaterial;
      } else {
        mesh.material = this.isGhostMode ? this.ghostMaterial : originalMaterial;
      }
    }
  };

  public setGhostMode(active: boolean) {
    this.isGhostMode = active;
    if (!this.isExploded) return;
    this.syncHologramHighlight();
  }

  private handleBoxSelection(topLeft: THREE.Vector2, bottomRight: THREE.Vector2, fullyIncluded: boolean): OBC.ModelIdMap {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (!world || !world.renderer) return {};

    const rect = world.renderer.three.domElement.getBoundingClientRect();
    const minX = ((topLeft.x - rect.left) / rect.width) * 2 - 1;
    const maxX = ((bottomRight.x - rect.left) / rect.width) * 2 - 1;
    const minY = -((bottomRight.y - rect.top) / rect.height) * 2 + 1;
    const maxY = -((topLeft.y - rect.top) / rect.height) * 2 + 1;

    const newSelection: OBC.ModelIdMap = {};
    const box3 = new THREE.Box3();
    const corners = [
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
    ];
    
    world.camera.three.updateMatrixWorld();

    for (const mesh of this.allHologramMeshes) {
      if (!mesh.visible) continue;
      mesh.updateMatrixWorld();
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box3.copy(mesh.geometry.boundingBox!);
      box3.applyMatrix4(mesh.matrixWorld);

      corners[0].set(box3.min.x, box3.min.y, box3.min.z);
      corners[1].set(box3.min.x, box3.min.y, box3.max.z);
      corners[2].set(box3.min.x, box3.max.y, box3.min.z);
      corners[3].set(box3.min.x, box3.max.y, box3.max.z);
      corners[4].set(box3.max.x, box3.min.y, box3.min.z);
      corners[5].set(box3.max.x, box3.min.y, box3.max.z);
      corners[6].set(box3.max.x, box3.max.y, box3.min.z);
      corners[7].set(box3.max.x, box3.max.y, box3.max.z);

      let meshMinX = Infinity, meshMaxX = -Infinity;
      let meshMinY = Infinity, meshMaxY = -Infinity;
      let isInFrontOfCamera = false;

      for (const corner of corners) {
        corner.project(world.camera.three);
        if (corner.z >= -1 && corner.z <= 1) isInFrontOfCamera = true;
        meshMinX = Math.min(meshMinX, corner.x);
        meshMaxX = Math.max(meshMaxX, corner.x);
        meshMinY = Math.min(meshMinY, corner.y);
        meshMaxY = Math.max(meshMaxY, corner.y);
      }

      if (!isInFrontOfCamera) continue;

      let isSelected = false;
      if (fullyIncluded) {
        isSelected = meshMinX >= minX && meshMaxX <= maxX && meshMinY >= minY && meshMaxY <= maxY;
      } else {
        isSelected = meshMinX <= maxX && meshMaxX >= minX && meshMinY <= maxY && meshMaxY >= minY;
      }

      if (isSelected) {
        const { modelId, localId } = mesh.userData;
        if (!newSelection[modelId]) newSelection[modelId] = new Set();
        newSelection[modelId].add(localId);
      }
    }
    return newSelection;
  }

  private setupInteraction() {
    if (this._interactionInitialized) return;
    
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (!world || !world.renderer) return;

    const highlighter = this.components.get(Highlighter);
    if (highlighter.events["select"]) {
      highlighter.events["select"].onHighlight.add(this.syncHologramHighlight);
      highlighter.events["select"].onClear.add(this.syncHologramHighlight);
    }

    const container = world.renderer.three.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    container.addEventListener('dblclick', (e: MouseEvent) => {
      if (this.isExploded) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        this.focusSelection();
      }
    }, true);

    let isDragging = false;
    let startX = 0, startY = 0;

    container.addEventListener('pointerdown', (e: PointerEvent) => {
      isDragging = false;
      startX = e.clientX;
      startY = e.clientY;
    });

    container.addEventListener('pointermove', (e: PointerEvent) => {
      if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
        isDragging = true;
      }
    });

    container.addEventListener('pointerup', async (e: PointerEvent) => {
      if (!this.isExploded || isDragging) return;
      
      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const bounds = container.getBoundingClientRect();
      mouse.x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
      mouse.y = -((e.clientY - bounds.top) / bounds.height) * 2 + 1;

      if (world.camera) {
        raycaster.setFromCamera(mouse, world.camera.three);
        const intersectableObjects = this.storeyData.map(data => data.group);
        const intersects = raycaster.intersectObjects(intersectableObjects, true);

        if (intersects.length > 0) {
          const clickedMesh = intersects[0].object as THREE.Mesh;
          const { modelId, localId } = clickedMesh.userData;

          if (modelId && localId !== undefined) {
            const found: OBC.ModelIdMap = { [modelId]: new Set([localId]) };
            
            if (isCtrl) {
              const isSelected = highlighter.selection["select"]?.[modelId]?.has(localId);
              if (!isSelected) {
                OBC.ModelIdMapUtils.add(highlighter.selection["select"], found);
                await highlighter.updateColors();
                if (highlighter.events["select"].onHighlight) {
                  highlighter.events["select"].onHighlight.trigger(highlighter.selection["select"]);
                }
              }
            } else if (isShift) {
              const isSelected = highlighter.selection["select"]?.[modelId]?.has(localId);
              if (isSelected) {
                await highlighter.clear("select", found);
              }
            } else {
              await highlighter.clear("select");
              await highlighter.highlightByID("select", found, true, false);
            }
          }
        } else {
          if (!isCtrl && !isShift) {
            await highlighter.clear("select");
          }
        }
      }
    });

    this._interactionInitialized = true;
  }

  private async prepareStoreyData() {
    if (this.storeyData.length > 0) return;

    const fragments = this.components.get(OBC.FragmentsManager);
    if (fragments.list.size === 0) return;

    const classifier = this.components.get(OBC.Classifier);
    const hiddenGroup = classifier.list.get("PermanentHidden")?.get("HiddenItems");
    let hiddenItemsMap: OBC.ModelIdMap = {};
    if (hiddenGroup) {
      hiddenItemsMap = await hiddenGroup.get();
    }

    const globalStoreyMap = new Map<string, Record<string, Set<number>>>();
    
    for (const [modelId, model] of fragments.list.entries()) {
      const coreModel = (model as any).model || model;
      if (typeof coreModel.getSpatialStructure !== "function") continue;
      
      const structure = await coreModel.getSpatialStructure();
      if (!structure) continue;
      
      const findStoreys = async (node: any) => {
        const categoryName = node.category ? String(node.category).toUpperCase() : "";
        
        if (categoryName.includes("STOREY") && node.children) {
          for (const storeyNode of node.children) {
            if (storeyNode.localId !== undefined && storeyNode.localId !== null) {
              const data = await coreModel.getItemsData([storeyNode.localId], { attributesDefault: true });
              let sName = `Storey-${storeyNode.localId}`;
              if (data.length > 0 && data[0].Name) {
                const n = data[0].Name;
                sName = typeof n === 'object' && n.value !== undefined ? String(n.value) : String(n);
              }
              
              const elementIds = await coreModel.getItemsChildren([storeyNode.localId]);
              if (elementIds && elementIds.length > 0) {
                if (!globalStoreyMap.has(sName)) globalStoreyMap.set(sName, {});
                const modelMap = globalStoreyMap.get(sName)!;
                if (!modelMap[modelId]) modelMap[modelId] = new Set();
                
                modelMap[modelId].add(storeyNode.localId);
                for (const eid of elementIds) modelMap[modelId].add(eid);
              }
            }
          }
        } else if (node.children) {
          for (const child of node.children) {
            await findStoreys(child);
          }
        }
      };
      await findStoreys(structure);
    }

    const storeyNames = Array.from(globalStoreyMap.keys()).sort();

    for (const storeyName of storeyNames) {
      const modelIdMap = globalStoreyMap.get(storeyName)!;

      for (const [modelId, elementIdsSet] of Object.entries(modelIdMap)) {
        const model = fragments.list.get(modelId);
        if (!model) continue;

        const elementIds = Array.from(elementIdsSet);
        if (elementIds.length === 0) continue;

        if (!this.originalHiddenItems[modelId]) this.originalHiddenItems[modelId] = new Set();
        for (const id of elementIds) this.originalHiddenItems[modelId].add(id);

        const floorGroup = new THREE.Group();
        floorGroup.name = `${storeyName}_${modelId}`;

        const matDefs = await model.getItemsMaterialDefinition(elementIds);
        const materialCache = new Map<number, THREE.Material>();
        for (const def of matDefs) {
          const mat = new THREE.MeshLambertMaterial({
            color: def.definition.color,
            transparent: def.definition.transparent,
            opacity: def.definition.opacity,
            side: THREE.DoubleSide
          });
          for (const id of def.localIds) {
            materialCache.set(id, mat);
          }
        }
        const defaultMat = new THREE.MeshLambertMaterial({ color: 0xcccccc, side: THREE.DoubleSide });

        const itemGeometries = await model.getItemsGeometry(elementIds, 0);
        let meshCount = 0;

        for (let i = 0; i < itemGeometries.length; i++) {
          const geoms = itemGeometries[i];
          const localId = elementIds[i];

          for (const geom of geoms) {
            if (!geom.positions) continue;

            const bufferGeometry = new THREE.BufferGeometry();
            const posArray = geom.positions instanceof Float64Array ? new Float32Array(geom.positions) : geom.positions;
            bufferGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
            
            if (geom.normals) {
              bufferGeometry.setAttribute('normal', new THREE.BufferAttribute(geom.normals, 3, true));
            } else {
              bufferGeometry.computeVertexNormals();
            }

            if (geom.indices) {
              bufferGeometry.setIndex(new THREE.BufferAttribute(geom.indices, 1));
            }

            const idToUse = geom.localId ?? localId;
            const isHiddenItem = hiddenItemsMap[modelId]?.has(idToUse);
            const mat = isHiddenItem ? this.hiddenItemMaterial : (materialCache.get(idToUse) || defaultMat);

            const mesh = new THREE.Mesh(bufferGeometry, mat);
            if (geom.transform) mesh.applyMatrix4(geom.transform);
            
            mesh.userData = { modelId, localId: idToUse, originalMaterial: mat };
            
            floorGroup.add(mesh);
            this.allHologramMeshes.push(mesh);
            meshCount++;
          }
        }
        
        if (meshCount > 0) {
          const box = new THREE.Box3().setFromObject(floorGroup);
          const originalElevation = box.isEmpty() ? 0 : box.min.y;
          const originalCenter = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());

          this.storeyData.push({
            modelId,
            storeyName,
            originalElevation,
            originalCenter,
            group: floorGroup
          });
        }
      }
    }
  }

  public async focusSelection() {
    if (!this.isExploded) return;

    const highlighter = this.components.get(Highlighter);
    const selection = highlighter.selection["select"] || {};

    if (OBC.ModelIdMapUtils.isEmpty(selection)) {
      this.fitCameraToScene();
      return;
    }

    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (!world || !(world.camera instanceof OBC.SimpleCamera) || !world.camera.controls) return;

    const itemBox = new THREE.Box3();
    let hasSelection = false;

    world.camera.three.updateMatrixWorld();

    for (const mesh of this.allHologramMeshes) {
      const { modelId, localId } = mesh.userData;
      if (selection[modelId]?.has(localId)) {
        mesh.updateMatrixWorld();
        const meshBox = new THREE.Box3().setFromObject(mesh);
        itemBox.union(meshBox);
        hasSelection = true;
      }
    }

    if (hasSelection && !itemBox.isEmpty()) {
      const sphereBound = new THREE.Sphere();
      itemBox.getBoundingSphere(sphereBound);
      sphereBound.radius *= 1.2;
      await world.camera.controls.fitToSphere(sphereBound, true);
    }
  }

  private fitCameraToScene() {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (world && world.camera instanceof OBC.SimpleCamera && world.camera.controls) {
      const fragments = this.components.get(OBC.FragmentsManager);
      const boxer = this.components.get(OBC.BoundingBoxer);
      boxer.list.clear();
      boxer.addFromModels(Array.from(fragments.list.keys()).map(id => new RegExp(`^${id}$`)));
      const box = boxer.get();
      boxer.list.clear();
      if (!box.isEmpty()) {
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        world.camera.controls.fitToSphere(sphere, true);
      }
    }
  }

  public setVisibility(show: boolean, selection?: OBC.ModelIdMap) {
    if (!this.isExploded) return;
    if (!selection) {
      for (const mesh of this.allHologramMeshes) {
        mesh.visible = show;
      }
      return;
    }
    for (const mesh of this.allHologramMeshes) {
      const { modelId, localId } = mesh.userData;
      if (selection[modelId]?.has(localId)) mesh.visible = show;
    }
  }

  public isolate(selection: OBC.ModelIdMap) {
    if (!this.isExploded) return;
    for (const mesh of this.allHologramMeshes) {
      const { modelId, localId } = mesh.userData;
      mesh.visible = !!(selection[modelId] && selection[modelId].has(localId));
    }
  }
}

import * as OBC from "@thatopen/components";

// 사용자가 UI에서 매핑할 규칙(Rule) 구조
export interface PhaseRule {
  modelName?: string;   // 예: "Model-1" 등
  storeyName: string;   // 예: "01", "1F" 등
  entityName: string;   // 예: "COLUMN", "WALL", "SLAB" 등
  objectName?: string;  // 특정 객체 이름
  phase: number;        // 할당할 타임라인 시퀀스 번호
  startDate?: string;   // 예: "2024-01-01"
  duration?: number;    // 예: 7 (일 단위)
}

export class Timeline extends OBC.Component {
  static uuid = "939bb2bc-7d31-4a44-811d-68e4dd286c36" as const;
  enabled = true;

  phases: number[] = [];

  readonly onPhasesProcessed = new OBC.Event<undefined>();

  // 애니메이션 스크러빙 진행률 동기화용 이벤트
  readonly onProgress = new OBC.Event<number>();

  currentPhase: number | null = null;

  phaseIdMap: { [key: number]: number[] } = {};
  phaseDates: { [key: number]: { start: number, end: number } } = {};
  phaseDescriptions: { [key: number]: string } = {};

  storeyElementsMap = new Map<string, OBC.ModelIdMap>();
  categoriesMap = new Map<string, OBC.ModelIdMap>();
  storeyElevations = new Map<string, number>();
  isDataExtracted = false;

  constructor(components: OBC.Components) {
    super(components);
    components.add(Timeline.uuid, this);
  }

  get isDateMode() {
    return Object.keys(this.phaseDates).length > 0;
  }

  get minProgress() {
    if (this.phases.length === 0) return 0;
    if (this.isDateMode) return Math.min(...Object.values(this.phaseDates).map(d => d.start));
    return Math.min(...this.phases);
  }

  get maxProgress() {
    if (this.phases.length === 0) return 0;
    if (this.isDateMode) return Math.max(...Object.values(this.phaseDates).map(d => d.end));
    return Math.max(...this.phases) + 1;
  }

  getPhaseAtProgress(progress: number) {
    if (!this.isDateMode) return Math.floor(progress);
    let targetPhase = this.phases[0];
    for (const p of this.phases) {
      const pd = this.phaseDates[p];
      if (pd && progress >= pd.start) targetPhase = p;
    }
    return targetPhase;
  }

  // 모델 구조가 변경될 때 캐시를 초기화합니다.
  clearPhaseData() {
    this.storeyElementsMap.clear();
    this.categoriesMap.clear();
    this.storeyElevations.clear();
    this.isDataExtracted = false;
  }

  // 성능 최적화: 전체 모델의 공간 구조 및 분류 데이터를 단 1회만 스캔하여 메모리에 맵핑합니다.
  async extractPhaseData() {
    if (this.isDataExtracted) return;
    const fragments = this.components.get(OBC.FragmentsManager);
    const classifier = this.components.get(OBC.Classifier);

    try { await classifier.byCategory({ classificationName: "entities" }); } catch (e) {}
    const entitiesClass = classifier.list.get("entities");
    
    if (entitiesClass) {
      for (const [catName, group] of entitiesClass.entries()) {
        const cleanName = catName.replace(/^IFC/i, "").toUpperCase();
        this.categoriesMap.set(cleanName, await group.get());
      }
    }

    for (const [modelId, model] of fragments.list.entries()) {
      const coreModel = (model as any).model || model;
      if (typeof coreModel.getSpatialStructure !== "function") continue;
      
      const structure = await coreModel.getSpatialStructure();
      if (!structure) continue;
      
      const findStoreys = async (node: any, parentCategory: string = "") => {
        // 1. 카테고리 그룹 노드인 경우 (예: { category: "IFCBUILDINGSTOREY", children: [...] })
        if (node.category && node.children) {
          const cat = String(node.category).toUpperCase();
          for (const child of node.children) {
            await findStoreys(child, cat); // 자식에게 카테고리 이름을 물려줍니다.
          }
          return;
        }

        const localId = node.localId ?? node.id ?? node.expressID;
        // 버그 수정: 부모 그룹 노드에서 전달받은 카테고리(parentCategory)를 사용합니다.
        const nodeCategory = node.category ? String(node.category).toUpperCase() : parentCategory;
        
        // 노드의 카테고리가 STOREY(층)인 경우를 직접 찾아냅니다.
        if (localId !== undefined && localId !== null && nodeCategory.includes("STOREY")) {
          // 이 노드는 Storey입니다. 속성에서 Name과 Elevation을 가져옵니다.
          const data = await coreModel.getItemsData([localId], { attributesDefault: true });
          let sName = `Storey-${localId}`;
          let elevation = 0;
          if (data.length > 0) {
            const item = data[0] as any;
            if (item.Name) {
              const n = item.Name;
              sName = typeof n === 'object' && n.value !== undefined ? String(n.value) : String(n);
            }
            const elevVal = item.Elevation;
            if (elevVal !== undefined && elevVal !== null) {
              elevation = typeof elevVal === "object" && elevVal.value !== undefined ? Number(elevVal.value) : Number(elevVal);
            }
            if (isNaN(elevation)) elevation = 0;
          }
          
          if (!this.storeyElevations.has(sName)) this.storeyElevations.set(sName, elevation);
          
          // SpatialTree와 동일하게 Storey 아래에 중첩된 자식 요소의 localId를 재귀적으로 전부 수집합니다.
          const elementIds = new Set<number>();
          const collectDescendants = (n: any) => {
            const childId = n.localId ?? n.id ?? n.expressID;
            if (childId !== undefined && childId !== null) {
              elementIds.add(childId);
            }
            if (n.children) {
              for (const c of n.children) collectDescendants(c);
            }
          };
          
          if (node.children) {
            for (const child of node.children) {
              collectDescendants(child);
            }
          }

          if (elementIds.size > 0) {
            if (!this.storeyElementsMap.has(sName)) this.storeyElementsMap.set(sName, {});
            const modelMap = this.storeyElementsMap.get(sName)!;
            if (!modelMap[modelId]) modelMap[modelId] = new Set();
            for (const eid of elementIds) modelMap[modelId].add(eid);
          }
        } else {
          // 현재 노드가 Storey가 아니면 계속해서 하위 노드 탐색
          if (node.children) {
            for (const child of node.children) {
              await findStoreys(child);
            }
          }
        }
      };
      
      await findStoreys(structure);
    }
    this.isDataExtracted = true;
  }

  getSortedStoreys() {
    return Array.from(this.storeyElementsMap.keys()).sort((a, b) => {
      const elevA = this.storeyElevations.get(a) || 0;
      const elevB = this.storeyElevations.get(b) || 0;
      return elevA - elevB;
    });
  }

  getAvailableCategoriesForStorey(storeyName: string): Set<string> {
    const categories = new Set<string>();
    const sMap = this.storeyElementsMap.get(storeyName);
    if (!sMap) return categories;

    for (const [catName, cMap] of this.categoriesMap.entries()) {
      let intersect = false;
      for (const modelId in sMap) {
        if (cMap[modelId]) {
          for (const id of sMap[modelId]) {
            if (cMap[modelId].has(id)) { intersect = true; break; }
          }
        }
        if (intersect) break;
      }
      if (intersect) categories.add(catName);
    }
    return categories;
  }

  // [New] 사용자 정의 규칙(Rules)을 기반으로 Phase 동적 할당
  async applyPhaseRules(rules: PhaseRule[]) {
    await this.extractPhaseData();
    const fragments = this.components.get(OBC.FragmentsManager);

    this.phaseIdMap = {};
    this.phases = [];
    this.phaseDates = {};
    this.phaseDescriptions = {};

    for (const rule of rules) {
      if (rule.startDate && rule.duration !== undefined) {
        const start = new Date(rule.startDate).getTime();
        const durationInMs = rule.duration * 24 * 60 * 60 * 1000;
        const end = start + durationInMs;
        if (!this.phaseDates[rule.phase]) {
          this.phaseDates[rule.phase] = { start, end };
        } else {
          this.phaseDates[rule.phase].start = Math.min(this.phaseDates[rule.phase].start, start);
          this.phaseDates[rule.phase].end = Math.max(this.phaseDates[rule.phase].end, end);
        }
      }

      const mName = rule.modelName && rule.modelName !== "All" ? rule.modelName : "";
      const sName = rule.storeyName && rule.storeyName !== "All" ? rule.storeyName : "";
      const eName = rule.entityName && rule.entityName !== "All" ? rule.entityName : "";
      const oName = rule.objectName && rule.objectName !== "All" ? rule.objectName : "";
      const descArr = [mName, sName, eName, oName].filter(x => x);
      this.phaseDescriptions[rule.phase] = descArr.length > 0 ? descArr.join(" / ") : "All";

      let targetModelIds = Array.from(fragments.list.keys());
      if (rule.modelName && rule.modelName !== "All") {
        for (const [id, model] of fragments.list) {
          if ((model as any).name === rule.modelName) {
            targetModelIds = [id];
            break;
          }
        }
      }

      let storeyMap: OBC.ModelIdMap | null = null;
      if (rule.storeyName && rule.storeyName !== "All") {
        storeyMap = this.storeyElementsMap.get(rule.storeyName) || {};
      }

      let entityMap: OBC.ModelIdMap | null = null;
      if (rule.entityName && rule.entityName !== "All") {
        entityMap = this.categoriesMap.get(rule.entityName.toUpperCase()) || {};
      }

      // OOM 방지를 위한 메모리 상의 안전한 교집합(Intersection) 추출
      const intersectedMap: OBC.ModelIdMap = {};
      for (const modelId of targetModelIds) {
        let currentSet: Set<number> | null = null;
        
        if (storeyMap) currentSet = storeyMap[modelId] || new Set();

        if (entityMap) {
           if (currentSet) {
             const newSet = new Set<number>();
             const eSet = entityMap[modelId];
             if (eSet) {
               for (const id of currentSet) {
                 if (eSet.has(id)) newSet.add(id);
               }
             }
             currentSet = newSet;
           } else {
             currentSet = entityMap[modelId] || new Set();
           }
        }

        if (currentSet === null) {
          currentSet = new Set<number>();
          for (const cMap of this.categoriesMap.values()) {
            if (cMap[modelId]) cMap[modelId].forEach(id => currentSet!.add(id));
          }
        }

        if (currentSet.size > 0) intersectedMap[modelId] = currentSet;
      }

      const finalMap: OBC.ModelIdMap = {};
      if (rule.objectName && rule.objectName !== "All") {
        const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const objRegex = new RegExp(escapeRegExp(rule.objectName), "i");

        for (const [modelId, ids] of Object.entries(intersectedMap)) {
          const model = fragments.list.get(modelId);
          if (!model) continue;
          const idsArray = Array.from(ids);
          const data = await model.getItemsData(idsArray, { attributesDefault: true, relationsDefault: { attributes: false, relations: false } });
          const filteredSet = new Set<number>();
          for (let i = 0; i < data.length; i++) {
             const item = data[i] as any;
             const nameVal = item.Name;
             const actualName = typeof nameVal === "object" && nameVal?.value !== undefined ? nameVal.value : nameVal;
             if (actualName && objRegex.test(String(actualName))) {
               filteredSet.add(idsArray[i]);
             }
          }
          if (filteredSet.size > 0) finalMap[modelId] = filteredSet;
        }
      } else {
        Object.assign(finalMap, intersectedMap);
      }

      if (!(rule.phase in this.phaseIdMap)) {
        this.phaseIdMap[rule.phase] = [];
      }
      for (const modelId in finalMap) {
        this.phaseIdMap[rule.phase].push(...Array.from(finalMap[modelId]));
      }
      if (!this.phases.includes(rule.phase)) this.phases.push(rule.phase);
    }

    this.phases.sort((a, b) => a - b);
    this.onPhasesProcessed.trigger();
  }

  async showElements(selectedPhase: number) {
    const fragments = this.components.get(OBC.FragmentsManager);

    if (this.currentPhase === selectedPhase) return;

    this.currentPhase = selectedPhase;

    for (const [_, model] of fragments.list) {
      const idsToShow: number[] = [];

      for (const [phase, localIds] of Object.entries(this.phaseIdMap)) {
        const elementPhase = Number(phase);

        if (elementPhase <= selectedPhase) {
          idsToShow.push(...localIds);
        }
      }

      if (idsToShow.length > 0) {
        // 선택된 페이즈에 객체가 있는 경우
        await model.setVisible(undefined, false);
        await model.setVisible(idsToShow, true);
      } else {
        // 선택된 페이즈까지 보여줄 객체가 아예 없는 경우 모델 전체를 숨김
        await model.setVisible(undefined, false);
      }
      
      await fragments.core.update(true);
    }
  }
}

export * from "./src";

import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { Timeline, PhaseRule } from "../../bim-components/Timeline";
import { appIcons, setupBIMTable, tableButtonStyle } from "../../globals";

export interface PhaseManagerPanelState {
  components: OBC.Components;
}

// 모델에서 추출한 층(Storey)과 카테고리 목록을 저장하는 로컬 캐시
let cachedModels: string[] = [];
let modelNameToId = new Map<string, string>();
let cachedStoreys: string[] = [];
let cachedCategories: string[] = [];
let isOptionsLoaded = false;

// 사용자가 입력한 Phase 매핑 규칙을 유지하기 위한 로컬 캐시
let phaseRules: PhaseRule[] = [];
let isEventsRegistered = false;

const getFormattedDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const phaseManagerPanelTemplate: BUI.StatefullComponent<
  PhaseManagerPanelState
> = (state) => {
  const { components } = state;

  // Timeline 컴포넌트가 등록되지 않았을 경우를 대비한 안전한 지연 초기화(Lazy Init)
  let timeline: Timeline;
  try {
    timeline = components.get(Timeline);
  } catch {
    timeline = new Timeline(components);
  }

  // 모델에서 층과 카테고리 목록을 자동으로 추출하는 함수
  const loadOptions = async () => {
    const fragments = components.get(OBC.FragmentsManager);
    
    try {
      await timeline.extractPhaseData();
    } catch (e) {
      console.warn("Timeline data extraction error:", e);
    }

    cachedModels = [];
    modelNameToId.clear();
    for (const [id, model] of fragments.list) {
      const mName = (model as any).name || `${id}`;
      cachedModels.push(mName);
      modelNameToId.set(mName, id);
    }

    cachedCategories = Array.from(timeline.categoriesMap.keys()).sort();
    cachedStoreys = timeline.getSortedStoreys();
    isOptionsLoaded = true;
  };

  // 특정 모델에 속한 층(Storey)만 필터링
  const getStoreysForModel = (modelName: string) => {
    if (!timeline) return [];
    if (modelName === "All" || !modelName) return cachedStoreys;
    const targetId = modelNameToId.get(modelName);
    if (!targetId) return [];
    return cachedStoreys.filter(s => {
      const sMap = timeline.storeyElementsMap.get(s);
      return sMap && sMap[targetId] && sMap[targetId].size > 0;
    });
  };

  // 특정 모델과 층에 모두 속한 엔티티(Entity)만 교집합으로 필터링
  const getEntitiesForModelAndStorey = (modelName: string, storeyName: string) => {
    if (!timeline) return [];
    const targetIds = (modelName === "All" || !modelName) ? Array.from(modelNameToId.values()) : (modelNameToId.has(modelName) ? [modelNameToId.get(modelName)!] : []);
    const result = new Set<string>();
    for (const catName of cachedCategories) {
      const cMap = timeline.categoriesMap.get(catName);
      if (!cMap) continue;
      let hasMatch = false;
      for (const mId of targetIds) {
        if (!cMap[mId] || cMap[mId].size === 0) continue;
        if (storeyName === "All" || !storeyName) {
          hasMatch = true; break;
        } else {
          const sMap = timeline.storeyElementsMap.get(storeyName);
          if (sMap && sMap[mId]) {
            for (const id of sMap[mId]) if (cMap[mId].has(id)) { hasMatch = true; break; }
          }
        }
        if (hasMatch) break;
      }
      if (hasMatch) result.add(catName);
    }
    return Array.from(result).sort();
  };

  const onClick = async ({ target }: { target: BUI.Button }) => {
    target.loading = true;
    // 기존 IFC 내장 속성 대신 사용자 정의 룰(PhaseRules)을 적용합니다.
    await timeline.applyPhaseRules(phaseRules);
    target.loading = false;
  };

  const phaseRulesTable = document.createElement("bim-table") as BUI.Table<any>;
  phaseRulesTable.headersHidden = false;
  phaseRulesTable.noIndentation = true;
  phaseRulesTable.noCarets = true;
  phaseRulesTable.hiddenColumns = ["RuleRef"];
  
  setupBIMTable(phaseRulesTable);

  // 테이블 셀(Cell)의 좌우 패딩을 대폭 줄여서 컬럼 사이 간격을 좁힙니다.
  phaseRulesTable.addEventListener("cellcreated", (ev: Event) => {
    const { cell } = (ev as CustomEvent).detail;
    cell.style.padding = "0.25rem 0.125rem";
  });

  const missingDataLabel = document.createElement("bim-label");
  missingDataLabel.textContent = "⚠️ No phase rules defined. Click [+] button to start.";
  missingDataLabel.setAttribute("slot", "missing-data");
  phaseRulesTable.append(missingDataLabel);

  const updateTableData = () => {
    phaseRulesTable.columns = [
      { name: "Model", width: "1fr" },
      { name: "Storey", width: "1fr" },
      { name: "Entity", width: "1fr" },
      { name: "Object", width: "1fr" },
      { name: "Start", width: "130px" },
      { name: "Days", width: "60px" },
      { name: "Action", width: "40px" }
    ];
    phaseRulesTable.data = phaseRules.map((rule, index) => ({
      data: {
        Model: rule.modelName || "All",
        Storey: rule.storeyName || "All",
        Entity: rule.entityName || "All",
        Object: rule.objectName || "All",
        Start: rule.startDate,
        Days: rule.duration,
        Action: index,
        RuleRef: rule
      }
    }));
  };

  phaseRulesTable.dataTransform = {
    Model: (_, rowData) => {
      const rule = rowData.RuleRef as PhaseRule;
      return BUI.html`
        <bim-dropdown required vertical
          ${BUI.ref(e => { const dp = e as any; if (dp && dp.elements) dp.elements.clear(); })}
          @change=${(e: Event) => {
            const dropdown = e.target as BUI.Dropdown;
            dropdown.visible = false;
            rule.modelName = dropdown.value[0] as string;
            
            // 모델이 바뀌면 하위 조건 유효성 검사 후 리셋
            const availableStoreys = getStoreysForModel(rule.modelName);
            if (rule.storeyName !== "All" && !availableStoreys.includes(rule.storeyName)) rule.storeyName = "All";
            
            const availableEntities = getEntitiesForModelAndStorey(rule.modelName, rule.storeyName);
            if (rule.entityName !== "All" && !availableEntities.includes(rule.entityName)) rule.entityName = "All";
            
            rule.objectName = "All";
            updateTableData();
          }}
          style="width: 100%; margin: 0; min-width: 0;"
        >
          <bim-option label="All" value="All" ?checked=${rule.modelName === "All" || !rule.modelName}></bim-option>
          ${cachedModels.map(m => BUI.html`<bim-option label=${m} value=${m} ?checked=${rule.modelName === m}></bim-option>`)}
        </bim-dropdown>
      `;
    },
    Storey: (_, rowData) => {
      const rule = rowData.RuleRef as PhaseRule;
      const availableStoreys = getStoreysForModel(rule.modelName || "All");
      return BUI.html`
        <bim-dropdown required vertical
          ${BUI.ref(e => { const dp = e as any; if (dp && dp.elements) dp.elements.clear(); })}
          @change=${(e: Event) => {
            const dropdown = e.target as BUI.Dropdown;
            dropdown.visible = false;
            const newStorey = dropdown.value[0] as string;
            rule.storeyName = newStorey;
            
            // Entity 드롭다운 옵션 갱신 및 유효하지 않은 Entity 리셋
            const availableEntities = getEntitiesForModelAndStorey(rule.modelName || "All", rule.storeyName);
            if (rule.entityName !== "All" && !availableEntities.includes(rule.entityName)) {
              rule.entityName = "All";
            }
            rule.objectName = "All";
            updateTableData();
          }}
          style="width: 100%; margin: 0; min-width: 0;"
        >
          <bim-option label="All" value="All" ?checked=${rule.storeyName === "All" || !rule.storeyName}></bim-option>
          ${availableStoreys.map(s => BUI.html`<bim-option label=${s} value=${s} ?checked=${rule.storeyName === s}></bim-option>`)}
        </bim-dropdown>
      `;
    },
    Entity: (_, rowData) => {
      const rule = rowData.RuleRef as PhaseRule;
      const availableEntities = getEntitiesForModelAndStorey(rule.modelName || "All", rule.storeyName || "All");

      return BUI.html`
        <bim-dropdown required vertical
          ${BUI.ref(e => { const dp = e as any; if (dp && dp.elements) dp.elements.clear(); })}
          @change=${(e: Event) => {
            const dropdown = e.target as BUI.Dropdown;
            dropdown.visible = false;
            rule.entityName = dropdown.value[0] as string;
          }}
          style="width: 100%; margin: 0; min-width: 0;"
        >
          <bim-option label="All" value="All" ?checked=${rule.entityName === "All" || !rule.entityName}></bim-option>
          ${availableEntities.map(c => BUI.html`<bim-option label=${c} value=${c} ?checked=${rule.entityName === c}></bim-option>`)}
        </bim-dropdown>
      `;
    },
    Object: (_, rowData) => {
      const rule = rowData.RuleRef as PhaseRule;

      return BUI.html`
        <bim-text-input 
          value=${rule.objectName || "All"}
          @input=${(e: Event) => { rule.objectName = (e.target as BUI.TextInput).value || "All"; }}
          vertical
          style="margin: 0; padding: 0; width: 100%; min-width: 0;"
        ></bim-text-input>
      `;
    },
    Start: (_, rowData) => {
      const rule = rowData.RuleRef as PhaseRule;
      return BUI.html`
        <bim-text-input 
          type="date"
          value=${rule.startDate || ""}
          @input=${(e: Event) => { rule.startDate = (e.target as BUI.TextInput).value; updateTableData(); }}
          vertical
          style="margin: 0; padding: 0; width: 100%; min-width: 0;"
        ></bim-text-input>
      `;
    },
    Days: (_, rowData) => {
      const rule = rowData.RuleRef as PhaseRule;
      return BUI.html`
        <bim-text-input 
          type="number"
          value=${rule.duration ?? 7}
          @input=${(e: Event) => { 
            const input = e.target as BUI.TextInput;
            rule.duration = input.value === "" ? undefined : Number(input.value); 
          }}
          vertical
          style="margin: 0; padding: 0; width: 100%; min-width: 0; text-align: center;"
        ></bim-text-input>
      `;
    },
    Action: (value) => {
      const index = value as number;
      return BUI.html`
        <div style="display: flex; justify-content: center; align-items: center; width: 100%;">
          <bim-button icon=${appIcons.DELETE} tooltip-title="Remove Rule" @click=${() => {
            phaseRules.splice(index, 1);
            updateTableData();
          }} style=${tableButtonStyle}></bim-button>
        </div>
      `;
    }
  };

  // 패널이 렌더링될 때 모델 옵션이 비어있다면 자동 로드
  if (!isOptionsLoaded) {
    loadOptions().then(() => updateTableData());
  } else {
    updateTableData();
  }

  // 모델이 로드되거나 삭제될 때 자동으로 옵션 갱신
  if (!isEventsRegistered) {
    const fragments = components.get(OBC.FragmentsManager);
    const triggerUpdate = () => {
      setTimeout(async () => {
        if (fragments.list.size === 0) {
          // 남은 모델이 없으면 룰과 차트를 완전히 초기화합니다.
          phaseRules = [];
          timeline.clearPhaseData();
          timeline.phases = [];
          timeline.onPhasesProcessed.trigger(); // 간트 차트 비우기
          cachedModels = [];
          cachedStoreys = [];
          cachedCategories = [];
          updateTableData();
          return;
        }
        timeline.clearPhaseData();
        await loadOptions();
        updateTableData();
      }, 500); // UI 스레드 블로킹 방지 및 안정성 확보를 위한 지연
    };
    fragments.list.onItemSet.add(triggerUpdate);
    fragments.list.onItemDeleted.add(triggerUpdate);
    isEventsRegistered = true;
  }

  // 초안(Draft) 자동 생성 함수
  const onDraft = () => {
    if (!isOptionsLoaded) {
      alert("모델 데이터를 아직 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    if (phaseRules.length > 0 && !confirm("기존 설정된 규칙들이 모두 삭제되고 새 초안이 생성됩니다. 계속하시겠습니까?")) {
      return;
    }

    phaseRules = [];
    let currentDate = new Date();
    let phaseCounter = 1;

    const sortedModels = cachedModels.length > 0 ? [...cachedModels].sort() : ["All"];

    for (const model of sortedModels) {
      const storeys = getStoreysForModel(model);
      const storeysToUse = storeys.length > 0 ? storeys : ["All"];
      
      for (const storey of storeysToUse) {
        const entities = getEntitiesForModelAndStorey(model, storey);
        const entitiesToUse = entities.length > 0 ? entities : ["All"];
        
        for (const entity of entitiesToUse) {
          phaseRules.push({
            modelName: model,
            storeyName: storey,
            entityName: entity,
            objectName: "All",
            phase: phaseCounter,
            startDate: getFormattedDate(currentDate),
            duration: 30 // 기본 시공 일수
          });
          
          // 다음 Phase 시작일을 현재 날짜 + Days(30)로 연쇄 계산
          currentDate.setDate(currentDate.getDate() + 30);
          phaseCounter++;
        }
      }
    }
    updateTableData();
  };

  // Start Date 기준으로 룰을 정렬하는 함수
  const onSort = () => {
    if (phaseRules.length === 0) return;
    
    phaseRules.sort((a, b) => {
      const timeA = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      return timeA - timeB;
    });
    // 정렬 후 시퀀스 번호(Phase) 재할당
    phaseRules.forEach((rule, index) => {
      rule.phase = index + 1;
    });
    updateTableData();
  };

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.GANTT} label="Phase Manager">
      <div style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1; min-height: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
          <bim-label style="font-weight: bold;">Phase Builder</bim-label>
          <div style="display: flex; gap: 0.25rem;">
            <bim-button style="flex: 0;" icon=${appIcons.DRAFT} title="Generate Draft" @click=${onDraft}></bim-button>
            <bim-button style="flex: 0;" icon=${appIcons.ADD} title="Add a Phase Rule" @click=${() => {
              const today = new Date();
              const nextPhase = phaseRules.length > 0 ? phaseRules[phaseRules.length - 1].phase + 1 : 1;
              phaseRules.push({ 
                modelName: "All",
                storeyName: "All", 
                entityName: "All", 
                objectName: "All",
                phase: nextPhase,
                startDate: getFormattedDate(today),
                duration: 7
              });
              updateTableData();
            }}></bim-button>
            <bim-button style="flex: 0;" icon=${appIcons.SORT} title="Sort by Start Date" @click=${onSort}></bim-button>
            <bim-button style="flex: 0;" icon=${appIcons.GANTT} title="Apply Phase Rules" @click=${onClick}></bim-button>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; flex: 1; min-height: 0; overflow-y: auto;">
          ${phaseRulesTable}
        </div>
      </div>
    </bim-panel-section>
  `;
};

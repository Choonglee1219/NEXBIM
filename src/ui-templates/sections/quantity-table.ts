import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../globals";
import { Highlighter } from "../../bim-components/Highlighter";
import { quantityChart } from "../../ui-components/QuantityChart";
import { setupBIMTable, tableDefaultContentTemplate, onTableCellCreated, onTableRowCreated, createPaginationTemplate, PaginationRefs } from "../../globals";

export interface QuantitiesPanelState {
  components: OBC.Components;
}

// 상태 변수 및 이벤트 핸들러를 컴포넌트 외부로 분리 (상태 유지 및 이벤트 중복 방지)
let allData: any[] = [];
const numericKeys = new Set<string>();
const categoricalKeys = ["Category", "PredefinedType", "Name"];
const currentFilters = {
  text: {} as Record<string, string>,
  range: {} as Record<string, { min: number | null; max: number | null }>,
};
let currentItemCount = 0;
let selectedCatKey = categoricalKeys[0];
let selectedNumKey = "";
const selectedSummaryKeys = new Set<string>();

let isEventsRegistered = false;
let activeUpdateFilters: (() => void) | null = null;
let activeUpdateSummary: (() => void) | null = null;
let activeApplyFilters: (() => void) | null = null;
let activeSection: BUI.PanelSection | null = null;

// --- Pagination State ---
let currentPage = 0;
const pageSize = 30;
let totalItems = 0;
let totalPages = 0;
let filteredDataCache: any[] = [];

// 속성값을 재귀적으로 안전하게 추출하는 유틸리티 (메모리 절약을 위해 루프 외부로 분리)
const extractValue = (attr: any): any => {
  if (attr === null || attr === undefined) return null;
  if (Array.isArray(attr)) return attr.length > 0 ? extractValue(attr[0]) : null;
  if (typeof attr === "object" && "value" in attr) {
    if (attr.type === 5) return null; // 참조(Handle ID)는 값으로 취급하지 않음
    return attr.value;
  }
  return attr;
};

const extractSelectionData = async (components: OBC.Components, modelIdMap: OBC.ModelIdMap) => {
  allData = [];
  numericKeys.clear();
  currentFilters.text = {};
  currentFilters.range = {};

  const fragments = components.get(OBC.FragmentsManager);
  const classifier = components.get(OBC.Classifier);

  try {
    await classifier.byCategory({ classificationName: "entities" });
  } catch (e) {
    console.warn("Classifier grouping error:", e);
  }

  const entitiesClass = classifier.list.get("entities");

  // 성능 최적화: 모든 모델을 순회하기 전에, 각 Category의 ModelIdMap을 한 번만 미리 Fetch 해둡니다.
  const preFetchedCategories = new Map<string, OBC.ModelIdMap>();
  if (entitiesClass) {
    for (const [cat, group] of entitiesClass.entries()) {
      preFetchedCategories.set(cat.replace(/^IFC/i, ""), await group.get());
    }
  }

  for (const [modelId, expressIds] of Object.entries(modelIdMap)) {
    const model = fragments.list.get(modelId);
    if (!model) continue;

    // 현재 처리 중인 모델의 ID에 해당하는 Category만 추출하여 매핑 (속도 향상)
    const catMap = new Map<number, string>();
    for (const [catName, map] of preFetchedCategories.entries()) {
      if (map[modelId]) {
        for (const id of map[modelId]) {
          if (expressIds.has(id)) catMap.set(id, catName);
        }
      }
    }

    const idsArray = Array.from(expressIds);
    if (idsArray.length === 0) continue; // 빈 배열 시 전체 데이터를 가져오는 버그 방어

    const itemsData = await model.getItemsData(idsArray, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        IsTypedBy: { attributes: true, relations: false }
      },
    });

    for (let i = 0; i < itemsData.length; i++) {
      const itemAny = itemsData[i] as any;
      // ID 매핑 안정성 복원 및 fallback으로 배열 인덱스 활용
      const expressId = itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId ?? idsArray[i];
      const category = catMap.get(Number(expressId)) || "Unknown";


      const name = extractValue(itemAny.Name) || "Unknown";
      let pType = extractValue(itemAny.PredefinedType);
      if (!pType) {
        for (const t of (itemAny.IsTypedBy || [])) {
          let typeObj = t.RelatingType || t;
          if (typeObj && typeObj.type === 5 && typeObj.value !== undefined) {
            const exp = await model.getItemsData([typeObj.value], { attributesDefault: true });
            typeObj = exp[0] || typeObj;
          }
          if (typeObj.PredefinedType) { pType = extractValue(typeObj.PredefinedType); break; }
        }
      }
      pType = pType || "Unknown";

      const rowData: any = {
        id: `${modelId}-${expressId}`,
        Category: category,
        PredefinedType: pType,
        Name: name,
      };

      // 수량(Quantity) 정보만 파싱하여 추출
      for (let rel of (itemAny.IsDefinedBy || [])) {
        if (rel && rel.type === 5 && rel.value !== undefined) {
          const expRels = await model.getItemsData([rel.value], { attributesDefault: true });
          rel = expRels[0] || rel;
        }
        let pset = rel.RelatingPropertyDefinition || rel;
        if (pset && pset.type === 5 && pset.value !== undefined) {
          const expPsets = await model.getItemsData([pset.value], { attributesDefault: true });
          pset = expPsets[0] || pset;
        }

        const psetName = extractValue(pset.Name);
        if (psetName && (psetName.includes("Quantities") || psetName.startsWith("Qto_"))) {
          let props = pset.Quantities || pset.HasProperties || [];

          // Handle 확장 (Reference ID일 경우 실제 데이터를 한 번 더 Fetch)
          const propIds = [];
          for (const p of props) {
            if (p && typeof p === "object" && p.type === 5 && p.value !== undefined) {
              propIds.push(p.value);
            }
          }
          if (propIds.length > 0) {
            props = await model.getItemsData(propIds, { attributesDefault: true });
          }

          for (const prop of props) {
            const propName = extractValue(prop.Name);
            if (propName) {
              const val = extractValue(
                prop.LengthValue ??
                prop.AreaValue ??
                prop.VolumeValue ??
                prop.WeightValue ??
                prop.CountValue ??
                prop.TimeValue ??
                prop.NominalValue
              );

              const numVal = Number(val);
              if (!isNaN(numVal) && val !== null && val !== "") {
                // 문자열 .toFixed() 변환 대신 수학적 반올림으로 성능 최적화
                rowData[propName] = Math.round(numVal * 100) / 100;
                numericKeys.add(propName);
              }
            }
          }
        }
      }
      allData.push(rowData);
    }
  }

  // 모든 행의 컬럼이 일치하도록 (테이블 오류 방지) 없는 컬럼에는 "-" 부여
  const numKeysArray = Array.from(numericKeys);
  for (let i = 0; i < allData.length; i++) {
    const row = allData[i];
    for (const key of numKeysArray) {
      if (row[key] === undefined) row[key] = "-";
    }
  }
};

export const quantitiesPanelTemplate: BUI.StatefullComponent<QuantitiesPanelState> = (state) => {
  const { components } = state;
  const highlighter = components.get(Highlighter);

  const quantityTable = document.createElement("bim-table") as BUI.Table<any>;
  quantityTable.hiddenColumns = ["id"];
  quantityTable.headersHidden = false;
  quantityTable.noIndentation = true;
  quantityTable.noCarets = true;

  // 공통 테이블 템플릿 및 셀 스타일 적용
  quantityTable.defaultContentTemplate = tableDefaultContentTemplate;
  quantityTable.addEventListener("cellcreated", onTableCellCreated);

  // Quantity Table만의 개별 이벤트 (행 클릭 시 이동)
  quantityTable.addEventListener("rowcreated", (e: Event) => {
    onTableRowCreated(e); // 공통 행 스타일 적용 (stopImmediatePropagation 포함)
    const customEvent = e as CustomEvent<BUI.RowCreatedEventDetail<any>>;
    const { row } = customEvent.detail;
    row.style.cursor = "pointer";

    row.onclick = async () => {
      const rowId = row.data.id;
      if (!rowId || typeof rowId !== "string") return;

      const lastDashIndex = rowId.lastIndexOf("-");
      if (lastDashIndex === -1) return;

      const modelId = rowId.substring(0, lastDashIndex);
      const localId = parseInt(rowId.substring(lastDashIndex + 1), 10);

      if (!modelId || isNaN(localId)) return;

      const worlds = components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;

      if (world && world.camera && "fitToItems" in world.camera) {
        const modelIdMap = { [modelId]: new Set([localId]) };
        await (world.camera as any).fitToItems(modelIdMap);
      }
    };
  });

  const summaryTable = document.createElement("bim-table") as BUI.Table<any>;
  summaryTable.headersHidden = false;
  setupBIMTable(summaryTable);

  // --- Pagination UI Refs ---
  const paginationRefs: PaginationRefs = {};

  const updatePage = () => {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const slicedData = filteredDataCache.slice(start, end);

    quantityTable.data = slicedData.map(d => ({ data: d }));

    if (paginationRefs.container) {
      paginationRefs.container.style.display = totalPages > 1 ? "flex" : "none";
    }
    if (paginationRefs.label) {
      paginationRefs.label.textContent = `${currentPage + 1} / ${totalPages}`;
    }
    if (paginationRefs.prev) {
      paginationRefs.prev.disabled = currentPage === 0;
    }
    if (paginationRefs.next) {
      paginationRefs.next.disabled = currentPage >= totalPages - 1;
    }
  };

  const onPrevPage = () => {
    if (currentPage > 0) {
      currentPage--;
      updatePage();
    }
  };

  const onNextPage = () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      updatePage();
    }
  };

  // 히스토그램(막대) 차트 컴포넌트 초기화
  const [chartPanel, updateChartPanel] = quantityChart({
    components,
    data: [],
    categoryKey: selectedCatKey,
    numericKey: selectedNumKey,
    onBarClick: (numericKey: string, min: number, max: number) => {
      selectedNumKey = numericKey;

      if (!currentFilters.range[selectedNumKey]) {
        currentFilters.range[selectedNumKey] = { min: null, max: null };
      }
      currentFilters.range[selectedNumKey].min = Number(min.toFixed(2));
      currentFilters.range[selectedNumKey].max = Number(max.toFixed(2));

      currentPage = 0;
      if (activeUpdateFilters) activeUpdateFilters();
      if (activeApplyFilters) activeApplyFilters();
    },
    onQuantityTypeChange: (numericKey: string) => {
      selectedNumKey = numericKey;
      currentPage = 0;
      if (activeUpdateFilters) activeUpdateFilters();
      if (activeApplyFilters) activeApplyFilters();
    }
  });
  chartPanel.style.width = "100%";
  chartPanel.style.boxSizing = "border-box";

  const onToggleSection = (e: Event) => {
    const header = e.currentTarget as HTMLElement;
    const wrapper = header.parentElement as HTMLElement;
    const content = header.nextElementSibling as HTMLElement;
    const icon = header.querySelector(".toggle-icon") as any;

    if (content.style.display === "none") {
      content.style.display = "flex";
      icon.icon = appIcons.MINOR;
      if (wrapper.dataset.flex === "true") wrapper.style.flex = "1";
    } else {
      content.style.display = "none";
      icon.icon = appIcons.RIGHT;
      if (wrapper.dataset.flex === "true") wrapper.style.flex = "none";
    }
  };

  const applyFilters = () => {
    // 성능 최적화: 루프 바깥에서 활성화된 필터 조건들을 미리 배열로 정리 (매 Row마다 불필요한 연산 방지)
    const activeTextFilters: { key: string; val: string }[] = [];
    for (const key of categoricalKeys) {
      const filterVal = currentFilters.text[key]?.trim().toLowerCase();
      if (filterVal) activeTextFilters.push({ key, val: filterVal });
    }

    const activeRangeFilters: { key: string; min: number | null; max: number | null }[] = [];
    for (const key of numericKeys) {
      const min = currentFilters.range[key]?.min;
      const max = currentFilters.range[key]?.max;
      if ((min !== undefined && min !== null) || (max !== undefined && max !== null)) {
        activeRangeFilters.push({ key, min: min ?? null, max: max ?? null });
      }
    }

    const filtered = allData.filter(row => {
      for (let i = 0; i < activeTextFilters.length; i++) {
        const { key, val } = activeTextFilters[i];
        if (!row[key] || !String(row[key]).toLowerCase().includes(val)) return false;
      }
      for (let i = 0; i < activeRangeFilters.length; i++) {
        const { key, min, max } = activeRangeFilters[i];
        const val = row[key];
        if (typeof val !== "number") return false; // 범위 필터가 있는데 값이 숫자("-")가 아니면 무조건 탈락
        if (min !== null && val < min) return false;
        if (max !== null && val > max) return false;
      }
      return true;
    });

    filteredDataCache = filtered;
    totalItems = filteredDataCache.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

    // 라이브러리의 자동 컬럼 생성(캐싱) 로직을 우회하고, 
    // 원본 데이터(allData)의 구조에 맞춰 매번 컬럼을 강제로 명시해 줍니다.
    if (allData.length > 0) {
      (quantityTable as any).columns = Object.keys(allData[0]).map(k => ({
        name: k,
        width: k === "Name" ? "minmax(200px, 2fr)" : (categoricalKeys.includes(k) ? "minmax(120px, 1fr)" : "minmax(100px, 1fr)")
      }));
    } else {
      (quantityTable as any).columns = [];
    }

    updatePage();

    // 요약 데이터 업데이트 (총합계, 평균, 최대, 최소)
    const summaryData = [];
    for (const key of numericKeys) {
      if (!selectedSummaryKeys.has(key)) continue;
      const values = filtered.map(r => r[key]).filter(v => typeof v === "number") as number[];
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);
        const round2 = (num: number) => Math.round(num * 100) / 100;
        summaryData.push({
          data: {
            Quantity: key,
            Sum: round2(sum),
            Mean: round2(mean),
            Max: round2(max),
            Min: round2(min),
          }
        });
      }
    }
    summaryTable.data = summaryData;

    if (summaryData.length > 0) {
      (summaryTable as any).columns = Object.keys(summaryData[0].data).map(k => ({
        name: k,
        width: k === "Quantity" ? "minmax(150px, 2fr)" : "minmax(100px, 1fr)"
      }));
    } else {
      (summaryTable as any).columns = [];
    }

    // 차트 업데이트 (동기화)
    updateChartPanel({
      data: filtered,
      categoryKey: selectedCatKey,
      numericKey: selectedNumKey
    });
  };

  activeApplyFilters = applyFilters; // 클로저 업데이트

  const [summaryDropdownContainer, updateSummaryDropdown] = BUI.Component.create<HTMLElement, { updateKey: number }>((_state) => {
    const numKeysArr = Array.from(numericKeys);
    return BUI.html`
      <bim-dropdown multiple 
        ${BUI.ref(e => {
      const dropdown = e as BUI.Dropdown;
      if (!dropdown) return;

      // 내부 옵션 캐시 및 DOM 완전 초기화
      if ((dropdown as any).elements) (dropdown as any).elements.clear();
      dropdown.replaceChildren();

      if (numKeysArr.length === 0) {
        const opt = document.createElement("bim-option") as BUI.Option;
        opt.label = "No Data";
        opt.value = "";
        opt.checked = true;
        dropdown.append(opt);
      } else {
        numKeysArr.forEach(key => {
          const opt = document.createElement("bim-option") as BUI.Option;
          opt.label = key;
          opt.value = key;
          opt.checked = selectedSummaryKeys.has(key);
          dropdown.append(opt);
        });
      }
    })}
        @change=${(e: Event) => {
        const target = e.target as BUI.Dropdown;
        selectedSummaryKeys.clear();
        if (Array.isArray(target.value)) {
          target.value.forEach((v: any) => {
            if (typeof v === "string" && v !== "") selectedSummaryKeys.add(v);
          });
        }
        if (activeApplyFilters) activeApplyFilters();
      }}>
      </bim-dropdown>
    `;
  }, { updateKey: 0 });

  activeUpdateSummary = () => updateSummaryDropdown({ updateKey: Math.random() });

  const [filtersContainer, updateFilters] = BUI.Component.create<HTMLElement, { updateKey: number }>((_state) => {
    const numKeysArr = Array.from(numericKeys);
    if (!numKeysArr.includes(selectedNumKey) && numKeysArr.length > 0) {
      selectedNumKey = numKeysArr[0];
    } else if (numKeysArr.length === 0) {
      selectedNumKey = ""; // 명확한 초기화를 통해 Multiple 오작동 방지
    }

    return BUI.html`
      <div data-flex="false" style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; flex-shrink: 0; overflow: hidden;">
        <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
          <bim-label style="font-weight: bold; pointer-events: none;">Data Filters</bim-label>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <bim-button @click=${(e: Event) => {
        e.stopPropagation();
        currentFilters.text = {};
        currentFilters.range = {};
        currentPage = 0;
        applyFilters();
        if (activeUpdateFilters) activeUpdateFilters();
      }} icon=${appIcons.CLEAR} tooltip-title="Clear All Filters" style="flex: 0; margin: 0; padding: 0.25rem;"></bim-button>
            <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
          </div>
        </div>
        <div style="display: flex; gap: 1rem;">
          <div style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
            <bim-label style="font-size: 0.8rem; color: var(--bim-ui_gray-10);">Categorical Filters</bim-label>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <bim-dropdown style="flex: 1;" required
              @change=${(e: Event) => {
        const dropdown = e.target as BUI.Dropdown;
        dropdown.visible = false;
        const val = dropdown.value[0];
        if (typeof val === "string") selectedCatKey = val;
        currentPage = 0;
        if (activeUpdateFilters) activeUpdateFilters();
      }}>
              ${categoricalKeys.map(key => BUI.html`<bim-option label=${key} value=${key} ?checked=${selectedCatKey === key}></bim-option>`)}
            </bim-dropdown>
            <bim-text-input 
              style="flex: 1;"
              placeholder="Filter value..." 
              .value=${currentFilters.text[selectedCatKey] || ""}
              debounce="200"
              @input=${(e: Event) => {
        currentFilters.text[selectedCatKey] = (e.target as BUI.TextInput).value;
        currentPage = 0;
        applyFilters();
      }}
            ></bim-text-input>
          </div>
        </div>

          <div style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
            <bim-label style="font-size: 0.8rem; color: var(--bim-ui_gray-10);">Numeric Filters</bim-label>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <bim-dropdown style="flex: 1;" required 
              ${BUI.ref(e => {
        const dropdown = e as BUI.Dropdown;
        if (!dropdown) return;

        // 내부 옵션 캐시 및 DOM 완전 초기화
        if ((dropdown as any).elements) (dropdown as any).elements.clear();
        dropdown.replaceChildren();

        if (numKeysArr.length === 0) {
          const opt = document.createElement("bim-option") as BUI.Option;
          opt.label = "No Data";
          opt.value = "";
          opt.checked = true;
          dropdown.append(opt);
        } else {
          numKeysArr.forEach(key => {
            const opt = document.createElement("bim-option") as BUI.Option;
            opt.label = key;
            opt.value = key;
            opt.checked = selectedNumKey === key;
            dropdown.append(opt);
          });
        }
      })}
              @change=${(e: Event) => {
        const dropdown = e.target as BUI.Dropdown;
        dropdown.visible = false;
        const val = dropdown.value[0];
        if (typeof val === "string" && val !== "") selectedNumKey = val;
        else selectedNumKey = "";
        currentPage = 0;
        if (activeUpdateFilters) activeUpdateFilters();
        if (activeApplyFilters) activeApplyFilters();
      }}>
            </bim-dropdown>
            <div style="flex: 1; display: flex; align-items: center; gap: 0.25rem;">
              <bim-text-input 
                type="number" 
                placeholder="Min" 
                .value=${selectedNumKey ? (currentFilters.range[selectedNumKey]?.min ?? "") : ""}
                debounce="200"
                style="flex: 1;"
                ?disabled=${numKeysArr.length === 0}
                @input=${(e: Event) => {
        if (!selectedNumKey) return;
        const val = (e.target as BUI.TextInput).value;
        if (!currentFilters.range[selectedNumKey]) currentFilters.range[selectedNumKey] = { min: null, max: null };
        currentFilters.range[selectedNumKey].min = val !== "" ? Number(val) : null;
        currentPage = 0;
        applyFilters();
      }}
              ></bim-text-input>
              <bim-label>-</bim-label>
              <bim-text-input 
                type="number" 
                placeholder="Max" 
                .value=${selectedNumKey ? (currentFilters.range[selectedNumKey]?.max ?? "") : ""}
                debounce="200"
                style="flex: 1;"
                ?disabled=${numKeysArr.length === 0}
                @input=${(e: Event) => {
        if (!selectedNumKey) return;
        const val = (e.target as BUI.TextInput).value;
        if (!currentFilters.range[selectedNumKey]) currentFilters.range[selectedNumKey] = { min: null, max: null };
        currentFilters.range[selectedNumKey].max = val !== "" ? Number(val) : null;
        currentPage = 0;
        applyFilters();
      }}
              ></bim-text-input>
            </div>
          </div>
        </div>
        </div>
      </div>
    `;
  }, { updateKey: 0 }); // 상태 객체 전달로 Stateful 컴포넌트화

  activeUpdateFilters = () => updateFilters({ updateKey: Math.random() }); // 항상 리렌더링 유도

  if (!isEventsRegistered && highlighter.events.select) {
    isEventsRegistered = true;
    highlighter.events.select.onHighlight.add(async (modelIdMap) => {
      if (activeSection) activeSection.label = "Quantity Table (Loading...)";

      // 이전 선택 객체의 컬럼 찌꺼기가 남는 버그 방지를 위해 테이블 캐시 강제 초기화
      quantityTable.data = [];
      (quantityTable as any).columns = [];
      summaryTable.data = [];
      (summaryTable as any).columns = [];

      await extractSelectionData(components, modelIdMap);

      selectedSummaryKeys.clear();
      currentPage = 0;

      currentItemCount = 0;
      for (const ids of Object.values(modelIdMap)) currentItemCount += ids.size;

      if (activeUpdateFilters) activeUpdateFilters();
      if (activeUpdateSummary) activeUpdateSummary();
      if (activeApplyFilters) activeApplyFilters();

      if (activeSection) activeSection.label = `Quantity Table (${currentItemCount})`;
    });

    highlighter.events.select.onClear.add(async () => {
      const currentSelection = highlighter.selection.select;
      const hasSelection = !OBC.ModelIdMapUtils.isEmpty(currentSelection);

      if (hasSelection) {
        if (activeSection) activeSection.label = "Quantity Table (Loading...)";

        quantityTable.data = [];
        (quantityTable as any).columns = [];
        summaryTable.data = [];
        (summaryTable as any).columns = [];

        await extractSelectionData(components, currentSelection);

        selectedSummaryKeys.clear();
        currentPage = 0;

        currentItemCount = 0;
        for (const ids of Object.values(currentSelection)) currentItemCount += ids.size;

        if (activeUpdateFilters) activeUpdateFilters();
        if (activeUpdateSummary) activeUpdateSummary();
        if (activeApplyFilters) activeApplyFilters();

        if (activeSection) activeSection.label = `Quantity Table (${currentItemCount})`;
        return;
      }

      // 테이블 캐시 강제 초기화
      quantityTable.data = [];
      (quantityTable as any).columns = [];
      summaryTable.data = [];
      (summaryTable as any).columns = [];

      allData = [];
      numericKeys.clear();
      currentFilters.text = {};
      currentFilters.range = {};
      filteredDataCache = [];
      currentPage = 0;
      totalItems = 0;
      totalPages = 0;
      currentItemCount = 0;
      selectedNumKey = "";
      selectedSummaryKeys.clear();

      if (activeUpdateFilters) activeUpdateFilters();
      if (activeUpdateSummary) activeUpdateSummary();
      if (activeApplyFilters) activeApplyFilters();

      if (activeSection) activeSection.label = "Quantity Table (0)";
    });
  }

  // 레이아웃 이동/복귀 시 렌더링을 위해 필터를 한 번 실행하여 테이블 데이터 주입
  setTimeout(() => applyFilters(), 0);

  return BUI.html`
    <bim-panel-section ${BUI.ref((e) => {
    if (!e) return;
    activeSection = e as BUI.PanelSection;

    // 1. 패널 최초 렌더링 시점에 이미 선택된 객체가 있다면 데이터 강제 추출 (초기 빈 화면 방지)
    const currentSelection = highlighter.selection.select;
    if (allData.length === 0 && !OBC.ModelIdMapUtils.isEmpty(currentSelection)) {
      activeSection.label = "Quantity Table (Loading...)";
      extractSelectionData(components, currentSelection).then(() => {
        currentItemCount = 0;
        for (const ids of Object.values(currentSelection)) currentItemCount += ids.size;
        if (activeUpdateFilters) activeUpdateFilters();
        if (activeUpdateSummary) activeUpdateSummary();
        if (activeApplyFilters) activeApplyFilters();
        if (activeSection) activeSection.label = `Quantity Table (${currentItemCount})`;
      });
    }

    // 2. Quantities 레이아웃으로 진입하여 화면에 나타날 때 UI 렌더링 강제 새로고침
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setTimeout(() => {
          if (activeApplyFilters) activeApplyFilters();
        }, 50);
      }
    });
    observer.observe(e);

  })} fixed icon=${appIcons.TASK} label=${`Quantity Table (${currentItemCount})`}>
      <div style="display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 0.5rem;">
        ${filtersContainer}
        <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; flex-shrink: 0; max-height: 15rem; overflow-y: auto;">
          <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 1rem; flex: 1;">
              <bim-label style="font-weight: bold; pointer-events: none; white-space: nowrap;">Quantity Summary</bim-label>
              <div @click=${(e: Event) => e.stopPropagation()} style="flex: 1; max-width: 300px;">
                ${summaryDropdownContainer}
              </div>
            </div>
            <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto;">
            ${summaryTable}
          </div>
        </div>

        <div data-flex="true" style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; flex: 1; min-height: 0; overflow: hidden;">
          <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; flex-shrink: 0;">
            <bim-label style="font-weight: bold; pointer-events: none;">Quantity Data</bim-label>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <bim-button 
                @click=${(e: Event) => {
      e.stopPropagation();
      quantityTable.downloadData("Quantity_Data", "csv");
    }} 
                icon=${appIcons.EXPORT} 
                tooltip-title="Export to CSV" 
                style="flex: 0; margin: 0; padding: 0.25rem;"
              ></bim-button>
              ${createPaginationTemplate(onPrevPage, onNextPage, paginationRefs)}
              <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; flex: 1; min-height: 0;">
            ${quantityTable}
          </div>
        </div>

        <div data-flex="false" style="display: flex; flex-direction: column; flex-shrink: 0; min-width: 0; max-width: 100%; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; overflow: hidden;">
          <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 0.5rem; background-color: var(--bim-ui_bg-contrast-10);">
            <bim-label style="font-weight: bold; pointer-events: none;">Quantity Chart</bim-label>
            <bim-label class="toggle-icon" icon=${appIcons.RIGHT} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
          </div>
          <div style="display: none; flex-direction: column; width: 100%; min-width: 0; box-sizing: border-box; height: 300px;">
            ${chartPanel}
          </div>
        </div>

      </div>
    </bim-panel-section>
  `;
};

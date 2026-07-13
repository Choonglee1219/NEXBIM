import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { ClashService, ClashResult, clashMatrix } from "../../bim-components/ClashService";
import { Highlighter } from "../../bim-components/Highlighter";
import { tableButtonStyle, appIcons, createPaginationTemplate, PaginationRefs, tableDefaultContentTemplate, onTableCellCreated, onTableRowCreated } from "../../globals";
import { restoreModelMaterials } from "../toolbars/viewer-toolbar";

export interface ClashListPanelState {
  components: OBC.Components;
}

// 상태 유지를 위한 모듈 레벨 캐시 변수
let cachedClashData: any[] | null = null;
let cachedFlatData: any[] = [];
let rawValidResults: ClashResult[] | null = null;
let itemNamesCache = new Map<string, string>();
let itemGuidsCache = new Map<string, string>();
let modelNamesCache = new Map<string, string>();
let cachedAllCategories: string[] = [];
let cachedClashMode = "Hard";
let cachedClashValue = "0.05";
let cachedGroupDistance = "0.5";
let currentPage = 0;
let filteredClashData: any[] = [];
let searchQuery = "";
let isMarkersVisible = false;
let isClashClearRegistered = false;
let badgeFilter = "All";
let badgeFilterDropdown: BUI.Dropdown;
let matrixCellFilterSet: Set<any> | null = null;
let cachedExcludeSelfCheck = false;

export const clashUIState = {
  get rawValidResults() { return rawValidResults; },
  set rawValidResults(val) { rawValidResults = val; },
  get cachedFlatData() { return cachedFlatData; },
  set searchQuery(val: string) {
    searchQuery = val;
    currentPage = 0;
    if (clashUIState.applyFilters) clashUIState.applyFilters();
  },
  get searchQuery() { return searchQuery; },
  runClash: null as ((e?: Event) => Promise<void>) | null,
  applyFilters: null as (() => void) | null,
};

export const clashListPanelTemplate: BUI.StatefullComponent<ClashListPanelState> = (state) => {
  const { components } = state;
  const clashService = components.get(ClashService);
  const fragmentsManager = components.get(OBC.FragmentsManager);
  const highlighter = components.get(Highlighter);
  const classifier = components.get(OBC.Classifier);

  clashUIState.applyFilters = () => applyFilters();
  clashUIState.runClash = (e?: Event) => runClash(e);


  const clashTable = document.createElement("bim-table") as BUI.Table<any>;
  clashTable.headersHidden = false;
  clashTable.preserveStructureOnFilter = true;

  clashTable.defaultContentTemplate = tableDefaultContentTemplate;
  clashTable.addEventListener("cellcreated", onTableCellCreated);

  clashTable.addEventListener("rowcreated", (e: Event) => {
    onTableRowCreated(e);
    const customEvent = e as CustomEvent<BUI.RowCreatedEventDetail<any>>;
    const { row } = customEvent.detail;
    row.style.cursor = "pointer";

    row.onclick = () => {
      // 1. 단일 선택 강제 처리 (기존 다중 선택 방지)
      const wasSelected = clashTable.selection.has(row.data);
      clashTable.selection.clear();

      // 시각적으로 모든 체크박스 해제 (DOM 직접 제어)
      const allRows = [
        ...Array.from(clashTable.querySelectorAll("bim-table-row")),
        ...Array.from(clashTable.shadowRoot?.querySelectorAll("bim-table-row") || [])
      ];
      allRows.forEach((r: Element) => {
        const cb = r.querySelector("bim-checkbox") || r.shadowRoot?.querySelector("bim-checkbox");
        if (cb) (cb as any).checked = false;
      });

      if (!wasSelected) {
        clashTable.selection.add(row.data);
      }

      if (typeof clashTable.requestUpdate === "function") clashTable.requestUpdate();
      const checkbox = row.querySelector("bim-checkbox") || row.shadowRoot?.querySelector("bim-checkbox");
      if (checkbox) (checkbox as any).checked = clashTable.selection.has(row.data);
      clashTable.dispatchEvent(new Event("change"));

      // 2. 간섭 카메라 이동 (기존 Go to Clash 동작)
      if (row.data.isGroup) {
        const posStr = row.data.Position as string;
        const coords = posStr.split(",").map(Number);
        const resList = row.data.rawGroup as ClashResult[];
        clashService.moveToClashGroup(new THREE.Vector3(coords[0], coords[1], coords[2]), resList);
      } else {
        const res = row.data.raw as ClashResult;
        clashService.moveToClash(res);
      }
    };
  });

  let clashSection: BUI.PanelSection;

  let clashValueInput: BUI.TextInput;
  let clashValueLabel: BUI.Label;
  let groupDistInput: BUI.TextInput;
  let deleteBtn: BUI.Button;
  let markerBtn: any;
  let searchInput: BUI.TextInput;

  // --- Pagination State & Logic ---
  const pageSize = 30;
  let totalItems = 0;
  let totalPages = 0;

  const paginationRefs: PaginationRefs = {};

  let updateMatrixFn: any;

  const updateClashCountLabel = () => {
    if (!clashSection) return;
    let newCount = 0;
    let holdCount = 0;
    let excludeCount = 0;

    // 화면의 행(Row) 기준이 아닌 실제 모든 간섭 아이템(Flat Data) 기준으로 집계
    for (const row of cachedFlatData) {
      const badge = (row.data.raw as any).badge || row.data.Badge || "New";
      if (badge === "Hold") holdCount++;
      else if (badge === "Exclude") excludeCount++;
      else newCount++;
    }

    clashSection.label = `Clash List ( Total(${cachedFlatData.length}) = New(${newCount}) + Hold(${holdCount}) + Exclude(${excludeCount}) )`;
  };

  const updateMarkers = () => {
    if (isMarkersVisible) {
      const markerData = cachedFlatData.map(row => {
        const badge = (row.data.raw as any).badge || row.data.Badge || "New";
        let colorStr = "hsl(0, 65%, 40%)"; // New
        if (badge === "Hold") colorStr = "hsl(45, 65%, 40%)";
        else if (badge === "Exclude") colorStr = "hsl(205, 65%, 40%)";

        return {
          position: row.data.raw.position,
          color: new THREE.Color(colorStr)
        };
      });
      clashService.drawClashMarkers(markerData);
    } else {
      clashService.clearClashMarkers();
    }
  };

  const getFlatDataFromTree = (nodes: any[]): any[] => {
    let result: any[] = [];
    for (const n of nodes) {
      if (n.children) {
        result.push(...getFlatDataFromTree(n.children));
      } else {
        result.push(n);
      }
    }
    return result;
  };

  const applyFilters = () => {
    let matrixClashData: any[] = [];

    if (!rawValidResults) {
      filteredClashData = [];
      cachedFlatData = [];
      cachedClashData = null;
    } else {
      // 1. 제외 필터(activeExclusions) 제거하고 모든 유효한 결과를 리스트에 반영
      const effectiveResults = rawValidResults;

      // 2. 동적 그룹화 (거리 기반 계산)
      const parsedDist = parseFloat(cachedGroupDistance);
      const GROUP_DISTANCE = isNaN(parsedDist) ? 0.5 : parsedDist;

      const groups: { center: THREE.Vector3, items: ClashResult[] }[] = [];
      for (const res of effectiveResults) {
        let foundGroup = false;
        for (const group of groups) {
          if (res.position.distanceTo(group.center) <= GROUP_DISTANCE) {
            group.items.push(res);
            foundGroup = true;
            break;
          }
        }
        if (!foundGroup) {
          groups.push({ center: res.position, items: [res] });
        }
      }

      // 3. 트리 데이터 생성
      let treeData: any[] = [];
      matrixClashData = [];
      let groupCounter = 1;

      for (const group of groups) {
        const items = group.items;
        if (items.length === 0) continue;

        const groupRows = items.map((res, i) => {
          const cat1 = (res.id1 as any).category;
          const cat2 = (res.id2 as any).category;
          const name1 = itemNamesCache.get(`${res.id1.modelId}-${res.id1.expressID}`) || "Unknown";
          const name2 = itemNamesCache.get(`${res.id2.modelId}-${res.id2.expressID}`) || "Unknown";
          return {
            id: `clash-${groupCounter}-${i}`,
            Badge: (res as any).badge || "New",
            Model1: modelNamesCache.get(res.id1.modelId),
            Entity1: cat1,
            Object1: name1,
            Model2: modelNamesCache.get(res.id2.modelId),
            Entity2: cat2,
            Object2: name2,
            Position: `${res.position.x.toFixed(2)}, ${res.position.y.toFixed(2)}, ${res.position.z.toFixed(2)}`,
            Action: "",
            raw: res
          };
        });

        matrixClashData.push(...groupRows.map(data => ({ data })));

        if (items.length > 1) {
          const model1Set = new Set<string>();
          const model2Set = new Set<string>();
          const entities = new Set<string>();
          const uniqueObjects = new Set<string>();
          items.forEach(item => {
            model1Set.add(item.id1.modelId);
            model2Set.add(item.id2.modelId);
            entities.add((item.id1 as any).category);
            entities.add((item.id2 as any).category);
            uniqueObjects.add(`${item.id1.modelId}-${item.id1.expressID}`);
            uniqueObjects.add(`${item.id2.modelId}-${item.id2.expressID}`);
          });
          const entityStr = Array.from(entities).join(", ");

          const model1Name = model1Set.size === 1 ? (modelNamesCache.get(Array.from(model1Set)[0]) || "Unknown") : "Multi";
          const model2Name = model2Set.size === 1 ? (modelNamesCache.get(Array.from(model2Set)[0]) || "Unknown") : "Multi";

          const pos = group.center;

          let groupBadge = "New";
          if (items.length > 0) {
            const hasNew = items.some(item => ((item as any).badge || "New") === "New");
            if (hasNew) {
              groupBadge = "New";
            } else {
              const hasHold = items.some(item => (item as any).badge === "Hold");
              groupBadge = hasHold ? "Hold" : "Exclude";
            }
          }
          (items as any).badge = groupBadge;

          const groupRowData = {
            id: `group-${groupCounter}`,
            isGroup: true,
            Badge: groupBadge,
            Model1: model1Name,
            Entity1: entityStr,
            Object1: `${uniqueObjects.size} objects, ${items.length} clashes`,
            Model2: model2Name,
            Entity2: entityStr,
            Object2: `${uniqueObjects.size} objects, ${items.length} clashes`,
            Position: `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`,
            Action: "",
            rawGroup: items
          };
          treeData.push({
            data: groupRowData,
            children: groupRows.map(data => ({ data }))
          });
        } else {
          treeData.push({ data: groupRows[0] });
        }
        groupCounter++;
      }

      cachedClashData = treeData;

      // 4. 검색 필터 적용 (트리 구조 유지)
      if (searchQuery || badgeFilter !== "All" || matrixCellFilterSet) {
        const lowerQ = searchQuery.toLowerCase();
        const filterTree = (nodes: any[]): any[] => {
          return nodes.map(node => {
            const d = node.data;

            let matchSearch = true;
            if (searchQuery) {
              if (d.isGroup) {
                matchSearch = String(d.Entity1 || "").toLowerCase().includes(lowerQ);
              } else {
                matchSearch = (
                  String(d.Model1 || "").toLowerCase().includes(lowerQ) ||
                  String(d.Model2 || "").toLowerCase().includes(lowerQ) ||
                  String(d.Entity1 || "").toLowerCase().includes(lowerQ) ||
                  String(d.Entity2 || "").toLowerCase().includes(lowerQ) ||
                  String(d.Object1 || "").toLowerCase().includes(lowerQ) ||
                  String(d.Object2 || "").toLowerCase().includes(lowerQ)
                );
              }
            }

            let matchBadge = true;
            if (badgeFilter !== "All") {
              matchBadge = d.Badge === badgeFilter;
            }

            let matchMatrix = true;
            if (matrixCellFilterSet) {
              if (d.isGroup) {
                matchMatrix = d.rawGroup.some((r: any) => matrixCellFilterSet!.has(r));
              } else {
                matchMatrix = matrixCellFilterSet.has(d.raw);
              }
            }

            const match = matchSearch && matchBadge && matchMatrix;

            if (node.children) {
              const filteredChildren = filterTree(node.children);
              // 그룹 노드라면 반드시 조건에 맞는 유효한 자식이 하나 이상 있을 때만 표시
              if (filteredChildren.length > 0) {
                return { ...node, children: filteredChildren };
              }
              return null;
            }
            return match ? node : null;
          }).filter(n => n !== null);
        };

        filteredClashData = filterTree(cachedClashData);
      } else {
        filteredClashData = [...cachedClashData];
      }

      cachedFlatData = getFlatDataFromTree(filteredClashData);
    }

    totalItems = filteredClashData.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

    updatePage();

    if (updateMatrixFn) {
      updateMatrixFn({ components, clashData: matrixClashData, allCategories: cachedAllCategories });
    }
    updateMarkers();
  };

  const updatePage = () => {
    const start = currentPage * pageSize;
    const end = start + pageSize;

    // 항상 데이터가 비워질 때를 대비하여 컬럼과 숨김 컬럼을 명시적으로 재설정합니다.
    if (filteredClashData.length === 0) {
      clashTable.data = [];
      // 컬럼 정의도 비워주어 테이블이 이전 구조를 기억하지 않도록 합니다.
      clashTable.columns = [];
    } else {
      clashTable.columns = [
        { name: "Badge", width: "100px" },
        { name: "Model1", width: "1.5fr" },
        { name: "Entity1", width: "1.5fr" },
        { name: "Object1", width: "2fr" },
        { name: "Model2", width: "1.5fr" },
        { name: "Entity2", width: "1.5fr" },
        { name: "Object2", width: "2fr" },
        { name: "Position", width: "2fr" },
        { name: "Action", width: "110px" },
      ];
      clashTable.hiddenColumns = ["id", "raw", "rawGroup", "isGroup"];
      clashTable.data = filteredClashData.slice(start, end);
    }

    updateClashCountLabel();

    if (paginationRefs.container) paginationRefs.container.style.display = totalPages > 1 ? "flex" : "none";
    if (paginationRefs.label) paginationRefs.label.textContent = `${currentPage + 1} / ${totalPages}`;
    if (paginationRefs.prev) paginationRefs.prev.disabled = currentPage === 0;
    if (paginationRefs.next) paginationRefs.next.disabled = currentPage >= totalPages - 1;

    if (deleteBtn) deleteBtn.disabled = clashTable.selection.size === 0;
  };

  const onPrevPage = () => {
    if (currentPage > 0) { currentPage--; updatePage(); }
  };

  const onNextPage = () => {
    if (currentPage < totalPages - 1) { currentPage++; updatePage(); }
  };

  clashTable.addEventListener("change", () => {
    if (deleteBtn) deleteBtn.disabled = clashTable.selection.size === 0;
  });

  clashTable.dataTransform = {
    Badge: (value, row) => {
      const currentBadge = (value as string) || "New";
      const colors: Record<string, string> = {
        "Exclude": "hsl(205, 65%, 40%)",
        "Hold": "hsl(45, 65%, 40%)",
        "New": "hsl(0, 65%, 40%)"
      };
      const color = colors[currentBadge] || colors["New"];

      return BUI.html`
        <bim-dropdown
          @change=${(e: Event) => {
          e.stopPropagation();
          const dp = e.target as BUI.Dropdown;
          dp.visible = false;
          const newVal = (dp.value[0] as string) || "New";
          row.Badge = newVal;
          dp.style.color = colors[newVal];
          dp.style.setProperty("--bim-ui_bg-contrast-100", colors[newVal]);

          if (row.isGroup) {
            (row.rawGroup as any).badge = newVal;
            for (const res of (row.rawGroup as any[])) {
              res.badge = newVal;
            }
          } else {
            (row.raw as any).badge = newVal;
          }

          // 마커 색상 즉시 업데이트
          updateMarkers();
          updateClashCountLabel();
        }}
          style="width: 100%; min-width: 90px; color: ${color}; --bim-ui_bg-contrast-100: ${color}; font-weight: bold; background: transparent;"
        >
          <bim-option label="New" value="New" style="color: ${colors["New"]}; --bim-ui_bg-contrast-100: ${colors["New"]}; font-weight: bold;" ?checked=${currentBadge === "New"}></bim-option>
          <bim-option label="Hold" value="Hold" style="color: ${colors["Hold"]}; --bim-ui_bg-contrast-100: ${colors["Hold"]}; font-weight: bold;" ?checked=${currentBadge === "Hold"}></bim-option>
          <bim-option label="Exclude" value="Exclude" style="color: ${colors["Exclude"]}; --bim-ui_bg-contrast-100: ${colors["Exclude"]}; font-weight: bold;" ?checked=${currentBadge === "Exclude"}></bim-option>
        </bim-dropdown>
      `;
    },
    Action: (_, row) => {
      if (row.isGroup) {
        return BUI.html`
          <div style="display: flex; justify-content: center; gap: 0.25rem;">
            <bim-button style=${tableButtonStyle || ''} icon=${appIcons.SELECT} @click=${async (e: Event) => {
            e.stopPropagation();
            const resList = row.rawGroup as ClashResult[];
            const map: OBC.ModelIdMap = {};
            for (const r of resList) {
              if (!map[r.id1.modelId]) map[r.id1.modelId] = new Set();
              map[r.id1.modelId].add(r.id1.expressID);
              if (!map[r.id2.modelId]) map[r.id2.modelId] = new Set();
              map[r.id2.modelId].add(r.id2.expressID);
            }
            const highlighter = components.get(Highlighter);
            await highlighter.clear("select");
            await highlighter.highlightByID("select", map);
          }} title="Select All Objects in Group"></bim-button>
            <bim-button style=${tableButtonStyle || ''} icon=${appIcons.DELETE} @click=${(e: Event) => {
            e.stopPropagation();
            if (!confirm("이 간섭 그룹을 삭제하시겠습니까?")) return;
            const resList = row.rawGroup as ClashResult[];
            const toDelete = new Set(resList);
            if (rawValidResults) {
              rawValidResults = rawValidResults.filter(r => !toDelete.has(r));
              clashTable.selection.clear();
              if (deleteBtn) deleteBtn.disabled = true;
              applyFilters();
            }
          }} title="Delete Group"></bim-button>
            <bim-button style=${tableButtonStyle || ''} icon=${appIcons.SAVE} @click=${(e: Event) => {
            e.stopPropagation();
            const posStr = row.Position as string;
            const coords = posStr.split(",").map(Number);
            const resList = row.rawGroup as ClashResult[];
            clashService.saveGroupToTopic(new THREE.Vector3(coords[0], coords[1], coords[2]), resList);
          }} title="Create Topic for Group"></bim-button>
          </div>
        `;
      }

      const res = row.raw as ClashResult;
      return BUI.html`
        <div style="display: flex; justify-content: center; gap: 0.25rem;">
          <bim-button style=${tableButtonStyle || ''} icon=${appIcons.SELECT} @click=${(e: Event) => { e.stopPropagation(); clashService.selectClashObjects(res); }} title="Select Objects"></bim-button>
          <bim-button style=${tableButtonStyle || ''} icon=${appIcons.DELETE} @click=${(e: Event) => {
          e.stopPropagation();
          if (!confirm("이 간섭 항목을 삭제하시겠습니까?")) return;
          if (rawValidResults) {
            rawValidResults = rawValidResults.filter(r => r !== res);
            clashTable.selection.clear();
            if (deleteBtn) deleteBtn.disabled = true;
            applyFilters();
          }
        }} title="Delete Clash"></bim-button>
          <bim-button style=${tableButtonStyle || ''} icon=${appIcons.SAVE} @click=${(e: Event) => { e.stopPropagation(); clashService.saveToTopic(res); }} title="Create Topic"></bim-button>
        </div>
      `;
    }
  };

  const runClash = async (e?: Event) => {
    const btn = e ? e.target as BUI.Button : null;
    if (btn) btn.loading = true;

    let setA: OBC.ModelIdMap = {};
    let setB: OBC.ModelIdMap = {};

    // Classifier를 이용한 카테고리 정보 추출
    try {
      await classifier.byCategory({ classificationName: "entities" });
    } catch (err) {
      console.warn("Classifier grouping error:", err);
    }
    const entitiesClass = classifier.list.get("entities");

    const basicExclusions = new Set(["REINFORCINGBAR", "OPENING", "SITE", "SPACE", "SPATIALZONE", "VOID"]);

    // 각 카테고리 그룹의 ModelIdMap 데이터를 미리 비동기로 추출 (성능 최적화)
    const preFetchedCategories = new Map<string, OBC.ModelIdMap>();
    if (entitiesClass) {
      for (const [catName, group] of entitiesClass.entries()) {
        try {
          const mapData = await (group as any).get();
          if (mapData) {
            let hasActiveItems = false;
            for (const modelId in mapData) {
              if (fragmentsManager.list.has(modelId) && mapData[modelId].size > 0) {
                hasActiveItems = true;
                break;
              }
            }
            const cleanCatName = catName.replace(/^IFC/i, "");
            // 현재 활성화된 모델에 존재하는 카테고리이면서, 기본 제외 항목이 아닌 경우에만 캐싱합니다.
            if (hasActiveItems && !basicExclusions.has(cleanCatName.toUpperCase())) {
              preFetchedCategories.set(cleanCatName, mapData);
            }
          }
        } catch (e) { }
      }
    }
    cachedAllCategories = Array.from(preFetchedCategories.keys()).sort();

    const allModelIdMap: OBC.ModelIdMap = {};

    for (const modelIdMap of preFetchedCategories.values()) {
      OBC.ModelIdMapUtils.add(allModelIdMap, modelIdMap);
    }

    let totalItems = 0;
    for (const modelId in allModelIdMap) {
      totalItems += allModelIdMap[modelId].size;
    }

    const selection = highlighter.selection.select;
    const hasSelection = Object.keys(selection).length > 0;

    if (hasSelection) {
      setA = selection;
      setB = allModelIdMap;
    } else {
      setA = allModelIdMap;
      setB = allModelIdMap;
    }

    if (totalItems === 0) {
      console.warn("⚠️ 간섭 검토를 위한 객체가 추출되지 않았습니다! 모델이 제대로 로드되었는지 확인하세요.");
      alert("간섭 검토를 위한 객체를 찾을 수 없습니다.");
      if (btn) btn.loading = false;
      return;
    }

    // 3. 간섭 검토 실행 (성능 측정을 위해 시간 측정)
    const rawVal = clashValueInput ? parseFloat(clashValueInput.value) : NaN;
    const inputVal = isNaN(rawVal) ? 0.05 : rawVal;
    const toleranceVal = cachedClashMode === "Hard" ? inputVal : 0;
    const clearanceVal = cachedClashMode === "Soft" ? inputVal : 0;

    const results = await clashService.detectClashes(setA, setB, {
      clearance: clearanceVal,
      tolerance: toleranceVal,
      excludeSelfCheck: cachedExcludeSelfCheck
    });

    const getCategory = (modelId: string, expressID: number) => {
      for (const [catName, mapData] of preFetchedCategories.entries()) {
        if (mapData[modelId] && mapData[modelId].has(expressID)) {
          return catName;
        }
      }
      return "Unknown";
    };

    // 간섭 결과에 카테고리 정보를 첨부합니다.
    const validResults: ClashResult[] = [];
    for (const res of results) {
      (res.id1 as any).category = getCategory(res.id1.modelId, res.id1.expressID);
      (res.id2 as any).category = getCategory(res.id2.modelId, res.id2.expressID);
      validResults.push(res);
    }

    // 성능 최적화: 필요한 객체 이름 일괄 가져오기 및 모델 이름 캐싱
    const modelNames = new Map<string, string>();
    const idMap: Record<string, Set<number>> = {};
    for (const res of validResults) {
      if (!idMap[res.id1.modelId]) idMap[res.id1.modelId] = new Set();
      idMap[res.id1.modelId].add(res.id1.expressID);

      if (!idMap[res.id2.modelId]) idMap[res.id2.modelId] = new Set();
      idMap[res.id2.modelId].add(res.id2.expressID);

      if (!modelNames.has(res.id1.modelId)) {
        const m = fragmentsManager.list.get(res.id1.modelId);
        modelNames.set(res.id1.modelId, m && (m as any).name ? (m as any).name : `Model-${res.id1.modelId.substring(0, 4)}`);
      }
      if (!modelNames.has(res.id2.modelId)) {
        const m = fragmentsManager.list.get(res.id2.modelId);
        modelNames.set(res.id2.modelId, m && (m as any).name ? (m as any).name : `Model-${res.id2.modelId.substring(0, 4)}`);
      }
    }

    modelNamesCache.clear();
    for (const [k, v] of modelNames) modelNamesCache.set(k, v);

    itemNamesCache.clear();
    itemGuidsCache.clear();
    for (const modelId in idMap) {
      const model = fragmentsManager.list.get(modelId);
      if (model) {
        try {
          const idsArray = Array.from(idMap[modelId]);
          const itemsData = await model.getItemsData(idsArray, {
            attributesDefault: true,
            relationsDefault: { attributes: false, relations: false },
          });

          for (let i = 0; i < itemsData.length; i++) {
            const itemAny = itemsData[i] as any;
            const expressId = itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId ?? idsArray[i];
            let name = "Unknown";
            let guid = "Unknown";
            if (itemAny.Name) {
              name = typeof itemAny.Name === "object" && itemAny.Name.value !== undefined ? String(itemAny.Name.value) : String(itemAny.Name);
            }
            if (itemAny._guid) {
              guid = typeof itemAny._guid === "object" && itemAny._guid.value !== undefined ? String(itemAny._guid.value) : String(itemAny._guid);
            } else if (itemAny.GlobalId) {
              guid = typeof itemAny.GlobalId === "object" && itemAny.GlobalId.value !== undefined ? String(itemAny.GlobalId.value) : String(itemAny.GlobalId);
            }
            itemNamesCache.set(`${modelId}-${expressId}`, name);
            itemGuidsCache.set(`${modelId}-${expressId}`, guid);
          }
        } catch (e) {
          console.warn("Error fetching item names:", e);
        }
      }
    }

    // 4. DB에서 이전에 저장된 Hold/Exclude 상태 가져와서 복원하기 (모델 개정 시 상태 유지 기능)
    try {
      const pairsToFetch: [string, string][] = [];
      for (const res of validResults) {
        const g1 = itemGuidsCache.get(`${res.id1.modelId}-${res.id1.expressID}`) || "";
        const g2 = itemGuidsCache.get(`${res.id2.modelId}-${res.id2.expressID}`) || "";
        if (g1 && g2) {
          const [sortedG1, sortedG2] = [g1, g2].sort();
          pairsToFetch.push([sortedG1, sortedG2]);
        }
      }

      if (pairsToFetch.length > 0) {
        const dbRes = await fetch("/api/clash-manager/filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairs: pairsToFetch })
        });

        if (dbRes.ok) {
          const dbStatuses = await dbRes.json();
          const dbMap = new Map();
          for (const row of dbStatuses) dbMap.set(`${row.guid1}|${row.guid2}`, row.badge);

          for (const res of validResults) {
            const g1 = itemGuidsCache.get(`${res.id1.modelId}-${res.id1.expressID}`) || "";
            const g2 = itemGuidsCache.get(`${res.id2.modelId}-${res.id2.expressID}`) || "";
            if (g1 && g2) {
              const key = [g1, g2].sort().join("|");
              if (dbMap.has(key)) {
                (res as any).badge = dbMap.get(key);
                (res as any).wasSavedInDB = true;
              }
            }
          }
        }
      }
    } catch (e) { console.error("Error syncing clash statuses from DB:", e); }

    rawValidResults = validResults;
    currentPage = 0;
    matrixCellFilterSet = null;
    applyFilters();

    if (btn) btn.loading = false;

    if (!e) {
      // UI 자동 탭 전환 로직 (ThatOpen UI 구조 대응)
      if (clashSection) {
        clashSection.collapsed = false;

        const parentPanel = clashSection.closest("bim-panel");
        if (parentPanel) {
          const tabId = parentPanel.getAttribute("name") || parentPanel.getAttribute("slot");
          if (tabId) {
            const tabsContainer = parentPanel.closest("bim-tabs") || document.querySelector("bim-tabs");
            if (tabsContainer) {
              const targetTab = tabsContainer.querySelector(`bim-tab[name="${tabId}"], bim-tab[label="${tabId}"]`) as HTMLElement;
              if (targetTab) targetTab.click();
              else (tabsContainer as any).active = tabId;
            }
          }
        }
        setTimeout(() => clashSection.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }

      // 화면(탭) 전환이 시각적으로 이루어진 직후에 완료 알림창을 띄우기 위해 약간의 지연(setTimeout)을 줍니다.
      setTimeout(() => {
        alert(`간섭 검토 완료: 총 ${validResults.length}개의 유효한 간섭이 발견되었습니다.\n결과는 화면에 표시된 Clash Detection 패널에서 확인하세요.`);
      }, 150);
    }
  };

  const onMarkersChange = (e: Event) => {
    const cb = e.target as any;
    isMarkersVisible = cb.checked;
    updateMarkers();
  };

  const onSelfCheckChange = (e: Event) => {
    const cb = e.target as any;
    cachedExcludeSelfCheck = !cb.checked;
  };

  const saveAllToTopics = async (e?: Event) => {
    const btn = e ? e.target as BUI.Button : null;
    if (btn) btn.loading = true;

    // 1. Hold 및 Exclude 상태인 간섭들을 DB에 백업하여 모델 개정 시 유지되도록 처리 (UPSERT)
    const statusPayload: any[] = [];
    const deletePayload: { guid1: string, guid2: string }[] = [];
    if (cachedFlatData) {
      for (const row of cachedFlatData) {
        const badge = ((row.data.raw as any).badge || row.data.Badge || "New");
        const raw = row.data.raw as ClashResult;
        const g1 = itemGuidsCache.get(`${raw.id1.modelId}-${raw.id1.expressID}`) || "Unknown";
        const g2 = itemGuidsCache.get(`${raw.id2.modelId}-${raw.id2.expressID}`) || "Unknown";

        // 순서 무결성을 위해 GUID를 알파벳 순으로 정렬합니다.
        const [sortedG1, sortedG2] = [g1, g2].sort();
        const isSwapped = sortedG1 !== g1;

        if (badge === "Hold" || badge === "Exclude") {
          statusPayload.push({
            guid1: sortedG1,
            guid2: sortedG2,
            badge: badge,
            entity1: isSwapped ? row.data.Entity2 : row.data.Entity1,
            object1: isSwapped ? row.data.Object2 : row.data.Object1,
            entity2: isSwapped ? row.data.Entity1 : row.data.Entity2,
            object2: isSwapped ? row.data.Object1 : row.data.Object2,
            x_coord: Number(raw.position.x.toFixed(2)),
            y_coord: Number(raw.position.y.toFixed(2)),
            z_coord: Number(raw.position.z.toFixed(2))
          });
        } else if (badge === "New" && (raw as any).wasSavedInDB) {
          // 기존에 DB에 저장되었으나 다시 New 상태로 되돌린 경우 삭제 페이로드에 추가
          deletePayload.push({ guid1: sortedG1, guid2: sortedG2 });
          (raw as any).wasSavedInDB = false; // 플래그 초기화
        }
      }
    }

    if (statusPayload.length > 0) {
      try {
        await fetch("/api/clash-manager/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(statusPayload)
        });
      } catch (e) { console.error("Error saving clash statuses to DB:", e); }
    }

    if (deletePayload.length > 0) {
      try {
        await fetch("/api/clash-manager/delete-pairs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deletePayload)
        });
      } catch (e) { console.error("Error deleting reverted clash statuses from DB:", e); }
    }

    // 평탄화된 데이터 중에서 Badge 값이 "New"인 간섭 결과만 추출하여 BCF로 내보냅니다.
    const newResults = cachedFlatData
      ? cachedFlatData
        .filter(row => ((row.data.raw as any).badge || row.data.Badge || "New") === "New")
        .map(row => row.data.raw as ClashResult)
      : [];

    if (newResults.length === 0) {
      alert("변환할 'New' 상태의 간섭 결과가 없습니다.");
    } else {
      await clashService.saveAllToTopics(newResults);
    }
    if (btn) btn.loading = false;
  };

  const onDeleteSelected = () => {
    if (clashTable.selection.size === 0) return;
    if (!confirm(`선택된 ${clashTable.selection.size}개의 간섭 결과를 삭제하시겠습니까?`)) return;

    const selectedSet = new Set();
    for (const sel of clashTable.selection) {
      if ((sel as any).raw) selectedSet.add((sel as any).raw);
    }

    if (rawValidResults) {
      rawValidResults = rawValidResults.filter(res => !selectedSet.has(res));
    }

    clashTable.selection.clear();
    if (deleteBtn) deleteBtn.disabled = true;

    applyFilters();
  };

  const clearClashDataSilent = async () => {
    rawValidResults = null;
    cachedClashData = null;
    cachedAllCategories = [];
    itemNamesCache.clear();
    itemGuidsCache.clear();
    modelNamesCache.clear();
    clashTable.selection.clear();
    if (deleteBtn) deleteBtn.disabled = true;
    currentPage = 0;
    searchQuery = "";
    if (searchInput) searchInput.value = "";
    badgeFilter = "All";
    if (badgeFilterDropdown) badgeFilterDropdown.value = ["All"];
    matrixCellFilterSet = null;
    applyFilters();
    if (isMarkersVisible) {
      isMarkersVisible = false;
      if (markerBtn) markerBtn.checked = false;
      updateMarkers();
    }
    await highlighter.clear("select");
    const clashPalette = [
      "#C00000", "#00B050", "#0070C0", "#FFC000", "#7030A0",
      "#FF66CC", "#00CCFF", "#FF9933", "#99CC00", "#3399FF"
    ];
    for (const color of clashPalette) {
      await highlighter.clear(color);
    }
    restoreModelMaterials(components);
  };

  if (!isClashClearRegistered) {
    fragmentsManager.list.onItemDeleted.add(async () => {
      await clearClashDataSilent();
    });
    isClashClearRegistered = true;
  }

  const onClearAll = async () => {
    if (confirm("모든 간섭 검토 결과를 삭제하시겠습니까?")) {
      await clearClashDataSilent();
    }
  };

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    searchQuery = input.value;
    currentPage = 0;
    applyFilters();
  };

  const onClearSearch = () => {
    if (searchInput) searchInput.value = "";
    searchQuery = "";
    badgeFilter = "All";
    if (badgeFilterDropdown) badgeFilterDropdown.value = ["All"];
    currentPage = 0;
    applyFilters();
  };

  const onExcludeSearch = () => {
    if (!rawValidResults || !searchQuery) return;
    if (cachedFlatData.length === 0) return;

    if (!confirm(`검색된 ${cachedFlatData.length}개의 간섭 결과를 삭제(Exclude)하시겠습니까?`)) return;

    const excludedSet = new Set(cachedFlatData.map(row => row.data.raw));
    rawValidResults = rawValidResults.filter(res => !excludedSet.has(res));

    clashTable.selection.clear();
    if (deleteBtn) deleteBtn.disabled = true;

    onClearSearch();
  };

  const onIsolateSearch = () => {
    if (!rawValidResults || !searchQuery) return;
    if (cachedFlatData.length === 0) return;

    if (!confirm(`검색된 ${cachedFlatData.length}개의 간섭 결과만 남기고 나머지(Isolate)를 삭제하시겠습니까?`)) return;

    const isolateSet = new Set(cachedFlatData.map(row => row.data.raw));
    rawValidResults = rawValidResults.filter(res => isolateSet.has(res));

    clashTable.selection.clear();
    if (deleteBtn) deleteBtn.disabled = true;

    onClearSearch();
  };

  const onExportCSV = () => {
    if (!cachedFlatData || cachedFlatData.length === 0) {
      alert("내보낼 데이터가 없습니다.");
      return;
    }
    const headers = ["Badge", "Model1", "Entity1", "Object1", "Model2", "Entity2", "Object2", "Position"];
    const csvRows = [headers.join(",")];

    for (const row of cachedFlatData) {
      const d = row.data;
      if (d.isGroup) continue; // 그룹 행 제외

      const escapeCSV = (val: any) => `"${String(val ?? "").replace(/"/g, '""')}"`;
      csvRows.push([
        escapeCSV(d.Badge),
        escapeCSV(d.Model1),
        escapeCSV(d.Entity1),
        escapeCSV(d.Object1),
        escapeCSV(d.Model2),
        escapeCSV(d.Entity2),
        escapeCSV(d.Object2),
        escapeCSV(d.Position)
      ].join(","));
    }

    const csvString = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clash_list.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const [matrixPanel, updateMatrix] = clashMatrix({
    components,
    clashData: filteredClashData,
    allCategories: cachedAllCategories,
    onCellClicked: (clashRows: any[] | null) => {
      clashTable.selection.clear();
      if (clashRows) {
        matrixCellFilterSet = new Set(clashRows.map(r => r.raw));
      } else {
        matrixCellFilterSet = null;
      }
      currentPage = 0;
      applyFilters();
    },
    onBadgeChanged: (pairs: [string, string][], badge: string) => {
      if (pairs.length === 0) return;

      if (rawValidResults) {
        for (const res of rawValidResults) {
          const cat1 = String((res.id1 as any).category || "").toUpperCase();
          const cat2 = String((res.id2 as any).category || "").toUpperCase();
          for (const [pc1, pc2] of pairs) {
            if ((cat1 === pc1.toUpperCase() && cat2 === pc2.toUpperCase()) ||
              (cat1 === pc2.toUpperCase() && cat2 === pc1.toUpperCase())) {
              (res as any).badge = badge;
            }
          }
        }
      }
      applyFilters();
      setTimeout(() => updatePage(), 0);
    }
  });
  updateMatrixFn = updateMatrix;
  matrixPanel.style.minWidth = "0";
  matrixPanel.style.width = "100%";
  matrixPanel.style.boxSizing = "border-box";

  return BUI.html`
    <bim-panel-section ${BUI.ref((el) => {
    clashSection = el as BUI.PanelSection;
    setTimeout(() => applyFilters(), 0);
  })} fixed label="Clash List ( Total(0) = New(0) + Hold(0) + Exclude(0) )" icon=${appIcons.CLASH}>
      <div style="display: flex; flex-direction: column; gap: 0.5rem; height: 100%;">
        <div style="display: flex; gap: 0.5rem; flex-shrink: 0; align-items: center; position: relative; z-index: 10;">
          <div style="display: flex; gap: 0.25rem; flex: 1; align-items: center;">
            <bim-dropdown
              @change=${(e: Event) => {
      const dp = e.target as BUI.Dropdown;
      dp.visible = false;
      cachedClashMode = dp.value[0] as string;
      if (clashValueLabel) clashValueLabel.textContent = cachedClashMode === "Hard" ? "Tolerance (m)" : "Clearance (m)";
    }}
              style="width: 120px; flex-shrink: 0;"
            >
              <bim-option label="Hard Clash" value="Hard" ?checked=${cachedClashMode === "Hard"}></bim-option>
              <bim-option label="Soft Clash" value="Soft" ?checked=${cachedClashMode === "Soft"}></bim-option>
            </bim-dropdown>
            <bim-label ${BUI.ref(e => {
      clashValueLabel = e as BUI.Label;
      if (clashValueLabel) {
        clashValueLabel.textContent = cachedClashMode === "Hard" ? "Tolerance (m)" : "Clearance (m)";
      }
    })} style="white-space: nowrap; margin: 0 0.25rem;">
            </bim-label>
            <bim-text-input 
              ${BUI.ref((e) => {
      clashValueInput = e as BUI.TextInput;
      if (clashValueInput) { clashValueInput.value = cachedClashValue; }
    })} 
              @input=${(e: Event) => { cachedClashValue = (e.target as BUI.TextInput).value; }} 
              type="number" style="width: 60px; flex-shrink: 0;">
            </bim-text-input>
            <bim-checkbox label="Self Check" .checked=${!cachedExcludeSelfCheck} @change=${onSelfCheckChange} style="padding: 0.5rem; white-space: nowrap;" title="동일한 모델 내 객체 간의 간섭검토 여부"></bim-checkbox>
            <bim-button label="Run Clash" icon=${appIcons.CLASH} @click=${runClash} style="flex: 1; background-color: var(--bim-ui_main-base); color: var(--bim-ui_main-contrast); font-weight: bold;"></bim-button>
            <bim-button ${BUI.ref(e => deleteBtn = e as BUI.Button)} label="Delete" icon=${appIcons.DELETE} @click=${onDeleteSelected} disabled style="flex: 1;"></bim-button>
            <bim-button label="Clear" icon=${appIcons.CLEAR} @click=${onClearAll} style="flex: 1;"></bim-button>
            <bim-checkbox ${BUI.ref(e => markerBtn = e as any)} label="Markers" .checked=${isMarkersVisible} @change=${onMarkersChange} style="padding: 0.5rem; white-space: nowrap;" title="간섭 위치 마커 표시 여부"></bim-checkbox>
            <bim-button label="To Topic" icon=${appIcons.SAVE} @click=${saveAllToTopics} style="flex: 1;"></bim-button>
            <bim-button label="Export" icon=${appIcons.EXPORT} @click=${onExportCSV} style="flex: 1;"></bim-button>
          </div>
          <div style="display: flex; gap: 0.25rem; flex: 1; align-items: center;">
            <bim-dropdown
            ${BUI.ref(e => badgeFilterDropdown = e as BUI.Dropdown)}
            @change=${(e: Event) => {
      const dp = e.target as BUI.Dropdown;
      dp.visible = false;
      badgeFilter = (dp.value[0] as string) || "All";
      currentPage = 0;
      applyFilters();
    }}
            style="flex: 0.2;"
            >
            <bim-option label="All" value="All" ?checked=${badgeFilter === "All"}></bim-option>
            <bim-option label="New" value="New" ?checked=${badgeFilter === "New"} style="font-weight: bold;"></bim-option>
            <bim-option label="Hold" value="Hold" ?checked=${badgeFilter === "Hold"} style="font-weight: bold;"></bim-option>
            <bim-option label="Exclude" value="Exclude" ?checked=${badgeFilter === "Exclude"} style="font-weight: bold;"></bim-option>
            </bim-dropdown>
            <bim-label style="white-space: nowrap; margin: 0 0.25rem;">Group Dist. (m)</bim-label>
            <bim-text-input 
              ${BUI.ref((e) => {
      groupDistInput = e as BUI.TextInput;
      if (groupDistInput) { groupDistInput.value = cachedGroupDistance; }
    })} 
              @input=${(e: Event) => {
      cachedGroupDistance = (e.target as BUI.TextInput).value;
      applyFilters();
    }} type="number" style="flex: 0.2;" title="근접한 간섭 마커를 하나로 묶을 반경 거리 (m)"></bim-text-input>
            <bim-text-input ${BUI.ref((e) => { searchInput = e as BUI.TextInput; })} @input=${onSearch} vertical placeholder="Search Model or Entity..." debounce="200" style="flex: 1;"></bim-text-input>
            <bim-button @click=${onClearSearch} icon=${appIcons.CLEAR} tooltip-title="Clear Search" style="flex: 0 0 auto;"></bim-button>
            <bim-button @click=${onExcludeSearch} icon=${appIcons.EXCLUDE} tooltip-title="Remove search results from list" style="flex: 0 0 auto;"></bim-button>
            <bim-button @click=${onIsolateSearch} icon=${appIcons.ISOLATE} tooltip-title="Keep only search results" style="flex: 0 0 auto;"></bim-button>
            ${createPaginationTemplate(onPrevPage, onNextPage, paginationRefs)}
          </div>
        </div>
        <div style="display: flex; flex: 1; gap: 0.5rem; min-height: 0; overflow: hidden;">
          <div style="flex: 1; display: flex; flex-direction: column; min-height: 250px; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; overflow: hidden; min-width: 0;">
            ${clashTable}
          </div>
          <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; overflow: hidden;">
            <div style="display: flex; flex-direction: column; width: 100%; flex: 1; min-width: 0; box-sizing: border-box; overflow: hidden;">
              ${matrixPanel}
            </div>
          </div>
        </div>
      </div>
    </bim-panel-section>
  `;
};
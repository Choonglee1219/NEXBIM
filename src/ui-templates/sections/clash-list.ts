import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { ClashService, ClashResult, clashMatrix } from "../../bim-components/ClashService";
import { Highlighter } from "../../bim-components/Highlighter";
import { tableButtonStyle, setupBIMTable, appIcons, createPaginationTemplate, PaginationRefs } from "../../globals";

export interface ClashListPanelState {
  components: OBC.Components;
}

// 상태 유지를 위한 모듈 레벨 캐시 변수
let cachedClashData: any[] | null = null;
let cachedFlatData: any[] = [];
let rawValidResults: ClashResult[] | null = null;
let itemNamesCache = new Map<string, string>();
let modelNamesCache = new Map<string, string>();
let cachedAllCategories: string[] = [];
let cachedClashMode = "Hard";
let cachedClashValue = "0.05";
let cachedGroupDistance = "0.5";
let currentPage = 0;
let activeExclusions = new Set<string>();
let filteredClashData: any[] = [];
let searchQuery = "";
let isMarkersVisible = false;
let isClashClearRegistered = false;

export const clashListPanelTemplate: BUI.StatefullComponent<ClashListPanelState> = (state) => {
  const { components } = state;
  const clashService = components.get(ClashService);
  const fragmentsManager = components.get(OBC.FragmentsManager);
  const highlighter = components.get(Highlighter);
  const classifier = components.get(OBC.Classifier);

  const clashTable = document.createElement("bim-table") as BUI.Table<any>;
  clashTable.hiddenColumns = ["id", "raw", "rawGroup", "isGroup"];
  clashTable.headersHidden = false;
  clashTable.preserveStructureOnFilter = true;
  if (setupBIMTable) setupBIMTable(clashTable);

  clashTable.columns = [
    { name: "Model1", width: "1.5fr" },
    { name: "Entity1", width: "1.5fr" },
    { name: "Object1", width: "2fr" },
    { name: "Model2", width: "1.5fr" },
    { name: "Entity2", width: "1.5fr" },
    { name: "Object2", width: "2fr" },
    { name: "Position", width: "1.5fr" },
    { name: "Action", width: "120px" },
  ];

  let clashSection: BUI.PanelSection;

  let clashValueInput: BUI.TextInput;
  let clashValueLabel: BUI.Label;
  let groupDistInput: BUI.TextInput;
  let deleteBtn: BUI.Button;
  let markerBtn: BUI.Button;
  let searchInput: BUI.TextInput;

  // --- Pagination State & Logic ---
  const pageSize = 30;
  let totalItems = 0;
  let totalPages = 0;

  const paginationRefs: PaginationRefs = {};

  let updateMatrixFn: any;

  const updateMarkers = () => {
    if (isMarkersVisible) {
      const positions = cachedFlatData.map(row => row.data.raw.position);
      clashService.drawClashMarkers(positions);
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
      // 1. 제외 필터(activeExclusions) 적용하여 유효한 결과만 추출
      const effectiveResults = rawValidResults.filter(res => {
        const cat1 = String((res.id1 as any).category || "").toUpperCase();
        const cat2 = String((res.id2 as any).category || "").toUpperCase();
        return !activeExclusions.has(`${cat1}|${cat2}`) && !activeExclusions.has(`${cat2}|${cat1}`);
      });

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
          const groupRowData = {
            id: `group-${groupCounter}`,
            isGroup: true,
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
      if (searchQuery) {
        const lowerQ = searchQuery.toLowerCase();
        const filterTree = (nodes: any[]): any[] => {
          return nodes.map(node => {
            const d = node.data;
            let match = false;
            if (d.isGroup) {
              match = String(d.Entity1 || "").toLowerCase().includes(lowerQ);
            } else {
              match = (
                String(d.Model1 || "").toLowerCase().includes(lowerQ) ||
                String(d.Model2 || "").toLowerCase().includes(lowerQ) ||
                String(d.Entity1 || "").toLowerCase().includes(lowerQ) ||
                String(d.Entity2 || "").toLowerCase().includes(lowerQ) ||
                String(d.Object1 || "").toLowerCase().includes(lowerQ) ||
                String(d.Object2 || "").toLowerCase().includes(lowerQ)
              );
            }

            if (node.children) {
              const filteredChildren = filterTree(node.children);
              if (match || filteredChildren.length > 0) {
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
      updateMatrixFn({ components, clashData: matrixClashData, allCategories: cachedAllCategories, activeExclusions });
    }
    updateMarkers();
  };

  const updatePage = () => {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    clashTable.hiddenColumns = ["id", "raw", "rawGroup", "isGroup"];
    clashTable.data = filteredClashData.slice(start, end);

    if (clashSection) clashSection.label = `Clash List (${totalItems})`;
    
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
    Action: (_, row) => {
      if (row.isGroup) {
        return BUI.html`
          <div style="display: flex; justify-content: center; gap: 0.25rem;">
            <bim-button style=${tableButtonStyle || ''} icon=${appIcons.SELECT} @click=${async (e: Event) => {
              e.stopPropagation();
              const resList = row.rawGroup as ClashResult[];
              const map: OBC.ModelIdMap = {};
              for(const r of resList) {
                if(!map[r.id1.modelId]) map[r.id1.modelId] = new Set();
                map[r.id1.modelId].add(r.id1.expressID);
                if(!map[r.id2.modelId]) map[r.id2.modelId] = new Set();
                map[r.id2.modelId].add(r.id2.expressID);
              }
              const highlighter = components.get(Highlighter);
              await highlighter.clear("select");
              await highlighter.highlightByID("select", map);
            }} title="Select All Objects in Group"></bim-button>
            <bim-button style=${tableButtonStyle || ''} icon=${appIcons.FOCUS} @click=${(e: Event) => {
              e.stopPropagation();
              const posStr = row.Position as string;
              const coords = posStr.split(",").map(Number);
              const resList = row.rawGroup as ClashResult[];
              clashService.moveToClashGroup(new THREE.Vector3(coords[0], coords[1], coords[2]), resList);
            }} title="Go to Group"></bim-button>
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
          <bim-button style=${tableButtonStyle || ''} icon=${appIcons.FOCUS} @click=${(e: Event) => { e.stopPropagation(); clashService.moveToClash(res); }} title="Go to Clash"></bim-button>
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
    console.log("🚀 간섭 검토를 시작합니다...");
    
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
        } catch (e) {}
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
      console.log("🎯 [선택 모드] 선택된 객체 vs 전체 모델의 간섭을 검사합니다.");
      setA = selection;
      setB = allModelIdMap;
      
      let selectionCount = 0;
      for (const modelId in selection) selectionCount += selection[modelId].size;
      console.log(`✅ [선택 모드] Set A (선택됨): ${selectionCount}개 아이템 vs Set B (전체): ${totalItems}개 아이템`);
    } else {
      console.log("🌐 [전체 모드] 선택된 객체가 없습니다. 모델 전체(Self-Clash) 간섭을 검사합니다.");
      setA = allModelIdMap;
      setB = allModelIdMap;
      console.log(`✅ [전체 모드] Set A: ${totalItems}개 아이템 vs Set B: ${totalItems}개 아이템`);
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
    
    const startTime = performance.now();
    const results = await clashService.detectClashes(setA, setB, { clearance: clearanceVal, tolerance: toleranceVal });
    const endTime = performance.now();

    console.log(`✅ 간섭 검토 완료! (소요 시간: ${(endTime - startTime).toFixed(2)}ms)`);
    console.log(`💥 총 ${results.length}개의 간섭이 발견되었습니다.`);
    
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
             if (itemAny.Name) {
               name = typeof itemAny.Name === "object" && itemAny.Name.value !== undefined ? String(itemAny.Name.value) : String(itemAny.Name);
             }
             itemNamesCache.set(`${modelId}-${expressId}`, name);
          }
        } catch (e) {
          console.warn("Error fetching item names:", e);
        }
      }
    }

    rawValidResults = validResults;
    currentPage = 0;
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

  const toggleMarkers = () => {
    isMarkersVisible = !isMarkersVisible;
    if (markerBtn) markerBtn.active = isMarkersVisible;
    updateMarkers();
  };

  const saveAllToTopics = async (e?: Event) => {
    const btn = e ? e.target as BUI.Button : null;
    if (btn) btn.loading = true;
    
    // 전체 데이터가 아닌 검색 필터링된 결과 데이터만 BCF로 내보냅니다.
    const results = cachedFlatData ? cachedFlatData.map(row => row.data.raw as ClashResult) : [];
    if (results.length === 0) {
      alert("변환할 간섭 결과가 없습니다.");
    } else {
      await clashService.saveAllToTopics(results);
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

  const clearClashDataSilent = () => {
    rawValidResults = null;
    cachedClashData = null;
    cachedAllCategories = [];
    activeExclusions.clear();
    clashTable.selection.clear();
    if (deleteBtn) deleteBtn.disabled = true;
    currentPage = 0;
    applyFilters();
    if (isMarkersVisible) {
      isMarkersVisible = false;
      if (markerBtn) markerBtn.active = false;
      updateMarkers();
    }
  };

  if (!isClashClearRegistered) {
    fragmentsManager.list.onItemDeleted.add(() => {
      clearClashDataSilent();
    });
    isClashClearRegistered = true;
  }

  const onClearAll = () => {
    if (confirm("모든 간섭 검토 결과를 삭제하시겠습니까?")) {
      clearClashDataSilent();
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

  const [matrixPanel, updateMatrix] = clashMatrix({ 
    components,
    clashData: filteredClashData,
    allCategories: cachedAllCategories,
    activeExclusions,
    onCellClicked: (clashRows: any[] | null) => {
      clashTable.selection.clear();
      if (clashRows) {
        for (const rowData of clashRows) {
          clashTable.selection.add(rowData);
        }
      }
      clashTable.dispatchEvent(new Event("change"));
    },
    onExcludeToggled: (pairs: [string, string][]) => {
      if (pairs.length === 0) return;
      let allExcluded = true;
      for (const [c1, c2] of pairs) {
        const key1 = `${c1.toUpperCase()}|${c2.toUpperCase()}`;
        const key2 = `${c2.toUpperCase()}|${c1.toUpperCase()}`;
        if (!activeExclusions.has(key1) && !activeExclusions.has(key2)) {
          allExcluded = false;
          break;
        }
      }
      
      if (allExcluded) {
        for (const [c1, c2] of pairs) {
          const key1 = `${c1.toUpperCase()}|${c2.toUpperCase()}`;
          const key2 = `${c2.toUpperCase()}|${c1.toUpperCase()}`;
          activeExclusions.delete(key1);
          activeExclusions.delete(key2);
        }
      } else {
        for (const [c1, c2] of pairs) {
          activeExclusions.add(`${c1.toUpperCase()}|${c2.toUpperCase()}`);
        }
      }
      applyFilters();
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
      })} fixed label="Clash List (0)" icon=${appIcons.CLASH}>
      <div style="display: flex; flex-direction: column; gap: 0.5rem; height: 100%;">
        <div style="display: flex; gap: 0.5rem; flex-shrink: 0; align-items: center; position: relative; z-index: 10;">
          <div style="display: flex; gap: 0.25rem; flex: 1;">
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
            <bim-label ${BUI.ref(e => clashValueLabel = e as BUI.Label)} style="white-space: nowrap; margin: 0 0.25rem;">
              ${cachedClashMode === "Hard" ? "Tolerance (m)" : "Clearance (m)"}
            </bim-label>
            <bim-text-input 
              ${BUI.ref((e) => { 
                clashValueInput = e as BUI.TextInput; 
                if (clashValueInput) { clashValueInput.value = cachedClashValue; }
              })} 
              @input=${(e: Event) => { cachedClashValue = (e.target as BUI.TextInput).value; }} type="number" style="width: 60px; flex-shrink: 0;"></bim-text-input>
            <bim-label style="white-space: nowrap; margin: 0 0.25rem;">Group Dist. (m)</bim-label>
            <bim-text-input 
              ${BUI.ref((e) => { 
                groupDistInput = e as BUI.TextInput; 
                if (groupDistInput) { groupDistInput.value = cachedGroupDistance; }
              })} 
              @input=${(e: Event) => { 
                cachedGroupDistance = (e.target as BUI.TextInput).value; 
                applyFilters();
              }} type="number" style="width: 60px; flex-shrink: 0;" title="근접한 간섭 마커를 하나로 묶을 반경 거리 (m)"></bim-text-input>
            <bim-button label="Run Clash" icon=${appIcons.CLASH} @click=${runClash} style="flex: 1; background-color: var(--bim-ui_main-base); color: var(--bim-ui_main-contrast); font-weight: bold;"></bim-button>
            <bim-button ${BUI.ref(e => markerBtn = e as BUI.Button)} label="Markers" ?active=${isMarkersVisible} icon=${appIcons.MAP} @click=${toggleMarkers} style="flex: 1;"></bim-button>
            <bim-button ${BUI.ref(e => deleteBtn = e as BUI.Button)} label="Delete" icon=${appIcons.DELETE} @click=${onDeleteSelected} disabled style="flex: 1;"></bim-button>
            <bim-button label="Clear" icon=${appIcons.CLEAR} @click=${onClearAll} style="flex: 1;"></bim-button>
            <bim-button label="To Topic" icon=${appIcons.SAVE} @click=${saveAllToTopics} style="flex: 1;"></bim-button>
          </div>
          <div style="display: flex; gap: 0.25rem; flex: 1; align-items: center;">
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
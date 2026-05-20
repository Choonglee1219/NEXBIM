import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../../globals";
import { Highlighter } from "../../Highlighter";
import { getDiscipline } from "./clash-grouping";

export interface ClashMatrixState {
  components: OBC.Components;
  clashData?: any[];
  allCategories?: string[];
  activeExclusions?: Set<string>;
  onCellClicked?: (clashRows: any[] | null) => void;
  onExcludeToggled?: (pairs: [string, string][]) => void;
}

// 리렌더링 시 상태 유지를 위한 모듈 레벨 변수
let selectedCell: { c1: string, c2: string } | null = null;
let matrixViewMode: string = "Entity";
let currentSortedItems: string[] = [];
let currentClashMatrix: Record<string, Record<string, number>> = {};
let currentTable: BUI.Table<any> | null = null;
let selectionLabel: any = null;

// 수동으로 Discipline 정렬 순서를 지정 (배열에 맞춰 정렬되며 ETC는 항상 맨 끝)
const disciplineOrder = ["STRUC", "ARCH", "MECH", "ELEC", "PIPE"];
const getRank = (item: string) => {
  if (item === "ETC") return 1000; // ETC는 무조건 가장 마지막
  const idx = disciplineOrder.indexOf(item);
  return idx === -1 ? 999 : idx; // 목록에 없는 분야는 ETC 바로 앞에 배치
};

export const clashMatrixTemplate: BUI.StatefullComponent<ClashMatrixState> = (state) => {
  const { components, clashData = [], allCategories = [], activeExclusions = new Set() } = state;
  const highlighter = components.get(Highlighter);

  const hasData = (clashData && clashData.length > 0) || (allCategories && allCategories.length > 0);

  const updateTable = (animate: boolean = false) => {
    if (!currentTable || !hasData) return;
    const table = currentTable;

    if (animate) {
      table.style.animation = "none";
      void table.offsetHeight; // Reflow를 강제 발생시켜 애니메이션 초기화
      table.style.animation = "matrixFadeIn 0.3s ease-out";
    }

    // 숨겨둔 카테고리 데이터가 오른쪽 끝에 자동 생성되는 현상 방지
    table.hiddenColumns = ["_Category"];

    const clashItemsMap: Record<string, Record<string, OBC.ModelIdMap>> = {};
    const clashMatrix: Record<string, Record<string, number>> = {};
    const clashDataMap: Record<string, Record<string, any[]>> = {};
    const itemsSet = new Set<string>();

    // O(1) 매칭을 위해 각 분야별 포함된 카테고리를 사전에 그룹화 해둡니다 (속도 최적화)
    const catsByDiscipline: Record<string, string[]> = {};
    for (const cat of allCategories) {
      const disc = getDiscipline(cat);
      if (!catsByDiscipline[disc]) catsByDiscipline[disc] = [];
      catsByDiscipline[disc].push(cat);
    }

    if (matrixViewMode === "Entity") {
      for (const cat of allCategories) itemsSet.add(cat);
    } else {
      for (const cat of allCategories) itemsSet.add(getDiscipline(cat));
    }

    for (const row of clashData) {
      const d = row.data;
      if (!d || !d.raw) continue;

      let cat1 = d.Entity1 || "Unknown";
      let cat2 = d.Entity2 || "Unknown";
      const res = d.raw;

      let key1 = matrixViewMode === "Entity" ? cat1 : getDiscipline(cat1);
      let key2 = matrixViewMode === "Entity" ? cat2 : getDiscipline(cat2);

      if (key1 > key2) {
        [key1, key2] = [key2, key1];
        [cat1, cat2] = [cat2, cat1];
      } else if (key1 === key2 && cat1 > cat2) {
        [cat1, cat2] = [cat2, cat1];
      }

      itemsSet.add(key1);
      itemsSet.add(key2);

      if (!clashMatrix[key1]) clashMatrix[key1] = {};
      clashMatrix[key1][key2] = (clashMatrix[key1][key2] || 0) + 1;
      
      if (!clashItemsMap[key1]) clashItemsMap[key1] = {};
      if (!clashItemsMap[key1][key2]) clashItemsMap[key1][key2] = {};
      
      if (!clashItemsMap[key1][key2][res.id1.modelId]) clashItemsMap[key1][key2][res.id1.modelId] = new Set();
      clashItemsMap[key1][key2][res.id1.modelId].add(res.id1.expressID);

      if (!clashItemsMap[key1][key2][res.id2.modelId]) clashItemsMap[key1][key2][res.id2.modelId] = new Set();
      clashItemsMap[key1][key2][res.id2.modelId].add(res.id2.expressID);

      if (!clashDataMap[key1]) clashDataMap[key1] = {};
      if (!clashDataMap[key1][key2]) clashDataMap[key1][key2] = [];
      clashDataMap[key1][key2].push(row.data);
    }

    const sortedItems = Array.from(itemsSet).sort((a, b) => {
      if (matrixViewMode === "Entity") {
        const discA = getDiscipline(a);
        const discB = getDiscipline(b);
        if (discA !== discB) {
          const rankA = getRank(discA);
          const rankB = getRank(discB);
          if (rankA !== rankB) return rankA - rankB;
          return discA.localeCompare(discB);
        }
        return a.localeCompare(b);
      }
      const rankA = getRank(a);
      const rankB = getRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b);
    });

    currentSortedItems = sortedItems;
    currentClashMatrix = clashMatrix;

    // 카테고리 갯수에 비례하여 테이블의 전체 최소 너비 설정 (횡 스크롤 유도)
    table.style.minWidth = `calc(${sortedItems.length * 3.6}rem + 3rem)`;

    table.columns = [
      ...sortedItems.map(item => ({ name: item, width: "3.5rem" }))
    ];

    const onCellClick = async (c1: string, c2: string) => {
      if (selectedCell && selectedCell.c1 === c1 && selectedCell.c2 === c2) {
        selectedCell = null;
        if (selectionLabel) selectionLabel.textContent = "None";
        updateTable(false);
        await highlighter.clear("select");
        if (state.onCellClicked) state.onCellClicked(null);
        return;
      }

      selectedCell = { c1, c2 };
      if (selectionLabel) selectionLabel.textContent = `${c1} vs ${c2}`;
      updateTable(false);

      const items = clashItemsMap[c1]?.[c2];
      if (items && !OBC.ModelIdMapUtils.isEmpty(items)) {
        await highlighter.clear("select");
        await highlighter.highlightByID("select", items);

        const worlds = components.get(OBC.Worlds);
        const world = worlds.list.values().next().value;
        if (world && world.camera instanceof OBC.SimpleCamera) {
          await world.camera.fitToItems(items);
        }
      }

      if (state.onCellClicked) {
        const clashRows = clashDataMap[c1]?.[c2] || null;
        state.onCellClicked(clashRows);
      }
    };

    const dataTransform: Record<string, any> = {};

    for (let j = 0; j < sortedItems.length; j++) {
      const colItem = sortedItems[j];
      dataTransform[colItem] = (value: any, row: any) => {
        const rowItem = row._Category;
        const i = sortedItems.indexOf(rowItem);

        if (j > i) {
          return BUI.html`
            <div title="${rowItem} vs ${colItem}" style="display: flex; width: 100%; height: 100%; min-height: 1.5rem; align-items: center; justify-content: center; background-color: transparent; color: var(--bim-ui_gray-5); font-size: 0.75rem; font-weight: bold; cursor: default; box-sizing: border-box;">
              -
            </div>
          `;
        }

        const c1 = rowItem < colItem ? rowItem : colItem;
        const c2 = rowItem < colItem ? colItem : rowItem;
        
        const count = value as number;
        
        let isExcluded = false;

        if (matrixViewMode === "Entity") {
          isExcluded = activeExclusions.has(`${c1.toUpperCase()}|${c2.toUpperCase()}`) || activeExclusions.has(`${c2.toUpperCase()}|${c1.toUpperCase()}`);
        } else {
          const discKey1 = `${c1.toUpperCase()}|${c2.toUpperCase()}`;
          const discKey2 = `${c2.toUpperCase()}|${c1.toUpperCase()}`;
          
          if (activeExclusions.has(discKey1) || activeExclusions.has(discKey2)) {
            isExcluded = true;
          }
        }

        let displayValue = "-";
        let bgColor = "transparent";
        let textColor = "var(--bim-ui_main-contrast)";
        let cursor = "default";

        if (isExcluded) {
            displayValue = "E";
            bgColor = "#FFC000"; // 노란색
            textColor = "#000000"; // 노란 바탕에 잘 보이도록 검은색 사용
        } else if (count === 0) {
            displayValue = "OK";
            bgColor = "#00B050"; // 초록색
            textColor = "#ffffff";
        } else {
            displayValue = count.toString();
            bgColor = "#C00000"; // 빨간색
            textColor = "#ffffff";
            cursor = "pointer";
        }
        
        const isSelected = selectedCell?.c1 === c1 && selectedCell?.c2 === c2;
        const border = isSelected ? `3px solid #ffffff` : "3px solid transparent";
        
        return BUI.html`
          <div 
            title="${c1} vs ${c2}${selectedCell ? ' (선택 해제 후 우클릭 제외 가능)' : ' (우클릭하여 제외 필터 토글)'}"
            @click=${() => { if (count > 0 && !isExcluded) onCellClick(c1, c2); }}
            @contextmenu=${(e: Event) => {
              e.preventDefault();
              if (selectedCell) return;
              if (state.onExcludeToggled) {
                // 렌더링 시 매번 계산하던 무거운 로직을 우클릭 이벤트 발생 시점으로 지연시켜 즉시 계산
                let pairs: [string, string][] = [];
                if (matrixViewMode === "Entity") {
                  pairs = [[c1, c2]];
                } else {
                  pairs.push([c1, c2]);
                  const cats1 = catsByDiscipline[c1] || [];
                  const cats2 = catsByDiscipline[c2] || [];
                  const uniquePairs = new Set<string>();
                  for (const catA of cats1) {
                    for (const catB of cats2) {
                      const key1 = `${catA.toUpperCase()}|${catB.toUpperCase()}`;
                      const key2 = `${catB.toUpperCase()}|${catA.toUpperCase()}`;
                      if (!uniquePairs.has(key1) && !uniquePairs.has(key2)) {
                        uniquePairs.add(key1);
                        uniquePairs.add(key2);
                        pairs.push([catA, catB]);
                      }
                    }
                  }
                }
                
                if (pairs.length > 0) {
                  state.onExcludeToggled(pairs);
                }
              }
            }}
            style="display: flex; width: 100%; height: 100%; min-height: 1.5rem; align-items: center; justify-content: center; background-color: ${bgColor}; color: ${textColor}; font-size: 0.75rem; font-weight: bold; border-radius: 4px; cursor: ${cursor}; border: ${border}; transition: filter 0.2s, border 0.2s; box-sizing: border-box;"
            onmouseover="this.style.filter='brightness(1.2)'" onmouseout="this.style.filter='none'">
            ${displayValue}
          </div>
        `;
      };
    }
    
    table.dataTransform = dataTransform;

    const tableData = sortedItems.map((rowItem, i) => {
      const row: any = { _Category: rowItem };
      for (let j = 0; j < sortedItems.length; j++) {
        const colItem = sortedItems[j];
        const c1 = rowItem < colItem ? rowItem : colItem;
        const c2 = rowItem < colItem ? colItem : rowItem;
        row[colItem] = j > i ? "-" : (clashMatrix[c1]?.[c2] || 0);
      }
      return { data: row };
    });

    table.data = tableData;
  };
  
  const onTableCreated = (el?: Element) => {
    if (!el || !hasData) return;
    if (currentTable !== el) {
      currentTable = el as BUI.Table<any>;
      updateTable(true);
    }
  };

  // 컴포넌트 렌더링 시 최신 상태를 기반으로 테이블을 확실하게 업데이트 (UI 멈춤 방지)
  setTimeout(() => {
    if (currentTable && hasData) {
      updateTable(false);
    }
  }, 0);

  const onExportCSV = () => {
    if (!currentSortedItems.length) {
      alert("내보낼 데이터가 없습니다.");
      return;
    }

    const headers = ["Category", ...currentSortedItems];
    const csvRows = [headers.join(",")];

    for (let i = 0; i < currentSortedItems.length; i++) {
      const rowItem = currentSortedItems[i];
      const rowValues = [rowItem];

      for (let j = 0; j < currentSortedItems.length; j++) {
        const colItem = currentSortedItems[j];
        
        if (j > i) {
          rowValues.push("-");
        } else {
          const c1 = rowItem < colItem ? rowItem : colItem;
          const c2 = rowItem < colItem ? colItem : rowItem;
          
          const count = currentClashMatrix[c1]?.[c2] || 0;

          let isExcluded = false;
          if (matrixViewMode === "Entity") {
            isExcluded = activeExclusions.has(`${c1.toUpperCase()}|${c2.toUpperCase()}`) || activeExclusions.has(`${c2.toUpperCase()}|${c1.toUpperCase()}`);
          } else {
            const discKey1 = `${c1.toUpperCase()}|${c2.toUpperCase()}`;
            const discKey2 = `${c2.toUpperCase()}|${c1.toUpperCase()}`;
            if (activeExclusions.has(discKey1) || activeExclusions.has(discKey2)) {
              isExcluded = true;
            }
          }

          if (isExcluded) rowValues.push("Excluded");
          else if (count === 0) rowValues.push("0");
          else rowValues.push(count.toString());
        }
      }
      csvRows.push(rowValues.join(","));
    }

    // UTF-8 BOM을 추가하여 엑셀에서 한글 깨짐 방지
    const csvString = "\uFEFF" + csvRows.join("\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clash_matrix.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onMatrixModeChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    matrixViewMode = target.value;
    updateTable(true);
  };

  return BUI.html`
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%; padding: 0.5rem; box-sizing: border-box; overflow: hidden;">
      <style>
        /* That Open UI 느낌의 얇고 모던한 커스텀 스크롤바 */
        .matrix-scroll-wrapper::-webkit-scrollbar {
          height: 8px;
          width: 8px;
        }
        .matrix-scroll-wrapper::-webkit-scrollbar-track {
          background: var(--bim-ui_bg-base);
          border-radius: 4px;
        }
        .matrix-scroll-wrapper::-webkit-scrollbar-thumb {
          background: var(--bim-ui_bg-contrast-20);
          border-radius: 4px;
        }
        .matrix-scroll-wrapper::-webkit-scrollbar-thumb:hover {
          background: var(--bim-ui_bg-contrast-40);
        }
        @keyframes matrixFadeIn {
          0% { opacity: 0.5; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      </style>
      <bim-label style="text-align: center; padding: 1rem; color: var(--bim-ui_gray-5); display: ${hasData ? 'none' : 'block'};">
        ${hasData ? '' : 'Waiting for clash data...'}
      </bim-label>
      <div style="display: ${hasData ? 'flex' : 'none'}; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding: 0.25rem 0.5rem; background-color: var(--bim-ui_bg-contrast-10); border-radius: 4px; flex-shrink: 0;">
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <bim-label style="font-size: 0.75rem; color: var(--bim-ui_gray-10); margin: 0; font-weight: normal; margin-right: 0.25rem;">Clash Matrix :</bim-label>
          <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer;">
            <input type="radio" name="matrixMode" value="Entity" ?checked=${matrixViewMode === "Entity"} @change=${onMatrixModeChange} style="margin: 0; cursor: pointer; accent-color: var(--bim-ui_main-base);">
            <bim-label style="pointer-events: none; margin: 0; font-size: 0.75rem;">Entity</bim-label>
          </label>
          <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer; margin-left: 0.25rem;">
            <input type="radio" name="matrixMode" value="Discipline" ?checked=${matrixViewMode === "Discipline"} @change=${onMatrixModeChange} style="margin: 0; cursor: pointer; accent-color: var(--bim-ui_main-base);">
            <bim-label style="pointer-events: none; margin: 0; font-size: 0.75rem;">Discipline</bim-label>
          </label>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <bim-label ${BUI.ref(e => selectionLabel = e)} style="color: var(--bim-ui_main-contrast); margin: 0;">${selectedCell ? `${selectedCell.c1} vs ${selectedCell.c2}` : "None"}</bim-label>
          <bim-button @click=${onExportCSV} icon=${appIcons.EXPORT} tooltip-title="Export to CSV"></bim-button>
        </div>
      </div>
      <div class="matrix-scroll-wrapper" style="${hasData ? 'flex: 1; min-height: 0; display: flex; flex-direction: column;' : 'display: none;'} overflow-x: auto; overflow-y: hidden; padding-bottom: 0.25rem;">
        <bim-table style="flex: 1; min-height: 0;" headers-hidden no-indentation
          ${BUI.ref(onTableCreated)}
        ></bim-table>
      </div>
    </div>
  `;
};

export const clashMatrix = (state: ClashMatrixState) => {
  return BUI.Component.create<HTMLDivElement, ClashMatrixState>(clashMatrixTemplate, state);
};

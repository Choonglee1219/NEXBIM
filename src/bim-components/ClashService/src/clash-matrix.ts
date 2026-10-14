import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, createModalDialog } from "../../../globals";
import { Highlighter } from "../../Highlighter";
import { getDiscipline } from "./clash-grouping";

export interface ClashMatrixState {
  components: OBC.Components;
  clashData?: any[];
  allCategories?: string[];
  onCellClicked?: (clashRows: any[] | null) => void;
  onBadgeChanged?: (pairs: [string, string][], badge: string) => void;
}

// 리렌더링 시 상태 유지를 위한 모듈 레벨 변수
let selectedCell: { c1: string, c2: string } | null = null;
let selectedCellEl: HTMLElement | null = null;
let matrixLevel: 1 | 2 | 3 = 2; // 1: Discipline, 2: Entity, 3: PredefinedType
let matrixViewMode: string = "Entity";
let currentSortedItems: string[] = [];
let currentClashMatrix: Record<string, Record<string, number>> = {};
let currentTable: BUI.Table<any> | null = null;
let currentClashDataMap: Record<string, Record<string, any[]>> = {};
let selectionLabel: any = null;
let activeMatrixDialog: HTMLDialogElement | null = null;
let currentMatrixComponent: HTMLDivElement | null = null;
let currentUpdateTableFn: ((animate?: boolean) => void) | null = null;

export const openClashMatrixModal = () => {
  if (activeMatrixDialog && activeMatrixDialog.open) {
    activeMatrixDialog.focus();
    return;
  }

  const { dialog, contentContainer } = createModalDialog({
    title: "Clash Matrix",
    icon: appIcons.TABLE,
    width: "95vw",
    height: "95vh",
    maxWidth: "1600px",
    maxHeight: "1200px",
    onClose: () => {
      activeMatrixDialog = null;
      if (currentMatrixComponent && currentMatrixComponent.parentElement) {
        currentMatrixComponent.remove();
      }
    },
  });

  activeMatrixDialog = dialog;

  const style = document.createElement("style");
  style.textContent = `
    .matrix-scroll-wrapper bim-table {
      --bim-ui_size-16xl: 1.85rem;
    }
    .matrix-scroll-wrapper bim-table::part(cell) { overflow: visible !important; }
  `;
  dialog.appendChild(style);

  if (currentMatrixComponent) {
    currentMatrixComponent.style.width = "100%";
    currentMatrixComponent.style.height = "100%";
    currentMatrixComponent.style.flex = "1";
    currentMatrixComponent.style.display = "flex";
    currentMatrixComponent.style.flexDirection = "column";
    currentMatrixComponent.style.minHeight = "0";
    currentMatrixComponent.style.overflow = "hidden";
    contentContainer.appendChild(currentMatrixComponent);
  }

  document.body.appendChild(dialog);
  dialog.showModal();

  setTimeout(() => {
    if (currentUpdateTableFn) {
      currentUpdateTableFn(false);
    }
  }, 0);
};

// 수동으로 Discipline 정렬 순서를 지정 (배열에 맞춰 정렬되며 ETC는 항상 맨 끝)
const disciplineOrder = ["STRUC", "ARCH", "HVAC", "MECH", "ELEC", "PIPE", "CIVIL"];
const getRank = (item: string) => {
  if (item === "ETC") return 1000; // ETC는 무조건 가장 마지막
  const idx = disciplineOrder.indexOf(item);
  return idx === -1 ? 999 : idx; // 목록에 없는 분야는 ETC 바로 앞에 배치
};

export interface CategoryItemInfo {
  level: 1 | 2 | 3;
  rawKey: string;
  discipline: string;
  entity: string;
  predefinedType: string;
  fullPath: string;
}

const disciplineColors: Record<string, { bg: string; text: string; border: string }> = {
  STRUC: { bg: "rgba(51, 154, 240, 0.15)", text: "#74c0fc", border: "rgba(51, 154, 240, 0.4)" },
  ARCH:  { bg: "rgba(204, 93, 232, 0.15)", text: "#da77f2", border: "rgba(204, 93, 232, 0.4)" },
  HVAC:  { bg: "rgba(32, 201, 151, 0.15)", text: "#63e6be", border: "rgba(32, 201, 151, 0.4)" },
  MECH:  { bg: "rgba(255, 146, 43, 0.15)", text: "#ffa94d", border: "rgba(255, 146, 43, 0.4)" },
  ELEC:  { bg: "rgba(252, 196, 25, 0.15)", text: "#ffe066", border: "rgba(252, 196, 25, 0.4)" },
  PIPE:  { bg: "rgba(81, 207, 102, 0.15)", text: "#8ce99a", border: "rgba(81, 207, 102, 0.4)" },
  CIVIL: { bg: "rgba(132, 94, 247, 0.15)", text: "#b197fc", border: "rgba(132, 94, 247, 0.4)" },
  ETC:   { bg: "rgba(134, 142, 150, 0.15)", text: "#adb5bd", border: "rgba(134, 142, 150, 0.4)" },
};

const getDisciplineStyle = (disc: string) => {
  return disciplineColors[disc] || disciplineColors.ETC;
};

export interface CellStatus {
  badge: "New" | "Hold" | "Exclude";
  text: string;
  bg: string;
  color: string;
  cursor: string;
}

const getCellStatus = (count: number, cellItems?: any[]): CellStatus => {
  let badge: "New" | "Hold" | "Exclude" = "New";
  if (cellItems && cellItems.length > 0) {
    const hasNew = cellItems.some(item => ((item.raw && item.raw.badge) || item.Badge || "New") === "New");
    if (hasNew) {
      badge = "New";
    } else {
      const hasHold = cellItems.some(item => ((item.raw && item.raw.badge) || item.Badge || "New") === "Hold");
      badge = hasHold ? "Hold" : "Exclude";
    }
  }

  if (count === 0) {
    return { badge, text: "OK", bg: "hsl(147, 65%, 40%)", color: "#ffffff", cursor: "default" };
  }
  if (badge === "Exclude") {
    return { badge, text: "E", bg: "hsl(205, 65%, 40%)", color: "#ffffff", cursor: "default" };
  }
  if (badge === "Hold") {
    return { badge, text: "H", bg: "hsl(45, 65%, 40%)", color: "#ffffff", cursor: "pointer" };
  }
  return { badge, text: count.toString(), bg: "hsl(0, 65%, 40%)", color: "#ffffff", cursor: "pointer" };
};

const renderDisciplineBadge = (disc: string, isVertical = false) => {
  const style = getDisciplineStyle(disc);
  const padding = isVertical ? "4px 2px" : "1px 6px";
  const margin = isVertical ? "margin-bottom: 6px;" : "";
  return BUI.html`
    <span style="display: inline-flex; align-items: center; justify-content: center; padding: ${padding}; font-size: 0.58rem; font-weight: 700; border-radius: 3px; background-color: ${style.bg}; color: ${style.text}; border: 1px solid ${style.border}; ${margin} letter-spacing: 0.5px; flex-shrink: 0;">
      ${disc}
    </span>
  `;
};

const compareMatrixItems = (a: string, b: string, level: 1 | 2 | 3): number => {
  const infoA = parseItemInfo(a, level);
  const infoB = parseItemInfo(b, level);

  if (infoA.discipline !== infoB.discipline) {
    const rankDiff = getRank(infoA.discipline) - getRank(infoB.discipline);
    return rankDiff !== 0 ? rankDiff : infoA.discipline.localeCompare(infoB.discipline);
  }

  if (level >= 2 && infoA.entity !== infoB.entity) {
    return infoA.entity.localeCompare(infoB.entity);
  }

  if (level === 3) {
    return infoA.predefinedType.localeCompare(infoB.predefinedType);
  }

  return 0;
};

const openMatrixContextMenu = (
  e: MouseEvent,
  c1: string,
  c2: string,
  matrixLevel: 1 | 2 | 3,
  catsByDiscipline: Record<string, string[]>,
  onBadgeChanged?: (pairs: [string, string][], badge: string) => void
) => {
  e.preventDefault();
  if (selectedCell || !onBadgeChanged) return;

  const existingMenu = document.getElementById("clash-matrix-context-menu");
  if (existingMenu) existingMenu.remove();

  const menu = document.createElement("div");
  menu.id = "clash-matrix-context-menu";
  menu.style.position = "fixed";
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = "9999";
  menu.style.background = "var(--bim-ui_bg-base)";
  menu.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
  menu.style.borderRadius = "4px";
  menu.style.boxShadow = "0 2px 10px rgba(0,0,0,0.5)";
  menu.style.display = "flex";
  menu.style.flexDirection = "column";
  menu.style.overflow = "hidden";

  const options = [
    { label: "New", value: "New", color: "hsl(0, 65%, 40%)" },
    { label: "Hold", value: "Hold", color: "hsl(45, 65%, 40%)" },
    { label: "Exclude", value: "Exclude", color: "hsl(205, 65%, 40%)" }
  ];

  options.forEach(opt => {
    const btn = document.createElement("bim-button") as any;
    btn.label = opt.label;
    btn.style.color = opt.color;
    btn.style.setProperty("--bim-ui_bg-contrast-100", opt.color);
    btn.style.margin = "0";
    btn.style.borderRadius = "0";
    btn.style.borderBottom = "1px solid var(--bim-ui_bg-contrast-20)";
    btn.style.background = "transparent";
    btn.style.width = "100px";

    btn.onmouseover = () => btn.style.background = "var(--bim-ui_bg-contrast-20)";
    btn.onmouseout = () => btn.style.background = "transparent";

    btn.addEventListener("click", () => {
      let pairs: [string, string][] = [];
      if (matrixLevel === 2 || matrixLevel === 3) {
        pairs = [[c1, c2]];
      } else {
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
        onBadgeChanged(pairs, opt.value);
      }
      menu.remove();
    });
    menu.appendChild(btn);
  });

  const targetContainer = currentTable?.closest("dialog") || document.body;
  targetContainer.appendChild(menu);

  const closeMenu = (evt: Event) => {
    if (!menu.contains(evt.target as Node)) {
      menu.remove();
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("contextmenu", closeMenu);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", closeMenu);
    document.addEventListener("contextmenu", closeMenu);
  }, 0);
};

const parseItemInfo = (key: string, level: 1 | 2 | 3): CategoryItemInfo => {
  if (level === 1) {
    return {
      level: 1,
      rawKey: key,
      discipline: key,
      entity: "",
      predefinedType: "",
      fullPath: key,
    };
  } else if (level === 2) {
    const disc = getDiscipline(key);
    return {
      level: 2,
      rawKey: key,
      discipline: disc,
      entity: key,
      predefinedType: "",
      fullPath: `[${disc}] ${key}`,
    };
  } else {
    const [entity, pt = "NOTDEFINED"] = key.split("__");
    const disc = getDiscipline(entity);
    return {
      level: 3,
      rawKey: key,
      discipline: disc,
      entity,
      predefinedType: pt,
      fullPath: `[${disc}] ${entity} > ${pt}`,
    };
  }
};

export const clashMatrixTemplate: BUI.StatefullComponent<ClashMatrixState> = (state) => {
  const { components, clashData = [], allCategories = [] } = state;
  const highlighter = components.get(Highlighter);

  const hasData = (clashData && clashData.length > 0) || (allCategories && allCategories.length > 0);

  const updateTable = (animate: boolean = false) => {
    if (!currentTable) return;
    const table = currentTable;

    if (!(table as any)._hasMatrixListeners) {
      (table as any)._hasMatrixListeners = true;
      table.style.setProperty("--bim-ui_size-16xl", "1.85rem");
      table.addEventListener("cellcreated", (e: any) => {
        const cell = e.detail?.cell;
        if (cell) {
          cell.style.padding = "2px 3px";
          cell.style.overflow = "visible";
          const headerType = cell.rowData?._headerType;
          if (headerType === "DISC") {
            cell.style.minHeight = "48px";
            cell.style.height = "48px";
          } else if (headerType === "ENTITY") {
            cell.style.minHeight = "75px";
            cell.style.height = "75px";
          } else if (headerType === "TYPE") {
            cell.style.minHeight = "75px";
            cell.style.height = "75px";
          } else {
            cell.style.minHeight = "1.85rem";
            cell.style.height = "1.85rem";
          }
        }
      });
      table.addEventListener("rowcreated", (e: any) => {
        const row = e.detail?.row;
        if (row && !row.isHeader) {
          const headerType = row.data?._headerType;
          if (headerType === "DISC") {
            row.style.minHeight = "48px";
            row.style.height = "48px";
          } else if (headerType === "ENTITY") {
            row.style.minHeight = "75px";
            row.style.height = "75px";
          } else if (headerType === "TYPE") {
            row.style.minHeight = "75px";
            row.style.height = "75px";
          } else {
            row.style.minHeight = "1.85rem";
            row.style.height = "1.85rem";
          }
        }
      });
    }

    // 데이터가 비워졌을 때 내부 캐시와 테이블을 확실하게 초기화합니다.
    if (!hasData) {
      table.data = [];
      table.columns = [];
      table.dataTransform = {};
      currentSortedItems = [];
      currentClashMatrix = {};
      currentClashDataMap = {};
      selectedCell = null;
      if (selectionLabel) selectionLabel.textContent = "None";
      highlighter.clear("select");
      return;
    }

    if (animate) {
      table.style.animation = "none";
      void table.offsetHeight; // Reflow를 강제 발생시켜 애니메이션 초기화
      table.style.animation = "matrixFadeIn 0.3s ease-out";
    }

    // 숨겨둔 내부 데이터가 오른쪽 끝에 자동 컬럼으로 생성되는 현상 완전 방지
    table.hiddenColumns = ["_rowItem", "_headerType", "_Category", "_itemKey", "_rowInfo"];

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

    // 3수준(PredefinedType) 구성을 위해 clashData에 존재하는 엔티티별 PredefinedType 수집
    const entityPredefinedTypes = new Map<string, Set<string>>();
    if (matrixLevel === 3) {
      for (const row of clashData) {
        const d = row.data;
        if (!d) continue;
        const c1 = d.Entity1;
        const c2 = d.Entity2;
        const rawPt1 = d.PredefinedType1 || (d.raw?.id1 as any)?.predefinedType;
        const rawPt2 = d.PredefinedType2 || (d.raw?.id2 as any)?.predefinedType;
        const pt1 = (!rawPt1 || rawPt1 === "$" || rawPt1 === "*") ? "NOTDEFINED" : String(rawPt1).trim().toUpperCase();
        const pt2 = (!rawPt2 || rawPt2 === "$" || rawPt2 === "*") ? "NOTDEFINED" : String(rawPt2).trim().toUpperCase();
        if (c1 && c1 !== "Unknown") {
          if (!entityPredefinedTypes.has(c1)) entityPredefinedTypes.set(c1, new Set());
          entityPredefinedTypes.get(c1)!.add(pt1);
        }
        if (c2 && c2 !== "Unknown") {
          if (!entityPredefinedTypes.has(c2)) entityPredefinedTypes.set(c2, new Set());
          entityPredefinedTypes.get(c2)!.add(pt2);
        }
      }
    }

    if (matrixLevel === 2) {
      for (const cat of allCategories) itemsSet.add(cat);
    } else if (matrixLevel === 1) {
      for (const cat of allCategories) itemsSet.add(getDiscipline(cat));
    } else if (matrixLevel === 3) {
      for (const cat of allCategories) {
        const pts = entityPredefinedTypes.get(cat);
        if (pts && pts.size > 0) {
          for (const pt of pts) itemsSet.add(`${cat}__${pt}`);
        } else {
          itemsSet.add(`${cat}__NOTDEFINED`);
        }
      }
      for (const [entity, pts] of entityPredefinedTypes.entries()) {
        for (const pt of pts) itemsSet.add(`${entity}__${pt}`);
      }
    }

    for (const row of clashData) {
      const d = row.data;
      if (!d || !d.raw) continue;

      let cat1 = d.Entity1 || "Unknown";
      let cat2 = d.Entity2 || "Unknown";
      let rawPt1 = d.PredefinedType1 || (d.raw?.id1 as any)?.predefinedType;
      let rawPt2 = d.PredefinedType2 || (d.raw?.id2 as any)?.predefinedType;
      let pt1 = (!rawPt1 || rawPt1 === "$" || rawPt1 === "*") ? "NOTDEFINED" : String(rawPt1).trim().toUpperCase();
      let pt2 = (!rawPt2 || rawPt2 === "$" || rawPt2 === "*") ? "NOTDEFINED" : String(rawPt2).trim().toUpperCase();
      const res = d.raw;

      let key1 = matrixLevel === 2 ? cat1 : (matrixLevel === 1 ? getDiscipline(cat1) : `${cat1}__${pt1}`);
      let key2 = matrixLevel === 2 ? cat2 : (matrixLevel === 1 ? getDiscipline(cat2) : `${cat2}__${pt2}`);

      if (key1 > key2) {
        [key1, key2] = [key2, key1];
        [cat1, cat2] = [cat2, cat1];
        [pt1, pt2] = [pt2, pt1];
      } else if (key1 === key2 && cat1 > cat2) {
        [cat1, cat2] = [cat2, cat1];
        [pt1, pt2] = [pt2, pt1];
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

    const sortedItems = Array.from(itemsSet).sort((a, b) => compareMatrixItems(a, b, matrixLevel));

    currentSortedItems = sortedItems;
    currentClashMatrix = clashMatrix;
    currentClashDataMap = clashDataMap;

    const headerCols: { name: string; width: string }[] = [];
    let totalHeaderColWidth = 0;

    if (matrixLevel === 3) {
      headerCols.push({ name: "_Cat_Type", width: "7.5rem" });
      headerCols.push({ name: "_Cat_Entity", width: "7rem" });
      headerCols.push({ name: "_Cat_Disc", width: "5rem" });
      totalHeaderColWidth = 19.5;
    } else if (matrixLevel === 2) {
      headerCols.push({ name: "_Cat_Entity", width: "7.5rem" });
      headerCols.push({ name: "_Cat_Disc", width: "5rem" });
      totalHeaderColWidth = 12.5;
    } else {
      headerCols.push({ name: "_Cat_Disc", width: "5.5rem" });
      totalHeaderColWidth = 5.5;
    }

    // 카테고리 갯수 및 헤더 열 너비에 비례하여 테이블의 전체 최소 너비 설정 (횡 스크롤 유도)
    table.style.minWidth = `calc(${sortedItems.length * 3.6}rem + ${totalHeaderColWidth}rem)`;

    table.columns = [
      ...sortedItems.map(item => ({ name: item, width: "3.5rem" })),
      ...headerCols,
    ];

    const updateSelectionLabel = () => {
      if (!selectionLabel) return;
      if (!selectedCell) {
        selectionLabel.textContent = "None";
        return;
      }
      const info1 = parseItemInfo(selectedCell.c1, matrixLevel);
      const info2 = parseItemInfo(selectedCell.c2, matrixLevel);
      selectionLabel.textContent = `${info1.fullPath} vs ${info2.fullPath}`;
    };

    const onCellClick = async (c1: string, c2: string, e?: MouseEvent) => {
      const isAlreadySelected = selectedCell && selectedCell.c1 === c1 && selectedCell.c2 === c2;

      // 이전 선택된 셀 테두리 복원 (인라인 스타일 및 클래스 원복)
      if (selectedCellEl) {
        selectedCellEl.style.border = "3px solid transparent";
        selectedCellEl.classList.remove("matrix-cell-selected");
        selectedCellEl = null;
      }

      if (isAlreadySelected) {
        selectedCell = null;
        updateSelectionLabel();
        await highlighter.clear("select");
        if (state.onCellClicked) state.onCellClicked(null);
        return;
      }

      selectedCell = { c1, c2 };
      updateSelectionLabel();

      // 클릭된 엘리먼트에 직접 3px 흰색 테두리 즉각 적용 (Shadow DOM 제약 없이 0ms 즉시 하이라이트)
      const targetEl = (e?.currentTarget as HTMLElement) || (e?.target as HTMLElement)?.closest("[data-matrix-cell]") as HTMLElement | null;
      if (targetEl) {
        targetEl.style.border = "3px solid #ffffff";
        targetEl.classList.add("matrix-cell-selected");
        selectedCellEl = targetEl;
      }

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

    dataTransform["_Cat_Disc"] = (value: any, row: any) => {
      if (row._headerType) {
        return BUI.html`<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 0.6rem; color: var(--bim-ui_gray-10); font-weight: 600;">${row._headerType === "DISC" ? "Discipline" : ""}</div>`;
      }
      const disc = value || "ETC";
      return BUI.html`
        <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 1.85rem; padding: 0 4px; box-sizing: border-box;" title="[${disc}]">
          ${renderDisciplineBadge(disc)}
        </div>
      `;
    };

    dataTransform["_Cat_Entity"] = (value: any, row: any) => {
      if (row._headerType) {
        return BUI.html`<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 0.6rem; color: var(--bim-ui_gray-10); font-weight: 600;">${row._headerType === "ENTITY" ? "Entity" : ""}</div>`;
      }
      return BUI.html`
        <div style="display: flex; align-items: center; justify-content: flex-start; width: 100%; height: 1.85rem; padding: 0 6px; font-size: 0.65rem; color: var(--bim-ui_main-contrast); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-sizing: border-box;" title="${value}">
          ${value}
        </div>
      `;
    };

    dataTransform["_Cat_Type"] = (value: any, row: any) => {
      if (row._headerType) {
        return BUI.html`<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 0.6rem; color: var(--bim-ui_gray-10); font-weight: 600;">${row._headerType === "TYPE" ? "Type" : ""}</div>`;
      }
      return BUI.html`
        <div style="display: flex; align-items: center; justify-content: flex-start; width: 100%; height: 1.85rem; padding: 0 6px; font-size: 0.65rem; color: var(--bim-ui_main-contrast); font-weight: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-sizing: border-box;" title="${value}">
          ${value}
        </div>
      `;
    };

    for (let j = 0; j < sortedItems.length; j++) {
      const colItem = sortedItems[j];
      const colInfo = parseItemInfo(colItem, matrixLevel);

      dataTransform[colItem] = (value: any, row: any) => {
        if (row._headerType) {
          if (row._headerType === "DISC") {
            return BUI.html`
              <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 48px; padding: 4px 1px; box-sizing: border-box; writing-mode: vertical-rl; white-space: nowrap; overflow: hidden;" title="[${colInfo.discipline}]">
                ${renderDisciplineBadge(colInfo.discipline, true)}
              </div>
            `;
          } else if (row._headerType === "ENTITY") {
            return BUI.html`
              <div style="display: flex; align-items: center; justify-content: flex-start; width: 100%; height: 75px; padding-top: 6px; padding-bottom: 4px; box-sizing: border-box; font-size: 0.65rem; font-weight: 500; color: var(--bim-ui_main-contrast); writing-mode: vertical-rl; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${colInfo.entity}">
                ${colInfo.entity}
              </div>
            `;
          } else if (row._headerType === "TYPE") {
            return BUI.html`
              <div style="display: flex; align-items: center; justify-content: flex-start; width: 100%; height: 75px; padding-top: 6px; padding-bottom: 4px; box-sizing: border-box; font-size: 0.65rem; font-weight: normal; color: var(--bim-ui_gray-10); writing-mode: vertical-rl; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${colInfo.predefinedType}">
                ${colInfo.predefinedType}
              </div>
            `;
          }
        }

        const rowItem = row._rowItem;
        const i = sortedItems.indexOf(rowItem);

        if (j > i) {
          const infoRow = parseItemInfo(rowItem, matrixLevel);
          return BUI.html`
            <div title="${infoRow.fullPath} vs ${colInfo.fullPath}" style="display: flex; width: 100%; height: 1.55rem; min-height: 1.55rem; max-height: 1.55rem; align-items: center; justify-content: center; background-color: transparent; color: var(--bim-ui_gray-5); font-size: 0.65rem; font-weight: normal; cursor: default; box-sizing: border-box;">
              -
            </div>
          `;
        }

        const c1 = rowItem < colItem ? rowItem : colItem;
        const c2 = rowItem < colItem ? colItem : rowItem;
        const count = value as number;
        const cellItems = clashDataMap[c1]?.[c2];
        const status = getCellStatus(count, cellItems);

        const isSelected = selectedCell?.c1 === c1 && selectedCell?.c2 === c2;
        const border = isSelected ? `3px solid #ffffff` : "3px solid transparent";
        const selectedClass = isSelected ? "matrix-cell-selected" : "";

        const info1 = parseItemInfo(c1, matrixLevel);
        const info2 = parseItemInfo(c2, matrixLevel);
        const tooltipTitle = `${info1.fullPath} vs ${info2.fullPath}${selectedCell ? ' (선택 해제 후 상태 변경 가능)' : ' (우클릭하여 상태 변경 메뉴 호출)'}`;

        return BUI.html`
          <div 
            ${BUI.ref((el) => { if (isSelected && el) selectedCellEl = el as HTMLElement; })}
            data-matrix-cell="${c1}|${c2}"
            class="${selectedClass}"
            title="${tooltipTitle}"
            @click=${(e: MouseEvent) => { if (count > 0 && status.badge !== "Exclude") onCellClick(c1, c2, e); }}
            @contextmenu=${(e: MouseEvent) => openMatrixContextMenu(e, c1, c2, matrixLevel, catsByDiscipline, state.onBadgeChanged)}
            style="display: flex; width: 100%; height: 1.55rem; min-height: 1.55rem; max-height: 1.55rem; align-items: center; justify-content: center; background-color: ${status.bg}; color: ${status.color}; font-size: 0.65rem; font-weight: normal; border-radius: 4px; cursor: ${status.cursor}; border: ${border}; transition: filter 0.2s, border 0.2s; box-sizing: border-box;"
            onmouseover="this.style.filter='brightness(1.2)'" onmouseout="this.style.filter='none'">
            ${status.text}
          </div>
        `;
      };
    }

    table.dataTransform = dataTransform;

    const normalRows = sortedItems.map((rowItem, i) => {
      const rowInfo = parseItemInfo(rowItem, matrixLevel);
      const row: any = {
        _rowItem: rowItem,
      };

      if (matrixLevel === 3) {
        row._Cat_Type = rowInfo.predefinedType;
        row._Cat_Entity = rowInfo.entity;
        row._Cat_Disc = rowInfo.discipline;
      } else if (matrixLevel === 2) {
        row._Cat_Entity = rowInfo.entity;
        row._Cat_Disc = rowInfo.discipline;
      } else {
        row._Cat_Disc = rowInfo.discipline;
      }

      for (let j = 0; j < sortedItems.length; j++) {
        const colItem = sortedItems[j];
        const c1 = rowItem < colItem ? rowItem : colItem;
        const c2 = rowItem < colItem ? colItem : rowItem;
        row[colItem] = j > i ? "-" : (clashMatrix[c1]?.[c2] || 0);
      }
      return { data: row };
    });

    const headerRows: any[] = [];
    if (matrixLevel === 3) {
      const typeRow: any = { _headerType: "TYPE" };
      for (const colItem of sortedItems) {
        typeRow[colItem] = parseItemInfo(colItem, matrixLevel).predefinedType;
      }
      headerRows.push({ data: typeRow });
    }
    if (matrixLevel === 2 || matrixLevel === 3) {
      const entityRow: any = { _headerType: "ENTITY" };
      for (const colItem of sortedItems) {
        entityRow[colItem] = parseItemInfo(colItem, matrixLevel).entity;
      }
      headerRows.push({ data: entityRow });
    }
    const discRow: any = { _headerType: "DISC" };
    for (const colItem of sortedItems) {
      discRow[colItem] = parseItemInfo(colItem, matrixLevel).discipline;
    }
    headerRows.push({ data: discRow });

    const tableData = [
      ...normalRows,
      ...headerRows
    ];

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

    const csvRows: string[] = [];
    const escapeCsv = (val: string) => {
      if (val === undefined || val === null) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const colInfos = currentSortedItems.map(item => parseItemInfo(item, matrixLevel));

    if (matrixLevel === 3) {
      csvRows.push(["Discipline", "Entity", "Type", ...colInfos.map(c => escapeCsv(c.discipline))].join(","));
      csvRows.push(["", "", "", ...colInfos.map(c => escapeCsv(c.entity))].join(","));
      csvRows.push(["", "", "", ...colInfos.map(c => escapeCsv(c.predefinedType))].join(","));
    } else if (matrixLevel === 2) {
      csvRows.push(["Discipline", "Entity", ...colInfos.map(c => escapeCsv(c.discipline))].join(","));
      csvRows.push(["", "", ...colInfos.map(c => escapeCsv(c.entity))].join(","));
    } else {
      csvRows.push(["Discipline", ...colInfos.map(c => escapeCsv(c.discipline))].join(","));
    }

    // 데이터 행 생성
    for (let i = 0; i < currentSortedItems.length; i++) {
      const rowItem = currentSortedItems[i];
      const rowInfo = colInfos[i];
      const rowPrefix = matrixLevel === 3
        ? [rowInfo.discipline, rowInfo.entity, rowInfo.predefinedType]
        : matrixLevel === 2
        ? [rowInfo.discipline, rowInfo.entity]
        : [rowInfo.discipline];

      const rowValues = rowPrefix.map(escapeCsv);

      for (let j = 0; j < currentSortedItems.length; j++) {
        const colItem = currentSortedItems[j];

        if (j > i) {
          rowValues.push("-");
        } else {
          const c1 = rowItem < colItem ? rowItem : colItem;
          const c2 = rowItem < colItem ? colItem : rowItem;
          const count = currentClashMatrix[c1]?.[c2] || 0;
          const cellItems = currentClashDataMap[c1]?.[c2];
          const status = getCellStatus(count, cellItems);

          if (status.badge === "Exclude") rowValues.push("Excluded");
          else if (status.badge === "Hold") rowValues.push("Hold");
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

    const modelNamesSet = new Set<string>();
    for (const row of clashData) {
      const d = row.data;
      if (d) {
        if (d.Model1) modelNamesSet.add(d.Model1);
        if (d.Model2) modelNamesSet.add(d.Model2);
      }
    }
    modelNamesSet.delete("Multi");
    modelNamesSet.delete("Unknown");
    const modelNames = modelNamesSet.size > 0 ? Array.from(modelNamesSet).join("_") : "UnknownModel";

    a.download = `clash_matrix-${modelNames}-Level${matrixLevel}_${matrixViewMode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  let levelGroupEl: HTMLElement | null = null;

  const setLevelUI = (lvl: 1 | 2 | 3) => {
    if (levelGroupEl) {
      const buttons = levelGroupEl.querySelectorAll<HTMLButtonElement>(".level-btn");
      buttons.forEach((btn, idx) => {
        if (idx + 1 === lvl) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }
  };

  const onLevelChange = (level: 1 | 2 | 3) => {
    if (matrixLevel === level) return;
    matrixLevel = level;
    matrixViewMode = level === 1 ? "Discipline" : (level === 2 ? "Entity" : "PredefinedType");
    setLevelUI(level);

    selectedCell = null;
    selectedCellEl = null;
    if (selectionLabel) selectionLabel.textContent = "None";
    highlighter.clear("select");
    if (state.onCellClicked) state.onCellClicked(null);

    updateTable(true);
  };

  currentUpdateTableFn = updateTable;

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
        .matrix-scroll-wrapper bim-table {
          --bim-ui_size-16xl: 1.85rem;
        }
        bim-table::part(cell) {
          overflow: visible !important;
        }
        .matrix-level-group button.level-btn {
          background: transparent;
          color: var(--bim-ui_gray-10);
          border: none;
          padding: 0.2rem 0.65rem;
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          outline: none;
        }
        .matrix-level-group button.level-btn:not(:last-child) {
          border-right: 1px solid var(--bim-ui_bg-contrast-20);
        }
        .matrix-level-group button.level-btn:hover {
          background: var(--bim-ui_bg-contrast-20);
          color: var(--bim-ui_main-contrast);
        }
        .matrix-level-group button.level-btn.active {
          background: var(--bim-ui_main-base);
          color: #ffffff;
          font-weight: bold;
        }
      </style>
      <bim-label style="text-align: center; padding: 1rem; color: var(--bim-ui_gray-5); display: ${hasData ? 'none' : 'block'};">
        ${hasData ? '' : 'Waiting for clash data...'}
      </bim-label>
      <div style="display: ${hasData ? 'flex' : 'none'}; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding: 0.25rem 0.5rem; background-color: var(--bim-ui_bg-contrast-10); border-radius: 4px; flex-shrink: 0;">
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <bim-label style="font-size: 0.75rem; color: var(--bim-ui_gray-10); margin: 0; font-weight: normal; margin-right: 0.25rem;">Level :</bim-label>
          <div ${BUI.ref(el => { levelGroupEl = el as HTMLElement; })} class="matrix-level-group" style="display: inline-flex; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; overflow: hidden; background: var(--bim-ui_bg-contrast-10);">
            <button type="button" class="level-btn ${matrixLevel === 1 ? 'active' : ''}" @click=${() => onLevelChange(1)} title="Discipline">Discipline</button>
            <button type="button" class="level-btn ${matrixLevel === 2 ? 'active' : ''}" @click=${() => onLevelChange(2)} title="Entity">Entity</button>
            <button type="button" class="level-btn ${matrixLevel === 3 ? 'active' : ''}" @click=${() => onLevelChange(3)} title="PredefinedType">PredefinedType</button>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <bim-label ${BUI.ref(e => {
            selectionLabel = e;
            if (selectionLabel) {
              if (selectedCell) {
                const info1 = parseItemInfo(selectedCell.c1, matrixLevel);
                const info2 = parseItemInfo(selectedCell.c2, matrixLevel);
                selectionLabel.textContent = `${info1.fullPath} vs ${info2.fullPath}`;
              } else {
                selectionLabel.textContent = "None";
              }
            }
          })} style="color: var(--bim-ui_main-contrast); margin: 0; font-size: 0.75rem;"></bim-label>
          <bim-button @click=${onExportCSV} icon=${appIcons.EXPORT} title="Export to CSV"></bim-button>
        </div>
      </div>
      <div class="matrix-scroll-wrapper" style="${hasData ? 'flex: 1; min-height: 0; display: flex; flex-direction: column;' : 'display: none;'} overflow-x: auto; overflow-y: hidden; padding-bottom: 0.75rem;">
        <bim-table style="flex: 1; min-height: 0;" headers-hidden no-indentation
          ${BUI.ref(onTableCreated)}
        ></bim-table>
      </div>
    </div>
  `;
};

export const clashMatrix = (
  state: ClashMatrixState
): [HTMLDivElement, (state?: Partial<ClashMatrixState>) => void, () => void] => {
  const [component, update] = BUI.Component.create<HTMLDivElement, ClashMatrixState>(
    clashMatrixTemplate,
    state
  );
  currentMatrixComponent = component;
  (component as any).openModal = openClashMatrixModal;
  return [component, update, openClashMatrixModal];
};

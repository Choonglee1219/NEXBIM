import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import * as TEMPLATES from "..";
import {
  CONTENT_GRID_GAP,
  CONTENT_GRID_ID,
  MEDIUM_COLUMN_WIDTH,
} from "../../globals";
import { BCFTopics } from "../../bim-components/BCFTopics";

type Viewer = "viewer";

type IFCList = {
  name: "ifcList";
  state: TEMPLATES.IFCListPanelState;
};

type ElementData = {
  name: "elementData";
  state: TEMPLATES.ItemsDataPanelState;
};

type Queries = {
  name: "queries";
  state: TEMPLATES.QueriesPanelState;
};

type ViewTemplater = {
  name: "viewTemplater";
  state: TEMPLATES.ViewTemplatesPanelState;
};

type ViewPoints = {
  name: "viewPoints";
  state: TEMPLATES.ViewpointsPanelState
};

type IDSSpecs = {
  name: "idsSpecs";
  state: TEMPLATES.IDSSpecPanelState;
};

type ModelTree = {
  name: "modelTree";
  state: TEMPLATES.ModelTreePanelState;
};

type PropsManager = {
  name: "propsManager";
  state: TEMPLATES.GlobalPropsSectionState;
};

type TopicList = {
  name: "topicList";
  state: TEMPLATES.TopicListState;
};

type BCFList = {
  name: "bcfList";
  state: TEMPLATES.BCFListPanelState;
};

type Dashboard = {
  name: "dashboard";
  state: TEMPLATES.DashboardPanelState;
};

type QuantityTable = {
  name: "quantityTable";
  state: TEMPLATES.QuantityTablePanelState;
};

type ClashList = {
  name: "clashList";
  state: TEMPLATES.ClashListPanelState;
};

type DrawingEditor = {
  name: "drawing";
  state: TEMPLATES.DrawingEditorState;
};

export type ContentGridElements = [
  Viewer,
  IFCList,
  ElementData,
  Queries,
  ModelTree,
  ViewTemplater,
  PropsManager,
  TopicList,
  BCFList,
  Dashboard,
  ViewPoints,
  IDSSpecs,
  QuantityTable,
  ClashList,
  DrawingEditor,
];

export type ContentGridLayouts = ["Viewer", "BCFManager", "ClashDetection", "Queries", "Properties", "ViewPoints", "IDSCheck", "FullScreen", "QuantityTable", "DrawingEditor"];

export interface ContentGridState {
  components: OBC.Components;
  id: string;
  viewportTemplate: BUI.StatelessComponent;
  world: OBC.World;
}

export const contentGridTemplate: BUI.StatefullComponent<ContentGridState> = (
  state,
) => {
  const { components } = state;
  const fragments = components.get(OBC.FragmentsManager);
  const bcfTopics = components.get(BCFTopics);

  const onCreated = (e?: Element) => {
    if (!e) return;
    const grid = e as BUI.Grid<ContentGridLayouts, ContentGridElements>;

    grid.style.setProperty("--left-col-width", MEDIUM_COLUMN_WIDTH);
    grid.style.setProperty("--right-col-width", MEDIUM_COLUMN_WIDTH);

    grid.elements = {
      modelTree: {
        template: TEMPLATES.modelTreePanelTemplate,
        initialState: { components, models: fragments.list },
      },
      queries: {
        template: TEMPLATES.queriesPanelTemplate,
        initialState: { components, isAdmin: true },
      },
      ifcList: {
        template: TEMPLATES.ifcListPanelTemplate,
        initialState: { components },
      },
      elementData: {
        template: TEMPLATES.itemsDataPanelTemplate,
        initialState: { components },
      },
      viewTemplater: {
        template: TEMPLATES.viewTemplatesPanelTemplate,
        initialState: { components },
      },
      viewPoints: {
        template: TEMPLATES.viewpointsPanelTemplate,
        initialState: { components },
      },
      idsSpecs: {
        template: TEMPLATES.idsSpecPanelTemplate,
        initialState: { components },
      },
      propsManager: {
        template: TEMPLATES.globalPropsPanelTemplate,
        initialState: { components },
      },
      topicList: {
        template: TEMPLATES.topicListTemplate,
        initialState: { components },
      },
      bcfList: {
        template: TEMPLATES.bcfListPanelTemplate,
        initialState: { components },
      },
      dashboard: {
        template: TEMPLATES.dashboardPanelTemplate,
        initialState: { components },
      },
      quantityTable: {
        template: TEMPLATES.quantityTablePanelTemplate,
        initialState: { components },
      },
      clashList: {
        template: TEMPLATES.clashListPanelTemplate,
        initialState: { components },
      },
      drawing: {
        template: TEMPLATES.drawingEditorTemplate,
        initialState: { components, world: state.world },
      },
      viewer: state.viewportTemplate,
    };

    grid.layouts = {
      Viewer: {
        template: `
        "ifcList viewer elementData" var(--top-row-height, auto)
        "modelTree viewer elementData" 1fr
        "modelTree viewer viewTemplater" var(--bottom-row-height, auto)
        / var(--left-col-width) 1fr var(--right-col-width)
        `,
      },
      BCFManager: {
        template: `
        "ifcList viewer bcfList" var(--top-row-height, 1fr)
        "topicList topicList topicList" 1fr
        / var(--left-col-width) 1fr var(--right-col-width)
        `,
      },
      ClashDetection: {
        template: `
          "ifcList viewer elementData" var(--top-row-height, 1fr)
          "clashList clashList clashList" 1fr
          / var(--left-col-width) 1fr var(--right-col-width)
        `,
      },
      Queries: {
        template: `
          "queries viewer elementData" var(--top-row-height, 1fr)
          "queries dashboard elementData" 1fr
          / var(--left-col-width) 1fr var(--right-col-width)
        `,
      },
      IDSCheck: {
        template: `
          "idsSpecs viewer elementData" 1fr
          / var(--left-col-width) 1fr var(--right-col-width)
        `,
      },
      Properties: {
        template: `
          "propsManager viewer" var(--top-row-height, auto)
          "elementData viewer" 1fr
          / var(--half-col-width, 1fr) 1fr
        `,
      },
      ViewPoints: {
        template: `
          "viewPoints viewer" 1fr
          / var(--half-col-width, 1fr) 1fr
        `,
      },
      DrawingEditor: {
        template: `
          "ifcList drawing drawing" 1fr
          "viewer drawing drawing" 1fr
          / var(--left-col-width) 1fr var(--right-col-width)
        `,
      },
      QuantityTable: {
        template: `
          "viewer quantityTable quantityTable" var(--top-row-height, 1fr)
          "elementData quantityTable quantityTable" 1fr
          "elementData quantityTable quantityTable" var(--bottom-row-height, auto)
          / var(--left-col-width) 1fr var(--right-col-width)
        `,
      },
      FullScreen: {
        template: `
          "viewer" 1fr
          / 1fr
        `,
      },
    };

    // --- 드래그를 이용한 컬럼 리사이즈 로직 ---
    let isResizing: "left" | "right" | "top" | "bottom" | "half" | null = null;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;

    // 초기 행(Row) 높이를 추적하여 상한/하한선을 고정
    let initialTopRowHeight: number | null = null;
    let initialBottomRowHeight: number | null = null;
    let initialHalfColWidth: number | null = null;

    // 레이아웃이 BCFManager로 변경될 때 BCF 목록을 자동으로 새로고침
    grid.addEventListener("layoutchange", () => {
      if (grid.layout === "BCFManager") {
        bcfTopics.onRefresh.trigger();
      }
    });

    grid.addEventListener("pointerdown", (e: PointerEvent) => {
      // 그리드의 gap(빈 공간)을 정확히 클릭했을 때만 반응하도록
      if (e.target !== grid) return;
      const computed = getComputedStyle(grid);
      const cols = computed.gridTemplateColumns.split(" ").map(parseFloat);
      const rows = computed.gridTemplateRows.split(" ").map(parseFloat);

      const rect = grid.getBoundingClientRect();
      const paddingLeft = parseFloat(computed.paddingLeft) || 0;
      const paddingRight = parseFloat(computed.paddingRight) || 0;
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const colGap = parseFloat(computed.columnGap) || 16;
      const rowGap = parseFloat(computed.rowGap) || 16;

      let leftGapCenter = -1, rightGapCenter = -1;
      if (cols.length >= 2) leftGapCenter = rect.left + paddingLeft + cols[0] + colGap / 2;
      if (cols.length >= 3) rightGapCenter = rect.right - paddingRight - cols[cols.length - 1] - colGap / 2;

      let topGapCenter = -1, bottomGapCenter = -1;
      if (rows.length >= 2) topGapCenter = rect.top + paddingTop + rows[0] + rowGap / 2;
      if (rows.length >= 3) bottomGapCenter = rect.bottom - paddingBottom - rows[rows.length - 1] - rowGap / 2;

      if (leftGapCenter !== -1 && Math.abs(e.clientX - leftGapCenter) <= colGap) {
        const currentTemplate = grid.layouts[grid.layout as ContentGridLayouts[number]]?.template || "";
        isResizing = currentTemplate.includes("--half-col-width") ? "half" : "left";
        startX = e.clientX;
        startWidth = cols[0]; // 시작 사이즈 (가로/세로 공용)
        if (isResizing === "half" && initialHalfColWidth === null) initialHalfColWidth = startWidth;
        grid.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (rightGapCenter !== -1 && Math.abs(e.clientX - rightGapCenter) <= colGap) {
        isResizing = "right";
        startX = e.clientX;
        startWidth = cols[cols.length - 1];
        grid.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (topGapCenter !== -1 && Math.abs(e.clientY - topGapCenter) <= rowGap) {
        isResizing = "top";
        startY = e.clientY;
        startWidth = rows[0]; // 높이를 startWidth 변수에 공유
        if (initialTopRowHeight === null) initialTopRowHeight = startWidth;
        grid.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (bottomGapCenter !== -1 && Math.abs(e.clientY - bottomGapCenter) <= rowGap) {
        isResizing = "bottom";
        startY = e.clientY;
        startWidth = rows[rows.length - 1];
        if (initialBottomRowHeight === null) initialBottomRowHeight = startWidth;
        grid.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });

    grid.addEventListener("pointermove", (e: PointerEvent) => {
      const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const rangeLimit = 15 * remPx; // ±15rem 제한
      const baseColWidth = parseFloat(MEDIUM_COLUMN_WIDTH) * remPx; // 컬럼의 초기 기준값

      if (isResizing) {
        if (isResizing === "half") {
          const baseWidth = initialHalfColWidth ?? startWidth;
          let newWidth = startWidth + (e.clientX - startX);
          const rect = grid.getBoundingClientRect();
          const minWidth = Math.max(100, baseWidth - rangeLimit);
          const maxWidth = Math.min(rect.width - 100, baseWidth + rangeLimit);
          newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
          grid.style.setProperty("--half-col-width", `${newWidth}px`);
        } else if (isResizing === "left") {
          let newWidth = startWidth + (e.clientX - startX);
          const minWidth = Math.max(50, baseColWidth - rangeLimit);
          const maxWidth = baseColWidth + rangeLimit;
          newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
          grid.style.setProperty("--left-col-width", `${newWidth}px`);
        } else if (isResizing === "right") {
          let newWidth = startWidth - (e.clientX - startX);
          const minWidth = Math.max(50, baseColWidth - rangeLimit);
          const maxWidth = baseColWidth + rangeLimit;
          newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
          grid.style.setProperty("--right-col-width", `${newWidth}px`);
        } else if (isResizing === "top") {
          const baseHeight = initialTopRowHeight ?? startWidth;
          let newHeight = startWidth + (e.clientY - startY);
          const minHeight = Math.max(50, baseHeight - rangeLimit);
          const maxHeight = baseHeight + rangeLimit;
          newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
          grid.style.setProperty("--top-row-height", `${newHeight}px`);
        } else if (isResizing === "bottom") {
          const baseHeight = initialBottomRowHeight ?? startWidth;
          let newHeight = startWidth - (e.clientY - startY);
          const minHeight = Math.max(50, baseHeight - rangeLimit);
          const maxHeight = baseHeight + rangeLimit;
          newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
          grid.style.setProperty("--bottom-row-height", `${newHeight}px`);
        }
        e.preventDefault();
        return;
      }

      if (e.target === grid) {
        const computed = getComputedStyle(grid);
        const cols = computed.gridTemplateColumns.split(" ").map(parseFloat);
        const rows = computed.gridTemplateRows.split(" ").map(parseFloat);
        
        const rect = grid.getBoundingClientRect();
        const paddingLeft = parseFloat(computed.paddingLeft) || 0;
        const paddingRight = parseFloat(computed.paddingRight) || 0;
        const paddingTop = parseFloat(computed.paddingTop) || 0;
        const paddingBottom = parseFloat(computed.paddingBottom) || 0;
        const colGap = parseFloat(computed.columnGap) || 16;
        const rowGap = parseFloat(computed.rowGap) || 16;

        let leftGapCenter = -1, rightGapCenter = -1;
        if (cols.length >= 2) leftGapCenter = rect.left + paddingLeft + cols[0] + colGap / 2;
        if (cols.length >= 3) rightGapCenter = rect.right - paddingRight - cols[cols.length - 1] - colGap / 2;

        let topGapCenter = -1, bottomGapCenter = -1;
        if (rows.length >= 2) topGapCenter = rect.top + paddingTop + rows[0] + rowGap / 2;
        if (rows.length >= 3) bottomGapCenter = rect.bottom - paddingBottom - rows[rows.length - 1] - rowGap / 2;

        if ((leftGapCenter !== -1 && Math.abs(e.clientX - leftGapCenter) <= colGap) ||
            (rightGapCenter !== -1 && Math.abs(e.clientX - rightGapCenter) <= colGap)) {
          grid.style.cursor = "col-resize";
          return;
        } else if ((topGapCenter !== -1 && Math.abs(e.clientY - topGapCenter) <= rowGap) ||
                   (bottomGapCenter !== -1 && Math.abs(e.clientY - bottomGapCenter) <= rowGap)) {
          grid.style.cursor = "row-resize";
          return;
        }
      }
      grid.style.cursor = "";
    });

    grid.addEventListener("pointerup", (e: PointerEvent) => {
      if (isResizing) {
        grid.releasePointerCapture(e.pointerId);
        isResizing = null;
        grid.style.cursor = "";
      }
    });
  };

  return BUI.html`
    <bim-grid id=${state.id} style="padding: ${CONTENT_GRID_GAP}; gap: ${CONTENT_GRID_GAP}" ${BUI.ref(onCreated)}></bim-grid>
  `;
};

export const getContentGrid = () => {
  const contentGrid = document.getElementById(CONTENT_GRID_ID) as BUI.Grid<
    ContentGridLayouts,
    ContentGridElements
  > | null;

  return contentGrid;
};

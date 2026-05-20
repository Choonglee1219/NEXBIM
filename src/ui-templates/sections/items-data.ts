import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, createPaginationTemplate, PaginationRefs } from "../../globals";
import { itemsData } from "../../ui-components/ItemsData";
import { Highlighter } from "../../bim-components/Highlighter";

export interface ItemsDataPanelState {
  components: OBC.Components;
}

export const itemsDataPanelTemplate: BUI.StatefullComponent<
  ItemsDataPanelState
> = (state) => {
  const { components } = state;

  const highlighter = components.get(Highlighter);

  const [propsTable, updatePropsTable] = itemsData({
    components,
    modelIdMap: {},
  });

  propsTable.preserveStructureOnFilter = true;

  let section: BUI.PanelSection | undefined;

  // --- Pagination State ---
  let currentPage = 0;
  const pageSize = 30;
  let totalItems = 0;
  let totalPages = 0;
  let allItemsCache: { modelId: string; expressId: number }[] = [];

  // --- Pagination UI Refs ---
  const paginationRefs: PaginationRefs = {};

  const getSlicedMap = (page: number) => {
    const start = page * pageSize;
    const end = start + pageSize;
    const pageItems = allItemsCache.slice(start, end);

    const pageModelIdMap: OBC.ModelIdMap = {};
    for (const item of pageItems) {
      if (!pageModelIdMap[item.modelId]) {
        pageModelIdMap[item.modelId] = new Set();
      }
      pageModelIdMap[item.modelId].add(item.expressId);
    }
    return pageModelIdMap;
  };

  const updatePage = () => {
    const slicedMap = getSlicedMap(currentPage);
    updatePropsTable({ modelIdMap: slicedMap });

    if (section) {
      section.label = `Selection Data (${totalItems})`;
    }
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

  const processSelection = (modelIdMap: OBC.ModelIdMap) => {
    totalItems = 0;
    allItemsCache = [];
    for (const modelId in modelIdMap) {
      const ids = modelIdMap[modelId];
      totalItems += ids.size;
      for (const expressId of ids) {
        allItemsCache.push({ modelId, expressId });
      }
    }

    totalPages = Math.ceil(totalItems / pageSize);
    currentPage = 0;
    updatePage();
  };

  if (highlighter.events.select) {
    highlighter.events.select.onHighlight.add((modelIdMap) => {
      processSelection(modelIdMap);
    });

    highlighter.events.select.onClear.add(() => {
      // 현재 남아있는 선택 목록이 있는지 확인
      const currentSelection = highlighter.selection.select;
      const hasSelection = !OBC.ModelIdMapUtils.isEmpty(currentSelection);
      
      if (hasSelection) {
        // 부분 해제인 경우 남아있는 객체들로 리스트를 다시 구성
        processSelection(currentSelection);
        return;
      }

      allItemsCache = [];
      totalItems = 0;
      totalPages = 0;
      currentPage = 0;
      updatePropsTable({ modelIdMap: {} });
      if (section) section.label = "Selection Data (0)";
      if (paginationRefs.container) paginationRefs.container.style.display = "none";
    });
  }

  let searchInput: BUI.TextInput | undefined;

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    propsTable.queryString = input.value;
  };

  const onClearSearch = () => {
    if (!searchInput) return;
    searchInput.value = "";
    propsTable.queryString = null;
  };

  const toggleExpanded = () => {
    propsTable.expanded = !propsTable.expanded;
  };

  const sectionId = BUI.Manager.newRandomId();

  return BUI.html`
    <bim-panel-section ${BUI.ref((e) => {
      section = e as BUI.PanelSection;
      const selection = highlighter.selection.select;
      if (Object.keys(selection).length > 0) {
        setTimeout(() => processSelection(selection), 0);
      }
    })} fixed id=${sectionId} icon=${appIcons.TASK} label="Selection Data (0)">
      <div style="display: flex; gap: 0.375rem; align-items: center;">
        <bim-text-input ${BUI.ref((e) => { searchInput = e as BUI.TextInput; })} @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
        <bim-button style="flex: 0;" @click=${onClearSearch} icon=${appIcons.CLEAR} tooltip-title="Clear Search"></bim-button>
        <bim-button style="flex: 0;" @click=${toggleExpanded} icon=${appIcons.EXPAND} tooltip-title="Toggle Expanded"></bim-button>
        <bim-button style="flex: 0;" @click=${() => propsTable.downloadData("ElementData", "json")} icon=${appIcons.EXPORT} tooltip-title="Export Data" tooltip-text="Export the shown properties."></bim-button>
        ${createPaginationTemplate(onPrevPage, onNextPage, paginationRefs)}
      </div>
      ${propsTable}
    </bim-panel-section> 
  `;
};

import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, createPaginationTemplate, PaginationRefs, setupBIMTable } from "../../globals";
import { Highlighter } from "../../bim-components/Highlighter";
import { RuleService, RuleGroupByOption } from "../../bim-components/RuleService";

export interface RuleResultsPanelState {
  components: OBC.Components;
}

let selectedRowId: string | null = null;

export const ruleResultsPanelTemplate: BUI.StatefullComponent<RuleResultsPanelState> = (state) => {
  const { components } = state;
  const highlighter = components.get(Highlighter);
  const ruleService = components.get(RuleService);

  let currentPage = 0;
  const pageSize = 30;
  const paginationRefs: PaginationRefs = {};
  let statusFilter: "All" | "Pass" | "Fail" = "All";

  let panelSectionEl: BUI.PanelSection | null = null;
  let statusFilterDropdown: BUI.Dropdown | null = null;
  let passCountLabel: BUI.Label | null = null;
  let failCountLabel: BUI.Label | null = null;

  const findRowInTree = (nodes: any[], id: string): any => {
    for (const node of nodes) {
      if (node.data && node.data.id === id) return node;
      if (node.children) {
        const found = findRowInTree(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const filterTreeByStatus = (nodes: any[], filter: string): any[] => {
    return nodes.map(node => {
      const d = node.data;
      if (!d) return null;

      let matchStatus = false;
      if (filter === "Pass") {
        matchStatus = String(d.Status).startsWith("Pass");
      } else if (filter === "Fail") {
        matchStatus = String(d.Status).startsWith("Fail");
      }

      if (node.children) {
        const filteredChildren = filterTreeByStatus(node.children, filter);
        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren };
        }
        return null;
      }

      return matchStatus ? node : null;
    }).filter(n => n !== null);
  };

  const updatePage = () => {
    const rawData = ruleService.allResultsData || [];
    let filteredData = rawData;
    if (statusFilter !== "All") {
      filteredData = filterTreeByStatus(rawData, statusFilter);
    }

    const start = currentPage * pageSize;
    const end = start + pageSize;
    const totalItems = filteredData.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

    // Calculate Pass & Fail counts from rawFlatItems
    let passCount = 0;
    let failCount = 0;
    for (const item of ruleService.rawFlatItems) {
      if (String(item.Status).startsWith("Pass")) passCount++;
      else if (String(item.Status).startsWith("Fail")) failCount++;
    }
    const totalCount = ruleService.rawFlatItems.length;

    // Update section label & count labels
    if (panelSectionEl) {
      panelSectionEl.label = `Rule Check Results ( Total(${totalCount}) = Pass(${passCount}) + Fail(${failCount}) )`;
    }
    if (passCountLabel) passCountLabel.textContent = `Pass: ${passCount}`;
    if (failCountLabel) failCountLabel.textContent = `Fail: ${failCount}`;

    // Reset table data & columns first so @thatopen/ui clears its previous column memory
    resultsTable.data = [];
    resultsTable.columns = [];
    resultsTable.hiddenColumns = ["id", "ModelID", "ExpressID", "isGroup", "rawGroup"];

    if (filteredData.length > 0) {
      resultsTable.columns = [
        { name: "Model", width: "1.5fr" },
        { name: "Name", width: "2fr" },
        { name: "GUID", width: "1.5fr" },
        { name: "Entity", width: "1fr" },
        { name: "Value", width: "2.5fr" },
        { name: "Count", width: "0.5fr" },
        { name: "Status", width: "1fr" },
      ];
      resultsTable.hiddenColumns = ["id", "ModelID", "ExpressID", "isGroup", "rawGroup"];
      resultsTable.data = filteredData.slice(start, end);
      resultsTable.hiddenColumns = ["id", "ModelID", "ExpressID", "isGroup", "rawGroup"];
    }

    resultsTable.selection.clear();
    if (selectedRowId) {
      const rowToSelect = findRowInTree(resultsTable.data, selectedRowId);
      if (rowToSelect) resultsTable.selection.add(rowToSelect.data);
    }

    if (paginationRefs.container) paginationRefs.container.style.display = totalPages > 1 ? "flex" : "none";
    if (paginationRefs.label) paginationRefs.label.textContent = `${currentPage + 1} / ${totalPages}`;
    if (paginationRefs.prev) paginationRefs.prev.disabled = currentPage === 0;
    if (paginationRefs.next) paginationRefs.next.disabled = currentPage >= totalPages - 1;
  };

  const onPrevPage = () => {
    if (currentPage > 0) {
      currentPage--;
      updatePage();
    }
  };

  const onNextPage = () => {
    const rawData = ruleService.allResultsData || [];
    const filteredData = statusFilter !== "All" ? filterTreeByStatus(rawData, statusFilter) : rawData;
    const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
    if (currentPage < totalPages - 1) {
      currentPage++;
      updatePage();
    }
  };

  // Results Table Setup
  const resultsTable = document.createElement("bim-table") as BUI.Table<any>;
  resultsTable.hiddenColumns = ["id", "ModelID", "ExpressID", "isGroup", "rawGroup"];
  setupBIMTable(resultsTable);

  resultsTable.addEventListener("rowcreated", (e: Event) => {
    const customEvent = e as CustomEvent<BUI.RowCreatedEventDetail<any>>;
    const { row } = customEvent.detail;
    row.style.cursor = "pointer";

    row.onclick = async (event: MouseEvent) => {
      const path = event.composedPath();
      const isCaretClicked = path.some((el: any) =>
        el.classList && (
          el.classList.contains("caret") ||
          el.classList.contains("bim-table-row-caret")
        )
      );

      if (isCaretClicked) return;

      const rowData = row.data;
      if (!rowData) return;

      selectedRowId = rowData.id;

      const modelIdMap: OBC.ModelIdMap = {};
      if (rowData.isGroup && rowData.rawGroup) {
        for (const child of rowData.rawGroup) {
          if (child.ModelID && child.ExpressID) {
            if (!modelIdMap[child.ModelID]) modelIdMap[child.ModelID] = new Set();
            modelIdMap[child.ModelID].add(child.ExpressID);
          }
        }
      } else if (rowData.ModelID && rowData.ExpressID) {
        if (!modelIdMap[rowData.ModelID]) modelIdMap[rowData.ModelID] = new Set();
        modelIdMap[rowData.ModelID].add(rowData.ExpressID);
      }

      await highlighter.clear("select");

      if (Object.keys(modelIdMap).length > 0) {
        await highlighter.highlightByID("select", modelIdMap);

        const worlds = components.get(OBC.Worlds);
        const world = worlds.list.values().next().value;
        if (world && world.camera instanceof OBC.SimpleCamera) {
          await world.camera.fitToItems(modelIdMap);
        }
      }
    };
  });

  resultsTable.dataTransform = {
    Model: (value) => BUI.html`
      <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title=${String(value)}>
        ${String(value)}
      </bim-label>
    `,
    Name: (value) => BUI.html`
      <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title=${String(value)}>
        ${String(value)}
      </bim-label>
    `,
    GUID: (value) => BUI.html`
      <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title=${String(value)}>
        ${String(value)}
      </bim-label>
    `,
    Entity: (value) => BUI.html`
      <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title=${String(value)}>
        ${String(value)}
      </bim-label>
    `,
    Value: (value) => BUI.html`
      <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title=${String(value)}>
        ${String(value)}
      </bim-label>
    `,
    Count: (value) => BUI.html`
      <bim-label style="font-weight: bold; text-align: center; width: 100%;">
        ${String(value)}
      </bim-label>
    `,
    Status: (value) => {
      const isPass = String(value).startsWith("Pass");
      const color = isPass ? "var(--bim-ui_success-base, #00B050)" : "var(--bim-ui_error-base, #C00000)";
      return BUI.html`<bim-label style="color: ${color}; font-weight: bold;">${value}</bim-label>`;
    }
  };

  // Subscribe to RuleService results changes
  ruleService.onResultsChanged.add(() => {
    selectedRowId = null;
    currentPage = 0;
    statusFilter = "All";
    if (statusFilterDropdown) statusFilterDropdown.value = ["All"];
    updatePage();
  });

  // Initial load
  updatePage();

  return BUI.html`
    <bim-panel-section ${BUI.ref((el) => {
      panelSectionEl = el as BUI.PanelSection;
      setTimeout(() => updatePage(), 0);
    })} fixed icon=${appIcons.TABLE} label="Rule Check Results ( Total(0) = Pass(0) + Fail(0) )" style="height: 100%; min-height: 0;">
      <div style="display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-shrink: 0; padding-bottom: 0.25rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-20);">
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <bim-button label="Select All" @click=${() => ruleService.selectObjects()} icon=${appIcons.SELECT}></bim-button>
            <bim-button label="To Topic" @click=${() => ruleService.failToTopic()} icon=${appIcons.SAVE}></bim-button>
            <bim-button label="Export CSV" @click=${() => ruleService.exportCSV()} icon=${appIcons.EXPORT}></bim-button>
            
            <div style="display: flex; gap: 0.35rem; align-items: center; margin-left: 0.25rem;">
              <bim-label style="font-weight: bold; white-space: nowrap;">Group By:</bim-label>
              <bim-dropdown style="min-width: 7.5rem;" @change=${(e: Event) => {
      const dropdown = e.target as BUI.Dropdown;
      dropdown.visible = false;
      const val = (dropdown.value[0] || "None") as RuleGroupByOption;
      ruleService.setGroupBy(val);
    }}>
                <bim-option label="None (Flat)" value="None" checked></bim-option>
                <bim-option label="GUID" value="GUID"></bim-option>
                <bim-option label="Model" value="Model"></bim-option>
                <bim-option label="Entity" value="Entity"></bim-option>
                <bim-option label="Status" value="Status"></bim-option>
              </bim-dropdown>
            </div>

            <div style="display: flex; gap: 0.35rem; align-items: center; margin-left: 0.25rem;">
              <bim-label style="font-weight: bold; white-space: nowrap;">Status:</bim-label>
              <bim-dropdown
                ${BUI.ref(e => statusFilterDropdown = e as BUI.Dropdown)}
                @change=${(e: Event) => {
      const dp = e.target as BUI.Dropdown;
      dp.visible = false;
      statusFilter = (dp.value[0] as any) || "All";
      currentPage = 0;
      updatePage();
    }}
                style="min-width: 6.5rem;"
              >
                <bim-option label="All" value="All" ?checked=${(statusFilter as string) === "All"}></bim-option>
                <bim-option label="Pass" value="Pass" ?checked=${(statusFilter as string) === "Pass"} style="font-weight: bold; color: var(--bim-ui_success-base, #00B050);"></bim-option>
                <bim-option label="Fail" value="Fail" ?checked=${(statusFilter as string) === "Fail"} style="font-weight: bold; color: var(--bim-ui_error-base, #C00000);"></bim-option>
              </bim-dropdown>
            </div>

            <div style="display: flex; gap: 0.5rem; align-items: center; margin-left: 0.25rem; padding: 0.2rem 0.5rem; background-color: var(--bim-ui_bg-contrast-10); border-radius: 4px; border: 1px solid var(--bim-ui_bg-contrast-20);">
              <bim-label ${BUI.ref(e => passCountLabel = e as BUI.Label)} style="color: var(--bim-ui_success-base, #00B050); font-weight: bold; white-space: nowrap;">
                Pass: 0
              </bim-label>
              <span style="color: var(--bim-ui_bg-contrast-60);">|</span>
              <bim-label ${BUI.ref(e => failCountLabel = e as BUI.Label)} style="color: var(--bim-ui_error-base, #C00000); font-weight: bold; white-space: nowrap;">
                Fail: 0
              </bim-label>
            </div>
          </div>
          <div>
            ${createPaginationTemplate(onPrevPage, onNextPage, paginationRefs)}
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; flex: 1; min-height: 0;">
          ${resultsTable}
        </div>
      </div>
    </bim-panel-section>
  `;
};

import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, createPaginationTemplate, PaginationRefs, setupBIMTable } from "../../globals";
import { Highlighter } from "../../bim-components/Highlighter";
import { RelationParsingService } from "../../bim-components/RelationParsingService";

// ==========================================
// 1. Types & Constants
// ==========================================

export interface OpeningsPanelState {
  components: OBC.Components;
}

export type OpeningGroupByOption = "None" | "PredefinedType" | "VoidsEntity" | "FillsEntity";

export interface OpeningRowData {
  id: string;
  modelId: string;
  openingId: number;
  Opening: string;
  PredefinedType: string;
  globalId: string;

  voidsId: number | null;
  voidsLabel: string;
  voidsEntity: string;
  VoidsElement: string;

  fillsId: number | null;
  fillsLabel: string;
  fillsEntity: string;
  FillsElement: string;

  quantities: Record<string, string | number>;
  properties: Record<string, string | number | boolean>;
  isGroup?: boolean;
  rawGroup?: OpeningRowData[];
  [key: string]: any;
}

const PREFERRED_QUANTITY_ORDER = [
  "Width",
  "Height",
  "Depth",
  "Length",
  "Thickness",
  "Area",
  "GrossArea",
  "NetArea",
  "Volume",
  "GrossVolume",
  "NetVolume",
];

const HIDDEN_COLUMNS = [
  "id",
  "modelId",
  "openingId",
  "globalId",
  "voidsId",
  "voidsLabel",
  "voidsEntity",
  "fillsId",
  "fillsLabel",
  "fillsEntity",
  "quantities",
  "properties",
  "isGroup",
  "rawGroup",
];

// Module-level state & caches
let allFlatOpeningsData: OpeningRowData[] = [];
let dynamicQuantityKeys: string[] = [];
let dynamicPropertyKeys: string[] = [];
let isExtracting = false;
let isEventsRegistered = false;

// ==========================================
// 2. High-Performance Extraction Utilities
// ==========================================

const extractValue = (attr: any): any => {
  if (attr === null || attr === undefined) return null;
  if (Array.isArray(attr)) return attr.length > 0 ? extractValue(attr[0]) : null;
  if (typeof attr === "object" && "value" in attr) {
    return attr.type === 5 ? null : attr.value;
  }
  return attr;
};

const isQuantityName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.includes("width") ||
    lower.includes("height") ||
    lower.includes("depth") ||
    lower.includes("length") ||
    lower.includes("area") ||
    lower.includes("volume") ||
    lower.includes("thick")
  );
};

const parseEntityProperty = (
  prop: any,
  quantities: Record<string, string | number>,
  properties: Record<string, string | number | boolean>,
  isExplicitQuantity = false
) => {
  if (!prop) return;
  const rawName = extractValue(prop.Name) || extractValue(prop.name);
  if (!rawName) return;
  const propName = String(rawName).trim();
  if (!propName || propName === "$" || propName === "*") return;

  const rawVal =
    extractValue(prop.LengthValue) ??
    extractValue(prop.AreaValue) ??
    extractValue(prop.VolumeValue) ??
    extractValue(prop.WeightValue) ??
    extractValue(prop.CountValue) ??
    extractValue(prop.NominalValue) ??
    extractValue(prop.value);

  if (rawVal === null || rawVal === undefined) return;

  if (typeof rawVal === "boolean") {
    properties[propName] = rawVal ? "True" : "False";
  } else if (typeof rawVal === "number") {
    if (isExplicitQuantity || isQuantityName(propName)) {
      quantities[propName] = Math.round(rawVal);
    } else {
      properties[propName] = Number.isInteger(rawVal) ? rawVal : Math.round(rawVal * 100) / 100;
    }
  } else {
    const strVal = String(rawVal).trim();
    if (strVal && strVal !== "$" && strVal !== "*") {
      if (isExplicitQuantity || isQuantityName(propName)) {
        const num = parseFloat(strVal);
        quantities[propName] = isNaN(num) ? strVal : Math.round(num);
      } else {
        properties[propName] = strVal;
      }
    }
  }
};

const extractOpeningQuantitiesAndProperties = (
  itemData: any,
  fallbackType?: string | null
): {
  predefinedType: string;
  quantities: Record<string, string | number>;
  properties: Record<string, string | number | boolean>;
} => {
  let predefinedType =
    extractValue(itemData?.PredefinedType) ||
    extractValue(itemData?.ObjectType) ||
    fallbackType ||
    "NOTDEFINED";

  if (predefinedType === "$" || predefinedType === "*" || !predefinedType) {
    predefinedType = "NOTDEFINED";
  }

  const quantities: Record<string, string | number> = {};
  const properties: Record<string, string | number | boolean> = {};
  if (!itemData) return { predefinedType, quantities, properties };

  // 1. Direct Quantities
  if (itemData.Quantities) {
    const qSets = Array.isArray(itemData.Quantities) ? itemData.Quantities : [itemData.Quantities];
    for (const qSet of qSets) {
      const qList = Array.isArray(qSet.Quantities) ? qSet.Quantities : [qSet.Quantities || qSet];
      for (const q of qList) parseEntityProperty(q, quantities, properties, true);
    }
  }

  // 2. IsDefinedBy
  if (itemData.IsDefinedBy) {
    const psets = Array.isArray(itemData.IsDefinedBy) ? itemData.IsDefinedBy : [itemData.IsDefinedBy];
    for (const pset of psets) {
      if (pset.Quantities) {
        const qList = Array.isArray(pset.Quantities) ? pset.Quantities : [pset.Quantities];
        for (const q of qList) parseEntityProperty(q, quantities, properties, true);
      }
      if (pset.HasProperties) {
        const props = Array.isArray(pset.HasProperties) ? pset.HasProperties : [pset.HasProperties];
        for (const prop of props) parseEntityProperty(prop, quantities, properties, false);
      }
    }
  }

  return { predefinedType, quantities, properties };
};

// ==========================================
// 3. Batched Data Fetcher & Tree Builder
// ==========================================

export const fetchAllOpeningsData = async (components: OBC.Components): Promise<OpeningRowData[]> => {
  const fragments = components.get(OBC.FragmentsManager);
  const relService = components.get(RelationParsingService);
  const rows: OpeningRowData[] = [];
  const qKeySet = new Set<string>();
  const pKeySet = new Set<string>();

  for (const [modelId, model] of fragments.list.entries()) {
    try {
      const relData = relService.getRelationsByModelKey(modelId) || (await relService.getModelRelations(model));
      if (!relData || relData.openings.size === 0) continue;

      // 1. Gather all unique express IDs for batch loading (Openings + Hosts + Fillings)
      const openingIds = Array.from(relData.openings.keys());
      const relatedIdSet = new Set<number>();

      for (const opData of relData.openings.values()) {
        if (opData.parentExpressId) relatedIdSet.add(opData.parentExpressId);
        if (opData.fillingExpressIds) {
          for (const fillId of opData.fillingExpressIds) relatedIdSet.add(fillId);
        }
      }

      // 2. Batch load opening details with relationships (attributes + Quantities/Psets)
      const openingDataMap = new Map<number, any>();
      try {
        const openingItemsData = await model.getItemsData(openingIds, {
          attributesDefault: true,
          relationsDefault: { attributes: false, relations: false },
          relations: {
            IsDefinedBy: { attributes: true, relations: true },
            Quantities: { attributes: true, relations: true },
          },
        });
        for (let i = 0; i < openingIds.length; i++) {
          openingDataMap.set(openingIds[i], openingItemsData[i]);
        }
      } catch (e) {
        // FragmentsModel에 개구부 속성이 미색인된 경우 graceful fallback
      }

      // 3. Batch load related host and filling entity details (500개 청크 분할 안전 로드)
      const relatedIds = Array.from(relatedIdSet);
      const entityDetailsMap = new Map<number, { label: string; entity: string }>();

      if (relatedIds.length > 0) {
        const CHUNK_SIZE = 500;
        for (let c = 0; c < relatedIds.length; c += CHUNK_SIZE) {
          const chunk = relatedIds.slice(c, c + CHUNK_SIZE);
          try {
            const relatedItemsData = await model.getItemsData(chunk, { attributesDefault: true });
            for (let i = 0; i < chunk.length; i++) {
              const id = chunk[i];
              const attrs = relatedItemsData[i];

              if (relData.openings?.has(id)) {
                const op = relData.openings.get(id)!;
                entityDetailsMap.set(id, {
                  label: `IFCOPENINGELEMENT  ||  ${op.name || `#${id}`}`,
                  entity: "IFCOPENINGELEMENT",
                });
              } else if (relData.spatialZones?.has(id)) {
                const zone = relData.spatialZones.get(id)!;
                const name = zone.name || zone.longName || `#${id}`;
                entityDetailsMap.set(id, {
                  label: `IFCSPATIALZONE  ||  ${name}`,
                  entity: "IFCSPATIALZONE",
                });
              } else if (attrs) {
                const category = extractValue(attrs._category) || "IFCELEMENT";
                const name = extractValue(attrs.Name) || `#${id}`;
                entityDetailsMap.set(id, { label: `${category}  ||  ${name}`, entity: category });
              } else {
                entityDetailsMap.set(id, { label: `IFCELEMENT  ||  #${id}`, entity: "IFCELEMENT" });
              }
            }
          } catch (e) { }
        }
      }

      const getEntityInfo = (id: number | null | undefined) => {
        if (!id) return { label: "-", entity: "None" };
        return entityDetailsMap.get(id) || { label: `IFCELEMENT  ||  #${id}`, entity: "IFCELEMENT" };
      };

      // 4. Construct Opening rows
      for (const [openingId, opData] of relData.openings.entries()) {
        const rawOpItem = openingDataMap.get(openingId);
        const opName = opData.name || extractValue(rawOpItem?.Name) || `Opening #${openingId}`;
        const globalId = opData.globalId || extractValue(rawOpItem?._guid) || "";

        const voidsId = opData.parentExpressId ?? null;
        const { label: voidsLabel, entity: voidsEntity } = getEntityInfo(voidsId);

        const { predefinedType, quantities, properties } = extractOpeningQuantitiesAndProperties(
          rawOpItem,
          opData.predefinedType
        );

        for (const k of Object.keys(quantities)) qKeySet.add(k);
        for (const k of Object.keys(properties)) pKeySet.add(k);

        const baseRow = {
          modelId,
          openingId,
          Opening: opName,
          PredefinedType: predefinedType,
          globalId,
          voidsId,
          voidsLabel,
          voidsEntity,
          VoidsElement: voidsLabel,
          quantities,
          properties,
        };

        const fillsList = opData.fillingExpressIds || [];

        if (fillsList.length === 0) {
          rows.push({
            ...baseRow,
            ...quantities,
            ...properties,
            id: `${modelId}-${openingId}-null`,
            fillsId: null,
            fillsLabel: "Null",
            fillsEntity: "Null",
            FillsElement: "Null",
          });
        } else {
          for (let fillIdx = 0; fillIdx < fillsList.length; fillIdx++) {
            const fillId = fillsList[fillIdx];
            const { label: fillsLabel, entity: fillsEntity } = getEntityInfo(fillId);

            rows.push({
              ...baseRow,
              ...quantities,
              ...properties,
              id: `${modelId}-${openingId}-${fillId}-${fillIdx}`,
              fillsId: fillId,
              fillsLabel,
              fillsEntity,
              FillsElement: fillsLabel,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[OpeningsPanel] Failed to extract openings from model ${modelId}:`, err);
    }
  }

  // Sort quantity columns by preferred order, then alphabetical
  dynamicQuantityKeys = Array.from(qKeySet).sort((a, b) => {
    const idxA = PREFERRED_QUANTITY_ORDER.indexOf(a);
    const idxB = PREFERRED_QUANTITY_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  // Sort property columns alphabetically
  dynamicPropertyKeys = Array.from(pKeySet).sort((a, b) => a.localeCompare(b));

  // Normalize missing keys to "-"
  for (const r of rows) {
    for (const qk of dynamicQuantityKeys) if (r[qk] === undefined) r[qk] = "-";
    for (const pk of dynamicPropertyKeys) if (r[pk] === undefined) r[pk] = "-";
  }

  return rows;
};

export const groupOpeningsTree = (
  flatItems: OpeningRowData[],
  groupBy: OpeningGroupByOption
): any[] => {
  if (flatItems.length === 0) return [];

  // 1. None: Group by OpeningElement only when multiple fillings exist
  if (groupBy === "None") {
    const openingMap = new Map<string, OpeningRowData[]>();
    for (const item of flatItems) {
      const key = `${item.modelId}-${item.openingId}`;
      let list = openingMap.get(key);
      if (!list) {
        list = [];
        openingMap.set(key, list);
      }
      list.push(item);
    }

    const tree: any[] = [];
    for (const items of openingMap.values()) {
      if (items.length === 1) {
        tree.push({ data: items[0] });
      } else {
        const first = items[0];
        tree.push({
          data: {
            ...first,
            id: `opening-group-${first.modelId}-${first.openingId}`,
            isGroup: true,
            FillsElement: `[${items.length} FillsElements]`,
            rawGroup: items,
          },
          children: items.map((i) => ({ data: i })),
        });
      }
    }
    return tree;
  }

  // 2. Categorical Grouping
  const categoryMap = new Map<string, OpeningRowData[]>();
  for (const item of flatItems) {
    let key = "None";
    if (groupBy === "PredefinedType") key = item.PredefinedType || "NOTDEFINED";
    else if (groupBy === "VoidsEntity") key = item.voidsEntity || "None";
    else if (groupBy === "FillsEntity") key = item.fillsEntity || "Null";

    let list = categoryMap.get(key);
    if (!list) {
      list = [];
      categoryMap.set(key, list);
    }
    list.push(item);
  }

  const tree: any[] = [];
  let groupCounter = 1;

  for (const [key, items] of categoryMap.entries()) {
    const groupRow: OpeningRowData = {
      id: `cat-group-${groupBy.toLowerCase()}-${key}-${groupCounter++}`,
      modelId: items[0]?.modelId || "",
      openingId: 0,
      Opening: `${key} (${items.length})`,
      PredefinedType: groupBy === "PredefinedType" ? key : "-",
      globalId: "",
      voidsId: null,
      voidsLabel: groupBy === "VoidsEntity" ? key : "-",
      voidsEntity: groupBy === "VoidsEntity" ? key : "None",
      VoidsElement: groupBy === "VoidsEntity" ? key : "-",
      fillsId: null,
      fillsLabel: groupBy === "FillsEntity" ? key : "-",
      fillsEntity: groupBy === "FillsEntity" ? key : "Null",
      FillsElement: groupBy === "FillsEntity" ? key : "-",
      quantities: {},
      properties: {},
      isGroup: true,
      rawGroup: items,
    };

    for (const qk of dynamicQuantityKeys) groupRow[qk] = "-";
    for (const pk of dynamicPropertyKeys) groupRow[pk] = "-";

    tree.push({
      data: groupRow,
      children: items.map((i) => ({ data: i })),
    });
  }

  return tree;
};

// ==========================================
// 4. UI Panel Component
// ==========================================

export const openingsPanelTemplate: BUI.StatefullComponent<OpeningsPanelState> = (state) => {
  const { components } = state;
  const highlighter = components.get(Highlighter);
  const fragments = components.get(OBC.FragmentsManager);
  const relService = components.get(RelationParsingService);

  let searchInput: BUI.TextInput | undefined;
  let section: BUI.PanelSection | undefined;
  let toggle3DBtn: BUI.Button | undefined;

  let activeGroupBy: OpeningGroupByOption = "None";
  let processedTreeData: any[] = [];

  // Table setup
  const openingsTable = document.createElement("bim-table") as BUI.Table<OpeningRowData>;
  openingsTable.headersHidden = false;
  openingsTable.noIndentation = false;
  openingsTable.noCarets = false;
  openingsTable.style.height = "100%";
  openingsTable.style.width = "100%";
  openingsTable.hiddenColumns = HIDDEN_COLUMNS;

  setupBIMTable(openingsTable);

  // Row click -> Select & Zoom Opening in 3D
  openingsTable.addEventListener("rowcreated", (e: Event) => {
    const customEvent = e as CustomEvent<BUI.RowCreatedEventDetail<OpeningRowData>>;
    const { row } = customEvent.detail;
    row.style.cursor = "pointer";

    row.onclick = async (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest("bim-button")) return;
      const path = ev.composedPath();
      const isCaretClicked = path.some(
        (el: any) =>
          el.classList &&
          (el.classList.contains("caret") || el.classList.contains("bim-table-row-caret"))
      );
      if (isCaretClicked) return;

      const rowData = row.data;
      if (!rowData) return;

      const modelIdMap: OBC.ModelIdMap = {};

      if (rowData.isGroup && rowData.rawGroup) {
        for (const child of rowData.rawGroup) {
          if (child.modelId && child.openingId) {
            const mId = String(child.modelId);
            if (!modelIdMap[mId]) modelIdMap[mId] = new Set();
            modelIdMap[mId].add(child.openingId);
          }
        }
      } else if (rowData.modelId && rowData.openingId) {
        modelIdMap[String(rowData.modelId)] = new Set([rowData.openingId]);
      }

      if (Object.keys(modelIdMap).length > 0) {
        await relService.showOpenings();
        if (toggle3DBtn) toggle3DBtn.active = true;
        await highlighter.highlightByID("select", modelIdMap, true, true);
      }
    };
  });

  // Cell Rendering Transforms
  openingsTable.dataTransform = {
    Opening: (value, row) => {
      const isGrp = row.isGroup;
      const text = String(value ?? "");
      return BUI.html`
        <bim-label style="font-weight: ${isGrp ? "bold" : "normal"}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title=${text}>
          ${text}
        </bim-label>
      `;
    },
    VoidsElement: (_, row) => {
      if (row.isGroup || !row.voidsId) {
        return BUI.html`<bim-label style="color: var(--bim-ui_bg-contrast-60);">-</bim-label>`;
      }
      return BUI.html`
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; width: 100%; min-width: 0;">
          <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;" title="${row.voidsLabel}">${row.voidsLabel}</bim-label>
          <bim-button
            icon=${appIcons.SELECT}
            style="flex: 0 0 auto; margin: 0; padding: 0.2rem;"
            @click=${async (e: Event) => {
          e.stopPropagation();
          const modelIdMap: OBC.ModelIdMap = { [String(row.modelId)]: new Set([row.voidsId!]) };
          highlighter.highlightByID("select", modelIdMap, true, true);
        }}
            tooltip-title="3D 뷰어에서 모체 선택"
          ></bim-button>
        </div>
      `;
    },
    FillsElement: (_, row) => {
      if (row.isGroup) {
        return BUI.html`<bim-label style="color: var(--bim-ui_bg-contrast-80); font-weight: 500;">${row.FillsElement}</bim-label>`;
      }
      if (!row.fillsId) {
        return BUI.html`<bim-label style="color: var(--bim-ui_bg-contrast-60);">Null</bim-label>`;
      }
      return BUI.html`
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; width: 100%; min-width: 0;">
          <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;" title="${row.fillsLabel}">${row.fillsLabel}</bim-label>
          <bim-button
            icon=${appIcons.SELECT}
            style="flex: 0 0 auto; margin: 0; padding: 0.2rem;"
            @click=${async (e: Event) => {
          e.stopPropagation();
          const modelIdMap: OBC.ModelIdMap = { [String(row.modelId)]: new Set([row.fillsId!]) };
          highlighter.highlightByID("select", modelIdMap, true, true);
        }}
            tooltip-title="3D 뷰어에서 채움 부재 선택"
          ></bim-button>
        </div>
      `;
    },
  };

  // Pagination & Table Refresh
  let currentPage = 0;
  const pageSize = 30;
  const paginationRefs: PaginationRefs = {};

  const updateTableData = () => {
    const totalPages = Math.max(1, Math.ceil(processedTreeData.length / pageSize));
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const slicedData = processedTreeData.slice(start, end);

    if (processedTreeData.length > 0) {
      openingsTable.columns = [
        { name: "Opening", width: "180px" },
        { name: "PredefinedType", width: "120px" },
        { name: "VoidsElement", width: "minmax(180px, 1.2fr)" },
        { name: "FillsElement", width: "minmax(180px, 1.2fr)" },
        ...dynamicQuantityKeys.map((k) => ({ name: k, width: "minmax(80px, 0.8fr)" })),
        ...dynamicPropertyKeys.map((k) => ({ name: k, width: "minmax(100px, 1fr)" })),
      ];
      openingsTable.hiddenColumns = HIDDEN_COLUMNS;
      openingsTable.data = slicedData;
    } else {
      openingsTable.data = [];
    }

    if (paginationRefs.container) paginationRefs.container.style.display = totalPages > 1 ? "flex" : "none";
    if (paginationRefs.label) paginationRefs.label.textContent = `${currentPage + 1} / ${totalPages}`;
    if (paginationRefs.prev) paginationRefs.prev.disabled = currentPage === 0;
    if (paginationRefs.next) paginationRefs.next.disabled = currentPage >= totalPages - 1;
    if (section) section.label = `Openings Management (${allFlatOpeningsData.length})`;
  };

  const applyFiltersAndGroup = () => {
    const query = (searchInput?.value || "").trim().toLowerCase();

    const filteredFlat = allFlatOpeningsData.filter((row) => {
      if (!query) return true;

      for (const [k, v] of Object.entries(row.quantities)) {
        if (k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) return true;
      }
      for (const [k, v] of Object.entries(row.properties)) {
        if (k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) return true;
      }

      return (
        row.Opening.toLowerCase().includes(query) ||
        row.PredefinedType.toLowerCase().includes(query) ||
        row.VoidsElement.toLowerCase().includes(query) ||
        row.FillsElement.toLowerCase().includes(query)
      );
    });

    processedTreeData = groupOpeningsTree(filteredFlat, activeGroupBy);
    currentPage = 0;
    updateTableData();
  };

  const loadData = async (btn?: BUI.Button) => {
    if (isExtracting) return;
    isExtracting = true;
    if (btn) btn.loading = true;

    try {
      allFlatOpeningsData = await fetchAllOpeningsData(components);
      applyFiltersAndGroup();
    } finally {
      isExtracting = false;
      if (btn) btn.loading = false;
    }
  };

  // Register model lifecycle events once
  if (!isEventsRegistered) {
    fragments.list.onItemSet.add(() => setTimeout(() => loadData(), 300));
    fragments.list.onItemDeleted.add(() => setTimeout(() => loadData(), 300));
    relService.onRelationsParsed.add(() => setTimeout(() => loadData(), 100));
    isEventsRegistered = true;
  }

  // CSV Export
  const exportToCSV = () => {
    if (allFlatOpeningsData.length === 0) {
      alert("내보낼 개구부 데이터가 없습니다.");
      return;
    }

    const headers = [
      "Opening",
      "PredefinedType",
      "VoidsElement",
      "FillsElement",
      ...dynamicQuantityKeys,
      ...dynamicPropertyKeys,
      "GlobalId",
    ];

    const csvRows = [headers.join(",")];
    for (const r of allFlatOpeningsData) {
      const qVals = dynamicQuantityKeys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`);
      const pVals = dynamicPropertyKeys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`);
      csvRows.push(
        [
          `"${r.Opening.replace(/"/g, '""')}"`,
          `"${r.PredefinedType.replace(/"/g, '""')}"`,
          `"${r.VoidsElement.replace(/"/g, '""')}"`,
          `"${r.FillsElement.replace(/"/g, '""')}"`,
          ...qVals,
          ...pVals,
          `"${r.globalId}"`,
        ].join(",")
      );
    }

    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IfcOpenings_Schedule_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onPrevPage = () => {
    if (currentPage > 0) {
      currentPage--;
      updateTableData();
    }
  };

  const onNextPage = () => {
    const totalPages = Math.ceil(processedTreeData.length / pageSize);
    if (currentPage < totalPages - 1) {
      currentPage++;
      updateTableData();
    }
  };

  setTimeout(() => loadData(), 100);

  const sectionId = BUI.Manager.newRandomId();

  return BUI.html`
    <bim-panel style="height: 100%; display: flex; flex-direction: column; padding: 0;">
      <bim-panel-section ${BUI.ref((e) => { section = e as BUI.PanelSection; })} fixed id=${sectionId} icon=${appIcons.AREA} label="Openings Management (0)" style="height: 100%; display: flex; flex-direction: column; overflow: hidden;">
        <!-- Compact 1-Line Controls Toolbar -->
        <div style="display: flex; gap: 0.375rem; align-items: center; padding-bottom: 0.5rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-40);">
          <!-- 1. Group By Section -->
          <div style="display: flex; gap: 0.35rem; align-items: center; flex-shrink: 0;">
            <bim-label style="font-weight: bold; white-space: nowrap;">Group By:</bim-label>
            <bim-dropdown 
              @change=${(e: Event) => {
      const dp = e.target as BUI.Dropdown;
      dp.visible = false;
      activeGroupBy = (dp.value[0] || "None") as OpeningGroupByOption;
      applyFiltersAndGroup();
    }} 
              style="width: 140px;"
            >
              <bim-option label="None" value="None" checked></bim-option>
              <bim-option label="Type" value="PredefinedType"></bim-option>
              <bim-option label="Voids Entity" value="VoidsEntity"></bim-option>
              <bim-option label="Fills Entity" value="FillsEntity"></bim-option>
            </bim-dropdown>
          </div>

          <!-- 2. Search Input -->
          <bim-text-input ${BUI.ref((e) => { searchInput = e as BUI.TextInput; })} @input=${applyFiltersAndGroup} vertical placeholder="Search Name, Type or Entity..." debounce="200" style="flex: 1; min-width: 140px;"></bim-text-input>

          <!-- 3. Clear Search Button -->
          <bim-button @click=${() => { if (searchInput) { searchInput.value = ""; applyFiltersAndGroup(); } }} icon=${appIcons.CLEAR} tooltip-title="Clear search" style="margin: 0; flex: 0 0 auto;"></bim-button>

          <!-- 4. Refresh Button -->
          <bim-button @click=${({ target }: { target: BUI.Button }) => loadData(target)} icon=${appIcons.REFRESH} tooltip-title="Refresh openings data" style="margin: 0; flex: 0 0 auto;"></bim-button>

          <!-- 5. 3D Visibility Toggle Button -->
          <bim-button 
            ${BUI.ref((e) => { toggle3DBtn = e as BUI.Button; if (toggle3DBtn) toggle3DBtn.active = relService.isOpeningsVisible; })}
            @click=${async ({ target }: { target: BUI.Button }) => {
      if (relService.isOpeningsVisible) {
        relService.hideOpenings();
        target.active = false;
      } else {
        await relService.showOpenings();
        target.active = true;
      }
    }} 
            icon=${appIcons.ISOLATE} 
            tooltip-title="Toggle 3D openings visibility" 
            style="margin: 0; flex: 0 0 auto;"
          ></bim-button>

          <!-- 6. CSV Export Button -->
          <bim-button @click=${exportToCSV} icon=${appIcons.EXPORT} tooltip-title="Export to CSV" style="margin: 0; flex: 0 0 auto;"></bim-button>

          <!-- 7. Pagination Controls -->
          ${createPaginationTemplate(onPrevPage, onNextPage, paginationRefs)}
        </div>

        <!-- Table Container -->
        <div style="flex: 1; overflow: auto; min-height: 200px; margin-top: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; background: var(--bim-ui_bg-base);">
          ${openingsTable}
        </div>
      </bim-panel-section>
    </bim-panel>
  `;
};

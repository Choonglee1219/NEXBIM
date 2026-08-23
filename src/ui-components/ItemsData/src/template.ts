import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { ItemsDataState, ItemsDataTableData, ModelIdMap } from "./types";
import { setupBIMTable, onTableCellCreated, onTableRowCreated, appIcons } from "../../../globals";
import { RelationParsingService } from "../../../bim-components/RelationParsingService";
import { Highlighter } from "../../../bim-components/Highlighter";

let itemsRowsCache: { [modelID: string]: Map<number, BUI.TableGroupData> } = {};

const attrMappings: Record<string, string> = {
  _category: "Category",
  _localId: "LocalId",
  _guid: "Guid",
};

const extractValue = (attr: any): any => {
  if (attr === null || attr === undefined) return null;
  if (Array.isArray(attr)) return attr.length > 0 ? extractValue(attr[0]) : null;
  if (typeof attr === "object" && "value" in attr) return attr.value;
  return attr;
};

const addDataToRow = (
  row: BUI.TableGroupData<ItemsDataTableData>,
  key: string,
  value: any,
  modelId: string,
  localId: number,
  dataType?: string,
) => {
  const dataRow: BUI.TableGroupData<ItemsDataTableData> = {
    data: {
      type: "attribute",
      modelId,
      localId,
      Name: key in attrMappings ? attrMappings[key] : key,
      Value: extractValue(value),
      dataType
    },
  };
  if (!row.children) row.children = [];
  row.children.push(dataRow);
};

const getItemRow = (
  modelId: string,
  propertyData: FRAGS.ItemData,
  state: Required<ItemsDataState>,
  parentRelation?: string,
  visited: Set<number> = new Set(),
) => {
  try {
    if (!(modelId in itemsRowsCache)) itemsRowsCache[modelId] = new Map();
    const modelProcessings = itemsRowsCache[modelId];

    const localId = propertyData && propertyData._localId && (propertyData._localId as any).value !== undefined
      ? (propertyData._localId as any).value
      : Math.floor(Math.random() * 1000000);

    if (propertyData && propertyData._localId && (propertyData._localId as any).value !== undefined) {
      const localIdVal = (propertyData._localId as any).value;
      if (visited.has(localIdVal)) {
        const categoryVal = propertyData._category && "value" in propertyData._category
          ? (propertyData._category as any).value
          : "Element";
        return {
          data: {
            modelId,
            localId: localIdVal,
            type: "item",
            Name: `[Cycle: ${categoryVal} ${localIdVal}]`,
          }
        } as BUI.TableGroupData<ItemsDataTableData>;
      }
    }

    const nextVisited = new Set(visited);
    if (propertyData && propertyData._localId && (propertyData._localId as any).value !== undefined) {
      nextVisited.add((propertyData._localId as any).value);
    }

    const isRestricted = !!parentRelation && !["HasProperties", "Quantities"].includes(parentRelation);

    const name = propertyData && propertyData[state.defaultItemNameKey] && (propertyData[state.defaultItemNameKey] as any).value !== undefined
      ? (propertyData[state.defaultItemNameKey] as any).value
      : undefined;

    const category = propertyData && propertyData._category && (propertyData._category as any).value !== undefined
      ? (propertyData._category as any).value
      : "Unknown";

    if (!isRestricted && modelProcessings.has(localId)) {
      const cachedRow = modelProcessings.get(localId)!;
      const newRow = { ...cachedRow, data: { ...cachedRow.data } };
      newRow.data.Name = name?.toString().length > 0
        ? (category && !parentRelation ? `${category} || ${name}` : name.toString())
        : category ?? String(localId);
      return newRow;
    }

    const row: BUI.TableGroupData<ItemsDataTableData> = {
      data: {
        modelId,
        localId,
        type: "item",
        Name:
          name?.toString().length > 0
            ? (category && !parentRelation ? `${category} || ${name}` : name.toString())
            : category ?? String(localId),
      },
    };

    if (parentRelation === "ContainedInStructure") {
      row.data.Name = String(category ?? "Unknown");
      row.data.Value = name?.toString();
    }

    if (typeof category === "string") {
      if (category === "IFCPROPERTYSINGLEVALUE") {
        const val = propertyData.NominalValue as FRAGS.ItemAttribute;
        if (val) {
          row.data.Value = extractValue(val.value);
          row.data.dataType = val.type;
        }
        if (!isRestricted) modelProcessings.set(localId, row);
        return row;
      }
      if (category.startsWith("IFCQUANTITY")) {
        for (const key in propertyData) {
          if (key.endsWith("Value") && key !== "NominalValue") {
            const val = propertyData[key] as FRAGS.ItemAttribute;
            if (val && !Array.isArray(val)) {
              row.data.Value = extractValue(val.value);
              row.data.dataType = val.type;
              break;
            }
          }
        }
        if (!isRestricted) modelProcessings.set(localId, row);
        return row;
      }
    }

    if (!isRestricted) {
      modelProcessings.set(localId, row);
    }

    const flattenRelations = ["IsDefinedBy", "HasProperties", "Quantities", "RelatingPropertyDefinition"];
    const allowedRelations = [
      "IsDefinedBy",
      "ContainedInStructure",
      "RelatingPropertyDefinition",
      "HasProperties",
      "Quantities",
      "HasAssociations",
      "HasPropertySets"
    ];

    for (const key in propertyData) {
      const data = propertyData[key];
      if (data === null || data === undefined) continue;

      const isRelation = Array.isArray(data) || (typeof data === "object" && !("value" in data));

      if (!isRelation) {
        const mappedKey = attrMappings[key] || key;
        if (isRestricted) {
          if (parentRelation === "ContainedInStructure") continue;
          if (mappedKey !== "Category" && mappedKey !== "Name") continue;
          if (parentRelation === "IsDefinedBy") continue;
        } else if (parentRelation && ["HasProperties", "Quantities"].includes(parentRelation)) {
          if (["Category", "LocalId", "Guid"].includes(mappedKey)) continue;
        }
        addDataToRow(row, key, (data as any).value, modelId, localId, (data as any).type);
      } else {
        if (!allowedRelations.includes(key)) continue;
        if (parentRelation === "ContainedInStructure" && key !== "IsDefinedBy") continue;
        const items = Array.isArray(data) ? data : [data];

        if (flattenRelations.includes(key)) {
          if (!row.children) row.children = [];
          for (const item of items) {
            const relItemRow = getItemRow(modelId, item as any, state, key, nextVisited);
            row.children.push(relItemRow);
          }
        } else {
          const relRow: BUI.TableGroupData<ItemsDataTableData> = {
            data: {
              Name: key === "ContainedInStructure" ? "ContainedIn" : key,
              type: "relation"
            },
          };
          if (!row.children) row.children = [];
          row.children.push(relRow);

          for (const item of items) {
            const relItemRow = getItemRow(modelId, item as any, state, key, nextVisited);
            if (!relRow.children) relRow.children = [];
            relRow.children.push(relItemRow);
          }
        }
      }
    }

    return row;
  } catch (err) {
    console.error("Error in getItemRow:", err);
    throw err;
  }
};

const createRelationRow = (
  name: string,
  value: string | number | boolean,
  modelId: string,
  localId: number
): BUI.TableGroupData<ItemsDataTableData> => ({
  data: {
    Name: name,
    Value: value,
    type: "item",
    modelId,
    localId,
  },
});

const entityLabelCache = new Map<string, string>();

async function resolveEntityLabel(
  model: FRAGS.FragmentsModel,
  modelId: string,
  expressId: number,
  relData?: any
): Promise<string> {
  const cacheKey = `${modelId}_${expressId}`;
  if (entityLabelCache.has(cacheKey)) {
    return entityLabelCache.get(cacheKey)!;
  }

  // 1. Check if it's an Opening
  if (relData?.openings?.has(expressId)) {
    const op = relData.openings.get(expressId);
    const label = `IFCOPENINGELEMENT  ||  ${op.name || `#${expressId}`}`;
    entityLabelCache.set(cacheKey, label);
    return label;
  }

  // 2. Check if it's a Spatial Zone
  if (relData?.spatialZones?.has(expressId)) {
    const zone = relData.spatialZones.get(expressId);
    const name = zone.name || zone.longName || `#${expressId}`;
    const label = `IFCSPATIALZONE  ||  ${name}`;
    entityLabelCache.set(cacheKey, label);
    return label;
  }

  // 3. Query from ThatOpen model.getItemsData
  try {
    const [attrs] = await model.getItemsData([expressId], { attributesDefault: true });
    if (attrs) {
      const category = extractValue(attrs._category) || "IFCELEMENT";
      const name = extractValue(attrs.Name) || `#${expressId}`;
      const label = `${category}  ||  ${name}`;
      entityLabelCache.set(cacheKey, label);
      return label;
    }
  } catch (e) {}


  const fallback = `IFCELEMENT  ||  #${expressId}`;
  entityLabelCache.set(cacheKey, fallback);
  return fallback;
}

const computeTableData = async (
  components: OBC.Components,
  modelIdMap: ModelIdMap,
  state: Required<ItemsDataState>,
) => {
  const fragments = components.get(OBC.FragmentsManager);
  if (Object.keys(modelIdMap).length === 0) itemsRowsCache = {};

  const rows: BUI.TableGroupData<ItemsDataTableData>[] = [];
  for (const modelId in modelIdMap) {
    const model = fragments.list.get(modelId);
    if (!model) continue;
    if (!(modelId in itemsRowsCache)) itemsRowsCache[modelId] = new Map();
    const modelProcessings = itemsRowsCache[modelId];
    const localIds = modelIdMap[modelId];

    let relData: any = null;
    try {
      const relService = components.get(RelationParsingService);
      relData = relService.getRelationsByModelKey(modelId) || (await relService.getModelRelations(model));
    } catch (e) {}

    for (const localId of localIds) {
      let elementRow = modelProcessings.get(localId);
      if (!elementRow) {
        const [elementAttrs] = await model.getItemsData(
          [localId],
          state.itemsDataConfig,
        );
        elementRow = getItemRow(modelId, elementAttrs, state);
      }

      // 🔗 IFC Relational Connections Integration (Contained, Referenced, Voids, Fills)
      const relationChildren: BUI.TableGroupData<ItemsDataTableData>[] = [];

      // 1. Contained (Spatial Container: Storey/Building from ContainedInStructure)
      if (elementRow.children) {
        const containedIdx = elementRow.children.findIndex(
          (c) => c.data.Name === "ContainedIn" || c.data.Name === "ContainedInStructure" || c.data.Name === "Contained"
        );
        if (containedIdx >= 0) {
          const containedGroup = elementRow.children.splice(containedIdx, 1)[0];
          if (containedGroup.children && containedGroup.children.length > 0) {
            for (const child of containedGroup.children) {
              const mId = String(child.data.modelId || modelId);
              const lId = Number(child.data.localId !== undefined ? child.data.localId : localId);
              const label = await resolveEntityLabel(model, mId, lId, relData);
              relationChildren.push(
                createRelationRow("Contained", label, mId, lId)
              );
            }
          } else if (containedGroup.data.Value !== undefined) {
            const mId = String(containedGroup.data.modelId || modelId);
            const lId = Number(containedGroup.data.localId !== undefined ? containedGroup.data.localId : localId);
            const label = await resolveEntityLabel(model, mId, lId, relData);
            relationChildren.push(
              createRelationRow("Contained", label, mId, lId)
            );
          }
        }
      }

      if (relData && elementRow) {
        // 2. Referenced (IfcRelReferencedInSpatialStructure)
        // Element referenced in Spatial Zone
        if (relData.elementToZones.has(localId)) {
          const zoneIds = relData.elementToZones.get(localId)!;
          for (const zId of zoneIds) {
            const label = await resolveEntityLabel(model, modelId, zId, relData);
            relationChildren.push(
              createRelationRow("Referenced", label, modelId, zId)
            );
          }
        }
        // Spatial Zone -> Referenced Elements
        if (relData.spatialZones.has(localId)) {
          const zoneData = relData.spatialZones.get(localId)!;
          if (zoneData.referencedElementIds) {
            for (const refId of zoneData.referencedElementIds) {
              const label = await resolveEntityLabel(model, modelId, refId, relData);
              relationChildren.push(
                createRelationRow("Referenced", label, modelId, refId)
              );
            }
          }
        }

        // 3. Voids (IfcRelVoidsElement: Wall/Slab <-> Opening)
        // IfcOpeningElement -> Host Element
        if (relData.openings.has(localId)) {
          const opData = relData.openings.get(localId)!;
          if (opData.parentExpressId) {
            const label = await resolveEntityLabel(model, modelId, opData.parentExpressId, relData);
            relationChildren.push(
              createRelationRow("Voids", label, modelId, opData.parentExpressId)
            );
          }
        }
        // Host Wall/Slab -> Openings
        if (relData.elementToOpenings.has(localId)) {
          const opIds = relData.elementToOpenings.get(localId)!;
          for (const opId of opIds) {
            const label = await resolveEntityLabel(model, modelId, opId, relData);
            relationChildren.push(
              createRelationRow("Voids", label, modelId, opId)
            );
          }
        }

        // 4. Fills (IfcRelFillsElement: Opening <-> Door/Window)
        // IfcOpeningElement -> Filling Elements
        if (relData.openings.has(localId)) {
          const opData = relData.openings.get(localId)!;
          if (opData.fillingExpressIds) {
            for (const fillId of opData.fillingExpressIds) {
              const label = await resolveEntityLabel(model, modelId, fillId, relData);
              relationChildren.push(
                createRelationRow("Fills", label, modelId, fillId)
              );
            }
          }
        }
        // Door/Window -> Opening
        if (relData.fillingToOpening.has(localId)) {
          const opId = relData.fillingToOpening.get(localId)!;
          const label = await resolveEntityLabel(model, modelId, opId, relData);
          relationChildren.push(
            createRelationRow("Fills", label, modelId, opId)
          );
        }
      }

      if (relationChildren.length > 0) {
        const relGroupRow: BUI.TableGroupData<ItemsDataTableData> = {
          data: {
            Name: "Relations",
            type: "relation",
          },
          children: relationChildren,
        };

        if (!elementRow.children) elementRow.children = [];
        const existingIdx = elementRow.children.findIndex(
          (c) => c.data.Name === "Relations" || c.data.Name === "🔗 IFC Relations (연결 관계망)" || c.data.Name === "ContainedIn"
        );
        if (existingIdx >= 0) {
          elementRow.children[existingIdx] = relGroupRow;
        } else {
          elementRow.children.unshift(relGroupRow);
        }
      }

      rows.push(elementRow);
    }
  }
  return rows;
};




export const itemsDataTemplate = (_state: ItemsDataState) => {
  const state: Required<ItemsDataState> = {
    emptySelectionWarning: true,
    defaultItemNameKey: "Name",
    itemsDataConfig: {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        DefinesOcurrence: { attributes: false, relations: false },
        ContainedInStructure: { attributes: true, relations: true },
        ContainsElements: { attributes: false, relations: false },
        Decomposes: { attributes: false, relations: false },
        RelatingPropertyDefinition: { attributes: true, relations: true },
        HasProperties: { attributes: true, relations: true },
        Quantities: { attributes: true, relations: true },
      },
    },
    ..._state,
  };

  const { components, modelIdMap, emptySelectionWarning } = _state;
  const fragments = components.get(OBC.FragmentsManager);

  // itemsRowsCache 메모리 누수 방지
  fragments.list.onItemDeleted.add((modelId) => {
    delete itemsRowsCache[modelId];
  });

  const filteredModelIdMap = Object.keys(modelIdMap).reduce((acc, key) => {
    if (!key.includes('DELTA')) {
      acc[key] = modelIdMap[key];
    }
    return acc;
  }, {} as typeof modelIdMap);

  const onTableCreated = async (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table<ItemsDataTableData>;
    setupBIMTable(table);

    table.loadFunction = async () => {
      try {
        const data = await computeTableData(components, filteredModelIdMap, state);
        return data;
      } catch (err) {
        console.error("Error in loadFunction:", err);
        throw err;
      }
    };

    try {
      const loaded = await table.loadData(true);
      if (loaded) table.dispatchEvent(new Event("datacomputed"));
    } catch (err) {
      console.error("Error in loadData:", err);
    }
  };

  const onCellCreated = ({
    detail,
  }: CustomEvent<BUI.CellCreatedEventDetail>) => {
    onTableCellCreated(new CustomEvent("cellcreated", { detail })); // 전역 이벤트 주입
    const { cell } = detail;

    const { Name, Value } = cell.rowData
    if (Name && Value === undefined) {
      setTimeout(() => {
        cell.style.gridColumn = "1 / -1";
      })
    }
  };

  const onRowCreated = (
    e: CustomEvent<BUI.RowCreatedEventDetail<ItemsDataTableData>>,
  ) => {
    onTableRowCreated(e); // 전역 이벤트 주입
    const { row } = e.detail;
    
    row.onclick = async () => {
      const { modelId, localId } = row.data;
      if (!modelId || localId === undefined) return;

      const highlighter = components.get(Highlighter);
      const modelIdMap = { [modelId]: new Set([localId]) };
      await highlighter.highlightByID("select", modelIdMap, true, true);

      const worlds = components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;
      
      if (world && world.camera && "fitToItems" in world.camera) {
        await (world.camera as any).fitToItems(modelIdMap);
      }
    };

  };

  return BUI.html`
    <bim-table @rowcreated=${onRowCreated} @cellcreated=${onCellCreated} ${BUI.ref(onTableCreated)}>
      ${
        emptySelectionWarning
          ? BUI.html`
            <bim-label slot="missing-data" style="--bim-icon--c: gold" icon=${appIcons.WARNING}>
              Select some elements to display its properties
            </bim-label>
            `
          : null
      }
      <bim-label slot="error-loading" style="--bim-icon--c: #e72e2e" icon=${appIcons.ERRORALT}>
        Something went wrong with the properties
      </bim-label>
    </bim-table>
  `;
};
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { ItemsDataState, ItemsDataTableData, ModelIdMap } from "./types";
import { setupBIMTable, onTableCellCreated, onTableRowCreated, appIcons } from "../../../globals";
import { RelationParsingService } from "../../../bim-components/RelationParsingService";
import { Highlighter } from "../../../bim-components/Highlighter";
import { buildModelClassificationMap, extractClassificationValue } from "../../../bim-components/RuleService/src/helpers";

export interface EntityInfo {
  category: string;
  name: string;
}

// Global caches across renderings
let itemsRowsCache: { [modelID: string]: Map<number, BUI.TableGroupData> } = {};
const entityInfoCache = new Map<string, EntityInfo>();
const boundDeletedModels = new Set<string>();

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
      dataType,
    },
  };
  if (!row.children) row.children = [];
  row.children.push(dataRow);
};

const isTypeCategory = (cat: string) => {
  if (!cat) return false;
  const c = cat.toUpperCase();
  return (
    c.endsWith("TYPE") ||
    c.includes("TYPEPRODUCT") ||
    c.includes("TYPEOBJECT") ||
    c.startsWith("IFCRELDEFINESBYTYPE") ||
    c === "IFCRELDEFINESBYTYPE"
  );
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

    const localId =
      propertyData && propertyData._localId && (propertyData._localId as any).value !== undefined
        ? (propertyData._localId as any).value
        : Math.floor(Math.random() * 1000000);

    if (propertyData && propertyData._localId && (propertyData._localId as any).value !== undefined) {
      const localIdVal = (propertyData._localId as any).value;
      if (visited.has(localIdVal)) {
        const categoryVal =
          propertyData._category && "value" in propertyData._category
            ? (propertyData._category as any).value
            : "Element";
        return {
          data: {
            modelId,
            localId: localIdVal,
            type: "item",
            Name: `[Cycle: ${categoryVal} ${localIdVal}]`,
          },
        } as BUI.TableGroupData<ItemsDataTableData>;
      }
    }

    const nextVisited = new Set(visited);
    if (propertyData && propertyData._localId && (propertyData._localId as any).value !== undefined) {
      nextVisited.add((propertyData._localId as any).value);
    }

    const isRestricted = !!parentRelation && !["HasProperties", "Quantities"].includes(parentRelation);

    const rawName = propertyData && propertyData[state.defaultItemNameKey];
    const name = rawName !== undefined ? extractValue(rawName) : undefined;

    const rawCat = propertyData && propertyData._category;
    const category = extractValue(rawCat) || (typeof rawCat === "string" ? rawCat : undefined) || "Unknown";

    const itemName = name?.toString().length > 0 ? name.toString() : (category ?? String(localId));
    const itemCategory = !parentRelation && category ? category : undefined;

    if (!isRestricted && modelProcessings.has(localId)) {
      const cachedRow = modelProcessings.get(localId)!;
      const newRow = { ...cachedRow, data: { ...cachedRow.data } };
      newRow.data.Name = itemName;
      newRow.data.category = itemCategory;
      return newRow;
    }

    const row: BUI.TableGroupData<ItemsDataTableData> = {
      data: {
        modelId,
        localId,
        type: "item",
        Name: itemName,
        category: itemCategory,
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
          row.data.dataType = val.type ? String(val.type) : undefined;
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
              if (val.type) {
                row.data.dataType = String(val.type);
              } else if (category === "IFCQUANTITYLENGTH" || key === "LengthValue") {
                row.data.dataType = "IFCLENGTHMEASURE";
              } else if (category === "IFCQUANTITYAREA" || key === "AreaValue") {
                row.data.dataType = "IFCAREAMEASURE";
              } else if (category === "IFCQUANTITYVOLUME" || key === "VolumeValue") {
                row.data.dataType = "IFCVOLUMEMEASURE";
              } else if (category === "IFCQUANTITYCOUNT" || key === "CountValue") {
                row.data.dataType = "IFCCOUNTMEASURE";
              } else if (category === "IFCQUANTITYWEIGHT" || key === "WeightValue") {
                row.data.dataType = "IFCMASSMEASURE";
              } else if (category === "IFCQUANTITYTIME" || key === "TimeValue") {
                row.data.dataType = "IFCTIMEMEASURE";
              }
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

    const flattenRelations = [
      "IsDefinedBy",
      "HasProperties",
      "Quantities",
      "RelatingPropertyDefinition",
      "HasPropertySets",
      "IsTypedBy",
      "RelatingType",
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
          if (
            parentRelation === "IsDefinedBy" ||
            parentRelation === "HasPropertySets" ||
            parentRelation === "RelatingPropertyDefinition" ||
            parentRelation === "RelatingType" ||
            parentRelation === "IsTypedBy"
          ) {
            continue;
          }
        } else if (parentRelation && ["HasProperties", "Quantities"].includes(parentRelation)) {
          if (["Category", "LocalId", "Guid"].includes(mappedKey)) continue;
        }
        const dataVal = extractValue(data);
        addDataToRow(row, key, dataVal, modelId, localId, (data as any)?.type);
      } else {
        if (!flattenRelations.includes(key)) continue;
        if (parentRelation === "ContainedInStructure" && key !== "IsDefinedBy") continue;
        const items = Array.isArray(data) ? data : [data];

        if (!row.children) row.children = [];
        for (const item of items) {
          const relItemRow = getItemRow(modelId, item as any, state, key, nextVisited);
          const itemCat = String(
            (item && item._category && "value" in item._category
              ? (item._category as any).value
              : "") || ""
          );

          if (isTypeCategory(itemCat)) {
            if (relItemRow.children && relItemRow.children.length > 0) {
              const typePsets = relItemRow.children.filter((c) =>
                String(c.data?.Name || "").startsWith("Pset_")
              );
              row.children.push(...typePsets);
            }
          } else {
            row.children.push(relItemRow);
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

async function preloadEntityInfoCache(
  model: FRAGS.FragmentsModel,
  modelId: string,
  expressIds: number[],
  relData?: any
) {
  const missingIds: number[] = [];
  for (const id of expressIds) {
    const cacheKey = `${modelId}_${id}`;
    if (entityInfoCache.has(cacheKey)) continue;

    // 1. STEP 파싱 데이터(relData) 최우선 캐싱
    if (relData?.openings?.has(id)) {
      const op = relData.openings.get(id);
      entityInfoCache.set(cacheKey, {
        category: "IFCOPENINGELEMENT",
        name: op.name || `#${id}`,
      });
      continue;
    }
    if (relData?.spatialZones?.has(id)) {
      const zone = relData.spatialZones.get(id);
      entityInfoCache.set(cacheKey, {
        category: "IFCSPATIALZONE",
        name: zone.name || zone.longName || `#${id}`,
      });
      continue;
    }

    missingIds.push(id);
  }

  if (missingIds.length === 0) return;

  try {
    const items = await model.getItemsData(missingIds, { attributesDefault: true });
    for (let i = 0; i < missingIds.length; i++) {
      const id = missingIds[i];
      const attrs = items[i];
      if (attrs) {
        const category = extractValue(attrs._category) || "IFCELEMENT";
        const name =
          extractValue(attrs.Name) ||
          extractValue(attrs.LayerSetName) ||
          extractValue(attrs.MaterialName) ||
          `#${id}`;
        entityInfoCache.set(`${modelId}_${id}`, { category, name });
      } else {
        entityInfoCache.set(`${modelId}_${id}`, { category: "IFCELEMENT", name: `#${id}` });
      }
    }
  } catch (e) { }
}

function resolveEntityInfoSync(
  modelId: string,
  expressId: number,
  relData?: any
): EntityInfo {
  const cacheKey = `${modelId}_${expressId}`;

  // 1. STEP 파싱 데이터(relData) 최우선 확인
  if (relData?.openings?.has(expressId)) {
    const op = relData.openings.get(expressId);
    const info: EntityInfo = {
      category: "IFCOPENINGELEMENT",
      name: op.name || `#${expressId}`,
    };
    entityInfoCache.set(cacheKey, info);
    return info;
  }

  // 2. Spatial Zone
  if (relData?.spatialZones?.has(expressId)) {
    const zone = relData.spatialZones.get(expressId);
    const info: EntityInfo = {
      category: "IFCSPATIALZONE",
      name: zone.name || zone.longName || `#${expressId}`,
    };
    entityInfoCache.set(cacheKey, info);
    return info;
  }

  if (entityInfoCache.has(cacheKey)) {
    return entityInfoCache.get(cacheKey)!;
  }

  const fallback: EntityInfo = {
    category: "IFCELEMENT",
    name: `#${expressId}`,
  };
  return fallback;
}

const getNodeOrderGroup = (node: BUI.TableGroupData<ItemsDataTableData>): number => {
  const name = String(node.data?.Name || "");
  const type = node.data?.type;

  // 1. Attributes
  if (type === "attribute") {
    return 1;
  }
  // 2. Pset_
  if (name.startsWith("Pset_") || (type === "item" && !name.startsWith("Qto_") && !name.startsWith("Rel_") && !name.includes("Quantities"))) {
    return 2;
  }
  // 3. Qto_
  if (name.startsWith("Qto_") || name.includes("Quantities")) {
    return 3;
  }
  // 4. Rel_
  if (name.startsWith("Rel_")) {
    return 4;
  }
  return 5;
};

const sortChildren = (children: BUI.TableGroupData<ItemsDataTableData>[]) => {
  children.sort((a, b) => {
    const groupA = getNodeOrderGroup(a);
    const groupB = getNodeOrderGroup(b);
    if (groupA !== groupB) {
      return groupA - groupB;
    }
    const nameA = String(a.data?.Name || "");
    const nameB = String(b.data?.Name || "");
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
  });

  for (const child of children) {
    if (child.children && child.children.length > 0) {
      child.children.sort((a, b) => {
        const nameA = String(a.data?.Name || "");
        const nameB = String(b.data?.Name || "");
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
      });
    }
  }
};

const createRelationChildRow = (
  category: string,
  name: string,
  modelId: string,
  localId: number
): BUI.TableGroupData<ItemsDataTableData> => ({
  data: {
    Name: category,
    Value: name,
    type: "item",
    modelId,
    localId,
  },
});

// Helper: Collect related IDs for preloading
const collectRelatedIds = (elementAttrs: any, numLocalId: number, relData: any): number[] => {
  const ids: number[] = [];

  // ContainedIn
  if (elementAttrs?.ContainedInStructure) {
    const containers = Array.isArray(elementAttrs.ContainedInStructure)
      ? elementAttrs.ContainedInStructure
      : [elementAttrs.ContainedInStructure];
    for (const cont of containers) {
      const cId = Number(
        extractValue(cont._localId) ||
        extractValue(cont.RelatingStructure?._localId) ||
        extractValue(cont.RelatingStructure)
      );
      if (!isNaN(cId) && cId > 0) ids.push(cId);
    }
  }

  // Relations from relData
  if (relData) {
    if (relData.elementToZones?.has(numLocalId)) {
      ids.push(...relData.elementToZones.get(numLocalId)!);
    }
    if (relData.openings?.has(numLocalId)) {
      const op = relData.openings.get(numLocalId)!;
      if (op.parentExpressId) ids.push(op.parentExpressId);
      if (op.fillingExpressIds) ids.push(...op.fillingExpressIds);
    }
    if (relData.elementToOpenings?.has(numLocalId)) {
      ids.push(...relData.elementToOpenings.get(numLocalId)!);
    }
    if (relData.openingToFillings?.has(numLocalId)) {
      ids.push(...relData.openingToFillings.get(numLocalId)!);
    }
    if (relData.fillingToOpening?.has(numLocalId)) {
      ids.push(relData.fillingToOpening.get(numLocalId)!);
    }
  }

  // Materials
  if (elementAttrs?.HasAssociations) {
    const assocs = Array.isArray(elementAttrs.HasAssociations)
      ? elementAttrs.HasAssociations
      : [elementAttrs.HasAssociations];
    for (const a of assocs) {
      const mId = Number(extractValue(a._localId) || extractValue(a.RelatingMaterial?._localId));
      if (!isNaN(mId) && mId > 0) ids.push(mId);
    }
  }

  return ids;
};

// 1. Rel_ContainedIn Builder
const buildContainedChildren = (
  elementAttrs: any,
  modelId: string,
  localId: number,
  relData: any
): BUI.TableGroupData<ItemsDataTableData>[] => {
  const children: BUI.TableGroupData<ItemsDataTableData>[] = [];
  if (!elementAttrs?.ContainedInStructure) return children;

  const containers = Array.isArray(elementAttrs.ContainedInStructure)
    ? elementAttrs.ContainedInStructure
    : [elementAttrs.ContainedInStructure];

  for (const cont of containers) {
    const cId = Number(
      extractValue(cont._localId) ||
      extractValue(cont.RelatingStructure?._localId) ||
      extractValue(cont.RelatingStructure)
    );
    if (!isNaN(cId) && cId > 0) {
      const info = resolveEntityInfoSync(modelId, cId, relData);
      children.push(createRelationChildRow(info.category, info.name, modelId, cId));
    } else {
      const directCat = String(extractValue(cont._category) || "IFCBUILDINGSTOREY");
      const directName = String(extractValue(cont.Name) || extractValue(cont.LongName) || "-");
      children.push(createRelationChildRow(directCat, directName, modelId, localId));
    }
  }
  return children;
};

// 2. Rel_Referenced Builder
const buildReferencedChildren = (
  numLocalId: number,
  modelId: string,
  relData: any
): BUI.TableGroupData<ItemsDataTableData>[] => {
  const children: BUI.TableGroupData<ItemsDataTableData>[] = [];
  if (!relData) return children;

  const matchedZoneIds = new Set<number>();
  if (relData.elementToZones?.has(numLocalId)) {
    for (const zId of relData.elementToZones.get(numLocalId)!) matchedZoneIds.add(zId);
  }
  for (const [zId, zone] of relData.spatialZones?.entries() || []) {
    if (zone.referencedElementIds && zone.referencedElementIds.includes(numLocalId)) {
      matchedZoneIds.add(zId);
    }
  }
  for (const zId of matchedZoneIds) {
    const info = resolveEntityInfoSync(modelId, zId, relData);
    children.push(createRelationChildRow(info.category, info.name, modelId, zId));
  }

  if (relData.spatialZones?.has(numLocalId)) {
    const zoneData = relData.spatialZones.get(numLocalId)!;
    if (zoneData.referencedElementIds) {
      for (const refId of zoneData.referencedElementIds) {
        const info = resolveEntityInfoSync(modelId, refId, relData);
        children.push(createRelationChildRow(info.category, info.name, modelId, refId));
      }
    }
  }
  return children;
};

// 3. Rel_Voids Builder
const buildVoidsChildren = (
  numLocalId: number,
  modelId: string,
  relData: any
): BUI.TableGroupData<ItemsDataTableData>[] => {
  const children: BUI.TableGroupData<ItemsDataTableData>[] = [];
  if (!relData) return children;

  if (relData.openings?.has(numLocalId)) {
    const opData = relData.openings.get(numLocalId)!;
    if (opData.parentExpressId) {
      const info = resolveEntityInfoSync(modelId, opData.parentExpressId, relData);
      children.push(createRelationChildRow(info.category, info.name, modelId, opData.parentExpressId));
    }
  }

  const hostOpeningIds = new Set<number>();
  if (relData.elementToOpenings?.has(numLocalId)) {
    for (const opId of relData.elementToOpenings.get(numLocalId)!) hostOpeningIds.add(opId);
  }
  for (const [opId, opData] of relData.openings?.entries() || []) {
    if (opData.parentExpressId === numLocalId) hostOpeningIds.add(opId);
  }
  for (const opId of hostOpeningIds) {
    const info = resolveEntityInfoSync(modelId, opId, relData);
    children.push(createRelationChildRow(info.category, info.name, modelId, opId));
  }
  return children;
};

// 4. Rel_Fills Builder
const buildFillsChildren = (
  numLocalId: number,
  modelId: string,
  relData: any
): BUI.TableGroupData<ItemsDataTableData>[] => {
  const children: BUI.TableGroupData<ItemsDataTableData>[] = [];
  if (!relData) return children;

  const fillingIds = new Set<number>();
  if (relData.openings?.has(numLocalId)) {
    const opData = relData.openings.get(numLocalId)!;
    if (opData.fillingExpressIds) for (const fillId of opData.fillingExpressIds) fillingIds.add(fillId);
  }
  if (relData.openingToFillings?.has(numLocalId)) {
    for (const fillId of relData.openingToFillings.get(numLocalId)!) fillingIds.add(fillId);
  }
  for (const [fillId, opId] of relData.fillingToOpening?.entries() || []) {
    if (opId === numLocalId) fillingIds.add(fillId);
  }
  for (const fillId of fillingIds) {
    const info = resolveEntityInfoSync(modelId, fillId, relData);
    children.push(createRelationChildRow(info.category, info.name, modelId, fillId));
  }

  let parentOpId: number | null = null;
  if (relData.fillingToOpening?.has(numLocalId)) {
    parentOpId = relData.fillingToOpening.get(numLocalId)!;
  } else {
    for (const [opId, op] of relData.openings?.entries() || []) {
      if (op.fillingExpressIds && op.fillingExpressIds.includes(numLocalId)) {
        parentOpId = opId;
        break;
      }
    }
  }
  if (parentOpId !== null) {
    const info = resolveEntityInfoSync(modelId, parentOpId, relData);
    children.push(createRelationChildRow(info.category, info.name, modelId, parentOpId));
  }
  return children;
};

// 5. Rel_Material Builder
const buildMaterialChildren = (
  elementAttrs: any,
  modelId: string,
  localId: number,
  relData: any
): BUI.TableGroupData<ItemsDataTableData>[] => {
  const children: BUI.TableGroupData<ItemsDataTableData>[] = [];
  if (!elementAttrs) return children;

  const assocsToProcess: any[] = [];
  if (Array.isArray(elementAttrs.HasAssociations)) {
    assocsToProcess.push(...elementAttrs.HasAssociations);
  } else if (elementAttrs.HasAssociations) {
    assocsToProcess.push(elementAttrs.HasAssociations);
  }
  if (elementAttrs.IsTypedBy) {
    const types = Array.isArray(elementAttrs.IsTypedBy) ? elementAttrs.IsTypedBy : [elementAttrs.IsTypedBy];
    for (const rel of types) {
      const typeObj = rel?.RelatingType || rel;
      if (typeObj && typeObj.HasAssociations) {
        const tAssocs = Array.isArray(typeObj.HasAssociations) ? typeObj.HasAssociations : [typeObj.HasAssociations];
        assocsToProcess.push(...tAssocs);
      }
    }
  }

  const processMaterialObj = (obj: any) => {
    if (!obj) return;
    const objCat = String(extractValue(obj._category) || "").toUpperCase();
    if (objCat.includes("CLASSIFICATION")) return;
    if (obj.RelatingMaterial) {
      processMaterialObj(obj.RelatingMaterial);
      return;
    }
    const lId = Number(extractValue(obj._localId) || localId);
    const info = resolveEntityInfoSync(modelId, lId, relData);
    let cat = info.category;
    let nm = info.name;
    if (cat === "IFCELEMENT" && objCat) cat = objCat;
    if (nm.startsWith("#") || nm === "Unknown") {
      const directName = extractValue(obj.Name) || extractValue(obj.LayerSetName) || extractValue(obj.MaterialName);
      if (directName) nm = directName;
    }
    if (cat.includes("MATERIAL") || cat.includes("LAYER") || cat.includes("PROFILE")) {
      if (!children.some((c) => c.data?.Name === cat && c.data?.Value === nm)) {
        children.push(createRelationChildRow(cat, nm, modelId, lId));
      }
    }
  };

  for (const assoc of assocsToProcess) {
    processMaterialObj(assoc);
  }
  return children;
};

// 6. Rel_Classification Builder
const buildClassificationChildren = (
  elementAttrs: any,
  classMap: Map<number, { system: string | null; code: string | null; full: string | null }> | undefined,
  numLocalId: number,
  modelId: string
): BUI.TableGroupData<ItemsDataTableData>[] => {
  const children: BUI.TableGroupData<ItemsDataTableData>[] = [];
  const classInfo = extractClassificationValue(elementAttrs || {}, classMap, numLocalId);
  if (classInfo.hasClassRel && (classInfo.classVal || classInfo.codeVal || classInfo.systemVal)) {
    const cat = classInfo.systemVal || "IFCCLASSIFICATION";
    const val = classInfo.codeVal || classInfo.classVal || "-";
    children.push(createRelationChildRow(cat, val, modelId, numLocalId));
  }
  return children;
};

const computeTableData = async (
  components: OBC.Components,
  modelIdMap: ModelIdMap,
  state: Required<ItemsDataState>,
) => {
  const fragments = components.get(OBC.FragmentsManager);
  const modelEntries = Object.entries(modelIdMap);
  if (modelEntries.length === 0) {
    return [];
  }

  const modelResults = await Promise.all(
    modelEntries.map(async ([modelId, localIds]) => {
      const model = fragments.list.get(modelId);
      const localIdsArray = Array.from(localIds || []);
      if (!model || localIdsArray.length === 0) return [];
      if (!(modelId in itemsRowsCache)) itemsRowsCache[modelId] = new Map();
      const modelProcessings = itemsRowsCache[modelId];

      let relData: any = null;
      let classMap: Map<number, { system: string | null; code: string | null; full: string | null }> | undefined;
      try {
        const relService = components.get(RelationParsingService);
        relData = relService.getRelationsByModelKey(modelId) || (await relService.getModelRelations(model));
      } catch (e) { }

      try {
        classMap = await buildModelClassificationMap(components, model);
      } catch (e) { }

      // 1. Single consolidated bulk fetch for items
      const allAttrsMap = new Map<number, any>();
      const fetchedItems = await model.getItemsData(localIdsArray, state.itemsDataConfig);
      for (let i = 0; i < localIdsArray.length; i++) {
        allAttrsMap.set(localIdsArray[i], fetchedItems[i]);
      }

      // 2. Pre-collect all related entity IDs to pre-fill entityInfoCache in 1 single bulk query
      const relatedIdsToPreload = new Set<number>();
      for (const localId of localIdsArray) {
        const numLocalId = Number(localId);
        const elementAttrs = allAttrsMap.get(localId);
        const ids = collectRelatedIds(elementAttrs, numLocalId, relData);
        for (const id of ids) relatedIdsToPreload.add(id);
      }

      if (relatedIdsToPreload.size > 0) {
        await preloadEntityInfoCache(model, modelId, Array.from(relatedIdsToPreload), relData);
      }

      // 3. Fast synchronous row assembly
      const rows: BUI.TableGroupData<ItemsDataTableData>[] = [];
      for (const localId of localIdsArray) {
        const numLocalId = Number(localId);
        let elementAttrs = allAttrsMap.get(localId);

        // 🛡️ 방어코드: FragmentsModel에 색인되지 않은 IfcOpeningElement / IfcSpatialZone 속성 주입 및 보정
        if (relData?.openings?.has(numLocalId)) {
          const opData = relData.openings.get(numLocalId);
          if (!elementAttrs) elementAttrs = {};
          if (!elementAttrs._localId) elementAttrs._localId = { value: numLocalId };
          if (!elementAttrs._category || !extractValue(elementAttrs._category)) {
            elementAttrs._category = { value: "IFCOPENINGELEMENT" };
          }
          if (opData?.name && (!elementAttrs.Name || !extractValue(elementAttrs.Name))) {
            elementAttrs.Name = { value: opData.name };
          }
          if (opData?.globalId && (!elementAttrs._guid || !extractValue(elementAttrs._guid))) {
            elementAttrs._guid = { value: opData.globalId };
          }
          if (opData?.predefinedType && !elementAttrs.PredefinedType) {
            elementAttrs.PredefinedType = { value: opData.predefinedType };
          }
        } else if (relData?.spatialZones?.has(numLocalId)) {
          const zoneData = relData.spatialZones.get(numLocalId);
          if (!elementAttrs) elementAttrs = {};
          if (!elementAttrs._localId) elementAttrs._localId = { value: numLocalId };
          if (!elementAttrs._category || !extractValue(elementAttrs._category)) {
            elementAttrs._category = { value: "IFCSPATIALZONE" };
          }
          if (zoneData?.name && (!elementAttrs.Name || !extractValue(elementAttrs.Name))) {
            elementAttrs.Name = { value: zoneData.name || zoneData.longName };
          }
          if (zoneData?.globalId && (!elementAttrs._guid || !extractValue(elementAttrs._guid))) {
            elementAttrs._guid = { value: zoneData.globalId };
          }
        }

        let elementRow = modelProcessings.get(localId);

        if (!elementRow) {
          elementRow = getItemRow(modelId, elementAttrs, state);
        }

        // Subgroups Building
        const containedChildren = buildContainedChildren(elementAttrs, modelId, localId, relData);
        const referencedChildren = buildReferencedChildren(numLocalId, modelId, relData);
        const voidsChildren = buildVoidsChildren(numLocalId, modelId, relData);
        const fillsChildren = buildFillsChildren(numLocalId, modelId, relData);
        const materialChildren = buildMaterialChildren(elementAttrs, modelId, localId, relData);
        const classificationChildren = buildClassificationChildren(elementAttrs, classMap, numLocalId, modelId);

        if (!elementRow.children) elementRow.children = [];

        // 중복 방지 필터링
        elementRow.children = elementRow.children.filter(
          (c) =>
            c.data?.Name !== "HasAssociations" &&
            c.data?.Name !== "Material" &&
            c.data?.Name !== "ContainedIn" &&
            c.data?.Name !== "ContainedInStructure" &&
            c.data?.Name !== "Contained" &&
            !String(c.data?.Name || "").startsWith("Rel_")
        );

        if (classificationChildren.length > 0) {
          elementRow.children.push({
            data: { Name: "Rel_Classification", type: "relation" },
            children: classificationChildren,
          });
        }
        if (containedChildren.length > 0) {
          elementRow.children.push({
            data: { Name: "Rel_ContainedIn", type: "relation" },
            children: containedChildren,
          });
        }
        if (referencedChildren.length > 0) {
          elementRow.children.push({
            data: { Name: "Rel_Referenced", type: "relation" },
            children: referencedChildren,
          });
        }
        if (voidsChildren.length > 0) {
          elementRow.children.push({
            data: { Name: "Rel_Voids", type: "relation" },
            children: voidsChildren,
          });
        }
        if (fillsChildren.length > 0) {
          elementRow.children.push({
            data: { Name: "Rel_Fills", type: "relation" },
            children: fillsChildren,
          });
        }
        if (materialChildren.length > 0) {
          elementRow.children.push({
            data: { Name: "Rel_Material", type: "relation" },
            children: materialChildren,
          });
        }

        sortChildren(elementRow.children);
        rows.push(elementRow);
      }
      return rows;
    })
  );

  return modelResults.flat();
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
        HasPropertySets: { attributes: true, relations: true },
        HasAssociations: { attributes: true, relations: true },
        IsTypedBy: { attributes: true, relations: true },
        RelatingType: { attributes: true, relations: true },
      },
    },
    ..._state,
  };

  const { components, modelIdMap, emptySelectionWarning } = _state;
  const fragments = components.get(OBC.FragmentsManager);

  // 메모리 누수 방지: 1회만 안전하게 등록
  const fragmentsKey = "GLOBAL_FRAGMENTS_LISTENER";
  if (!boundDeletedModels.has(fragmentsKey)) {
    boundDeletedModels.add(fragmentsKey);
    fragments.list.onItemDeleted.add((modelId) => {
      delete itemsRowsCache[modelId];
      for (const key of entityInfoCache.keys()) {
        if (key.startsWith(`${modelId}_`)) {
          entityInfoCache.delete(key);
        }
      }
    });
  }

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
    onTableCellCreated(new CustomEvent("cellcreated", { detail }));
    const { cell } = detail;

    const { Name, Value } = cell.rowData;
    if (Name && Value === undefined) {
      setTimeout(() => {
        cell.style.gridColumn = "1 / -1";
      });
    }
  };

  const onRowCreated = (
    e: CustomEvent<BUI.RowCreatedEventDetail<ItemsDataTableData>>,
  ) => {
    onTableRowCreated(e);
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
      ${emptySelectionWarning
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
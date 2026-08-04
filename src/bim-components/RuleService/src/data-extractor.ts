import * as OBC from "@thatopen/components";
import { RuleSpecDefinition } from "../../../setup/specs";
import { RuleTableData, RuleGroupByOption } from "./types";

export const getFlatData = (nodes: any[]): RuleTableData[] => {
  let result: RuleTableData[] = [];
  for (const n of nodes) {
    const d = n.data || n;
    if (d.isGroup && d.rawGroup) {
      result.push(...d.rawGroup);
    } else if (n.children) {
      result.push(...getFlatData(n.children));
    } else if (d.id) {
      result.push(d);
    }
  }
  return result;
};

const formatGroupColValue = (items: RuleTableData[], propKey: keyof RuleTableData, isGroupKey: boolean, defaultValue: string = "-"): string => {
  if (isGroupKey) {
    return String(items[0]?.[propKey] ?? defaultValue);
  }

  const uniqueVals = Array.from(
    new Set(
      items
        .map((i) => String(i[propKey] ?? "").trim())
        .filter((v) => v !== "" && v !== "-" && v !== "null" && v !== "undefined")
    )
  );

  if (uniqueVals.length === 0) return defaultValue;
  if (uniqueVals.length === 1) return uniqueVals[0];
  return `${uniqueVals.length} Unique`;
};

const getGroupStatus = (items: RuleTableData[]): string => {
  if (items.length === 0) return "Pass (100%)";
  const passCount = items.filter((i) => String(i.Status).startsWith("Pass")).length;
  const passRate = Math.round((passCount / items.length) * 100);
  return passRate === 100 ? "Pass (100%)" : `Fail (${passRate}%)`;
};

export const groupResultsBy = (flatItems: RuleTableData[], groupByColumn: RuleGroupByOption = "None"): any[] => {
  if (groupByColumn === "None") {
    return flatItems.map((item) => {
      const { isGroup, rawGroup, ...cleanItem } = item;
      return { data: { ...cleanItem, Count: 1 } };
    });
  }

  const groups = new Map<string, RuleTableData[]>();

  for (const item of flatItems) {
    let key = "";
    if (groupByColumn === "Model") key = item.Model || "Unknown Model";
    else if (groupByColumn === "Entity") key = item.Entity || "Unknown Entity";
    else if (groupByColumn === "Status") key = item.Status || "Unknown Status";
    else key = item.GUID || "Unknown GUID";

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const treeData: any[] = [];
  let groupCounter = 1;

  for (const [key, items] of groups.entries()) {
    const status = getGroupStatus(items);

    if (groupByColumn === "GUID") {
      if (items.length > 1 && key && key !== "Unknown" && key !== "Null") {
        const groupRowData: RuleTableData = {
          id: `group-guid-${key}-${groupCounter++}`,
          isGroup: true,
          Model: formatGroupColValue(items, "Model", false),
          Name: formatGroupColValue(items, "Name", false, `GUID: ${key}`),
          GUID: key,
          Entity: formatGroupColValue(items, "Entity", false),
          Value: formatGroupColValue(items, "Value", false),
          Count: items.length,
          Status: status,
          rawGroup: items,
        };
        treeData.push({
          data: groupRowData,
          children: items.map(i => ({ data: { ...i, Count: 1 } }))
        });
      } else {
        treeData.push(...items.map(i => ({ data: { ...i, Count: 1 } })));
      }
    } else if (groupByColumn === "Model") {
      const groupRowData: RuleTableData = {
        id: `group-model-${key}-${groupCounter++}`,
        isGroup: true,
        Model: key,
        Name: formatGroupColValue(items, "Name", false),
        GUID: formatGroupColValue(items, "GUID", false),
        Entity: formatGroupColValue(items, "Entity", false),
        Value: formatGroupColValue(items, "Value", false),
        Count: items.length,
        Status: status,
        rawGroup: items,
      };
      treeData.push({
        data: groupRowData,
        children: items.map(i => ({ data: { ...i, Count: 1 } }))
      });
    } else if (groupByColumn === "Entity") {
      const groupRowData: RuleTableData = {
        id: `group-entity-${key}-${groupCounter++}`,
        isGroup: true,
        Model: formatGroupColValue(items, "Model", false),
        Name: formatGroupColValue(items, "Name", false),
        GUID: formatGroupColValue(items, "GUID", false),
        Entity: key,
        Value: formatGroupColValue(items, "Value", false),
        Count: items.length,
        Status: status,
        rawGroup: items,
      };
      treeData.push({
        data: groupRowData,
        children: items.map(i => ({ data: { ...i, Count: 1 } }))
      });
    } else if (groupByColumn === "Status") {
      const groupRowData: RuleTableData = {
        id: `group-status-${key}-${groupCounter++}`,
        isGroup: true,
        Model: formatGroupColValue(items, "Model", false),
        Name: formatGroupColValue(items, "Name", false),
        GUID: formatGroupColValue(items, "GUID", false),
        Entity: formatGroupColValue(items, "Entity", false),
        Value: formatGroupColValue(items, "Value", false),
        Count: items.length,
        Status: status,
        rawGroup: items,
      };
      treeData.push({
        data: groupRowData,
        children: items.map(i => ({ data: { ...i, Count: 1 } }))
      });
    }
  }

  return treeData;
};

// Backward compatibility alias
export const groupByGUID = (flatData: any[]) => {
  const flatItems = getFlatData(flatData);
  return groupResultsBy(flatItems, "None");
};

export const extractData = async (fragments: OBC.FragmentsManager, allIds: OBC.ModelIdMap, specDef: RuleSpecDefinition) => {
  const itemPropsMap: Record<string, Record<number, { name: string; value: string; guid: string; entity: string }>> = {};

  const attrRegex = new RegExp(specDef.requirement.name || "", "i");
  const psetRegex = new RegExp(specDef.requirement.propertySet || "", "i");
  const propRegex = new RegExp(specDef.requirement.name || "", "i");

  for (const modelId in allIds) {
    const model = fragments.list.get(modelId);
    if (!model) continue;

    itemPropsMap[modelId] = {};
    const idsArray = Array.from(allIds[modelId]);
    const itemsData = await model.getItemsData(idsArray, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
      },
    });

    for (let i = 0; i < itemsData.length; i++) {
      const itemAny = itemsData[i] as any;
      const expressId = itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId ?? idsArray[i];

      let name = "Unknown";
      if (itemAny.Name) {
        name = typeof itemAny.Name === "object" && itemAny.Name.value !== undefined ? String(itemAny.Name.value) : String(itemAny.Name);
      }

      let guid = "Unknown";
      if (itemAny._guid) {
        guid = typeof itemAny._guid === "object" && itemAny._guid.value !== undefined ? String(itemAny._guid.value) : String(itemAny._guid);
      } else if (itemAny.GlobalId) {
        guid = typeof itemAny.GlobalId === "object" && itemAny.GlobalId.value !== undefined ? String(itemAny.GlobalId.value) : String(itemAny.GlobalId);
      }

      let rawCategory = itemAny._category;
      if (rawCategory && typeof rawCategory === "object" && rawCategory.value !== undefined) {
        rawCategory = rawCategory.value;
      }
      const entity = String(rawCategory || "").replace(/^IFC/i, "") || "Unknown";

      let val: any = "Null";

      if (specDef.requirement.type === "attribute") {
        const matchingKey = Object.keys(itemAny).find(k => attrRegex.test(k));
        if (matchingKey) {
          const attrVal = itemAny[matchingKey];
          if (attrVal !== null && attrVal !== undefined) {
            val = typeof attrVal === "object" && attrVal.value !== undefined ? attrVal.value : attrVal;
          }
        }
      } else {
        const rels = itemAny.IsDefinedBy || [];
        for (const rel of rels) {
          const pset = rel.RelatingPropertyDefinition || rel;
          if (pset.Name?.value && psetRegex.test(String(pset.Name.value))) {
            const targetArray = pset.HasProperties || pset.Quantities;
            if (Array.isArray(targetArray)) {
              const targetProp = targetArray.find((p: any) => p.Name?.value && propRegex.test(String(p.Name.value)));
              if (targetProp) {
                const valueKey = Object.keys(targetProp).find(k => /Value/.test(k) || /Values/.test(k));
                if (valueKey && targetProp[valueKey] !== null && targetProp[valueKey] !== undefined) {
                  const rawVal = targetProp[valueKey];
                  val = typeof rawVal === "object" && rawVal.value !== undefined ? rawVal.value : rawVal;
                  break;
                }
              }
            }
          }
        }
      }

      if (expressId !== undefined) {
        const displayVal = val === "Null" || val === null ? "Null" : String(val);
        itemPropsMap[modelId][expressId as number] = { name: String(name), value: displayVal, guid: String(guid), entity };
      }
    }
  }
  return itemPropsMap;
};

export const generateTableData = (
  fragments: OBC.FragmentsManager,
  resultMap: OBC.ModelIdMap,
  status: "Pass" | "Fail",
  itemPropsMap: Record<string, Record<number, { name: string; value: string; guid: string; entity: string }>>
): RuleTableData[] => {
  const data: RuleTableData[] = [];
  for (const [modelId, expressIds] of Object.entries(resultMap)) {
    const model = fragments.list.get(modelId);
    const modelName = (model as any)?.name || modelId;
    for (const expressId of expressIds) {
      const props = itemPropsMap[modelId]?.[expressId] || { name: "Unknown", value: "Null", guid: "Unknown", entity: "Unknown" };
      data.push({
        id: `${modelId}-${expressId}`,
        ModelID: modelId,
        ExpressID: expressId,
        Model: modelName,
        Name: props.name,
        GUID: props.guid,
        Entity: props.entity,
        Value: props.value,
        Count: 1,
        Status: status
      });
    }
  }
  return data;
};

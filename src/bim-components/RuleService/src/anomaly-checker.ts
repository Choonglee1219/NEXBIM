import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { setModelTransparent } from "../../../ui-templates/toolbars/viewer-toolbar";
import { RuleTableData } from "./types";
import { groupResultsBy } from "./data-extractor";

const TBD_VALUES = new Set(["", "TBD", "NONE", "N/A", "-", "--", "NULL", "UNDEFINED"]);
const QTO_PSET_NAMES = new Set(["BaseQuantities", "Quantities", "QuantitySets"]);

const isTbdValue = (val: any): boolean => {
  if (val === null || val === undefined) return true;
  const str = String(val).trim().toUpperCase();
  return TBD_VALUES.has(str);
};

const extractPsetsFromItem = (itemAny: any): Map<string, Map<string, string>> => {
  const psetMap = new Map<string, Map<string, string>>();

  const processPset = (pset: any) => {
    const psetName = pset.Name?.value ? String(pset.Name.value) : "Pset_Custom";
    if (psetName.toUpperCase().startsWith("QTO") || QTO_PSET_NAMES.has(psetName)) return;

    const targetArray = pset.HasProperties || pset.Quantities;
    if (!Array.isArray(targetArray)) return;

    for (const targetProp of targetArray) {
      const propName = targetProp.Name?.value ? String(targetProp.Name.value) : null;
      if (!propName || propName === "id") continue;

      const valueKey = Object.keys(targetProp).find(k => /Value/.test(k) || /Values/.test(k));
      let rawVal: any = null;
      if (valueKey && targetProp[valueKey] !== null && targetProp[valueKey] !== undefined) {
        rawVal = targetProp[valueKey];
        if (typeof rawVal === "object" && rawVal.value !== undefined) rawVal = rawVal.value;
      }

      if (!isTbdValue(rawVal)) {
        if (!psetMap.has(psetName)) psetMap.set(psetName, new Map());
        psetMap.get(psetName)!.set(propName, String(rawVal).trim());
      }
    }
  };

  // 1. Direct IsDefinedBy
  const rels = itemAny.IsDefinedBy || [];
  for (const rel of rels) {
    const pset = rel.RelatingPropertyDefinition || rel;
    if (pset) processPset(pset);
  }

  // 2. Type IsTypedBy
  const typeRels = itemAny.IsTypedBy || [];
  for (const rel of typeRels) {
    const typeObj = rel.RelatingType || rel;
    if (typeObj) {
      const typePsets = typeObj.HasPropertySets || typeObj.IsDefinedBy || [];
      for (const tPset of typePsets) {
        const pset = tPset.RelatingPropertyDefinition || tPset;
        if (pset) processPset(pset);
      }
    }
  }

  return psetMap;
};

export const checkCrossModelAnomalies = async (components: OBC.Components): Promise<{ resultsData: any[]; rawFlatItems: RuleTableData[]; failMap: OBC.ModelIdMap; message: string }> => {
  const fragments = components.get(OBC.FragmentsManager);
  if (fragments.list.size === 0) {
    throw new Error("로드된 모델이 없습니다.");
  }

  type ElementOccurrence = { modelId: string; expressId: number; name: string; guid: string; modelName: string };
  const merged = new Map<string, Map<string, Map<string, Map<string, ElementOccurrence[]>>>>();

  for (const [modelId, model] of fragments.list) {
    const modelName = (model as any).name || model.modelId;
    const localIds = await model.getLocalIds();

    const itemsData = await model.getItemsData(localIds, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        IsTypedBy: { attributes: true, relations: true },
      },
    });

    for (const item of itemsData) {
      const itemAny = item as any;
      const expressId = (itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId) as number;
      if (expressId === undefined) continue;

      let name = itemAny.Name;
      if (name && typeof name === "object" && name.value !== undefined) name = name.value;
      name = String(name || "Unnamed").trim();

      let guid = itemAny._guid ?? itemAny.GlobalId;
      if (guid && typeof guid === "object" && guid.value !== undefined) guid = guid.value;
      guid = String(guid || "Unknown").trim();

      let rawCategory = itemAny._category;
      if (rawCategory && typeof rawCategory === "object" && rawCategory.value !== undefined) rawCategory = rawCategory.value;
      const entity = String(rawCategory || "").replace(/^IFC/i, "") || "Unknown";

      const psetMap = extractPsetsFromItem(itemAny);

      for (const [psetName, propMap] of psetMap.entries()) {
        for (const [propName, valStr] of propMap.entries()) {
          if (!merged.has(entity)) merged.set(entity, new Map());
          const etMap = merged.get(entity)!;
          if (!etMap.has(psetName)) etMap.set(psetName, new Map());
          const pMap = etMap.get(psetName)!;
          if (!pMap.has(propName)) pMap.set(propName, new Map());
          const vMap = pMap.get(propName)!;
          if (!vMap.has(valStr)) vMap.set(valStr, []);
          vMap.get(valStr)!.push({ modelId, expressId, name, guid, modelName });
        }
      }
    }
  }

  const fail: OBC.ModelIdMap = {};
  const tableData: RuleTableData[] = [];
  let anomalyCount = 0;

  for (const [entity, psets] of merged.entries()) {
    for (const [psetName, props] of psets.entries()) {
      for (const [propName, valMap] of props.entries()) {
        let totalCount = 0;
        for (const occList of valMap.values()) totalCount += occList.length;

        if (totalCount < 4) continue;

        const uniqueCount = valMap.size;
        if (uniqueCount / totalCount > 0.65) continue;

        let maxCount = 0;
        let dominantVal = "";
        for (const [v, occList] of valMap.entries()) {
          if (occList.length > maxCount) {
            maxCount = occList.length;
            dominantVal = v;
          }
        }

        // 1. Dominant Value must represent at least 90% of total occurrences
        const dominantRatio = maxCount / totalCount;
        if (dominantRatio < 0.90) continue;

        // 2. Anomaly Threshold: values other than dominantVal that appear in <= 5% of total items (outliers)
        const threshold = Math.max(1, Math.floor(totalCount * 0.05));

        for (const [v, occList] of valMap.entries()) {
          if (v !== dominantVal && occList.length <= threshold) {
            anomalyCount += occList.length;
            for (const el of occList) {
              if (!fail[el.modelId]) fail[el.modelId] = new Set();
              fail[el.modelId].add(el.expressId);

              tableData.push({
                id: `${el.modelId}-${el.expressId}-${psetName}-${propName}`,
                ModelID: el.modelId,
                ExpressID: el.expressId,
                Model: el.modelName,
                Name: el.name,
                GUID: el.guid,
                Entity: entity,
                Value: `[Anomaly] ${psetName}.${propName}: "${v}" (Dominant: "${dominantVal}", ${Math.round(dominantRatio * 100)}%)`,
                Count: 1,
                Status: "Fail",
              });
            }
          }
        }
      }
    }
  }

  if (Object.keys(fail).length > 0) {
    await Promise.all([
      fragments.highlight({
        customId: "red",
        color: new THREE.Color("red"),
        renderedFaces: FRAGS.RenderedFaces.ONE,
        opacity: 1,
        transparent: false,
      }, fail),
      fragments.core.update(true),
    ]);

    setModelTransparent(components);

    const worlds = components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (world && world.camera instanceof OBC.SimpleCamera) {
      await world.camera.fitToItems(fail);
    }
  }

  const resultsData = groupResultsBy(tableData, "None");
  const message = anomalyCount > 0
    ? `다중 모델 교차 속성 이상치가 ${anomalyCount}개 발견되었습니다!`
    : "다중 모델 속성 이상치가 발견되지 않았습니다.";

  return { resultsData, rawFlatItems: tableData, failMap: fail, message };
};

export const checkPropertyCompletionRate = async (components: OBC.Components): Promise<{ resultsData: any[]; rawFlatItems: RuleTableData[]; failMap: OBC.ModelIdMap; message: string }> => {
  const fragments = components.get(OBC.FragmentsManager);
  if (fragments.list.size === 0) {
    throw new Error("로드된 모델이 없습니다.");
  }

  const fail: OBC.ModelIdMap = {};
  const tableData: RuleTableData[] = [];
  let missingCount = 0;

  type ElementInfo = {
    modelId: string;
    modelName: string;
    expressId: number;
    name: string;
    guid: string;
    entity: string;
    filledProps: Map<string, Map<string, string>>;
  };

  const elementsByEntity = new Map<string, ElementInfo[]>();

  // Pass 1: Extract all elements & filled properties (including IsTypedBy)
  for (const [modelId, model] of fragments.list) {
    const modelName = (model as any).name || model.modelId;
    const localIds = await model.getLocalIds();

    const itemsData = await model.getItemsData(localIds, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        IsTypedBy: { attributes: true, relations: true },
      },
    });

    for (const item of itemsData) {
      const itemAny = item as any;
      const expressId = (itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId) as number;
      if (expressId === undefined) continue;

      let name = itemAny.Name;
      if (name && typeof name === "object" && name.value !== undefined) name = name.value;
      name = String(name || "Unnamed").trim();

      let guid = itemAny._guid ?? itemAny.GlobalId;
      if (guid && typeof guid === "object" && guid.value !== undefined) guid = guid.value;
      guid = String(guid || "Unknown").trim();

      let rawCategory = itemAny._category;
      if (rawCategory && typeof rawCategory === "object" && rawCategory.value !== undefined) rawCategory = rawCategory.value;
      const entity = String(rawCategory || "").replace(/^IFC/i, "") || "Unknown";

      const filledProps = extractPsetsFromItem(itemAny);

      if (!elementsByEntity.has(entity)) {
        elementsByEntity.set(entity, []);
      }
      elementsByEntity.get(entity)!.push({
        modelId,
        modelName,
        expressId,
        name,
        guid,
        entity,
        filledProps,
      });
    }
  }

  // Pass 2: Calculate property coverage & detect missing properties (>= 70% coverage rule)
  for (const [entity, elements] of elementsByEntity.entries()) {
    const totalEl = elements.length;
    if (totalEl < 3) continue;

    const propCounts = new Map<string, Map<string, number>>();

    for (const el of elements) {
      for (const [psetName, propMap] of el.filledProps.entries()) {
        if (!propCounts.has(psetName)) propCounts.set(psetName, new Map());
        const targetPset = propCounts.get(psetName)!;
        for (const propName of propMap.keys()) {
          targetPset.set(propName, (targetPset.get(propName) || 0) + 1);
        }
      }
    }

    type ExpectedProp = { psetName: string; propName: string; coveragePct: number };
    const expectedProps: ExpectedProp[] = [];

    for (const [psetName, propMap] of propCounts.entries()) {
      for (const [propName, count] of propMap.entries()) {
        const coverage = count / totalEl;
        if (coverage >= 0.90 && coverage < 1.0) {
          expectedProps.push({
            psetName,
            propName,
            coveragePct: Math.trunc(coverage * 100),
          });
        }
      }
    }

    if (expectedProps.length === 0) continue;

    // Pass 3: Flag elements missing any expected property
    for (const el of elements) {
      for (const exp of expectedProps) {
        const hasProp = el.filledProps.get(exp.psetName)?.has(exp.propName);
        if (!hasProp) {
          missingCount++;
          if (!fail[el.modelId]) fail[el.modelId] = new Set();
          fail[el.modelId].add(el.expressId);

          tableData.push({
            id: `${el.modelId}-${el.expressId}-${exp.psetName}-${exp.propName}`,
            ModelID: el.modelId,
            ExpressID: el.expressId,
            Model: el.modelName,
            Name: el.name,
            GUID: el.guid,
            Entity: entity,
            Value: `${exp.psetName}.${exp.propName} missing (Coverage: ${exp.coveragePct}%)`,
            Count: 1,
            Status: `Missing(${100 - exp.coveragePct}%)`,
          });
        }
      }
    }
  }

  if (Object.keys(fail).length > 0) {
    await Promise.all([
      fragments.highlight({
        customId: "red",
        color: new THREE.Color("red"),
        renderedFaces: FRAGS.RenderedFaces.ONE,
        opacity: 1,
        transparent: false,
      }, fail),
      fragments.core.update(true),
    ]);

    setModelTransparent(components);

    const worlds = components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (world && world.camera instanceof OBC.SimpleCamera) {
      await world.camera.fitToItems(fail);
    }
  }

  const resultsData = groupResultsBy(tableData, "None");
  const message = missingCount > 0
    ? `표준 프로퍼티 누락 객체가 ${missingCount}개 발견되었습니다.`
    : "모든 객체의 표준 프로퍼티가 100% 작성 완료되어 있습니다.";

  return { resultsData, rawFlatItems: tableData, failMap: fail, message };
};

import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { RuleSpecDefinition } from "../../../setup/rules";
import { setModelTransparent } from "../../../ui-templates/toolbars/viewer-toolbar";
import { RuleTableData } from "./types";
import { extractData, generateTableData } from "./data-extractor";
import {
  getPattern,
  isNonGeometricEntity,
  extractMaterialValue,
  extractClassificationValue,
  extractParentInfo,
  buildModelClassificationMap,
} from "./helpers";

export const createFacetParameter = (
  condition: string,
  value?: string,
  specDef?: RuleSpecDefinition
): OBC.IDSFacetParameter | undefined => {
  if (condition === "exists" || (!value && condition === "pattern" && !specDef?.requirement.bounds && !specDef?.requirement.length && !specDef?.requirement.enumValues)) {
    return undefined;
  }

  if (condition === "simple") {
    return { type: "simple", parameter: value ?? "" };
  }

  if (condition === "pattern") {
    return { type: "pattern", parameter: getPattern(value || "") };
  }

  if (condition === "enumeration") {
    const list = specDef?.requirement.enumValues ?? (value ? value.split(",").map((v) => v.trim()) : []);
    return { type: "enumeration", parameter: list };
  }

  if (condition === "bounds") {
    let min = specDef?.requirement.bounds?.min;
    let max = specDef?.requirement.bounds?.max;
    if (min === undefined && max === undefined && value) {
      const parts = value.split(",").map((v) => v.trim());
      if (parts[0] && !isNaN(Number(parts[0]))) min = Number(parts[0]);
      if (parts[1] && !isNaN(Number(parts[1]))) max = Number(parts[1]);
    }
    return {
      type: "bounds",
      parameter: {
        min,
        max,
        minInclusive: specDef?.requirement.bounds?.minInclusive ?? true,
        maxInclusive: specDef?.requirement.bounds?.maxInclusive ?? true,
      },
    };
  }

  if (condition === "length") {
    let min = specDef?.requirement.length?.min;
    let max = specDef?.requirement.length?.max;
    let len = specDef?.requirement.length?.length;
    if (min === undefined && max === undefined && len === undefined && value) {
      const parts = value.split(",").map((v) => v.trim());
      if (parts.length === 1 && !isNaN(Number(parts[0]))) len = Number(parts[0]);
      else {
        if (parts[0] && !isNaN(Number(parts[0]))) min = Number(parts[0]);
        if (parts[1] && !isNaN(Number(parts[1]))) max = Number(parts[1]);
      }
    }
    return {
      type: "length",
      parameter: { min, max, length: len },
    };
  }

  return undefined;
};

export const testStandardSpec = async (
  components: OBC.Components,
  specDef: RuleSpecDefinition
): Promise<{ rawFlatItems: RuleTableData[]; allIds: OBC.ModelIdMap }> => {
  const fragments = components.get(OBC.FragmentsManager);
  if (fragments.list.size === 0) {
    throw new Error("로드된 모델이 없습니다.");
  }

  const ids = components.get(OBC.IDSSpecifications);

  let pass: OBC.ModelIdMap = {};
  let fail: OBC.ModelIdMap = {};
  const reqType = specDef.requirement.type;

  if (reqType === "material" || reqType === "classification" || reqType === "partof") {
    for (const [modelId, model] of fragments.list) {
      const classMap = reqType === "classification" ? await buildModelClassificationMap(components, model) : undefined;
      const localIds = await model.getLocalIds();
      const itemsData = await model.getItemsData(localIds, {
        attributesDefault: true,
        relationsDefault: { attributes: false, relations: false },
        relations: {
          HasAssociations: { attributes: true, relations: true },
          IsTypedBy: { attributes: true, relations: true },
          ContainedInStructure: { attributes: true, relations: true },
          Decomposes: { attributes: true, relations: true },
        },
      });

      for (const item of itemsData) {
        const itemAny = item as any;
        const expressId = (itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId) as number;
        if (expressId === undefined) continue;

        let rawCategory = itemAny._category;
        if (rawCategory && typeof rawCategory === "object" && rawCategory.value !== undefined) rawCategory = rawCategory.value;
        const entity = String(rawCategory || "").replace(/^IFC/i, "").toUpperCase() || "UNKNOWN";

        if (isNonGeometricEntity(entity)) continue;

        if (specDef.applicability.entity && specDef.applicability.entity.toUpperCase() !== "ALL" && specDef.applicability.entity.toUpperCase() !== "ANY") {
          const cleanAppEntity = specDef.applicability.entity.replace(/^IFC/i, "");
          const appRegex = new RegExp(getPattern(cleanAppEntity), "i");
          const rawCatStr = String(rawCategory || "");
          if (!appRegex.test(entity) && !appRegex.test(rawCatStr)) continue;
        }

        let isPassed = false;

        if (reqType === "material") {
          const { matVal, hasMatRel } = extractMaterialValue(itemAny);
          if (specDef.requirement.condition === "exists") {
            isPassed = Boolean(matVal || hasMatRel);
          } else if (specDef.requirement.condition === "pattern") {
            const patRegex = new RegExp(getPattern(specDef.requirement.value || specDef.requirement.name || ""), "i");
            isPassed = Boolean(matVal && patRegex.test(matVal));
          } else if (specDef.requirement.condition === "simple") {
            const targetVal = String(specDef.requirement.value || specDef.requirement.name || "").trim().toUpperCase();
            isPassed = Boolean(matVal && matVal.trim().toUpperCase() === targetVal);
          } else if (specDef.requirement.condition === "enumeration") {
            const enumVals = specDef.requirement.enumValues || (specDef.requirement.value ? specDef.requirement.value.split(",").map((s: string) => s.trim().toUpperCase()) : []);
            isPassed = Boolean(matVal && enumVals.includes(matVal.trim().toUpperCase()));
          }
        } else if (reqType === "classification") {
          const { classVal, systemVal, codeVal, hasClassRel } = extractClassificationValue(itemAny, classMap, expressId);
          const reqSystem = specDef.requirement.system || specDef.requirement.propertySet;
          const cleanSystemReq = reqSystem && reqSystem !== "N.A." && reqSystem.trim() !== "" ? reqSystem.trim() : null;

          let systemMatch = true;
          if (cleanSystemReq && cleanSystemReq.toUpperCase() !== "ALL" && cleanSystemReq.toUpperCase() !== "ANY") {
            const sysRegex = new RegExp(getPattern(cleanSystemReq), "i");
            systemMatch = Boolean(
              (systemVal && sysRegex.test(systemVal)) ||
              (codeVal && sysRegex.test(codeVal)) ||
              (classVal && sysRegex.test(classVal))
            );
          }

          const targetVal = specDef.requirement.value || (specDef.requirement.name !== "Classification" && specDef.requirement.name !== "N.A." ? specDef.requirement.name : "");

          if (specDef.requirement.condition === "exists") {
            isPassed = systemMatch && Boolean(classVal || hasClassRel);
          } else if (specDef.requirement.condition === "pattern") {
            const patRegex = new RegExp(getPattern(targetVal || ""), "i");
            isPassed = systemMatch && Boolean((codeVal && patRegex.test(codeVal)) || (classVal && patRegex.test(classVal)));
          } else if (specDef.requirement.condition === "simple") {
            const cleanTarget = String(targetVal || "").trim().toUpperCase();
            isPassed = systemMatch && Boolean((codeVal && codeVal.trim().toUpperCase() === cleanTarget) || (classVal && classVal.trim().toUpperCase() === cleanTarget));
          } else if (specDef.requirement.condition === "enumeration") {
            const enumVals = specDef.requirement.enumValues || (targetVal ? targetVal.split(",").map((s: string) => s.trim().toUpperCase()) : []);
            isPassed = systemMatch && Boolean((codeVal && enumVals.includes(codeVal.trim().toUpperCase())) || (classVal && enumVals.includes(classVal.trim().toUpperCase())));
          }
        } else if (reqType === "partof") {
          const { parentCategories, parentNames } = extractParentInfo(itemAny);

          const cleanParentEntityReq = specDef.requirement.name && specDef.requirement.name !== "N.A." && specDef.requirement.name.trim() !== ""
            ? specDef.requirement.name.replace(/^IFC/i, "").toUpperCase()
            : null;

          const valReq = specDef.requirement.value && specDef.requirement.value !== "N.A." && specDef.requirement.value.trim() !== ""
            ? specDef.requirement.value.trim()
            : null;

          let entityMatch = true;
          if (cleanParentEntityReq && cleanParentEntityReq !== "ALL" && cleanParentEntityReq !== "ANY") {
            const entityRegex = new RegExp(getPattern(cleanParentEntityReq), "i");
            entityMatch = parentCategories.some((cat) => entityRegex.test(cat));
          }

          if (entityMatch && (parentCategories.length > 0 || parentNames.length > 0)) {
            if (specDef.requirement.condition === "exists") {
              isPassed = true;
            } else if (specDef.requirement.condition === "pattern") {
              if (valReq) {
                const patRegex = new RegExp(getPattern(valReq), "i");
                isPassed = parentNames.some((n) => patRegex.test(n));
              } else {
                isPassed = true;
              }
            } else if (specDef.requirement.condition === "simple") {
              if (valReq) {
                isPassed = parentNames.some((n) => n.toUpperCase() === valReq.toUpperCase());
              } else {
                isPassed = true;
              }
            } else if (specDef.requirement.condition === "enumeration") {
              const enumVals = specDef.requirement.enumValues || (valReq ? valReq.split(",").map((s: string) => s.trim().toUpperCase()) : []);
              isPassed = parentNames.some((n) => enumVals.includes(n.toUpperCase()));
            }
          }
        }

        if (isPassed) {
          if (!pass[modelId]) pass[modelId] = new Set();
          pass[modelId].add(expressId);
        } else {
          if (!fail[modelId]) fail[modelId] = new Set();
          fail[modelId].add(expressId);
        }
      }
    }
  } else {
    ids.list.delete("Custom Spec");
    const spec = ids.create("Custom Spec", ["IFC2X3", "IFC4", "IFC4X3_ADD2"]);

    let descCond: string = specDef.requirement.condition;
    if (specDef.requirement.value) {
      descCond = `${specDef.requirement.condition} '${specDef.requirement.value}'`;
    }

    const psetName = (specDef.requirement.type === "property" || specDef.requirement.type === "quantity") && specDef.requirement.propertySet
      ? ` in ${specDef.requirement.propertySet}`
      : "";
    spec.description = specDef.description || `Check if ${specDef.applicability.entity} has ${specDef.requirement.name}${psetName} and condition ${descCond}`;

    const entity = new OBC.IDSEntity(components, {
      type: "pattern",
      parameter: getPattern(specDef.applicability.entity),
    });

    let reqFacet: OBC.IDSFacet;

    if (reqType === "property" || reqType === "quantity") {
      const propFacet = new OBC.IDSProperty(
        components,
        { type: "pattern", parameter: getPattern(specDef.requirement.propertySet || "") },
        { type: "pattern", parameter: getPattern(specDef.requirement.name) }
      );
      const valParam = createFacetParameter(specDef.requirement.condition, specDef.requirement.value, specDef);
      if (valParam) propFacet.value = valParam;
      reqFacet = propFacet;
    } else {
      const attrFacet = new OBC.IDSAttribute(
        components,
        { type: "pattern", parameter: getPattern(specDef.requirement.name) as any }
      );
      const valParam = createFacetParameter(specDef.requirement.condition, specDef.requirement.value, specDef);
      if (valParam) attrFacet.value = valParam;
      reqFacet = attrFacet;
    }

    spec.applicability.add(entity);
    spec.requirements.add(reqFacet);

    const result = await spec.test([/.*/]);
    const maps = ids.getModelIdMap(result);
    pass = maps.pass;
    fail = maps.fail;
  }

  await Promise.all([
    fragments.highlight({ customId: "green", color: new THREE.Color("green"), renderedFaces: FRAGS.RenderedFaces.ONE, opacity: 1, transparent: false }, pass),
    fragments.highlight({ customId: "red", color: new THREE.Color("red"), renderedFaces: FRAGS.RenderedFaces.ONE, opacity: 1, transparent: false }, fail),
    fragments.core.update(true)
  ]);

  const allIds = OBC.ModelIdMapUtils.clone(pass);
  OBC.ModelIdMapUtils.add(allIds, fail);

  const itemPropsMap = await extractData(fragments, allIds, specDef);

  const passData = generateTableData(fragments, pass, "Pass", itemPropsMap);
  const failData = generateTableData(fragments, fail, "Fail", itemPropsMap);

  setModelTransparent(components);

  return {
    rawFlatItems: [...passData, ...failData],
    allIds,
  };
};



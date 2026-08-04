import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { RuleSpecDefinition } from "../../../setup/rules";
import { setModelTransparent } from "../../../ui-templates/toolbars/viewer-toolbar";
import { RuleTableData } from "./types";
import { extractData, generateTableData } from "./data-extractor";

export const testStandardSpec = async (
  components: OBC.Components,
  specDef: RuleSpecDefinition
): Promise<{ rawFlatItems: RuleTableData[]; allIds: OBC.ModelIdMap }> => {
  const fragments = components.get(OBC.FragmentsManager);
  const ids = components.get(OBC.IDSSpecifications);

  ids.list.delete("Custom Spec");
  const spec = ids.create("Custom Spec", ["IFC2X3", "IFC4", "IFC4X3_ADD2"]);

  const getPattern = (val: string) => {
    if (!val) return ".*";
    let pattern = val.replace(/[a-zA-Z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
    let prefix = ".*";
    let suffix = ".*";
    if (pattern.startsWith('^')) { prefix = ""; pattern = pattern.substring(1); }
    else if (pattern.startsWith('.*')) { prefix = ""; }
    if (pattern.endsWith('$')) { suffix = ""; pattern = pattern.substring(0, pattern.length - 1); }
    else if (pattern.endsWith('.*')) { suffix = ""; }
    return `${prefix}(?:${pattern})${suffix}`;
  };

  let descCond = "exists";
  if (specDef.requirement.value && specDef.requirement.condition === "pattern") {
    descCond = `matches '${specDef.requirement.value}'`;
  }

  const psetName = (specDef.requirement.type === "property" || specDef.requirement.type === "quantity") ? ` in ${specDef.requirement.propertySet}` : "";
  spec.description = specDef.description || `Check if ${specDef.applicability.entity} has ${specDef.requirement.name}${psetName} and its value ${descCond}`;

  const entity = new OBC.IDSEntity(components, {
    type: "pattern",
    parameter: getPattern(specDef.applicability.entity),
  });

  let reqFacet: OBC.IDSProperty | OBC.IDSAttribute;

  if (specDef.requirement.type === "property" || specDef.requirement.type === "quantity") {
    reqFacet = new OBC.IDSProperty(
      components,
      { type: "pattern", parameter: getPattern(specDef.requirement.propertySet || "") },
      { type: "pattern", parameter: getPattern(specDef.requirement.name) }
    );
  } else {
    reqFacet = new OBC.IDSAttribute(
      components,
      { type: "pattern", parameter: getPattern(specDef.requirement.name) as any }
    );
  }

  if (specDef.requirement.value && specDef.requirement.condition === "pattern") {
    reqFacet.value = { type: "pattern", parameter: getPattern(specDef.requirement.value || "") };
  }

  spec.applicability.add(entity);
  spec.requirements.add(reqFacet);

  const result = await spec.test([/.*/]);
  const { fail, pass } = ids.getModelIdMap(result);

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

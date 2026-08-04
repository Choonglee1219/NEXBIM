import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { setModelTransparent } from "../../../ui-templates/toolbars/viewer-toolbar";
import { IDSTableData } from "./types";
import { groupResultsBy } from "./data-extractor";

export const checkDuplicateGUIDs = async (components: OBC.Components): Promise<{ resultsData: any[]; rawFlatItems: IDSTableData[]; failMap: OBC.ModelIdMap; message: string }> => {
  const fragments = components.get(OBC.FragmentsManager);
  if (fragments.list.size === 0) {
    throw new Error("로드된 모델이 없습니다.");
  }

  const guidMap = new Map<string, { modelId: string; expressId: number; name: string; modelName: string; entity: string }[]>();

  for (const [modelId, model] of fragments.list) {
    const modelName = (model as any).name || model.modelId;
    const localIds = await model.getLocalIds();

    const itemsData = await model.getItemsData(localIds, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
    });

    for (const item of itemsData) {
      const itemAny = item as any;
      const expressId = (itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId) as number;
      if (expressId === undefined) continue;

      let guid = itemAny._guid ?? itemAny.GlobalId;
      if (guid && typeof guid === "object" && guid.value !== undefined) {
        guid = guid.value;
      }
      guid = String(guid || "").trim();

      if (!guid || guid === "Unknown" || guid === "Null" || guid === "undefined") continue;

      let name = itemAny.Name;
      if (name && typeof name === "object" && name.value !== undefined) {
        name = name.value;
      }
      name = String(name || "Unnamed").trim();

      let rawCategory = itemAny._category;
      if (rawCategory && typeof rawCategory === "object" && rawCategory.value !== undefined) {
        rawCategory = rawCategory.value;
      }
      const entity = String(rawCategory || "").replace(/^IFC/i, "") || "Unknown";

      if (!guidMap.has(guid)) {
        guidMap.set(guid, []);
      }
      guidMap.get(guid)!.push({ modelId, expressId, name, modelName, entity });
    }
  }

  const fail: OBC.ModelIdMap = {};
  const tableData: IDSTableData[] = [];

  let duplicateCount = 0;
  let intraCount = 0;
  let interCount = 0;

  for (const [guid, elements] of guidMap.entries()) {
    if (elements.length > 1) {
      duplicateCount++;
      const uniqueModelIds = new Set(elements.map((el) => el.modelId));
      const isInterModel = uniqueModelIds.size > 1;

      if (isInterModel) {
        interCount++;
      } else {
        intraCount++;
      }

      const dupType = isInterModel ? "[Inter-Model]" : "[Intra-Model]";
      const dupDesc = isInterModel
        ? `Duplicate GUID across ${uniqueModelIds.size} models`
        : `Duplicate GUID within ${elements[0].modelName}`;
      const valueStr = `${dupType} ${dupDesc}`;

      for (const el of elements) {
        if (!fail[el.modelId]) fail[el.modelId] = new Set();
        fail[el.modelId].add(el.expressId);

        tableData.push({
          id: `${el.modelId}-${el.expressId}`,
          ModelID: el.modelId,
          ExpressID: el.expressId,
          Model: el.modelName,
          Name: el.name,
          GUID: guid,
          Entity: el.entity,
          Value: valueStr,
          Count: 1,
          Status: "Fail",
        });
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
  const message = duplicateCount > 0
    ? `중복 GUID ${duplicateCount}개 발견! (파일 내 중복: ${intraCount}개, 파일 간 중복: ${interCount}개, 총 ${tableData.length}개 객체)`
    : "중복되는 GUID가 없습니다.";

  return { resultsData, rawFlatItems: tableData, failMap: fail, message };
};

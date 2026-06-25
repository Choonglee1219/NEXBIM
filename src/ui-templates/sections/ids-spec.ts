import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { appIcons, onToggleSection, setupBIMTable, tableButtonStyle, appState, createPaginationTemplate, PaginationRefs } from "../../globals";
import { setModelTransparent, restoreModelMaterials } from "../toolbars/viewer-toolbar";
import { Highlighter } from "../../bim-components/Highlighter";
import { IDSSpecDefinition, predefinedSpecs } from "../../setup/specs";
import { BCFTopics } from "../../bim-components/BCFTopics";

export interface IDSSpecPanelState {
  components: OBC.Components;
}

type IDSTableData = {
  id: string;
  ModelID?: string;
  ExpressID?: number;
  Name: string;
  GUID: string;
  Entity: string;
  Value: string;
  Status: "Pass" | "Fail";
  isGroup?: boolean;
  rawGroup?: IDSTableData[];
};

type SpecTableData = {
  id: string;
  Name: string;
  Description: string;
  Check: string;
  spec: any;
};

let selectedRowId: string | null = null;
let isUpdatingSelection = false;

export const idsSpecPanelTemplate: BUI.StatefullComponent<IDSSpecPanelState> = (state) => {
  const { components } = state;
  const fragments = components.get(OBC.FragmentsManager);
  const ids = components.get(OBC.IDSSpecifications);
  const highlighter = components.get(Highlighter);

  let latestResultsMap: OBC.ModelIdMap | null = null;
  let allResultsData: any[] = [];
  let currentPage = 0;
  const pageSize = 30;
  const paginationRefs: PaginationRefs = {};

  // Helpers
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

  const getFlatData = (nodes: any[]): any[] => {
    let result: any[] = [];
    for (const n of nodes) {
      if (n.children) {
        result.push(...getFlatData(n.children));
      } else {
        result.push(n);
      }
    }
    return result;
  };

  const groupByGUID = (flatData: { data: IDSTableData }[]) => {
    const guidGroups = new Map<string, { data: IDSTableData }[]>();
    for (const item of flatData) {
      const guid = item.data.GUID;
      if (!guidGroups.has(guid)) {
        guidGroups.set(guid, []);
      }
      guidGroups.get(guid)!.push(item);
    }

    const treeData: any[] = [];
    let groupCounter = 1;
    for (const [guid, items] of guidGroups.entries()) {
      if (items.length > 1 && guid && guid !== "Unknown" && guid !== "Null") {
        const entities = Array.from(new Set(items.map(item => item.data.Entity || "Unknown")));
        const status = items.every(item => item.data.Status === "Pass") ? "Pass" : "Fail";
        const groupRowData = {
          id: `group-${guid}-${groupCounter++}`,
          isGroup: true,
          Name: `GUID: ${guid}`,
          GUID: guid,
          Entity: entities.join(", "),
          Value: `${items.length} elements`,
          Status: status,
          rawGroup: items.map(item => item.data),
        };
        treeData.push({
          data: groupRowData,
          children: items
        });
      } else {
        treeData.push(...items);
      }
    }
    return treeData;
  };

  const updatePage = () => {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const totalItems = allResultsData.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

    if (allResultsData.length === 0) {
      resultsTable.data = [];
      resultsTable.columns = [];
    } else {
      resultsTable.columns = [
        { name: "Name", width: "2fr" },
        { name: "GUID", width: "2fr" },
        { name: "Entity", width: "1.5fr" },
        { name: "Value", width: "2fr" },
        { name: "Status", width: "1fr" },
      ];
      resultsTable.hiddenColumns = ["id", "ModelID", "ExpressID", "isGroup", "rawGroup"];
      resultsTable.data = allResultsData.slice(start, end);
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
    const totalPages = Math.max(1, Math.ceil(allResultsData.length / pageSize));
    if (currentPage < totalPages - 1) {
      currentPage++;
      updatePage();
    }
  };

  // UI References
  let reqTypeDropdown: BUI.Dropdown;
  let entityInput: BUI.TextInput;
  let psetInput: BUI.TextInput;
  let propInput: BUI.TextInput;
  let conditionDropdown: BUI.Dropdown;
  let propValInput: BUI.TextInput;

  // Predefined Specs Table Setup
  const specsTable = document.createElement("bim-table") as BUI.Table<SpecTableData>;
  specsTable.hiddenColumns = ["id", "spec"];
  specsTable.headersHidden = false;

  setupBIMTable(specsTable);

  specsTable.data = predefinedSpecs.map((spec, i) => ({
    data: {
      id: `spec-${i}`,
      Name: spec.name,
      Description: spec.description,
      Check: "",
      spec: spec
    }
  }));

  specsTable.dataTransform = {
    Check: (_val, row) => {
      const spec = (row as any).spec as IDSSpecDefinition;
      return BUI.html`
        <div style="display: flex; justify-content: center; align-items: center; width: 100%; height: 1.5rem;">
          <bim-button style=${tableButtonStyle} tooltip-title="Check" icon=${appIcons.PLAY} @click=${async (e: Event) => {
          const btn = e.target as BUI.Button;
          btn.loading = true;
          try { await testSpec(spec); } catch (err) { console.error(err); alert("테스트 중 오류가 발생했습니다."); } finally { btn.loading = false; }
        }}></bim-button>
        </div>
      `;
    }
  };

  // Results Table Setup
  const resultsTable = document.createElement("bim-table") as BUI.Table<any>;
  resultsTable.hiddenColumns = ["id", "ModelID", "ExpressID", "isGroup", "rawGroup"];

  setupBIMTable(resultsTable);

  const onTableSelectionChange = async () => {
    if (isUpdatingSelection) return;
    isUpdatingSelection = true;

    const selected = Array.from(resultsTable.selection) as any[];
    selectedRowId = selected.length > 0 ? selected[0].id : null;

    // 테이블 데이터를 재할당하여 체크박스 UI 상태(checked) 강제 갱신
    const currentData = resultsTable.data;
    resultsTable.data = [...currentData];
    resultsTable.selection.clear();

    if (selectedRowId) {
      const rowToSelect = findRowInTree(resultsTable.data, selectedRowId);
      if (rowToSelect) resultsTable.selection.add(rowToSelect.data);
    }

    if (selected.length === 0) {
      await highlighter.clear("select");
      isUpdatingSelection = false;
      return;
    }

    const modelIdMap: OBC.ModelIdMap = {};
    for (const row of selected) {
      if (row.isGroup && row.rawGroup) {
        for (const child of row.rawGroup) {
          if (child.ModelID && child.ExpressID) {
            if (!modelIdMap[child.ModelID]) modelIdMap[child.ModelID] = new Set();
            modelIdMap[child.ModelID].add(child.ExpressID);
          }
        }
      } else if (row.ModelID && row.ExpressID) {
        if (!modelIdMap[row.ModelID]) modelIdMap[row.ModelID] = new Set();
        modelIdMap[row.ModelID].add(row.ExpressID);
      }
    }

    await highlighter.clear("select");
    await highlighter.highlightByID("select", modelIdMap);

    const worlds = components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (world && world.camera instanceof OBC.SimpleCamera) {
      await world.camera.fitToItems(modelIdMap);
    }

    isUpdatingSelection = false;
  };

  resultsTable.addEventListener("change", onTableSelectionChange);

  resultsTable.dataTransform = {
    Name: (value, rowData) => {
      const onClick = (e: Event) => {
        e.stopPropagation();
        const rowId = (rowData as IDSTableData).id;
        resultsTable.selection.clear();
        if (selectedRowId !== rowId) {
          resultsTable.selection.add(rowData as IDSTableData);
        }
        resultsTable.dispatchEvent(new Event("change"));
      };

      return BUI.html`
        <div @click=${onClick} style="display: flex; align-items: center; overflow: hidden; cursor: pointer; height: 1.5rem; width: 100%;">
          <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; margin: 0; width: 100%;" title=${String(value)}>
            ${String(value)}
          </bim-label>
        </div>
      `;
    },
    GUID: (value) => BUI.html`
      <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title=${String(value)}>
        ${String(value)}
      </bim-label>
    `,
    Status: (value) => {
      const color = value === "Pass" ? "var(--bim-ui_success-base, #00B050)" : "var(--bim-ui_error-base, #C00000)";
      return BUI.html`<bim-label style="color: ${color}; font-weight: bold;">${value}</bim-label>`;
    }
  };

  // 데이터 추출 헬퍼 함수 (Property 및 Attribute 모두 지원)
  const extractData = async (allIds: OBC.ModelIdMap, specDef: IDSSpecDefinition) => {
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

  // 테이블 데이터 생성 헬퍼 함수
  const generateTableData = (
    resultMap: OBC.ModelIdMap,
    status: "Pass" | "Fail",
    itemPropsMap: Record<string, Record<number, { name: string; value: string; guid: string; entity: string }>>
  ) => {
    const data: { data: IDSTableData }[] = [];
    for (const [modelId, expressIds] of Object.entries(resultMap)) {
      for (const expressId of expressIds) {
        const props = itemPropsMap[modelId]?.[expressId] || { name: "Unknown", value: "Null", guid: "Unknown", entity: "Unknown" };
        data.push({
          data: {
            id: `${modelId}-${expressId}`,
            ModelID: modelId,
            ExpressID: expressId,
            Name: props.name,
            GUID: props.guid,
            Entity: props.entity,
            Value: props.value,
            Status: status
          },
        });
      }
    }
    return data;
  };

  const testSpec = async (specDef: IDSSpecDefinition) => {
    // 새로운 검사 실행 전 상태 초기화
    restoreModelMaterials(components);
    await fragments.resetHighlight();

    if (specDef.name === "Duplicate GUIDs") {
      if (fragments.list.size === 0) {
        alert("로드된 모델이 없습니다.");
        return;
      }

      // 1. Map to find duplicates
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

      // 2. Separate pass/fail and collect table rows
      const fail: OBC.ModelIdMap = {};
      const tableData: { data: IDSTableData }[] = [];

      let duplicateCount = 0;
      for (const [guid, elements] of guidMap.entries()) {
        if (elements.length > 1) {
          duplicateCount++;
          for (const el of elements) {
            if (!fail[el.modelId]) fail[el.modelId] = new Set();
            fail[el.modelId].add(el.expressId);

            tableData.push({
              data: {
                id: `${el.modelId}-${el.expressId}`,
                ModelID: el.modelId,
                ExpressID: el.expressId,
                Name: el.name,
                GUID: guid,
                Entity: el.entity,
                Value: `Model: ${el.modelName}`,
                Status: "Fail",
              },
            });
          }
        }
      }

      // 3. Highlight duplicates in red
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

        // 투명화(Ghost) 적용
        setModelTransparent(components);

        // 카메라 초점 맞추기
        const worlds = components.get(OBC.Worlds);
        const world = worlds.list.values().next().value;
        if (world && world.camera instanceof OBC.SimpleCamera) {
          await world.camera.fitToItems(fail);
        }
      }

      allResultsData = groupByGUID(tableData);
      selectedRowId = null;
      currentPage = 0;
      updatePage();

      latestResultsMap = fail;

      if (duplicateCount > 0) {
        alert(`중복되는 GUID가 ${duplicateCount}개 발견되었습니다! (총 ${tableData.length}개 객체)`);
      } else {
        alert("중복되는 GUID가 없습니다.");
      }
      return;
    }

    // 기존 사양 지우기 및 새 사양 동적 생성
    ids.list.delete("Custom Spec");
    const spec = ids.create("Custom Spec", ["IFC2X3", "IFC4", "IFC4X3_ADD2"]);

    // 정규식 대소문자 무시(case-insensitive) 및 부분 포함(contains) 패턴 생성 헬퍼
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

    // 각 모델별로 데이터를 조회하기 위해 ModelIdMap 통합
    const allIds = OBC.ModelIdMapUtils.clone(pass);
    OBC.ModelIdMapUtils.add(allIds, fail);

    // 검사 대상들의 Name 및 속성/어트리뷰트 Value 추출
    const itemPropsMap = await extractData(allIds, specDef);

    // 테이블 데이터 생성
    const passData = generateTableData(pass, "Pass", itemPropsMap);
    const failData = generateTableData(fail, "Fail", itemPropsMap);

    const combinedData = [...passData, ...failData];
    allResultsData = groupByGUID(combinedData);
    selectedRowId = null;
    currentPage = 0;
    updatePage();

    latestResultsMap = allIds;

    // 검사 완료 후 하이라이트를 강조하기 위해 투명화(Ghost) 적용
    setModelTransparent(components);
  };

  const onReviewModel = async ({ target }: { target: BUI.Button }) => {
    target.loading = true;
    try {
      const type = (reqTypeDropdown?.value[0] || "property") as "property" | "attribute" | "quantity";
      const specDef: IDSSpecDefinition = {
        name: "Custom Spec",
        description: "Custom user-defined specification",
        applicability: {
          entity: entityInput?.value || ""
        },
        requirement: {
          type,
          propertySet: psetInput?.value || "",
          name: propInput?.value || "",
          condition: (conditionDropdown?.value[0] || "exists") as "exists" | "pattern",
          value: propValInput?.value || ""
        }
      };
      await testSpec(specDef);
    } catch (e) {
      console.error(e);
      alert("사양(Specification) 테스트 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  const onSaveSpec = () => {
    const type = (reqTypeDropdown?.value[0] || "property") as "property" | "attribute" | "quantity";
    const entityVal = entityInput?.value || "";
    const psetVal = psetInput?.value || "";
    const propVal = propInput?.value || "";
    const condVal = (conditionDropdown?.value[0] || "exists") as "exists" | "pattern";
    const valStr = propValInput?.value || "";

    let descCond = "exists";
    if (valStr && condVal === "pattern") {
      descCond = `matches '${valStr}'`;
    }
    const psetName = (type === "property" || type === "quantity") && psetVal ? ` in ${psetVal}` : "";
    const desc = `Check if ${entityVal || "ANY"} has ${propVal}${psetName} and its value ${descCond}`;

    const specDef: IDSSpecDefinition = {
      name: `${entityVal || "ANY"} ${propVal}`,
      description: desc,
      applicability: { entity: entityVal },
      requirement: { type, propertySet: psetVal, name: propVal, condition: condVal, value: valStr }
    };

    specsTable.data = [...specsTable.data, {
      data: {
        id: `spec-${specsTable.data.length}`,
        Name: specDef.name,
        Description: specDef.description,
        Check: "",
        spec: specDef
      }
    }];

    alert("사양이 Spec. List에 추가되었습니다.");
  };

  const onSelectObjects = async () => {
    if (!latestResultsMap || OBC.ModelIdMapUtils.isEmpty(latestResultsMap)) {
      alert("검사 결과가 없습니다. 먼저 Review Model을 실행하세요.");
      return;
    }
    selectedRowId = null;
    resultsTable.selection.clear();
    updatePage();
    await highlighter.clear("select");
    await highlighter.highlightByID("select", latestResultsMap);
  };

  const onFailToTopic = async () => {
    const flatResults = getFlatData(allResultsData);
    if (flatResults.length === 0) {
      alert("검사 결과가 없습니다.");
      return;
    }

    const failData = flatResults.filter(r => (r.data as IDSTableData).Status === "Fail");
    if (failData.length === 0) {
      alert("Fail 항목이 없습니다.");
      return;
    }

    const bcfTopics = components.get(BCFTopics);
    const worlds = components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const viewpoints = components.get(OBC.Viewpoints);

    const failMap: OBC.ModelIdMap = {};
    for (const row of failData) {
      const d = row.data as IDSTableData;
      if (d.ModelID && d.ExpressID) {
        if (!failMap[d.ModelID]) failMap[d.ModelID] = new Set();
        failMap[d.ModelID].add(d.ExpressID);
      }
    }

    // 화면을 Fail 항목으로 맞추고 반투명 및 하이라이트 처리
    await highlighter.clear("select");
    await highlighter.highlightByID("select", failMap);

    if (world && world.camera instanceof OBC.SimpleCamera) {
      await world.camera.fitToItems(failMap);
      if (world.camera.hasCameraControls()) {
        world.camera.controls.update(0);
      }
    }

    setModelTransparent(components);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 뷰포인트 및 스냅샷 캡처
    let capturedViewpoint: any = null;
    let capturedSnapshot: string | null = null;

    if (world && world.renderer) {
      world.renderer.three.render(world.scene.three, world.camera.three);
      capturedSnapshot = world.renderer.three.domElement.toDataURL("image/jpeg", 0.4);
    }

    capturedViewpoint = viewpoints.create();
    capturedViewpoint.title = `IDS Check Fail`;
    capturedViewpoint.world = world;
    await capturedViewpoint.updateCamera();

    if (capturedViewpoint) {
      const guids = await fragments.modelIdMapToGuids(failMap);
      if (!capturedViewpoint.selectionComponents) capturedViewpoint.selectionComponents = new Set();
      for (const guid of guids) capturedViewpoint.selectionComponents.add(guid);

      if (!capturedViewpoint.componentColors) capturedViewpoint.componentColors = new Map();
      capturedViewpoint.componentColors.set("C00000", guids); // Fail 객체를 뷰포인트 내에서 빨간색으로 매핑
    }

    try {
      const title = `IDS Check Fail (${failData.length} items)`;
      const description = `The following items failed the IDS specification check.`;
      const topicId = `ids-${Date.now()}`;

      let newTopic: any = null;
      if ((bcfTopics as any)._bcf && typeof (bcfTopics as any)._bcf.create === "function") {
        newTopic = (bcfTopics as any)._bcf.create();
      } else if (typeof (bcfTopics as any).create === "function") {
        newTopic = (bcfTopics as any).create();
      }

      if (newTopic) {
        newTopic.title = title;
        newTopic.description = description;
        newTopic.creationAuthor = appState.currentUser || "System";
        newTopic.topicType = "Issue";
        newTopic.topicStatus = "Open";
        if (capturedViewpoint) {
          if (!newTopic.viewpoints) newTopic.viewpoints = new Set();
          newTopic.viewpoints.add(capturedViewpoint.guid);
        }
        if (capturedSnapshot) newTopic.snapshot = capturedSnapshot;
        if (!bcfTopics.list.has(newTopic.guid)) bcfTopics.list.set(newTopic.guid, newTopic);
      } else {
        newTopic = {
          guid: topicId,
          title,
          description,
          creationAuthor: appState.currentUser || "System",
          creationDate: new Date().toISOString(),
          topicType: "Issue",
          topicStatus: "Open",
          viewpoints: new Set(),
          labels: new Set(),
          comments: [],
          snapshot: capturedSnapshot,
        };
        if (capturedViewpoint) newTopic.viewpoints.add(capturedViewpoint.guid);
        bcfTopics.list.set(topicId, newTopic);
      }

      bcfTopics.onRefresh.trigger();
      alert(`Fail 항목들이 BCF 토픽으로 성공적으로 생성되었습니다!\n제목: ${title}`);
    } catch (e) {
      console.error(e);
      alert("BCF 토픽 생성 중 오류가 발생했습니다.");
    }
  };

  const onExportCSV = () => {
    const flatResults = getFlatData(allResultsData);
    if (flatResults.length === 0) {
      alert("내보낼 데이터가 없습니다.");
      return;
    }
    const headers = ["ModelID", "ExpressID", "GUID", "Name", "Entity", "Value", "Status"];
    const csvRows = [headers.join(",")];

    for (const row of flatResults) {
      const d = row.data as IDSTableData;
      const escapeCSV = (val: any) => `"${String(val ?? "").replace(/"/g, '""')}"`;
      csvRows.push([
        escapeCSV(d.ModelID),
        escapeCSV(d.ExpressID),
        escapeCSV(d.GUID),
        escapeCSV(d.Name),
        escapeCSV(d.Entity),
        escapeCSV(d.Value),
        escapeCSV(d.Status)
      ].join(","));
    }

    const csvString = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ids_check_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TASK} label="IDS Check">
      <div style="display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 0.5rem;">
        <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; flex-shrink: 0;">
          <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
            <bim-label style="font-weight: bold; pointer-events: none;">Spec. List</bim-label>
            <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; max-height: 10rem; flex-shrink: 0;">
            ${specsTable}
          </div>
        </div>
          
        <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; flex-shrink: 0;">
          <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
            <bim-label style="font-weight: bold; pointer-events: none;">Spec. Builder</bim-label>
            <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <bim-text-input ${BUI.ref((e) => { entityInput = e as BUI.TextInput; })} placeholder="Entity (e.g. WALL)" vertical></bim-text-input>
            <div style="display: flex; gap: 0.5rem;">
              <bim-dropdown style="flex: 1;" ${BUI.ref((e) => { reqTypeDropdown = e as BUI.Dropdown; })} vertical
                @change=${(e: Event) => {
      const dropdown = e.target as BUI.Dropdown;
      const val = dropdown.value[0];
      if (psetInput) {
        if (val === "property") {
          psetInput.disabled = false;
          psetInput.placeholder = "Pset (e.g. Pset_WallCommon)";
        } else if (val === "quantity") {
          psetInput.disabled = false;
          psetInput.placeholder = "Qto (e.g. Qto_WallBaseQuantities)";
        } else if (val === "attribute") {
          psetInput.disabled = true;
          psetInput.placeholder = "N.A.";
        }
      }
    }}>
                <bim-option label="Property" value="property" checked></bim-option>
                <bim-option label="Quantity" value="quantity"></bim-option>
                <bim-option label="Attribute" value="attribute"></bim-option>
              </bim-dropdown>
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { psetInput = e as BUI.TextInput; })} placeholder="Pset (e.g. Pset_WallCommon)" vertical></bim-text-input>
            </div>
            <bim-text-input ${BUI.ref((e) => { propInput = e as BUI.TextInput; })} placeholder="Name" vertical></bim-text-input>
            <div style="display: flex; gap: 0.5rem;">
              <bim-dropdown style="flex: 1;" ${BUI.ref((e) => { conditionDropdown = e as BUI.Dropdown; })} vertical
                @change=${(e: Event) => {
      const dropdown = e.target as BUI.Dropdown;
      const val = dropdown.value[0];
      if (propValInput) {
        if (val === "exists") {
          propValInput.disabled = true;
          propValInput.placeholder = "N.A.";
        } else if (val === "pattern") {
          propValInput.disabled = false;
          propValInput.placeholder = "Value";
        }
      }
    }}>
                <bim-option label="Exists" value="exists" checked></bim-option>
                <bim-option label="Contains" value="pattern"></bim-option>
              </bim-dropdown>
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { propValInput = e as BUI.TextInput; })} placeholder="N.A." disabled vertical></bim-text-input>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem;">
              <bim-button style="flex: 1;" label="Check" @click=${onReviewModel} icon=${appIcons.PLAY}></bim-button>
              <bim-button style="flex: 1;" label="Save" @click=${onSaveSpec} icon=${appIcons.SAVE}></bim-button>
              <bim-button style="flex: 1;" label="Select" @click=${onSelectObjects} icon=${appIcons.SELECT}></bim-button>
              <bim-button style="flex: 1;" label="To Topic" @click=${onFailToTopic} icon=${appIcons.SAVE}></bim-button>
              <bim-button style="flex: 1;" label="Export" @click=${onExportCSV} icon=${appIcons.EXPORT}></bim-button>
            </div>
          </div>
        </div>

        <div data-flex="true" style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; flex: 1; min-height: 0; overflow: hidden;">
          <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; flex-shrink: 0;">
            <bim-label style="font-weight: bold; pointer-events: none;">Spec. Check Results</bim-label>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <div @click=${(e: Event) => e.stopPropagation()}>
                ${createPaginationTemplate(onPrevPage, onNextPage, paginationRefs)}
              </div>
              <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; flex: 1; min-height: 0;">
            ${resultsTable}
          </div>
        </div>

      </div>
    </bim-panel-section>
  `;
};
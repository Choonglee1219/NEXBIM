import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { appIcons, onToggleSection, setupBIMTable, tableButtonStyle } from "../../globals";
import { setModelTransparent, restoreModelMaterials } from "../toolbars/viewer-toolbar";
import { Highlighter } from "../../bim-components/Highlighter";
import { IDSSpecDefinition, predefinedSpecs } from "../../setup/specs";

export interface IDSSpecPanelState {
  components: OBC.Components;
}

type IDSTableData = {
  id: string;
  ModelID: string;
  ExpressID: number;
  Name: string;
  GUID: string;
  Value: string;
  Status: "Pass" | "Fail";
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
            try { await testSpec(spec); } catch(err) { console.error(err); alert("테스트 중 오류가 발생했습니다."); } finally { btn.loading = false; }
          }}></bim-button>
        </div>
      `;
    }
  };

  // Results Table Setup
  const resultsTable = document.createElement("bim-table") as BUI.Table<IDSTableData>;
  resultsTable.hiddenColumns = ["id", "ModelID", "ExpressID"];

  setupBIMTable(resultsTable);

  const onTableSelectionChange = async () => {
    if (isUpdatingSelection) return;
    isUpdatingSelection = true;

    const selected = Array.from(resultsTable.selection) as IDSTableData[];
    selectedRowId = selected.length > 0 ? selected[0].id : null;

    // 테이블 데이터를 재할당하여 체크박스 UI 상태(checked) 강제 갱신
    const currentData = resultsTable.data;
    resultsTable.data = [...currentData];
    resultsTable.selection.clear();

    if (selectedRowId) {
      const rowToSelect = resultsTable.data.find((r) => r.data && r.data.id === selectedRowId);
      if (rowToSelect) resultsTable.selection.add(rowToSelect.data);
    }

    if (selected.length === 0) {
      await highlighter.clear("select");
      isUpdatingSelection = false;
      return;
    }
    
    const modelIdMap: OBC.ModelIdMap = {};
    for (const row of selected) {
      if (!modelIdMap[row.ModelID]) modelIdMap[row.ModelID] = new Set();
      modelIdMap[row.ModelID].add(row.ExpressID);
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
      const isChecked = (rowData as IDSTableData).id === selectedRowId;
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
        <div @click=${onClick} style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden; cursor: pointer; height: 1.5rem;">
          <bim-checkbox style="pointer-events: none; flex: 0 0 auto; margin: 0;" .checked=${isChecked}></bim-checkbox>
          <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; margin: 0;" title=${String(value)}>
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
    const itemPropsMap: Record<string, Record<number, { name: string; value: string; guid: string }>> = {};

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
          itemPropsMap[modelId][expressId as number] = { name: String(name), value: displayVal, guid: String(guid) };
        }
      }
    }
    return itemPropsMap;
  };

  // 테이블 데이터 생성 헬퍼 함수
  const generateTableData = (
    resultMap: OBC.ModelIdMap, 
    status: "Pass" | "Fail", 
    itemPropsMap: Record<string, Record<number, { name: string; value: string; guid: string }>>
  ) => {
    const data: { data: IDSTableData }[] = [];
    for (const [modelId, expressIds] of Object.entries(resultMap)) {
      for (const expressId of expressIds) {
        const props = itemPropsMap[modelId]?.[expressId] || { name: "Unknown", value: "Null", guid: "Unknown" };
        data.push({
          data: { 
            id: `${modelId}-${expressId}`, 
            ModelID: modelId, 
            ExpressID: expressId, 
            Name: props.name, 
            GUID: props.guid, 
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
    
    resultsTable.data = [...passData, ...failData];
    resultsTable.selection.clear();
    selectedRowId = null;

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
    resultsTable.data = [...resultsTable.data]; 
    await highlighter.clear("select");
    await highlighter.highlightByID("select", latestResultsMap);
  };

  const onExportCSV = () => {
    if (!resultsTable.data || resultsTable.data.length === 0) {
      alert("내보낼 데이터가 없습니다.");
      return;
    }
    const headers = ["ModelID", "ExpressID", "GUID", "Name", "Value", "Status"];
    const csvRows = [headers.join(",")];

    for (const row of resultsTable.data) {
      const d = row.data as IDSTableData;
      const escapeCSV = (val: any) => `"${String(val ?? "").replace(/"/g, '""')}"`;
      csvRows.push([
        escapeCSV(d.ModelID),
        escapeCSV(d.ExpressID),
        escapeCSV(d.GUID),
        escapeCSV(d.Name),
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
              <bim-button style="flex: 1;" label="Export" @click=${onExportCSV} icon=${appIcons.EXPORT}></bim-button>
            </div>
          </div>
        </div>

        <div data-flex="true" style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; flex: 1; min-height: 0; overflow: hidden;">
          <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; flex-shrink: 0;">
            <bim-label style="font-weight: bold; pointer-events: none;">Spec. Check Results</bim-label>
            <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; flex: 1; min-height: 0;">
            ${resultsTable}
          </div>
        </div>

      </div>
    </bim-panel-section>
  `;
};
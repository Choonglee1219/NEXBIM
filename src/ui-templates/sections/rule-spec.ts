import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, setupBIMTable, tableButtonStyle } from "../../globals";
import { RuleSpecDefinition, predefinedSpecs } from "../../setup/rules";
import { RuleService } from "../../bim-components/RuleService";
import { bimChatPanel } from "../../bim-components/BimChat";

export interface RuleSpecPanelState {
  components: OBC.Components;
  world?: OBC.World;
}

type SpecTableData = {
  id: string;
  Name: string;
  Description: string;
  Check: string;
  spec: any;
};

export const ruleUIState = {
  reqTypeDropdown: null as BUI.Dropdown | null,
  entityInput: null as BUI.TextInput | null,
  psetInput: null as BUI.TextInput | null,
  propInput: null as BUI.TextInput | null,
  conditionDropdown: null as BUI.Dropdown | null,
  propValInput: null as BUI.TextInput | null,
  onReviewModel: null as ((btn?: any) => Promise<void>) | null,
  onSaveSpec: null as (() => void) | null,
  switchTab: null as ((tabName: "list" | "builder") => void) | null,
};

export const ruleSpecPanelTemplate: BUI.StatefullComponent<RuleSpecPanelState> = (state) => {
  const { components, world } = state;
  const ruleService = components.get(RuleService);

  let tabsElement: BUI.Tabs;

  const switchTab = (tabName: "list" | "builder") => {
    if (tabsElement) {
      tabsElement.tab = tabName;
    }
  };
  ruleUIState.switchTab = switchTab;

  // UI References for Rule Builder
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

  specsTable.columns = [
    { name: "Name", width: "1.2fr" },
    { name: "Description", width: "3fr" },
    { name: "Check", width: "4rem" },
  ];

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
      const spec = (row as any).spec as RuleSpecDefinition;
      return BUI.html`
        <div style="display: flex; justify-content: center; align-items: center; width: 100%; height: 1.5rem;">
          <bim-button style=${tableButtonStyle} tooltip-title="Check" icon=${appIcons.PLAY} @click=${async (e: Event) => {
            const btn = e.target as BUI.Button;
            btn.loading = true;
            try { await ruleService.testSpec(spec); } catch (err) { console.error(err); alert("테스트 중 오류가 발생했습니다."); } finally { btn.loading = false; }
          }}></bim-button>
        </div>
      `;
    }
  };

  const updateFormInputStates = () => {
    if (!reqTypeDropdown || !conditionDropdown) return;
    const type = reqTypeDropdown.value[0] || "property";
    const cond = conditionDropdown.value[0] || "exists";

    // 1. PsetInput state
    if (psetInput) {
      if (type === "property") {
        psetInput.disabled = false;
        psetInput.placeholder = "Pset (e.g. Pset_WallCommon)";
      } else if (type === "quantity") {
        psetInput.disabled = false;
        psetInput.placeholder = "Qto (e.g. Qto_WallBaseQuantities)";
      } else if (type === "classification") {
        psetInput.disabled = false;
        psetInput.placeholder = "System (e.g. Uniclass 2015)";
      } else if (type === "partof") {
        psetInput.disabled = false;
        psetInput.placeholder = "Relation (e.g. IFCRELCONTAINEDINSPATIALSTRUCTURE)";
      } else {
        psetInput.disabled = true;
        psetInput.placeholder = "N.A.";
      }
    }

    // 2. PropInput state
    if (propInput) {
      if (type === "property") {
        propInput.disabled = false;
        propInput.placeholder = "Property Name (e.g. FireRating)";
      } else if (type === "quantity") {
        propInput.disabled = false;
        propInput.placeholder = "Quantity Name (e.g. Height)";
      } else if (type === "attribute") {
        propInput.disabled = false;
        propInput.placeholder = "Attribute Name (e.g. PredefinedType)";
      } else if (type === "partof") {
        propInput.disabled = false;
        propInput.placeholder = "Parent Entity (e.g. BuildingStorey)";
      } else {
        // material, classification
        propInput.disabled = true;
        propInput.placeholder = "N.A.";
      }
    }

    // 3. PropValInput state
    if (propValInput) {
      if (cond === "exists") {
        propValInput.disabled = true;
        propValInput.placeholder = "N.A.";
      } else if (type === "material") {
        propValInput.disabled = false;
        if (cond === "pattern") propValInput.placeholder = "Material Pattern (e.g. ^CONCRETE.*)";
        else if (cond === "enumeration") propValInput.placeholder = "Material List (e.g. Concrete, Steel)";
        else propValInput.placeholder = "Material Name (e.g. Concrete)";
      } else if (type === "classification") {
        propValInput.disabled = false;
        if (cond === "pattern") propValInput.placeholder = "Code Pattern (e.g. ^A10.*)";
        else if (cond === "enumeration") propValInput.placeholder = "Code List (e.g. A1010130, A1020130)";
        else propValInput.placeholder = "Code / Notation (e.g. A1010130)";
      } else if (type === "partof") {
        propValInput.disabled = false;
        if (cond === "pattern") propValInput.placeholder = "Parent Name Pattern (e.g. 02 - Floor)";
        else if (cond === "enumeration") propValInput.placeholder = "Parent Name List (e.g. 01 - Floor, 02 - Floor)";
        else propValInput.placeholder = "Parent Name (e.g. 02 - Floor)";
      } else if (cond === "pattern") {
        propValInput.disabled = false;
        propValInput.placeholder = "Regex (e.g. ^FIRE_.*)";
      } else if (cond === "simple") {
        propValInput.disabled = false;
        propValInput.placeholder = "Exact Value (e.g. 2hr)";
      } else if (cond === "enumeration") {
        propValInput.disabled = false;
        propValInput.placeholder = "List (e.g. 1hr, 2hr, 90min)";
      } else if (cond === "bounds") {
        propValInput.disabled = false;
        propValInput.placeholder = "min,max (e.g. 10,100)";
      } else if (cond === "length") {
        propValInput.disabled = false;
        propValInput.placeholder = "min,max (e.g. 2,20)";
      } else {
        propValInput.disabled = false;
        propValInput.placeholder = "Value / Regex";
      }
    }
  };

  const onReviewModel = async (e?: { target: BUI.Button } | any) => {
    const target = e?.target ? (e.target as BUI.Button) : null;
    if (target) target.loading = true;

    try {
      const type = (reqTypeDropdown?.value[0] || "property") as any;
      const condition = (conditionDropdown?.value[0] || "exists") as any;
      const psetVal = psetInput?.value || "";
      const propVal = propInput?.value || "";
      const valStr = propValInput?.value || "";
      const reqName = type === "material"
        ? (valStr || "Material")
        : type === "classification"
        ? (valStr || psetVal || "Classification")
        : propVal;

      const specDef: RuleSpecDefinition = {
        name: "Custom Spec",
        description: "Custom user-defined specification",
        applicability: {
          entity: entityInput?.value || ""
        },
        requirement: {
          type,
          propertySet: (type === "property" || type === "quantity") ? psetVal : undefined,
          system: type === "classification" ? psetVal : undefined,
          relation: type === "partof" ? psetVal : undefined,
          name: reqName,
          condition,
          value: valStr
        }
      };
      await ruleService.testSpec(specDef);
    } catch (e) {
      console.error(e);
      alert("규칙 테스트 중 오류가 발생했습니다.");
    } finally {
      if (target) target.loading = false;
    }
  };

  const onSaveSpec = () => {
    const type = (reqTypeDropdown?.value[0] || "property") as any;
    const condition = (conditionDropdown?.value[0] || "exists") as any;
    const entityVal = entityInput?.value || "";
    const psetVal = psetInput?.value || "";
    const propVal = propInput?.value || "";
    const valStr = propValInput?.value || "";
    const reqName = type === "material"
      ? (valStr || "Material")
      : type === "classification"
      ? (valStr || psetVal || "Classification")
      : propVal;

    let descCond = condition;
    if (valStr) {
      descCond = `${condition} '${valStr}'`;
    }
    const psetName = (type === "property" || type === "quantity") && psetVal ? ` in ${psetVal}` : "";
    const desc = `Check if ${entityVal || "ANY"} has ${type}:${reqName}${psetName} condition ${descCond}`;

    const specDef: RuleSpecDefinition = {
      name: type === "material"
        ? `${entityVal || "ANY"} Material (${valStr || condition})`
        : type === "classification"
        ? `${entityVal || "ANY"} Classification (${psetVal || valStr || condition})`
        : `${entityVal || "ANY"} ${propVal || type}`,
      description: desc,
      applicability: { entity: entityVal },
      requirement: {
        type,
        propertySet: (type === "property" || type === "quantity") ? psetVal : undefined,
        system: type === "classification" ? psetVal : undefined,
        relation: type === "partof" ? psetVal : undefined,
        name: reqName,
        condition,
        value: valStr
      }
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

    alert("규칙이 Rule List에 추가되었습니다.");
    switchTab("list");
  };

  ruleUIState.onReviewModel = onReviewModel;
  ruleUIState.onSaveSpec = onSaveSpec;

  const [embeddedChat] = world
    ? bimChatPanel({ components, world, mode: "rule", embedded: true })
    : [null];

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TASK} label="Rule Check" style="height: 100%; display: flex; flex-direction: column;">
      <bim-tabs ${BUI.ref((e) => { tabsElement = e as BUI.Tabs; })} style="flex: 1; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;">
        <bim-tab name="list" label="Rule List" icon=${appIcons.TABLE}>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem;">
            <div style="display: flex; flex-direction: column; gap: 0.25rem;">
              ${specsTable}
            </div>
          </div>
        </bim-tab>

        <bim-tab name="builder" label="Rule Builder" icon=${appIcons.EDIT} style="height: 100%; flex: 1; overflow: hidden;">
          <div style="display: flex; gap: 0.75rem; padding: 0.5rem; height: 100%; max-height: 100%; box-sizing: border-box; overflow: hidden;">
            <div class="bim-scroll" style="flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; padding-right: 0.25rem;">
              <bim-text-input style="flex: 0 0 auto;" ${BUI.ref((e) => { entityInput = e as BUI.TextInput; ruleUIState.entityInput = entityInput; })} placeholder="Entity (e.g. WALL)" vertical></bim-text-input>
              <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
                <bim-dropdown style="flex: 1;" ${BUI.ref((e) => { reqTypeDropdown = e as BUI.Dropdown; ruleUIState.reqTypeDropdown = reqTypeDropdown; })} vertical
                  @change=${() => updateFormInputStates()}>
                  <bim-option label="Property" value="property" checked></bim-option>
                  <bim-option label="Quantity" value="quantity"></bim-option>
                  <bim-option label="Attribute" value="attribute"></bim-option>
                  <bim-option label="Classification" value="classification"></bim-option>
                  <bim-option label="Material" value="material"></bim-option>
                  <bim-option label="PartOf (Parent)" value="partof"></bim-option>
                </bim-dropdown>
                <bim-text-input style="flex: 1;" ${BUI.ref((e) => { psetInput = e as BUI.TextInput; ruleUIState.psetInput = psetInput; })} placeholder="Pset (e.g. Pset_WallCommon)" vertical></bim-text-input>
              </div>
              <bim-text-input style="flex: 0 0 auto;" ${BUI.ref((e) => { propInput = e as BUI.TextInput; ruleUIState.propInput = propInput; })} placeholder="Property Name (e.g. FireRating)" vertical></bim-text-input>
              <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
                <bim-dropdown style="flex: 1;" ${BUI.ref((e) => { conditionDropdown = e as BUI.Dropdown; ruleUIState.conditionDropdown = conditionDropdown; })} vertical
                  @change=${() => updateFormInputStates()}>
                  <bim-option label="Exists" value="exists" checked></bim-option>
                  <bim-option label="Contains (Pattern)" value="pattern"></bim-option>
                  <bim-option label="Exact (Simple)" value="simple"></bim-option>
                  <bim-option label="Enumeration (List)" value="enumeration"></bim-option>
                  <bim-option label="Bounds (Numeric)" value="bounds"></bim-option>
                  <bim-option label="Text Length" value="length"></bim-option>
                </bim-dropdown>
                <bim-text-input style="flex: 1;" ${BUI.ref((e) => { propValInput = e as BUI.TextInput; ruleUIState.propValInput = propValInput; })} placeholder="N.A." disabled vertical></bim-text-input>
              </div>
              <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem; flex: 0 0 auto;">
                <bim-button style="flex: 1;" label="Check" @click=${onReviewModel} icon=${appIcons.PLAY}></bim-button>
                <bim-button style="flex: 1;" label="Save" @click=${onSaveSpec} icon=${appIcons.SAVE}></bim-button>
              </div>
            </div>
            ${embeddedChat ? BUI.html`
              <div style="flex: 1; min-width: 280px; height: 100%; min-height: 0; max-height: 100%; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">
                ${embeddedChat}
              </div>
            ` : ""}
          </div>
        </bim-tab>
      </bim-tabs>
    </bim-panel-section>
  `;
};
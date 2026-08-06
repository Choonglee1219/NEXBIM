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

  const onReviewModel = async (e?: { target: BUI.Button } | any) => {
    const target = e?.target ? (e.target as BUI.Button) : null;
    if (target) target.loading = true;
    try {
      const type = (reqTypeDropdown?.value[0] || "property") as "property" | "attribute" | "quantity";
      const specDef: RuleSpecDefinition = {
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
      await ruleService.testSpec(specDef);
    } catch (e) {
      console.error(e);
      alert("규칙 테스트 중 오류가 발생했습니다.");
    } finally {
      if (target) target.loading = false;
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

    const specDef: RuleSpecDefinition = {
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
            <div style="flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; padding-right: 0.25rem;">
              <bim-text-input style="flex: 0 0 auto;" ${BUI.ref((e) => { entityInput = e as BUI.TextInput; ruleUIState.entityInput = entityInput; })} placeholder="Entity (e.g. WALL)" vertical></bim-text-input>
              <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
                <bim-dropdown style="flex: 1;" ${BUI.ref((e) => { reqTypeDropdown = e as BUI.Dropdown; ruleUIState.reqTypeDropdown = reqTypeDropdown; })} vertical
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
                <bim-text-input style="flex: 1;" ${BUI.ref((e) => { psetInput = e as BUI.TextInput; ruleUIState.psetInput = psetInput; })} placeholder="Pset (e.g. Pset_WallCommon)" vertical></bim-text-input>
              </div>
              <bim-text-input style="flex: 0 0 auto;" ${BUI.ref((e) => { propInput = e as BUI.TextInput; ruleUIState.propInput = propInput; })} placeholder="Name" vertical></bim-text-input>
              <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
                <bim-dropdown style="flex: 1;" ${BUI.ref((e) => { conditionDropdown = e as BUI.Dropdown; ruleUIState.conditionDropdown = conditionDropdown; })} vertical
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
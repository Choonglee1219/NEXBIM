import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, setupBIMTable, tableButtonStyle } from "../../globals";
import { RuleSpecDefinition, predefinedSpecs } from "../../setup/rules";
import { RuleService } from "../../bim-components/RuleService";

export interface RuleSpecPanelState {
  components: OBC.Components;
}

type SpecTableData = {
  id: string;
  Name: string;
  Description: string;
  Check: string;
  spec: any;
};

export const ruleSpecPanelTemplate: BUI.StatefullComponent<RuleSpecPanelState> = (state) => {
  const { components } = state;
  const ruleService = components.get(RuleService);

  // Tab State & References
  let activeTab: "list" | "builder" = "list";
  let specListContainer: HTMLDivElement;
  let specBuilderContainer: HTMLDivElement;
  let listTabBtn: BUI.Button;
  let builderTabBtn: BUI.Button;

  const switchTab = (tab: "list" | "builder") => {
    activeTab = tab;
    if (specListContainer) specListContainer.style.display = tab === "list" ? "flex" : "none";
    if (specBuilderContainer) specBuilderContainer.style.display = tab === "builder" ? "flex" : "none";
    if (listTabBtn) listTabBtn.active = tab === "list";
    if (builderTabBtn) builderTabBtn.active = tab === "builder";
  };

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

  const onReviewModel = async ({ target }: { target: BUI.Button }) => {
    target.loading = true;
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

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TASK} label="Rule Check">
      <div style="display: flex; gap: 0.25rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-20);">
        <bim-button ${BUI.ref((e) => { listTabBtn = e as BUI.Button; })} label="Rule List" icon=${appIcons.TABLE} ?active=${(activeTab as string) === "list"} @click=${() => switchTab("list")}></bim-button>
        <bim-button ${BUI.ref((e) => { builderTabBtn = e as BUI.Button; })} label="Rule Builder" icon=${appIcons.EDIT} ?active=${(activeTab as string) === "builder"} @click=${() => switchTab("builder")}></bim-button>
      </div>

      <div ${BUI.ref((e) => { specListContainer = e as HTMLDivElement; })} style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 0.5rem;">
        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
          ${specsTable}
        </div>
      </div>

      <div ${BUI.ref((e) => { specBuilderContainer = e as HTMLDivElement; })} style="display: none; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 0.5rem;">
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
          </div>
        </div>
      </div>
    </bim-panel-section>
  `;
};
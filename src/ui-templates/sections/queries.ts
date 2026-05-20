import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../globals";
import { queriesList } from "../../ui-components";
import { Highlighter } from "../../bim-components/Highlighter";

export interface QueriesPanelState {
  components: OBC.Components;
  isAdmin: boolean;
}

export const queriesPanelTemplate: BUI.StatefullComponent<QueriesPanelState> = (
  state,
) => {
  const { components, isAdmin } = state;
  const finder = components.get(OBC.ItemsFinder);
  const highlighter = components.get(Highlighter);

  const [queriesTable, updateList] = queriesList({ components });

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    updateList({ components, queryString: input.value });
  };

  let customBtn: BUI.TemplateResult | undefined;
  if (isAdmin) {
    const onExport = () => {
      const data = finder.export();
      const json = JSON.stringify(data);
      const blob = new Blob([json], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "queries.json";
      link.click();
      URL.revokeObjectURL(link.href);
    };

    const onOpenObsidian = () => {
      window.open("obsidian://open", "_self");
    };

    const onOpenLink = () => {
      window.open("https://docs.thatopen.com/intro", "_blank");
    };

    customBtn = BUI.html`
      <div style="display: flex; gap: 0.5rem">
        <bim-button
          @click=${onExport}
          style="flex: auto"
          label="Export"
          icon=${appIcons.EXPORT} >
        </bim-button>
        <bim-button
          @click=${onOpenObsidian}
          style="flex: auto"
          label="Obsidian"
          icon=${appIcons.OBSIDIAN} >
        </bim-button>
        <bim-button
          @click=${onOpenLink}
          style="flex: auto"
          label="Link"
          icon=${appIcons.LINK} >
        </bim-button>
      </div>
    `;
  }

  let nameInput: BUI.TextInput;
  let entityInput: BUI.TextInput;
  let attrNameInput: BUI.TextInput;
  let attrValInput: BUI.TextInput;
  let psetNameInput: BUI.TextInput;
  let propNameInput: BUI.TextInput;
  let propValInput: BUI.TextInput;
  let containedInInput: BUI.TextInput;
  let structureNameInput: BUI.TextInput;

  const onQueryCreate = async () => {
    if (!nameInput) return;
    if (!nameInput.value) return alert("Query name is required");
    try {
      const query: any = {
        categories: [entityInput.value ? new RegExp(entityInput.value, "i") : /.*/],
      };
      if (attrNameInput.value || attrValInput.value) {
        query.attributes = {
          queries: [
            {
              name: attrNameInput.value ? new RegExp(attrNameInput.value, "i") : /.*/,
              value: attrValInput.value ? new RegExp(attrValInput.value, "i") : /.*/,
            },
          ],
        };
      }
      if (psetNameInput.value || propNameInput.value || propValInput.value) {
        let propValueQuery: any = /.*/;
        if (propValInput.value) {
          const lowerValue = propValInput.value.toLowerCase();
          if (['true', 't', 'yes', 'y', '1'].includes(lowerValue)) {
            propValueQuery = true;
          } else if (['false', 'f', 'no', 'n', '0'].includes(lowerValue)) {
            propValueQuery = false;
          } else {
            propValueQuery = new RegExp(propValInput.value, "i");
          }
        }

        query.relation = {
          name: "IsDefinedBy",
          query: {
            categories: [/PROPERTYSET/],
            attributes: {
              queries: [
                {
                  name: /Name/,
                  value: psetNameInput.value ? new RegExp(psetNameInput.value, "i") : /.*/,
                },
              ],
            },
            relation: {
              name: "HasProperties",
              query: {
                categories: [/SINGLEVALUE/],
                attributes: {
                  queries: [
                    {
                      name: /Name/,
                      value: propNameInput.value ? new RegExp(propNameInput.value, "i") : /.*/,
                    },
                    {
                      name: /NominalValue/,
                      value: propValueQuery,
                    },
                  ],
                },
              },
            },
          },
        };
      }
      if (containedInInput.value || structureNameInput.value) {
        query.relation = {
          name: "ContainedInStructure",
          query: {
            categories: [
              containedInInput.value ? new RegExp(containedInInput.value, "i") : /.*/,
            ],
            attributes: {
              queries: [
                {
                  name: /Name/,
                  value: structureNameInput.value ? new RegExp(structureNameInput.value, "i") : /.*/,
                },
              ],
            },
          },
        };
      }

      finder.create(nameInput.value, [query]);
      updateList({ components });

      const createdQuery = finder.list.get(nameInput.value);
      if (createdQuery) {
        const items = await createdQuery.test({ modelIds: [/.*/], force: true });
        if (!OBC.ModelIdMapUtils.isEmpty(items)) {
          highlighter.highlightByID("select", items);
        } else {
          highlighter.clear("select");
        }
      }
      alert("Query created successfully!");
    } catch (e) {
      alert(`Error creating query: ${e}`);
    }
  };

  const onClear = () => {
    if (nameInput) nameInput.value = "";
    if (entityInput) entityInput.value = "";
    if (attrNameInput) attrNameInput.value = "";
    if (attrValInput) attrValInput.value = "";
    if (psetNameInput) psetNameInput.value = "";
    if (propNameInput) propNameInput.value = "";
    if (propValInput) propValInput.value = "";
    if (containedInInput) containedInInput.value = "";
    if (structureNameInput) structureNameInput.value = "";
  };

  return BUI.html`
    <bim-panel-section fixed label="Queries" icon=${appIcons.SEARCH}>
      ${customBtn}
      <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 0.5rem;">
        <bim-label>Query Builder</bim-label>
        <bim-text-input ${BUI.ref((e) => { nameInput = e as BUI.TextInput; })} placeholder="Query Name" vertical></bim-text-input>
        <bim-text-input ${BUI.ref((e) => { entityInput = e as BUI.TextInput; })} placeholder="Entity (e.g. WALL)" vertical></bim-text-input>
        <div style="display: flex; gap: 0.5rem;">
          <bim-text-input ${BUI.ref((e) => { attrNameInput = e as BUI.TextInput; })} placeholder="Attribute Name" vertical></bim-text-input>
          <bim-text-input ${BUI.ref((e) => { attrValInput = e as BUI.TextInput; })} placeholder="Attribute Value" vertical></bim-text-input>
        </div>
        <bim-text-input ${BUI.ref((e) => { psetNameInput = e as BUI.TextInput; })} placeholder="PropertySet Name" vertical></bim-text-input>
        <div style="display: flex; gap: 0.5rem;">
          <bim-text-input ${BUI.ref((e) => { propNameInput = e as BUI.TextInput; })} placeholder="Property Name" vertical></bim-text-input>
          <bim-text-input ${BUI.ref((e) => { propValInput = e as BUI.TextInput; })} placeholder="Property Value" vertical></bim-text-input>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <bim-text-input ${BUI.ref((e) => { containedInInput = e as BUI.TextInput; })} placeholder="Container Entity (e.g. STOREY)" vertical></bim-text-input>
          <bim-text-input ${BUI.ref((e) => { structureNameInput = e as BUI.TextInput; })} placeholder="Container Name" vertical></bim-text-input>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <bim-button style="flex: 1;" @click=${onQueryCreate} label="Create Query" icon=${appIcons.ADD}></bim-button>
          <bim-button style="flex: 1;" @click=${onClear} label="Clear" icon=${appIcons.CLEAR}></bim-button>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 0.5rem;">
        <bim-label>Saved Queries</bim-label>
        <bim-text-input @input=${onSearch} placeholder="Search..." vertical></bim-text-input>
        ${queriesTable}
      </div>
    </bim-panel-section>
  `;
};

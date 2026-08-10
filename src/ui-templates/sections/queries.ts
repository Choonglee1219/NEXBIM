import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../globals";
import { queriesList } from "../../ui-components";
import { Highlighter } from "../../bim-components/Highlighter";
import { bimChatPanel } from "../../bim-components/BimChat";

export const sanitizeRegexString = (raw: string): string => {
  if (!raw) return "";
  let str = raw.trim();
  const regexMatch = str.match(/^\/(.*)\/[gimuy]*$/);
  if (regexMatch) {
    str = regexMatch[1];
  }
  if (str.startsWith("^")) str = str.slice(1);
  if (str.endsWith("$")) str = str.slice(0, -1);
  if (str.startsWith("(") && str.endsWith(")")) {
    str = str.slice(1, -1);
  }
  return str.trim();
};

export interface QueriesPanelState {
  components: OBC.Components;
  world?: OBC.World;
  isAdmin: boolean;
}

export const queriesUIState = {
  nameInput: null as BUI.TextInput | null,
  entityInput: null as BUI.TextInput | null,
  attrNameInput: null as BUI.TextInput | null,
  attrValInput: null as BUI.TextInput | null,
  psetNameInput: null as BUI.TextInput | null,
  propNameInput: null as BUI.TextInput | null,
  propValInput: null as BUI.TextInput | null,
  containedInInput: null as BUI.TextInput | null,
  structureNameInput: null as BUI.TextInput | null,
  onCreateQuery: null as (() => Promise<void>) | null,
  onClear: null as (() => void) | null,
  switchTab: null as ((tabName: "list" | "builder") => void) | null,
};

export const queriesPanelTemplate: BUI.StatefullComponent<QueriesPanelState> = (
  state,
) => {
  const { components, world } = state;
  const finder = components.get(OBC.ItemsFinder);
  const highlighter = components.get(Highlighter);

  let tabsElement: BUI.Tabs;

  const switchTab = (tabName: "list" | "builder") => {
    if (tabsElement) {
      tabsElement.tab = tabName;
    }
  };
  queriesUIState.switchTab = switchTab;

  const [queriesTable, updateList] = queriesList({
    components,
    onLoadQuery: (fields: any) => {
      if (nameInput) nameInput.value = fields.name;
      if (entityInput) entityInput.value = fields.entity;
      if (attrNameInput) attrNameInput.value = fields.attrName;
      if (attrValInput) attrValInput.value = fields.attrVal;
      if (psetNameInput) psetNameInput.value = fields.psetName;
      if (propNameInput) propNameInput.value = fields.propName;
      if (propValInput) propValInput.value = fields.propVal;
      if (containedInInput) containedInInput.value = fields.containedIn;
      if (structureNameInput) structureNameInput.value = fields.structureName;
      switchTab("builder");
    }
  });

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    updateList({ components, queryString: input.value });
  };

  let nameInput: BUI.TextInput;
  let entityInput: BUI.TextInput;
  let attrNameInput: BUI.TextInput;
  let attrValInput: BUI.TextInput;
  let psetNameInput: BUI.TextInput;
  let propNameInput: BUI.TextInput;
  let propValInput: BUI.TextInput;
  let containedInInput: BUI.TextInput;
  let structureNameInput: BUI.TextInput;

  const onQueryFind = async () => {
    try {
      const rawEntity = sanitizeRegexString(entityInput.value || "");
      const rawAttrName = sanitizeRegexString(attrNameInput.value || "");
      const rawAttrVal = sanitizeRegexString(attrValInput.value || "");
      const rawPsetName = sanitizeRegexString(psetNameInput.value || "");
      const rawPropName = sanitizeRegexString(propNameInput.value || "");
      const rawPropVal = sanitizeRegexString(propValInput.value || "");
      const rawContainedIn = sanitizeRegexString(containedInInput.value || "");
      const rawStructureName = sanitizeRegexString(structureNameInput.value || "");

      const query: any = {
        categories: [rawEntity ? new RegExp(rawEntity, "i") : /.*/],
      };
      if (rawAttrName || rawAttrVal) {
        query.attributes = {
          queries: [
            {
              name: rawAttrName ? new RegExp(rawAttrName, "i") : /.*/,
              value: rawAttrVal ? new RegExp(rawAttrVal, "i") : /.*/,
            },
          ],
        };
      }
      if (rawPsetName || rawPropName || rawPropVal) {
        let propValueQuery: any = /.*/;
        if (rawPropVal) {
          const lowerValue = rawPropVal.toLowerCase();
          if (['true', 't', 'yes', 'y', '1'].includes(lowerValue)) {
            propValueQuery = true;
          } else if (['false', 'f', 'no', 'n', '0'].includes(lowerValue)) {
            propValueQuery = false;
          } else {
            propValueQuery = new RegExp(rawPropVal, "i");
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
                  value: rawPsetName ? new RegExp(rawPsetName, "i") : /.*/,
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
                      value: rawPropName ? new RegExp(rawPropName, "i") : /.*/,
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
      if (rawContainedIn || rawStructureName) {
        query.relation = {
          name: "ContainedInStructure",
          query: {
            categories: [
              rawContainedIn ? new RegExp(rawContainedIn, "i") : /.*/,
            ],
            attributes: {
              queries: [
                {
                  name: /Name/,
                  value: rawStructureName ? new RegExp(rawStructureName, "i") : /.*/,
                },
              ],
            },
          },
        };
      }

      const tempQueryName = "_temp_find_query_";
      finder.create(tempQueryName, [query]);

      const createdQuery = finder.list.get(tempQueryName);
      if (createdQuery) {
        const items = await createdQuery.test({ modelIds: [/.*/], force: true });
        if (!OBC.ModelIdMapUtils.isEmpty(items)) {
          highlighter.highlightByID("select", items);
        } else {
          highlighter.clear("select");
          alert("검색 조건에 맞는 객체를 찾을 수 없습니다.");
        }
      }
      finder.list.delete(tempQueryName);
    } catch (e) {
      alert(`객체 검색 중 오류가 발생했습니다: ${e}`);
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

  queriesUIState.onCreateQuery = onQueryFind;
  queriesUIState.onClear = onClear;

  const [embeddedChat] = world
    ? bimChatPanel({ components, world, mode: "query", embedded: true })
    : [null];

  return BUI.html`
    <bim-panel-section fixed label="Queries" icon=${appIcons.SEARCH} style="height: 100%; display: flex; flex-direction: column;">
      <bim-tabs ${BUI.ref((e) => { tabsElement = e as BUI.Tabs; })} style="flex: 1; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;">
        <bim-tab name="list" label="Query List" icon=${appIcons.TABLE}>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem;">
            <bim-text-input style="flex: 0 0 auto;" @input=${onSearch} placeholder="Search..." vertical></bim-text-input>
            ${queriesTable}
          </div>
        </bim-tab>
        <bim-tab name="builder" label="Query Builder" icon=${appIcons.EDIT} style="height: 100%; flex: 1; overflow: hidden;">
          <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; height: 100%; max-height: 100%; box-sizing: border-box; overflow: hidden;">
            <bim-text-input style="flex: 0 0 auto;" ${BUI.ref((e) => { nameInput = e as BUI.TextInput; queriesUIState.nameInput = nameInput; })} placeholder="Query Name" vertical></bim-text-input>
            <bim-text-input style="flex: 0 0 auto;" ${BUI.ref((e) => { entityInput = e as BUI.TextInput; queriesUIState.entityInput = entityInput; })} placeholder="Entity (e.g. WALL)" vertical></bim-text-input>
            <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { attrNameInput = e as BUI.TextInput; queriesUIState.attrNameInput = attrNameInput; })} placeholder="Attribute Name" vertical></bim-text-input>
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { attrValInput = e as BUI.TextInput; queriesUIState.attrValInput = attrValInput; })} placeholder="Attribute Value" vertical></bim-text-input>
            </div>
            <bim-text-input style="flex: 0 0 auto;" ${BUI.ref((e) => { psetNameInput = e as BUI.TextInput; queriesUIState.psetNameInput = psetNameInput; })} placeholder="PropertySet Name" vertical></bim-text-input>
            <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { propNameInput = e as BUI.TextInput; queriesUIState.propNameInput = propNameInput; })} placeholder="Property Name" vertical></bim-text-input>
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { propValInput = e as BUI.TextInput; queriesUIState.propValInput = propValInput; })} placeholder="Property Value" vertical></bim-text-input>
            </div>
            <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { containedInInput = e as BUI.TextInput; queriesUIState.containedInInput = containedInInput; })} placeholder="Container Entity (e.g. STOREY)" vertical></bim-text-input>
              <bim-text-input style="flex: 1;" ${BUI.ref((e) => { structureNameInput = e as BUI.TextInput; queriesUIState.structureNameInput = structureNameInput; })} placeholder="Container Name" vertical></bim-text-input>
            </div>
            <div style="display: flex; gap: 0.5rem; flex: 0 0 auto;">
              <bim-button style="flex: 1;" @click=${onQueryFind} label="Find" icon=${appIcons.SEARCH}></bim-button>
              <bim-button style="flex: 1;" @click=${onClear} label="Clear" icon=${appIcons.CLEAR}></bim-button>
            </div>
            ${embeddedChat ? BUI.html`
              <div style="flex: 1; min-height: 0; max-height: 100%; margin-top: 0.5rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">
                ${embeddedChat}
              </div>
            ` : ""}
          </div>
        </bim-tab>
      </bim-tabs>
    </bim-panel-section>
  `;
};

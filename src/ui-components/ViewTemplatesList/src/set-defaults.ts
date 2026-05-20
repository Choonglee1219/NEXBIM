import * as BUI from "@thatopen/ui";
import { ViewTemplatesListState, ViewTemplatesListTableData } from "./types";
import { ViewTemplater } from "../../../bim-components";
import { appIcons, tableDefaultContentTemplate, tableButtonStyle } from "../../../globals";

export const setDefaults = (
  state: ViewTemplatesListState,
  table: BUI.Table<ViewTemplatesListTableData>,
) => {
  const { components } = state;

  table.noIndentation = true;
  table.expanded = true;
  table.headersHidden = true;
  table.columns = [{ name: "Name", width: "minmax(0, 1fr)" }, { name: "Actions", width: "auto" }];

  table.defaultContentTemplate = tableDefaultContentTemplate;

  table.dataTransform = {
    Actions: (_, rowData) => {
      const { Name } = rowData;
      if (!Name) return _;

      const templater = components.get(ViewTemplater);

      const onApply = async ({ target }: { target: BUI.Button }) => {
        target.loading = true;
        await templater.apply(Name);
        target.loading = false;
      };

      const onReset = async ({ target }: { target: BUI.Button }) => {
        target.loading = true;
        await templater.reset();
        target.loading = false;
      };

      return BUI.html`
        <div style="display: flex; gap: 0.25rem; align-items: center; justify-content: center; height: 1.5rem;">
          <bim-button style=${tableButtonStyle} title="Apply Template" icon=${appIcons.COLORIZE} @click=${onApply}></bim-button>
          <bim-button style=${tableButtonStyle} title="Reset View" icon=${appIcons.SHOW} @click=${onReset}></bim-button>
        </div>
      `;
    },
  };
};

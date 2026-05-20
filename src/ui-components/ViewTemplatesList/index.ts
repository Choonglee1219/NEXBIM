import * as BUI from "@thatopen/ui";
import {
  ViewTemplatesListState,
  ViewTemplatesListTableData,
  viewTemplatesListTemplate,
} from "./src";
import { ViewTemplater } from "../../bim-components";
import { setDefaults } from "./src/set-defaults";

export const viewTemplatesList = (
  state: ViewTemplatesListState,
  autoUpdate = true,
) => {
  const element = BUI.Component.create<
    BUI.Table<ViewTemplatesListTableData>,
    ViewTemplatesListState
  >(viewTemplatesListTemplate, state);

  const [table, updateTable] = element;
  setDefaults(state, table);

  if (autoUpdate) {
    const { components } = state;
    const templater = components.get(ViewTemplater);
    const updateFunction = () => updateTable();
    templater.list.onItemSet.add(updateFunction);
    templater.list.onItemUpdated.add(updateFunction);
    templater.list.onItemDeleted.add(updateFunction);
  }

  return element;
};

export * from "./src";

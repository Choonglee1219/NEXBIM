import * as BUI from "@thatopen/ui";
import { ViewTemplatesListState, ViewTemplatesListTableData } from "./types";
import { ViewTemplater } from "../../../bim-components";
import { appIcons } from "../../../globals";
import { onTableCellCreated, onTableRowCreated } from "../../../globals";

export const viewTemplatesListTemplate = (state: ViewTemplatesListState) => {
  const { components } = state;

  const templater = components.get(ViewTemplater);

  const missingDataMessage =
    state.missingDataMessage ?? "There are no templates created.";

  const onCreated = (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table<ViewTemplatesListTableData>;

    const data: BUI.TableGroupData<ViewTemplatesListTableData>[] = [];

    for (const [name] of templater.list) {
      const templateRow: BUI.TableGroupData<ViewTemplatesListTableData> = {
        data: {
          Name: name,
          Actions: "",
        },
      };

      data.push(templateRow);
    }

    table.data = data;
  };

  return BUI.html`
   <bim-table @rowcreated=${onTableRowCreated} @cellcreated=${onTableCellCreated} ${BUI.ref(onCreated)}>
      <bim-label slot="missing-data" style="--bim-icon--c: gold" icon=${appIcons.TASK}>
        ${missingDataMessage}
      </bim-label>
   </bim-table> 
  `;
};

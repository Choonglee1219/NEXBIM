// eslint-disable-next-line import/no-extraneous-dependencies
import * as BUI from "@thatopen/ui";
import { TopicsListState, TopicsListTableData } from "./types";
import { appIcons, onTableCellCreated, onTableRowCreated } from "../../../globals";
import { BCFTopics as EngineBCFTopics } from "../../../engine-components/BCFTopics";

export const topicsListTemplate: BUI.StatefullComponent<TopicsListState> = (
  state,
) => {
  const { components } = state;

  const missingDataMessage = state.missingDataMessage ?? "No topics to display";

  const bcfTopics = components.get(EngineBCFTopics);
  const topics = state.topics ?? bcfTopics.list.values();
  const onTableCreated = (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table<TopicsListTableData>;
    table.data = [...topics].map((topic) => {
      return {
        data: {
          Guid: topic.guid,
          Title: topic.title,
          Snapshot: (topic as any).snapshot ?? "",
          Status: topic.status,
          Description: topic.description ?? "",
          Author: topic.creationAuthor,
          Assignee: topic.assignedTo ?? "",
          Date: topic.creationDate.toDateString(),
          DueDate: topic.dueDate?.toDateString() ?? "",
          Type: topic.type,
          Priority: topic.priority ?? "",
          Actions: "",
        },
      };
    });
  };

  return BUI.html`
    <bim-table no-indentation @rowcreated=${onTableRowCreated} @cellcreated=${onTableCellCreated} ${BUI.ref(onTableCreated)}>
      <bim-label slot="missing-data" icon=${appIcons.WARNING} style="--bim-icon--c: gold;">${missingDataMessage}</bim-label>
    </bim-table>
  `;
};
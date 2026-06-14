// eslint-disable-next-line import/no-extraneous-dependencies
import * as BUI from "@thatopen/ui";
import { TopicsListState, TopicsListTableData } from "./types";
import { appIcons, onTableCellCreated, onTableRowCreated } from "../../../globals";
import { BCFTopics as EngineBCFTopics } from "../../../bim-components/BCFTopics/src/engine";

export const topicsListTemplate: BUI.StatefullComponent<TopicsListState> = (
  state,
) => {
  const { components } = state;

  const missingDataMessage = state.missingDataMessage ?? "No topics to display";

  const bcfTopics = components.get(EngineBCFTopics);
  const topics = state.topics ?? bcfTopics.list.values();
  const tableData = [...topics].map((topic) => {
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
        Actions: state.unsyncedTopicGuids?.has(topic.guid) ? "unsynced" : "synced",
      },
    };
  });

  const onRowCreated = (e: Event) => {
    onTableRowCreated(e);
    const table = e.target as BUI.Table<TopicsListTableData>;
    const customEvent = e as CustomEvent<BUI.RowCreatedEventDetail<any>>;
    const { row } = customEvent.detail;
    row.style.cursor = "pointer";

    row.onclick = () => {
      const wasSelected = table.selection.has(row.data);
      table.selection.clear();

      if (!wasSelected) {
        table.selection.add(row.data);
      }

      if (typeof table.requestUpdate === "function") table.requestUpdate();
      table.dispatchEvent(new Event("change"));

      const topic = bcfTopics.list.get(row.data.Guid);
      if (topic) {
        const customBcf = Array.from(components.list.values()).find((c: any) => typeof c.restoreViewpoint === "function") as any;
        if (customBcf) {
          customBcf.restoreViewpoint(topic);
        }
      }
    };
  };

  return BUI.html`
    <bim-table no-indentation @rowcreated=${onRowCreated} @cellcreated=${onTableCellCreated} .data=${tableData}>
      <bim-label slot="missing-data" icon=${appIcons.WARNING} style="--bim-icon--c: gold;">${missingDataMessage}</bim-label>
    </bim-table>
  `;
};
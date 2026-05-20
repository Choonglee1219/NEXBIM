import * as BUI from "@thatopen/ui";
import { users } from "../../setup/users";
import {
  TopicsListState,
  TopicsListTableData,
  topicsListTemplate,
} from "./src";
import { setDefaults } from "./src/set-defaults";
import { BCFTopics as EngineBCFTopics } from "../../engine-components/BCFTopics";

/**
 * Creates a BCF Topics List component with the given UI state.
 *
 * @param state - The initial state of the BCF Topics List component.
 * @param autoUpdate - A flag indicating whether the component should automatically update based on events happening in the BCFTopic component.
 * Default value is `true`.
 *
 * @returns A tuple containing the created BCF Topics List component and a function to update it.
 */
export const topicsList = (state: TopicsListState, autoUpdate = true) => {
  if (!state.dataStyles) {
    state.dataStyles = {};
  }
  if (!state.dataStyles.users) {
    state.dataStyles.users = users;
  }

  const element = BUI.Component.create<
    BUI.Table<TopicsListTableData>,
    TopicsListState
  >(topicsListTemplate, state);

  const [table, updateTable] = element;
  setDefaults(state, table);

  table.selectableRows = true;

  table.addEventListener("click", () => {
    setTimeout(() => {
      if (table.selection.size > 1) {
        const lastSelected = Array.from(table.selection).pop();
        table.selection.clear();
        if (lastSelected) {
          table.selection.add(lastSelected);
        }
        table.requestUpdate();
      }
    });
  });

  if (autoUpdate) {
    const { components, topics } = state;
    const bcfTopics = components.get(EngineBCFTopics);
    
    let updateTimeout: ReturnType<typeof setTimeout>;
    const updateCallback = () => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => updateTable(), 50);
    };

    bcfTopics.list.onItemUpdated.add(updateCallback);
    bcfTopics.list.onItemDeleted.add(updateCallback);
    if (topics) {
      for (const topic of topics) {
        topic.relatedTopics.onItemAdded.add(updateCallback);
        topic.relatedTopics.onItemDeleted.add(updateCallback);
        topic.relatedTopics.onCleared.add(updateCallback);
      }
    } else {
      bcfTopics.list.onItemSet.add(updateCallback);
    }
  }

  return element;
};

export * from "./src";
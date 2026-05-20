import * as BUI from "@thatopen/ui";
import { QueriesListState, queriesListTemplate } from "./src";

export const queriesList = (state: QueriesListState) => {
  const element = BUI.Component.create(queriesListTemplate, state);
  return element;
};

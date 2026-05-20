import * as BUI from "@thatopen/ui";
import { ItemsDataState } from "./types";
import { itemsDataTemplate } from "./template";

export * from "./types";
export * from "./template";

export const itemsData = (state: ItemsDataState) => {
  return BUI.Component.create<BUI.Table, ItemsDataState>(itemsDataTemplate, state);
};
import * as BUI from "@thatopen/ui";
import { BimChatState } from "./src/types";
import { bimChatTemplate } from "./src/template";

export * from "./src/types";

export const bimChatPanel = (state: BimChatState) => {
  const element = BUI.Component.create<BUI.Panel, BimChatState>(
    bimChatTemplate,
    state,
  );
  return element;
};

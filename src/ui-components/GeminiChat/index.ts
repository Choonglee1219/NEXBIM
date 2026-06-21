import * as BUI from "@thatopen/ui";
import { GeminiChatState } from "./src/types";
import { geminiChatTemplate } from "./src/template";

export * from "./src/types";

export const geminiChatPanel = (state: GeminiChatState) => {
  const element = BUI.Component.create<BUI.Panel, GeminiChatState>(
    geminiChatTemplate,
    state,
  );
  return element;
};

import * as OBC from "@thatopen/components";

export type BimChatMode = "viewport" | "query" | "rule";

export interface ChatMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface BimChatState {
  components: OBC.Components;
  world: OBC.World;
  mode?: BimChatMode;
  embedded?: boolean;
}



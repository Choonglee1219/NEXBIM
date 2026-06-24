import * as OBC from "@thatopen/components";

export interface ChatMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface BimChatState {
  components: OBC.Components;
  world: OBC.World;
}

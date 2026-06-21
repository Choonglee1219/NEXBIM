import * as OBC from "@thatopen/components";

export interface ChatMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface GeminiChatState {
  components: OBC.Components;
  world: OBC.World;
}

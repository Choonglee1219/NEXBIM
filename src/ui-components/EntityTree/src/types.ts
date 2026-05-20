import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";

export interface EntityTreeState {
  components: OBC.Components;
  models: Iterable<FRAGS.FragmentsModel>;
  selectHighlighterName?: string;
}

export type EntityTreeData = {
  modelId: string;
  localId?: number;
  Name: string;
  children?: string;
};
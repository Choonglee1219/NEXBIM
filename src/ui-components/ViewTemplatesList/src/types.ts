import * as OBC from "@thatopen/components";

export type ViewTemplatesListTableData = {
  Name: string;
  Actions: string;
};

export interface ViewTemplatesListState {
  components: OBC.Components;
  missingDataMessage?: string;
}

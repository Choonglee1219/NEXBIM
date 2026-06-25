import * as OBC from "@thatopen/components";

export interface QueriesListState {
  components: OBC.Components;
  queryString?: string;
  onLoadQuery?: (fields: any) => void;
}

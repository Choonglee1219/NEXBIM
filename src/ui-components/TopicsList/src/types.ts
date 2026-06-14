import * as OBC from "@thatopen/components";

export type TopicsListTableData = {
  Guid: string;
  Title: string;
  Snapshot: string;
  Status: string;
  Description: string;
  Author: string;
  Assignee: string;
  Date: string;
  DueDate: string;
  Type: string;
  Priority: string;
  Actions: string;
};

export interface TopicsListState {
  components: OBC.Components;
  topics?: Iterable<OBC.Topic>;
  dataStyles?: TopicStyles;
  missingDataMessage?: string;
  unsyncedTopicGuids?: Set<string>;
};

export interface TopicDataStyles {
  [name: string]: { icon?: string; style?: Record<string, string> };
};

export interface TopicUserStyles {
  [email: string]: { name: string; picture?: string };
};

export interface TopicStyles {
  priorities?: TopicDataStyles;
  statuses?: TopicDataStyles;
  types?: TopicDataStyles;
  users?: TopicUserStyles;
  labels?: TopicDataStyles;
  stages?: TopicDataStyles;
};

export type RuleGroupByOption = "GUID" | "Model" | "Entity" | "Status" | "None";

export type RuleTableData = {
  id: string;
  ModelID?: string;
  ExpressID?: number;
  Model: string;
  Name: string;
  GUID: string;
  Entity: string;
  Value: string;
  Count: number | string;
  Status: string;
  isGroup?: boolean;
  rawGroup?: RuleTableData[];
};

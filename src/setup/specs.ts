export interface IDSSpecDefinition {
  name: string;
  description: string;
  applicability: {
    entity: string;
  };
  requirement: {
    type: "property" | "attribute" | "quantity" | "cross-anomaly" | "completion-rate" | "schema-check";
    propertySet?: string;
    name: string;
    condition: "exists" | "pattern" | "anomaly-check" | "completion-check" | "schema-check";
    value?: string;
  };
}

export const predefinedSpecs: IDSSpecDefinition[] = [
  {
    name: "1. IFC 스키마 및 규격 검사",
    description: "공간 구조(Storey) 소속 여부, PredefinedType Enum 유효성 등 IFC 스키마 규격을 검사한다.",
    applicability: { entity: "ALL" },
    requirement: { type: "schema-check", name: "SchemaValidator", condition: "schema-check" }
  },
  {
    name: "2. 중복 GUID 여부 검사",
    description: "불러져 있는 모든 모델들에 걸쳐 중복 GUID를 검사한다.",
    applicability: { entity: "ALL" },
    requirement: { type: "attribute", name: "GlobalId", condition: "exists" }
  },
  {
    name: "3. 프로퍼티 값 이상치 검사",
    description: "불러져 있는 모든 모델들에 걸쳐 프로퍼티 값의 이상치를 검사한다.",
    applicability: { entity: "ALL" },
    requirement: { type: "cross-anomaly", name: "MultiChecker", condition: "anomaly-check" }
  },
  {
    name: "4. 표준 프로퍼티 입력률 검사",
    description: "불러져 있는 모든 모델들에 걸쳐 프로퍼티 누락 및 미입력(TBD/Null) 항목을 검사한다.",
    applicability: { entity: "ALL" },
    requirement: { type: "completion-rate", name: "Completion", condition: "completion-check" }
  },
  {
    name: "5. Door FireRating 여부 검사",
    description: "모든 Door는 Pset_DoorCommon.FireRating 프로퍼티를 가져야 한다.",
    applicability: { entity: "IFCDOOR" },
    requirement: { type: "property", propertySet: "Pset_DoorCommon", name: "FireRating", condition: "exists" }
  },
  {
    name: "6. Wall PredefinedType 여부 검사",
    description: "모든 Wall은 PredefinedType 속성을 가져야 한다.",
    applicability: { entity: "IFCWALL" },
    requirement: { type: "attribute", name: "PredefinedType", condition: "exists" }
  },
];
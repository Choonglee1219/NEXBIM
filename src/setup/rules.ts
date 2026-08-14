export interface RuleSpecDefinition {
  name: string;
  description: string;
  applicability: {
    entity: string;
  };
  requirement: {
    type: "property" | "attribute" | "quantity" | "classification" | "material" | "partof" | "cross-anomaly" | "completion-rate" | "schema-check" | "duplicate-guid";
    propertySet?: string;
    name: string;
    condition: "exists" | "pattern" | "simple" | "enumeration" | "bounds" | "length" | "anomaly-check" | "completion-check" | "schema-check" | "duplicate-check";
    value?: string;
    system?: string;
    relation?: string;
    uri?: string;
    bounds?: {
      min?: number;
      minInclusive?: boolean;
      max?: number;
      maxInclusive?: boolean;
    };
    length?: {
      min?: number;
      max?: number;
      length?: number;
    };
    enumValues?: string[];
  };
}

export const predefinedSpecs: RuleSpecDefinition[] = [
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
    requirement: { type: "duplicate-guid", name: "GlobalId", condition: "duplicate-check" }
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
  {
    name: "7. Classification 분류 체계 검사",
    description: "모든 객체가 Classification(분류 정보) 체계와 연결되어 있는지 검사한다.",
    applicability: { entity: "ALL" },
    requirement: { type: "classification", name: "Classification", condition: "exists" }
  },
  {
    name: "8. Material 재질 존재 여부 검사",
    description: "모든 객체가 Material(재질 정보) 항목을 가지고 있는지 검사한다.",
    applicability: { entity: "ALL" },
    requirement: { type: "material", name: "Material", condition: "exists" }
  },
  {
    name: "9. Door FireRating Enum 검사",
    description: "Door의 FireRating 프로퍼티 값이 허용 목록(20 Minute, 1hr, 2hr, 90min, 120min, 60/60) 중 하나인지 검사한다.",
    applicability: { entity: "IFCDOOR" },
    requirement: { type: "property", propertySet: "Pset_DoorCommon", name: "FireRating", condition: "enumeration", value: "20 Minute, 1hr, 2hr, 90min, 120min, 60/60" }
  },
  {
    name: "10. Storey 공간 소속 여부 검사 (PartOf)",
    description: "모든 객체가 IfcBuildingStorey(층 공간 구조)의 상위 관계(Parent)를 가지고 있는지 검사한다.",
    applicability: { entity: "ALL" },
    requirement: { type: "partof", propertySet: "IFCRELCONTAINEDINSPATIALSTRUCTURE", name: "IFCBUILDINGSTOREY", condition: "exists" }
  },
];

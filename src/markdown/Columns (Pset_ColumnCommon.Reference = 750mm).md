# Columns (Pset_ColumnCommon.Reference = 750mm) 쿼리
<br>

### 역할
"Pset_ColumnCommon"이라는 프로퍼티 세트(Property Set)에서 "Reference" 프로퍼티 값이 "750"인 모든 기둥(Column) 요소를 선택합니다.
<br>

### 분석
이 쿼리는 복잡한 프로퍼티 세트(Pset) 관계를 탐색하여 매우 정밀한 조건을 만족하는 객체를 필터링합니다.

1.  **`categories: [/COLUMN/]`**: 먼저 모든 `IfcColumn` 객체를 대상으로 합니다.
2.  **`relation: { name: "IsDefinedBy", ... }`**: `IsDefinedBy` 관계를 통해 객체에 연결된 프로퍼티 정의를 찾습니다.
3.  **`query: { categories: [/PROPERTYSET/], attributes: { ... value: /ColumnCommon/ } }`**: 연결된 프로퍼티 정의가 `IfcPropertySet`이고, 그 이름(`Name`)에 "ColumnCommon"이 포함된 것을 찾습니다.
4.  **`relation: { name: "HasProperties", ... }`**: 해당 프로퍼티 세트가 가지고 있는 개별 프로퍼티(`HasProperties` 관계)을 탐색합니다.
5.  **`query: { categories: [/SINGLEVALUE/], attributes: { ... } }`**: 개별 프로퍼티가 `IfcPropertySingleValue` 타입인지 확인합니다.
6.  **`attributes: { queries: [{ name: /Reference/ }, { name: /NominalValue/, value: /750/ }] }`**: 해당 프로퍼티 이름(`Name`)이 "Reference"이고, 그 값(`NominalValue`)이 "750"인 것을 최종 조건으로 필터링합니다.
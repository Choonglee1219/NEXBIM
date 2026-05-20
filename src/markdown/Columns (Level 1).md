# Columns (Level 1) 쿼리
<br>

### 역할
1층에 포함된 모든 기둥(Column) 요소를 선택합니다.
<br>

### 분석
이 쿼리는 공간 구조 관계(ContainedInStructure)를 사용하여 특정 층에 속한 객체를 필터링합니다.

1.  **`categories: [/COLUMN/]`**: 먼저 모든 `IfcColumn` 객체를 대상으로 합니다.
2.  **`relation: { name: "ContainedInStructure", ... }`**: 대상 객체들이 `ContainedInStructure` 관계를 통해 다른 요소에 포함되어 있는지 확인합니다.
3.  **`query: { categories: [/STOREY/], ... }`**: 포함하는 요소가 `IfcStorey`(층)인지 확인합니다.
4.  **`attributes: { ... value: /01/ }`**: 해당 `IfcStorey`의 `Name` 속성에 "01"이 포함된 경우만 최종 결과로 선택합니다.
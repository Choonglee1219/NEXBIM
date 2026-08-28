import * as FRAGS from "@thatopen/fragments";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { SpatialTreeItem } from "@thatopen/fragments";
import { SpatialTreeState, SpatialTreeData } from "./types";
import { Highlighter } from "../../../bim-components/Highlighter";
import { RelationParsingService } from "../../../bim-components/RelationParsingService";
import { setupBIMTable, onTableCellCreated, onTableRowCreated, getCategoryBadgeStyle } from "../../../globals";

const getModelTree = (
  model: FRAGS.FragmentsModel,
  structure: SpatialTreeItem,
  nameMap: Map<number, string>,
  categoryPrefix: string = "",
): BUI.TableGroupData<SpatialTreeData>[] => {
  const { localId, category, children } = structure;

  if (category && children) {
    const rows: BUI.TableGroupData<SpatialTreeData>[] = [];
    for (const child of children) {
      const childRows = getModelTree(model, child, nameMap, category);
      rows.push(...childRows);
    }
    return rows;
  }

  if (localId !== undefined && localId !== null) {
    const name = nameMap.get(localId) || "Untitled";

    const row: BUI.TableGroupData<SpatialTreeData> = {
      data: {
        Name: name,
        category: categoryPrefix || undefined,
        modelId: model.modelId,
        localId,
      },
    };

    if (children && children.length > 0) {
      row.children = [];
      for (const child of children) {
        const childRows = getModelTree(model, child, nameMap);
        row.children.push(...childRows);
      }
    }
    return [row];
  }
  return [];
};

const computeRowData = async (models: Iterable<FRAGS.FragmentsModel>, components?: OBC.Components) => {
  const rows: BUI.TableGroupData[] = [];
  for (const model of models) {
    const structure = await model.getSpatialStructure();
    
    // 1. 트리 내의 모든 localId를 먼저 수집
    const allLocalIds = new Set<number>();
    const traverse = (node: SpatialTreeItem) => {
      if (node.localId !== undefined && node.localId !== null) allLocalIds.add(node.localId);
      if (node.children) node.children.forEach(traverse);
    };
    traverse(structure);

    // 2. RelationParsingService에서 SpatialZones 및 Openings 관계 수집
    let relData: any = null;
    if (components) {
      try {
        const relService = components.get(RelationParsingService);
        relData = await relService.getModelRelations(model);
        if (relData) {
          for (const zone of relData.spatialZones.values()) {
            allLocalIds.add(zone.expressId);
            for (const refId of zone.referencedElementIds) {
              allLocalIds.add(refId);
            }
          }
          for (const op of relData.openings.values()) {
            allLocalIds.add(op.expressId);
          }
        }
      } catch (err) {
        console.warn("[SpatialTree] Failed to fetch model relations:", err);
      }
    }

    // 3. 수집된 ID들의 속성 데이터를 한 번에 조회 (Bulk Fetch)
    const nameMap = new Map<number, string>();
    if (allLocalIds.size > 0) {
      const itemsData = await model.getItemsData(Array.from(allLocalIds), {
        attributesDefault: true,
        relationsDefault: { attributes: false, relations: false },
      });
      for (const item of itemsData) {
        const id = (item.expressID ?? item.id ?? (item as any)._localId?.value ?? (item as any)._localId) as unknown as number;
        const nameVal = (item as any).Name;
        let name = "Untitled";
        if (nameVal) {
          name = typeof nameVal === "object" && nameVal.value !== undefined ? String(nameVal.value) : String(nameVal);
        }
        if (id !== undefined) nameMap.set(id, name);
      }
    }

    // 4. Map 데이터를 참조하여 기본 계층 트리 구성
    const tree = getModelTree(model, structure, nameMap);

    // 5. SpatialZone 비계층 구조 그룹 추가 (IFC4 IfcSpatialZone)
    if (relData && relData.spatialZones && relData.spatialZones.size > 0) {
      const zoneRows: BUI.TableGroupData<SpatialTreeData>[] = [];
      for (const [zoneId, zone] of relData.spatialZones.entries()) {
        const zName = zone.name || zone.longName || (zone.objectType ? `Zone (${zone.objectType})` : `Zone #${zoneId}`);
        const refChildren: BUI.TableGroupData<SpatialTreeData>[] = [];
        for (const refId of zone.referencedElementIds) {
          const refName = nameMap.get(refId) || `Element #${refId}`;
          refChildren.push({
            data: {
              Name: refName,
              modelId: model.modelId,
              localId: refId,
            },
          });
        }
        zoneRows.push({
          data: {
            Name: zName,
            category: "Spatial Zone",
            modelId: model.modelId,
            localId: zoneId,
            children: JSON.stringify(zone.referencedElementIds),
          },
          children: refChildren.length > 0 ? refChildren : undefined,
        });
      }
      if (zoneRows.length > 0) {
        tree.push({
          data: {
            Name: "Spatial Zones (Non-Hierarchical)",
            modelId: model.modelId,
          },
          children: zoneRows,
        });
      }
    }

    if (tree.length === 0) continue;
    const modelName = (model as any).name || model.modelId;
    const modelData: BUI.TableGroupData<SpatialTreeData> = {
      data: {
        Name: modelName,
        modelId: model.modelId,
        children: JSON.stringify(Array.from(allLocalIds)), // 전체 객체 선택 기능을 위한 하위 ID 문자열화
      },
      children: tree,
    };
    rows.push(modelData);
  }
  return rows;
};

export const spatialTreeTemplate = (state: SpatialTreeState) => {
  const { components, models } = state;

  const selectHighlighterName = state.selectHighlighterName ?? "select";

  const onCellCreated = ({
    detail,
  }: CustomEvent<BUI.CellCreatedEventDetail<SpatialTreeData>>) => {
    onTableCellCreated(new CustomEvent("cellcreated", { detail })); // 전역 이벤트 주입
    const { cell } = detail;

    if (cell.column === "Name" && !cell.rowData.Name) {
      cell.style.gridColumn = "1 / -1";
    }
  };

  const onRowCreated = (
    e: CustomEvent<BUI.RowCreatedEventDetail<SpatialTreeData>>,
  ) => {
    onTableRowCreated(e); // 전역 이벤트 주입
    const { row } = e.detail;

    const highlighter = components.get(Highlighter);
    const fragments = components.get(OBC.FragmentsManager);
    row.onclick = async () => {
      if (!selectHighlighterName) return;
      const {
        data: { modelId, localId, children },
      } = row;
      if (!(modelId && (localId !== undefined || children))) return;
      const model = fragments.list.get(modelId);
      if (!model) return;
      if (localId !== undefined) {
        const childrenLocalIds = await model.getItemsChildren([localId]);
        const modelIdMap = {
          [modelId]:
            childrenLocalIds.length !== 0
              ? new Set(childrenLocalIds)
              : new Set([localId]),
        };
        highlighter.highlightByID(
          selectHighlighterName,
          modelIdMap,
          true,
          true,
        );
      } else if (children) {
        const localIds = JSON.parse(children);
        const childrenLocalIds = await model.getItemsChildren(localIds);
        const modelIdMap = {
          [modelId]:
            childrenLocalIds.length !== 0 ? childrenLocalIds : localIds,
        };
        highlighter.highlightByID(
          selectHighlighterName,
          modelIdMap,
          true,
          true,
        );
      }
    };
  };

  const onTableCreated = async (element?: Element) => {
    if (!element) return;
    const table = element as BUI.Table<SpatialTreeData>;
    setupBIMTable(table);

    // 열 너비를 제한하여 텍스트 오버플로우 시 말줄임표(...)가 적용되도록 설정
    table.columns = [{ name: "Name", width: "minmax(0, 1fr)" }];
    table.hiddenColumns = ["modelId", "localId", "children", "categoryPrefix", "category"];

    table.dataTransform = {
      Name: (value, rowData) => {
        const nameText = value !== null && value !== undefined ? String(value) : "";
        const category = (rowData as SpatialTreeData)?.category;

        if (!category) {
          return BUI.html`
            <bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; width: 100%;" title=${nameText}>
              ${nameText}
            </bim-label>
          `;
        }

        const badgeStyle = getCategoryBadgeStyle(category);
        const badgeLabel = category.replace(/^IFC/i, "");

        return BUI.html`
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; min-width: 0; gap: 0.5rem;">
            <bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;" title=${nameText}>
              ${nameText}
            </bim-label>
            <span style="
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 0.1rem 0.45rem;
              font-size: 0.675rem;
              font-weight: 500;
              letter-spacing: 0.02em;
              border-radius: 999px;
              white-space: nowrap;
              flex-shrink: 0;
              line-height: 1.2;
              user-select: none;
              ${badgeStyle}
            ">${badgeLabel}</span>
          </div>
        `;
      },
    };

    table.loadFunction = async () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(computeRowData(models, components));
        });
      });
    };

    table.loadData(true);
  };

  return BUI.html`
    <bim-table @rowcreated=${onRowCreated} @cellcreated=${onCellCreated} ${BUI.ref(onTableCreated)} headers-hidden style="gap: 0;">
      <bim-label slot="missing-data" style="--bim-icon--c: gold">
        ⚠️ No models available to display the spatial structure!
      </bim-label>
    </bim-table>
  `;
};


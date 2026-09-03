import * as FRAGS from "@thatopen/fragments";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { SpatialTreeItem } from "@thatopen/fragments";
import { SpatialTreeState, SpatialTreeData } from "./types";
import { Highlighter } from "../../../bim-components/Highlighter";
import { RelationParsingService } from "../../../bim-components/RelationParsingService";
import { setupBIMTable, onTableCellCreated, onTableRowCreated, getCategoryBadgeStyle, appIcons } from "../../../globals";

export const SPATIAL_STRUCTURE_CATEGORIES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPACE",
  "IFCSPATIALZONE",
  "IFCSPATIALELEMENT",
  "IFCSPATIALSTRUCTUREELEMENT",
]);

export const isSpatialStructureCategory = (category?: string | null): boolean => {
  if (!category) return false;
  let clean = String(category).trim().toUpperCase().replace(/^IFC/i, "").replace(/[\s_-]+/g, "");
  if (clean === "STOREY") clean = "BUILDINGSTOREY";
  return SPATIAL_STRUCTURE_CATEGORIES.has(`IFC${clean}`);
};

export const getSpatialLocalIds = (structure: any): Set<number> => {
  const spatialIds = new Set<number>();
  if (!structure) return spatialIds;

  const traverse = (node: any, inheritedCat = "") => {
    if (!node) return;
    const currentCat = node.category ? String(node.category).trim() : inheritedCat;
    const isSpatial = isSpatialStructureCategory(currentCat);

    if (node.localId !== undefined && node.localId !== null) {
      const numId = Number(node.localId);
      if (!isNaN(numId) && isSpatial) {
        spatialIds.add(numId);
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const nextCat = child.category ? String(child.category).trim() : currentCat;
        traverse(child, nextCat);
      }
    }
  };

  traverse(structure);
  return spatialIds;
};

const modelSpatialIdsMap = new WeakMap<FRAGS.FragmentsModel, Set<number>>();

export const getModelSpatialIds = async (
  model: FRAGS.FragmentsModel,
  components?: OBC.Components,
): Promise<Set<number>> => {
  let cached = modelSpatialIdsMap.get(model);
  if (cached) return cached;

  try {
    const structure = await model.getSpatialStructure();
    cached = getSpatialLocalIds(structure);

    if (components) {
      try {
        const relService = components.get(RelationParsingService);
        const relData =
          relService.getRelationsByModelKey(model.modelId) ||
          (await relService.getModelRelations(model));
        if (relData && relData.spatialZones) {
          for (const zoneId of relData.spatialZones.keys()) {
            cached.add(Number(zoneId));
          }
        }
      } catch (_) {}
    }

    modelSpatialIdsMap.set(model, cached);
    return cached;
  } catch (err) {
    console.warn("[SpatialTree] Failed to get spatial structure IDs:", err);
    return new Set<number>();
  }
};

export const collectDescendantIds = (
  item: SpatialTreeItem,
  spatialIds: Set<number>,
): number[] => {
  const ids: number[] = [];
  if (!item.children || item.children.length === 0) return ids;

  const traverse = (node: SpatialTreeItem) => {
    if (node.localId !== undefined && node.localId !== null) {
      const nId = Number(node.localId);
      if (!isNaN(nId) && !spatialIds.has(nId)) {
        ids.push(nId);
      }
    }
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };

  for (const child of item.children) {
    traverse(child);
  }
  return ids;
};

const getModelTree = (
  model: FRAGS.FragmentsModel,
  structure: SpatialTreeItem,
  nameMap: Map<number, string>,
  spatialIds: Set<number>,
  categoryPrefix: string = "",
): BUI.TableGroupData<SpatialTreeData>[] => {
  const { localId, category, children } = structure;

  if (localId !== undefined && localId !== null) {
    const name = nameMap.get(localId) || "Untitled";
    const currentCategory = category || categoryPrefix || undefined;
    const hasChildren = Boolean(children && children.length > 0);
    const descendantIds = hasChildren ? collectDescendantIds(structure, spatialIds) : [];

    const row: BUI.TableGroupData<SpatialTreeData> = {
      data: {
        Name: name,
        category: currentCategory,
        modelId: model.modelId,
        localId,
        hasChildren,
        children: hasChildren ? JSON.stringify(descendantIds) : undefined,
      },
    };

    if (children && children.length > 0) {
      row.children = [];
      for (const child of children) {
        const childRows = getModelTree(model, child, nameMap, spatialIds, child.category || currentCategory);
        row.children.push(...childRows);
      }
    }
    return [row];
  }

  if (category && children) {
    const rows: BUI.TableGroupData<SpatialTreeData>[] = [];
    for (const child of children) {
      const childRows = getModelTree(model, child, nameMap, spatialIds, category);
      rows.push(...childRows);
    }
    return rows;
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
    const spatialIds = await getModelSpatialIds(model, components);
    const tree = getModelTree(model, structure, nameMap, spatialIds);

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
            hasChildren: zone.referencedElementIds.length > 0,
            children: JSON.stringify(zone.referencedElementIds),
          },
          children: refChildren.length > 0 ? refChildren : undefined,
        });
      }
      if (zoneRows.length > 0) {
        const allZoneRefIds = Array.from(new Set(zoneRows.flatMap((z) => (z.data.children ? JSON.parse(z.data.children) : []))));
        tree.push({
          data: {
            Name: "Spatial Zones (Non-Hierarchical)",
            modelId: model.modelId,
            hasChildren: true,
            children: JSON.stringify(allZoneRefIds),
          },
          children: zoneRows,
        });
      }
    }

    if (tree.length === 0) continue;
    const modelName = (model as any).name || model.modelId;
    const modelNonSpatialIds = Array.from(allLocalIds).filter((id) => !spatialIds.has(id));
    const modelData: BUI.TableGroupData<SpatialTreeData> = {
      data: {
        Name: modelName,
        modelId: model.modelId,
        hasChildren: true,
        children: JSON.stringify(modelNonSpatialIds), // 전체 객체 선택 기능을 위한 하위 ID 문자열화
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

  const onHighlightDescendants = async (rowData: SpatialTreeData) => {
    if (!selectHighlighterName) return;
    const { modelId, localId, children } = rowData;
    if (!modelId) return;

    const fragments = components.get(OBC.FragmentsManager);
    const model = fragments.list.get(modelId);
    if (!model) return;

    let targetIds: number[] = [];
    if (children) {
      try {
        const parsed = JSON.parse(children);
        targetIds = Array.isArray(parsed) ? parsed : [];
      } catch (_) {}
    }

    if (targetIds.length === 0) {
      const spatialIds = await getModelSpatialIds(model, components);
      if (localId !== undefined) {
        try {
          const fetched = await model.getItemsChildren([Number(localId)]);
          targetIds = fetched.filter((id) => !spatialIds.has(Number(id)));
        } catch (_) {}
      }
      if (targetIds.length === 0 && localId !== undefined) {
        targetIds = [Number(localId)];
      }
    }

    if (targetIds.length > 0) {
      const highlighter = components.get(Highlighter);
      highlighter.highlightByID(
        selectHighlighterName,
        { [modelId]: new Set(targetIds) },
        true,
        true,
      );
    }
  };

  const onRowCreated = (
    e: CustomEvent<BUI.RowCreatedEventDetail<SpatialTreeData>>,
  ) => {
    onTableRowCreated(e); // 전역 이벤트 주입
    const { row } = e.detail;

    const highlighter = components.get(Highlighter);
    row.onclick = async () => {
      if (!selectHighlighterName) return;
      const {
        data: { modelId, localId },
      } = row;
      if (!modelId) return;

      if (localId !== undefined) {
        // 공간구조/집계요소/일반객체 상관없이 클릭된 해당 요소 자기자신(단 1개)만 선택!
        // -> 소속된 수천 개의 객체를 불필요하게 선택하지 않아 items-data가 즉시 로드됨!
        const numLocalId = Number(localId);
        const modelIdMap = {
          [modelId]: new Set([numLocalId]),
        };
        await highlighter.highlightByID(
          selectHighlighterName,
          modelIdMap,
          true,
          false, // zoomToSelection을 false로 설정하여 불필요한 카메라 지연 제거
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
    table.hiddenColumns = ["modelId", "localId", "children", "categoryPrefix", "category", "hasChildren"];

    table.dataTransform = {
      Name: (value, rowData) => {
        const data = rowData as SpatialTreeData;
        const nameText = value !== null && value !== undefined ? String(value) : "";
        const category = data?.category;
        const isContainer = Boolean(
          data?.hasChildren ||
          data?.children ||
          isSpatialStructureCategory(category)
        );

        const badgeStyle = category ? getCategoryBadgeStyle(category) : "";
        const badgeLabel = category ? category.replace(/^IFC/i, "") : null;

        return BUI.html`
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; min-width: 0; gap: 0.35rem;">
            <bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;" title=${nameText}>
              ${nameText}
            </bim-label>
            ${badgeLabel ? BUI.html`
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
            ` : ""}
            ${isContainer ? BUI.html`
              <bim-button
                icon=${appIcons.SELECT}
                title="소속 객체 모두 선택 (Highlight All)"
                style="
                  flex: 0 0 auto;
                  width: 1.45rem;
                  height: 1.45rem;
                  min-width: 1.45rem;
                  padding: 0;
                  margin: 0;
                  border-radius: 4px;
                  opacity: 0.85;
                  --bim-icon--c: var(--bim-ui_main-base, #8fbc0c);
                "
                @click=${(e: Event) => {
                  e.stopPropagation();
                  onHighlightDescendants(data);
                }}
              ></bim-button>
            ` : ""}
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

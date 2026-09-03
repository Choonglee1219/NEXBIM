import * as FRAGS from "@thatopen/fragments";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { EntityTreeState, EntityTreeData } from "./types";
import { Highlighter } from "../../../bim-components/Highlighter";
import { setupBIMTable, onTableCellCreated, onTableRowCreated, appIcons } from "../../../globals";

const computeRowData = async (models: Iterable<FRAGS.FragmentsModel>, components: OBC.Components) => {
  const rows: BUI.TableGroupData[] = [];
  const classifier = components.get(OBC.Classifier);

  // Classifier를 통해 엔티티 카테고리 분류
  try {
    await classifier.byCategory({ classificationName: "entities" });
  } catch (e) {}

  const entities = classifier.list.get("entities");
  if (!entities) return rows;

  // Classifier.list 의 Value는 ClassificationGroupData 이므로, 실제 ID 목록을 얻으려면 .get()을 호출해 쿼리를 평가해야 합니다.
  const preFetchedCategories = new Map<string, OBC.ModelIdMap>();
  for (const [catName, groupData] of entities.entries()) {
    preFetchedCategories.set(catName, await groupData.get());
  }

  for (const model of models) {
    const modelId = model.modelId;
    const modelName = (model as any).name || model.modelId;
    const modelChildren: BUI.TableGroupData<EntityTreeData>[] = [];
    const allLocalIds = new Set<number>();

    for (const [categoryName, modelMap] of preFetchedCategories.entries()) {
      if (!modelMap || !modelMap[modelId] || modelMap[modelId].size === 0) continue;

      const categoryIds = Array.from(modelMap[modelId]);
      categoryIds.forEach(id => allLocalIds.add(id));

      const itemsData = await model.getItemsData(categoryIds, {
        attributesDefault: true,
        relationsDefault: { attributes: false, relations: false },
      });

      const nameMap = new Map<number, string>();
      for (const item of itemsData) {
        const id = (item.expressID ?? item.id ?? (item as any)._localId?.value ?? (item as any)._localId) as unknown as number;
        const nameVal = (item as any).Name;
        let name = "Untitled";
        if (nameVal) {
          name = typeof nameVal === "object" && nameVal.value !== undefined ? String(nameVal.value) : String(nameVal);
        }
        if (id !== undefined) nameMap.set(id, name);
      }

      const elementRows: BUI.TableGroupData<EntityTreeData>[] = [];
      for (const expressId of categoryIds) {
        const name = nameMap.get(expressId) || `Element ${expressId}`;
        elementRows.push({
          data: {
            Name: name,
            modelId,
            localId: expressId,
          }
        });
      }

      // 하위 요소들을 알파벳 오름차순 정렬
      elementRows.sort((a, b) => String(a.data.Name || "Untitled").localeCompare(String(b.data.Name || "Untitled")));

      modelChildren.push({
        data: {
          Name: categoryName.replace(/^IFC/i, ""),
          modelId,
          children: JSON.stringify(categoryIds),
        },
        children: elementRows,
      });
    }

    if (modelChildren.length === 0) continue;

    // 카테고리 항목들을 알파벳 오름차순 정렬
    modelChildren.sort((a, b) => String(a.data.Name || "Untitled").localeCompare(String(b.data.Name || "Untitled")));

    // 모델 별 데이터 최상단 래핑
    const modelData: BUI.TableGroupData<EntityTreeData> = {
      data: {
        Name: modelName,
        modelId: modelId,
        children: JSON.stringify(Array.from(allLocalIds)),
      },
      children: modelChildren,
    };
    rows.push(modelData);
  }

  // 최상위 모델 항목들을 알파벳 오름차순 정렬
  rows.sort((a, b) => String(a.data.Name || "Untitled").localeCompare(String(b.data.Name || "Untitled")));

  return rows;
};

export const entityTreeTemplate = (state: EntityTreeState) => {
  const { components, models } = state;
  const selectHighlighterName = state.selectHighlighterName ?? "select";

  const onCellCreated = ({ detail }: CustomEvent<BUI.CellCreatedEventDetail<EntityTreeData>>) => {
    onTableCellCreated(new CustomEvent("cellcreated", { detail })); // 전역 이벤트 주입
    const { cell } = detail;
    if (cell.column === "Name" && !cell.rowData.Name) cell.style.gridColumn = "1 / -1";
  };

  const onRowCreated = (e: CustomEvent<BUI.RowCreatedEventDetail<EntityTreeData>>) => {
    onTableRowCreated(e); // 전역 이벤트 주입
    const { row } = e.detail;
    const highlighter = components.get(Highlighter);
    
    row.onclick = async () => {
      if (!selectHighlighterName) return;
      const { data: { modelId, localId } } = row;
      if (!modelId || localId === undefined) return;

      const modelIdMap = { [modelId]: new Set([localId]) };
      highlighter.highlightByID(selectHighlighterName, modelIdMap, true, true);
    };
  };

  const onTableCreated = async (element?: Element) => {
    if (!element) return;
    const table = element as BUI.Table<EntityTreeData>;
    setupBIMTable(table);
    table.columns = [{ name: "Name", width: "minmax(0, 1fr)" }];
    table.hiddenColumns = ["modelId", "localId", "children"];

    const highlighter = components.get(Highlighter);
    table.dataTransform = {
      Name: (value, rowData) => {
        const data = rowData as EntityTreeData;
        const nameText = value !== null && value !== undefined ? String(value) : "";
        const isContainer = Boolean(data?.children && data.localId === undefined);

        return BUI.html`
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; min-width: 0; gap: 0.35rem;">
            <bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;" title=${nameText}>
              ${nameText}
            </bim-label>
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
                  if (!selectHighlighterName || !data.children || !data.modelId) return;
                  try {
                    const localIds = JSON.parse(data.children);
                    highlighter.highlightByID(selectHighlighterName, { [data.modelId]: new Set(localIds) } as any, true, true);
                  } catch (_) {}
                }}
              ></bim-button>
            ` : ""}
          </div>
        `;
      },
    };

    table.loadFunction = async () => new Promise((resolve) => setTimeout(() => resolve(computeRowData(models, components))));
    table.loadData(true);
  };

  return BUI.html`
    <bim-table @rowcreated=${onRowCreated} @cellcreated=${onCellCreated} ${BUI.ref(onTableCreated)} headers-hidden style="gap: 0;">
      <bim-label slot="missing-data" style="--bim-icon--c: gold">⚠️ No models available to display the entity structure!</bim-label>
    </bim-table>
  `;
};
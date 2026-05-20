import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { FragmentsModel } from "@thatopen/fragments";
import { appIcons } from "../../globals";
import { spatialTree } from "../../ui-components/SpatialTree";
import { entityTree } from "../../ui-components/EntityTree";
import { Highlighter } from "../../bim-components/Highlighter";

export interface ModelTreePanelState {
  components: OBC.Components;
  models?: Map<string, FragmentsModel>;
}

export const modelTreePanelTemplate: BUI.StatefullComponent<
  ModelTreePanelState
> = (state) => {
  const { components, models } = state;
  
  const [spatialTreeTable] = spatialTree({ components, models: models ? [...models.values()] : [] });
  const [entityTreeTable] = entityTree({ components, models: models ? [...models.values()] : [] });
  
  spatialTreeTable.preserveStructureOnFilter = true;
  entityTreeTable.preserveStructureOnFilter = true;
  
  entityTreeTable.style.display = "none"; // 기본적으로 숨김
  let activeTreeTable = spatialTreeTable;

  let searchInput: BUI.TextInput | undefined;

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    spatialTreeTable.queryString = input.value;
    entityTreeTable.queryString = input.value;
  };

  const onClearSearch = () => {
    if (!searchInput) return;
    searchInput.value = "";
    spatialTreeTable.queryString = null;
    entityTreeTable.queryString = null;
  };

  const toggleExpanded = () => {
    activeTreeTable.expanded = !activeTreeTable.expanded;
  };

  const onSearchSelection = async (e: Event) => {
    const btn = e.target as BUI.Button;
    const highlighter = components.get(Highlighter);
    const selection = highlighter.selection.select;
    const modelIds = Object.keys(selection);
    
    if (modelIds.length === 0 || selection[modelIds[0]].size === 0) {
      alert("먼저 Viewport에서 객체를 선택해주세요.");
      return;
    }

    btn.loading = true;
    try {
      const modelId = modelIds[0];
      const localId = Array.from(selection[modelId])[0]; // 첫 번째 선택된 객체의 ID
      
      const fragments = components.get(OBC.FragmentsManager);
      const model = fragments.list.get(modelId);
      
      if (model) {
        const [itemData] = await model.getItemsData([localId], { 
          attributesDefault: true, 
          relationsDefault: { attributes: false, relations: false } 
        });

        if (itemData && itemData.Name) {
          const nameVal = typeof itemData.Name === "object" && "value" in itemData.Name ? itemData.Name.value : itemData.Name;
          const nameStr = String(nameVal);
          if (searchInput) searchInput.value = nameStr; // 입력창에도 검색어 반영
          spatialTreeTable.queryString = nameStr; // 테이블 필터링 적용
          entityTreeTable.queryString = nameStr;
          activeTreeTable.expanded = true; // 활성화된 트리를 확장해서 결과를 보여줌
        } else {
          alert("선택된 객체에서 이름(Name) 속성을 찾을 수 없습니다.");
        }
      }
    } finally {
      btn.loading = false;
    }
  };

  const onTreeTypeChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.value === "spatial") {
      spatialTreeTable.style.display = "block";
      entityTreeTable.style.display = "none";
      activeTreeTable = spatialTreeTable;
    } else {
      spatialTreeTable.style.display = "none";
      entityTreeTable.style.display = "block";
      activeTreeTable = entityTreeTable;
    }
  };

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TREE} label="Model Tree">
      <div style="display: flex; flex-direction: column; gap: 0.375rem; flex: 0;">
        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; align-items: center; margin-bottom: 0.125rem;">
          <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer;">
            <input type="radio" name="treeType" value="spatial" checked @change=${onTreeTypeChange} style="margin: 0; cursor: pointer; accent-color: var(--bim-ui_main-base);">
            <bim-label style="pointer-events: none;">Spatial</bim-label>
          </label>
          <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer;">
            <input type="radio" name="treeType" value="entity" @change=${onTreeTypeChange} style="margin: 0; cursor: pointer; accent-color: var(--bim-ui_main-base);">
            <bim-label style="pointer-events: none;">Entity</bim-label>
          </label>
        </div>
        <div style="display: flex; gap: 0.375rem; flex: 0;">
          <bim-text-input ${BUI.ref((e) => { searchInput = e as BUI.TextInput; })} @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
          <bim-button style="flex: 0;" @click=${onClearSearch} icon=${appIcons.CLEAR} tooltip-title="Clear Search"></bim-button>
          <bim-button style="flex: 0;" @click=${toggleExpanded} icon=${appIcons.EXPAND} tooltip-title="Toggle Expanded"></bim-button>
          <bim-button style="flex: 0;" @click=${onSearchSelection} icon=${appIcons.SEARCH} tooltip-title="Search Selection"></bim-button>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; flex: 1; overflow: auto; min-height: 0; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding-top: 0.25rem;">
        ${spatialTreeTable}
        ${entityTreeTable}
      </div>
    </bim-panel-section> 
  `;
};

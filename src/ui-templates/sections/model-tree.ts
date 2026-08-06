import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { FragmentsModel } from "@thatopen/fragments";
import { appIcons, appState } from "../../globals";
import { spatialTree } from "../../ui-components/SpatialTree";
import { entityTree } from "../../ui-components/EntityTree";
import { Highlighter } from "../../bim-components/Highlighter";
import { SharedIFC } from "../../bim-components/SharedIFC";
import { SharedFRAG } from "../../bim-components/SharedFRAG";
import { GISMapComponent } from "../../bim-components/GISMap";
import { ClashService } from "../../bim-components/ClashService";

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

  let tabsElement: BUI.Tabs;
  let searchInputSpatial: BUI.TextInput | undefined;
  let searchInputEntity: BUI.TextInput | undefined;

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    spatialTreeTable.queryString = input.value;
    entityTreeTable.queryString = input.value;
    if (searchInputSpatial && searchInputSpatial !== input) searchInputSpatial.value = input.value;
    if (searchInputEntity && searchInputEntity !== input) searchInputEntity.value = input.value;
  };

  const onClearSearch = () => {
    if (searchInputSpatial) searchInputSpatial.value = "";
    if (searchInputEntity) searchInputEntity.value = "";
    spatialTreeTable.queryString = null;
    entityTreeTable.queryString = null;
  };

  const toggleExpanded = () => {
    const activeTable = tabsElement?.tab === "entity" ? entityTreeTable : spatialTreeTable;
    activeTable.expanded = !activeTable.expanded;
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
      const localId = Array.from(selection[modelId])[0];

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
          if (searchInputSpatial) searchInputSpatial.value = nameStr;
          if (searchInputEntity) searchInputEntity.value = nameStr;
          spatialTreeTable.queryString = nameStr;
          entityTreeTable.queryString = nameStr;
          const activeTable = tabsElement?.tab === "entity" ? entityTreeTable : spatialTreeTable;
          activeTable.expanded = true;
        } else {
          alert("선택된 객체에서 이름(Name) 속성을 찾을 수 없습니다.");
        }
      }
    } finally {
      btn.loading = false;
    }
  };

  const onChangeSpatialStructure = async (e: Event) => {
    const btn = e.target as BUI.Button;
    const fragments = components.get(OBC.FragmentsManager);
    const models = fragments.list;

    if (models.size === 0) {
      alert("현재 로드되어 있는 IFC 모델이 없습니다.");
      return;
    }

    const model = [...models.values()][0];
    const dbId = (model as any).dbId;
    if (!dbId) {
      alert("DB에 저장되지 않은 모델입니다. DB에 저장된 모델만 공간 구조 변경이 가능합니다.");
      return;
    }

    const siteName = prompt("Site 이름을 입력하세요 (비워두면 파일명 기반 자동 파싱):");
    if (siteName === null) return;
    const buildingName = prompt("Building 이름을 입력하세요 (비워두면 파일명 기반 자동 파싱):");
    if (buildingName === null) return;
    const storeyName = prompt("Storey 이름을 입력하세요 (비워두면 파일명 기반 자동 파싱):");
    if (storeyName === null) return;

    btn.loading = true;
    try {
      const sharedIFC = new SharedIFC();
      const sharedFRAG = new SharedFRAG();

      const ifcData = await sharedIFC.loadIFC(dbId);
      if (!ifcData || !ifcData.content) {
        alert("DB에서 원본 IFC 데이터를 가져오지 못했습니다.");
        return;
      }

      const file = new File([ifcData.content], ifcData.name);
      const formData = new FormData();
      formData.append("file", file);
      if (siteName.trim()) formData.append("siteName", siteName.trim());
      if (buildingName.trim()) formData.append("buildingName", buildingName.trim());
      if (storeyName.trim()) formData.append("storeyName", storeyName.trim());

      const response = await fetch("/api/change-spatial-structure", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${errorText}`);
      }

      const processedBlob = await response.blob();
      const baseName = ifcData.name.replace(/\.ifc$/i, "");
      const newModelName = `${baseName}_spatial`;
      const processedFile = new File(
        [processedBlob],
        `${newModelName}.ifc`,
        { type: "application/octet-stream" }
      );

      const highlighter = components.get(Highlighter);
      await highlighter.clear("select");
      highlighter.events.select.onClear.trigger();
      model.dispose();

      await new Promise(resolve => setTimeout(resolve, 300));

      const ifcLoader = components.get(OBC.IfcLoader);
      const buffer = await processedFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const newModel = await ifcLoader.load(bytes, false, newModelName, {
        instanceCallback: (importer: any) => {
          importer.includeUniqueAttributes = true;
          importer.includeRelationNames = true;
        },
      });
      (newModel as any).name = newModelName;
      await fragments.core.update(true);

      const gisMap = components.get(GISMapComponent);
      gisMap.detectGeorefFromBuffer(bytes);

      const newModelId = (newModel as any).uuid;
      if (newModelId) {
        const clashService = components.get(ClashService);
        clashService.addIfcBuffer(newModelId, bytes);
      }

      const fragData = await (newModel as any).getBuffer(false);
      const fragFile = new File([fragData], `${newModelName}.frag`, { type: "application/octet-stream" });

      const activeProjectId = appState.currentProject?.id;
      const newIfcId = await sharedIFC.saveIFC(processedFile, activeProjectId);
      let newFragId = null;
      if (newIfcId) {
        newFragId = await sharedFRAG.saveFRAG(fragFile, activeProjectId);
      }

      if (newIfcId && newFragId) {
        (newModel as any).dbId = newIfcId;
        sharedIFC.addModelUUID(newIfcId, newModelId);
        sharedFRAG.addModelUUID(newFragId, newModelId);

        if ((window as any).refreshSharedModelLists) {
          await (window as any).refreshSharedModelLists();
        }
        if ((window as any).refreshLoadedModelList) {
          (window as any).refreshLoadedModelList();
        }

        alert("공간 구조가 재구성된 IFC 파일이 성공적으로 DB에 저장되고 로드되었습니다.");
      } else {
        alert("공간 구조 변경 처리는 되었으나, DB 저장에 실패했습니다.");
      }

    } catch (error) {
      console.error("Error changing spatial structure:", error);
      alert(`공간 구조 변경 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      btn.loading = false;
    }
  };

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TREE} label="Model Tree">
      <bim-tabs ${BUI.ref((e) => { tabsElement = e as BUI.Tabs; })}>
        <bim-tab name="spatial" label="Spatial" icon=${appIcons.TREE}>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; flex: 1; overflow: hidden;">
            <div style="display: flex; gap: 0.375rem; flex: 0;">
              <bim-text-input ${BUI.ref((e) => { searchInputSpatial = e as BUI.TextInput; })} @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
              <bim-button style="flex: 0;" @click=${onClearSearch} icon=${appIcons.CLEAR} tooltip-title="Clear Search"></bim-button>
              <bim-button style="flex: 0;" @click=${toggleExpanded} icon=${appIcons.EXPAND} tooltip-title="Toggle Expanded"></bim-button>
              <bim-button style="flex: 0;" @click=${onSearchSelection} icon=${appIcons.SEARCH} tooltip-title="Search Selection"></bim-button>
              <bim-button style="flex: 0;" @click=${onChangeSpatialStructure} icon=${appIcons.EDIT} tooltip-title="Change Spatial Structure"></bim-button>
            </div>
            <div style="display: flex; flex-direction: column; flex: 1; overflow: auto; min-height: 0; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding-top: 0.25rem;">
              ${spatialTreeTable}
            </div>
          </div>
        </bim-tab>

        <bim-tab name="entity" label="Entity" icon=${appIcons.TREE}>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; flex: 1; overflow: hidden;">
            <div style="display: flex; gap: 0.375rem; flex: 0;">
              <bim-text-input ${BUI.ref((e) => { searchInputEntity = e as BUI.TextInput; })} @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
              <bim-button style="flex: 0;" @click=${onClearSearch} icon=${appIcons.CLEAR} tooltip-title="Clear Search"></bim-button>
              <bim-button style="flex: 0;" @click=${toggleExpanded} icon=${appIcons.EXPAND} tooltip-title="Toggle Expanded"></bim-button>
              <bim-button style="flex: 0;" @click=${onSearchSelection} icon=${appIcons.SEARCH} tooltip-title="Search Selection"></bim-button>
            </div>
            <div style="display: flex; flex-direction: column; flex: 1; overflow: auto; min-height: 0; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding-top: 0.25rem;">
              ${entityTreeTable}
            </div>
          </div>
        </bim-tab>
      </bim-tabs>
    </bim-panel-section> 
  `;
};

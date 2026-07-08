import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { FragmentsModel } from "@thatopen/fragments";
import { appIcons, appState } from "../../globals";
import { spatialTree } from "../../ui-components/SpatialTree";
import { entityTree } from "../../ui-components/EntityTree";
import { Highlighter } from "../../bim-components/Highlighter";
import { SharedIFC } from "../../bim-components/SharedIFC";
import { SharedFRAG } from "../../bim-components/SharedFRAG";
import { ClashService } from "../../bim-components/ClashService";
import { GISMapComponent } from "../../bim-components/GISMap";

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

  (window as any).refreshModelTree = () => {
    spatialTreeTable.loadData(true);
    entityTreeTable.loadData(true);
  };

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

  const onChangeSpatialStructure = async (e: Event) => {
    const btn = e.target as BUI.Button;
    const fragments = components.get(OBC.FragmentsManager);
    const models = fragments.list;

    if (models.size === 0) {
      alert("현재 로드되어 있는 IFC 모델이 없습니다.");
      return;
    }

    // 첫 번째 로드된 모델을 타겟으로 함
    const model = [...models.values()][0];
    const dbId = (model as any).dbId;
    if (!dbId) {
      alert("DB에 저장되지 않은 모델입니다. DB에 저장된 모델만 공간 구조 변경이 가능합니다.");
      return;
    }

    const siteName = prompt("Site 이름을 입력하세요 (비워두면 파일명 기반 자동 파싱):");
    if (siteName === null) return; // 취소
    const buildingName = prompt("Building 이름을 입력하세요 (비워두면 파일명 기반 자동 파싱):");
    if (buildingName === null) return; // 취소
    const storeyName = prompt("Storey 이름을 입력하세요 (비워두면 파일명 기반 자동 파싱):");
    if (storeyName === null) return; // 취소

    btn.loading = true;
    try {
      const sharedIFC = new SharedIFC();
      const sharedFRAG = new SharedFRAG();

      // 1. DB에서 기존 원본 IFC 데이터 조회
      const ifcData = await sharedIFC.loadIFC(dbId);
      if (!ifcData || !ifcData.content) {
        alert("DB에서 원본 IFC 데이터를 가져오지 못했습니다.");
        return;
      }

      // 2. FormData 생성 및 API 호출
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

      // 3. 처리된 파일 수신
      const processedBlob = await response.blob();
      const processedFile = new File(
        [processedBlob],
        `${ifcData.name.replace(/\.ifc$/i, "")}_spatial.ifc`,
        { type: "application/octet-stream" }
      );

      // 4. 기존 모델 삭제 (dispose)
      model.dispose();

      // 5. 신규 모델 파싱 및 뷰포트 로드
      const ifcLoader = components.get(OBC.IfcLoader);
      const buffer = await processedFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const newModelName = processedFile.name.replace(/\.ifc$/i, "");
      
      const newModel = await ifcLoader.load(bytes, false, newModelName, {
        instanceCallback: (importer: any) => {
          importer.includeUniqueAttributes = true;
          importer.includeRelationNames = true;
        },
      });
      (newModel as any).name = newModelName;
      await fragments.core.update(true);
      if ((window as any).refreshLoadedModelList) {
        (window as any).refreshLoadedModelList();
      }

      // 🗺️ Detect georeferencing from raw IFC buffer
      const gisMap = components.get(GISMapComponent);
      gisMap.detectGeorefFromBuffer(bytes);

      // ClashService 버퍼 캐싱
      const newModelId = (newModel as any).uuid;
      if (newModelId) {
        const clashService = components.get(ClashService);
        clashService.addIfcBuffer(newModelId, bytes);
      }

      // 6. FRAG 변환 및 DB 저장
      const fragData = await (newModel as any).getBuffer(false);
      const fragFile = new File([fragData], processedFile.name.replace(".ifc", ".frag"));

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
        
        // 7. Shared Model List 테이블 갱신
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
      <div slot="header-end" style="display: flex; gap: 0.75rem; align-items: center; margin-right: 0.5rem;" @click=${(e: Event) => e.stopPropagation()}>
        <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer;">
          <input type="radio" name="treeType" value="spatial" checked @change=${onTreeTypeChange} style="margin: 0; cursor: pointer; accent-color: var(--bim-ui_main-base);">
          <bim-label style="pointer-events: none;">Spatial</bim-label>
        </label>
        <label style="display: flex; align-items: center; gap: 0.25rem; cursor: pointer;">
          <input type="radio" name="treeType" value="entity" @change=${onTreeTypeChange} style="margin: 0; cursor: pointer; accent-color: var(--bim-ui_main-base);">
          <bim-label style="pointer-events: none;">Entity</bim-label>
        </label>
      </div>
      <div style="display: flex; gap: 0.375rem; flex: 0; margin-bottom: 0.375rem;">
        <bim-text-input ${BUI.ref((e) => { searchInput = e as BUI.TextInput; })} @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
        <bim-button style="flex: 0;" @click=${onClearSearch} icon=${appIcons.CLEAR} tooltip-title="Clear Search"></bim-button>
        <bim-button style="flex: 0;" @click=${toggleExpanded} icon=${appIcons.EXPAND} tooltip-title="Toggle Expanded"></bim-button>
        <bim-button style="flex: 0;" @click=${onSearchSelection} icon=${appIcons.SEARCH} tooltip-title="Search Selection"></bim-button>
        <bim-button style="flex: 0;" @click=${onChangeSpatialStructure} icon=${appIcons.EDIT} tooltip-title="Change Spatial Structure"></bim-button>
      </div>
      <div style="display: flex; flex-direction: column; flex: 1; overflow: auto; min-height: 0; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding-top: 0.25rem;">
        ${spatialTreeTable}
        ${entityTreeTable}
      </div>
    </bim-panel-section> 
  `;
};

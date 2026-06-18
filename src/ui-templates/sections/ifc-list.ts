import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, appState, onToggleSection, setupBIMTable, tableButtonStyle } from "../../globals";
import { SharedIFC } from '../../bim-components/SharedIFC';
import { SharedFRAG } from '../../bim-components/SharedFRAG';
import { BCFTopics } from "../../bim-components/BCFTopics";
import { ClashService } from "../../bim-components/ClashService";

export interface IFCListPanelState {
  components: OBC.Components;
}

export const ifcListPanelTemplate: BUI.StatefullComponent<IFCListPanelState> = (
  state,
) => {
  const { components } = state;
  
  const ifcLoader = components.get(OBC.IfcLoader);
  const fragments = components.get(OBC.FragmentsManager);
  const sharedIFC = new SharedIFC();
  const sharedFRAG = new SharedFRAG();
  const bcfTopics = components.get(BCFTopics);
  
  // --- Grouping 1단계: 사용자 정의 그룹 상태 관리 ---
  const paletteColors = [
    "hsl(0, 65%, 40%)",
    "hsl(45, 65%, 40%)",
    "hsl(147, 65%, 40%)",
    "hsl(196, 65%, 40%)",
    "hsl(205, 65%, 40%)",
    "hsl(274, 65%, 40%)"
  ];
  const customGroups = ["None", ...paletteColors];

  // 현재 선택된 필터용 그룹 상태
  let activeGroupFilter: string | null = null;
  let sharedModelLabel: BUI.Label;
  let loadedModelLabel: BUI.Label;

  // 그룹별 아이템 개수를 계산하는 함수
  const getGroupCounts = () => {
    const counts: Record<string, number> = {};
    for (const g of customGroups) {
      counts[g] = 0;
    }
    for (const file of sharedFRAG.list) {
      let g = fragGroups.get(file.id) || "None";
      if (!customGroups.includes(g)) g = "None";
      counts[g] = (counts[g] || 0) + 1;
    }
    return counts;
  };

  let refreshBadges: () => void;

  const onBadgeClick = (groupName: string) => {
    // 같은 그룹을 다시 클릭하면 필터 해제, 아니면 해당 그룹으로 필터링
    activeGroupFilter = activeGroupFilter === groupName ? null : groupName;
    if (refreshBadges) refreshBadges();
    updateIFCTableData();
    updateFRAGTableData();
  };

  // 그룹 뱃지 UI 컴포넌트 생성
  type CustomGroupsState = { groups: string[], activeFilter: string | null, counts: Record<string, number> };
  const groupsCreator: BUI.StatefullComponent<CustomGroupsState> = (state) => {
    return BUI.html`
      <div style="display: flex; gap: 0.375rem; width: 100%;">
        ${state.groups.map(g => {
          const isActive = state.activeFilter === g;
          const isNone = g === "None";
          const bg = isNone 
            ? (isActive ? "var(--bim-ui_main-base)" : "var(--bim-ui_bg-contrast-20)") 
            : g;
          const border = isActive ? "3px solid #ffffff" : "1px solid transparent";

          return BUI.html`
            <div 
              @click=${() => onBadgeClick(g)} 
              style="flex: 1; height: 1.25rem; padding: 0 0.25rem; background: ${bg}; border: ${border}; border-radius: 0.25rem; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" onmouseover="this.style.filter='brightness(1.2)'" onmouseout="this.style.filter='none'">
              <span style="font-size: 0.75rem;">${state.counts[g] || 0} EA</span>
            </div>
          `;
        })}
      </div>
    `;
  };
  const [groupBadges, updateGroupBadges] = BUI.Component.create(groupsCreator, { groups: customGroups, activeFilter: activeGroupFilter, counts: {} });

  refreshBadges = () => {
    updateGroupBadges({ groups: customGroups, activeFilter: activeGroupFilter, counts: getGroupCounts() });
  };

  type LoadedTableData = {
    id: string;
    Name: string;
    model: any;
    [key: string]: any;
  };

  const loadedTable = document.createElement("bim-table") as BUI.Table<LoadedTableData>;
  loadedTable.hiddenColumns = ["id", "model"];
  loadedTable.headersHidden = true;
  loadedTable.expanded = true;
  loadedTable.noIndentation = true;
  loadedTable.noCarets = true;

  setupBIMTable(loadedTable);

  // 일괄 Dispose를 위해 선택된 모델들을 추적
  const selectedLoadedModels = new Set<any>();
  
  const updateLoadedModelsList = () => {
    const models = [...fragments.list.values()];
    // 이름을 기준으로 오름차순 정렬
    models.sort((a: any, b: any) => (a.name || "Untitled").localeCompare(b.name || "Untitled"));
    loadedTable.data = models.map(model => ({
      data: {
        id: (model as any).uuid || Math.random().toString(),
        Name: (model as any).name || "Untitled",
        model: model
      }
    }));
    if (loadedModelLabel) {
      loadedModelLabel.textContent = `Loaded Model (${models.length})`;
    }
  };

  const onDisposeSelectedModels = () => {
    if (selectedLoadedModels.size === 0) {
      alert("선택된 모델이 없습니다.");
      return;
    }
    // 루프 도중 요소가 제거되는 것을 방지하기 위해 배열로 복사하여 순회
    const modelsToDispose = Array.from(selectedLoadedModels);
    selectedLoadedModels.clear();
    for (const model of modelsToDispose) {
      model.dispose();
    }
    updateLoadedModelsList();
  };

  const onSelectAllLoadedModels = () => {
    const visibleData = loadedTable.value.map(v => v.data);
    const allSelected = visibleData.length > 0 && visibleData.every(d => selectedLoadedModels.has(d.model));
    if (allSelected) {
      visibleData.forEach(d => selectedLoadedModels.delete(d.model));
    } else {
      visibleData.forEach(d => selectedLoadedModels.add(d.model));
    }
    updateLoadedModelsList();
  };

  loadedTable.dataTransform = {
    Name: (value, rowData) => {
      const model = rowData.model;
      const name = value as string;
      const isChecked = selectedLoadedModels.has(model);

      return BUI.html`
        <div style="display: flex; align-items: center; width: 100%; gap: 0.25rem; overflow: hidden; margin: 0; padding: 0; height: 1.5rem;">
          <bim-checkbox .checked=${isChecked} @change=${(e: Event) => {
            const cb = e.target;
            if (!(cb instanceof BUI.Checkbox)) return;
            if (cb.checked) selectedLoadedModels.add(model);
            else selectedLoadedModels.delete(model);
            updateLoadedModelsList(); // 상태를 즉시 동기화
          }} style="flex: 0 0 auto; margin: 0; padding: 0;"></bim-checkbox>
          <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; padding: 0;" title=${name}>
            <bim-label style="margin: 0; padding: 0;">${name}</bim-label>
          </div>
          <div style="flex: 0 0 auto; display: flex; gap: 0.25rem; margin: 0; padding: 0;">
            <bim-button @click=${() => {
              model.object.visible = !model.object.visible;
              updateLoadedModelsList();
              }} icon=${model.object.visible ? appIcons.SHOW : appIcons.HIDE} style=${tableButtonStyle} title="Visibility"></bim-button>
            <bim-button @click=${() => {
              selectedLoadedModels.delete(model);
              model.dispose();
              updateLoadedModelsList();
              }} icon=${appIcons.CLEAR} style=${tableButtonStyle} title="Dispose"></bim-button>
          </div>
        </div>
      `;
    }
  };

  fragments.list.onItemUpdated.add(updateLoadedModelsList);
  fragments.list.onItemDeleted.add(updateLoadedModelsList);
  
  updateLoadedModelsList();
  
  const createFileInputHandler = (
    accept: string,
    multiple: boolean,
    onLoad: (file: File, target: BUI.Button) => Promise<void>,
  ) => (e: Event) => {
    const target = (e.target as HTMLElement).closest("bim-button") as BUI.Button | null;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;

    input.addEventListener("change", async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      if (target) target.loading = true;
      try {
        for (let i = 0; i < files.length; i++) {
          if (target) await onLoad(files[i], target);
        }
      } catch (error) {
        console.error("Error loading file:", error);
        alert("파일 로드 중 오류가 발생했습니다. 콘솔을 확인하세요.");
      } finally {
        if (target) target.loading = false;
        BUI.ContextMenu.removeMenus();
      }
    });

    input.click();
  };

  // 공통 로직 분리: IFC 파일을 로드, FRAG 변환 및 데이터베이스에 저장
  const processAndSaveIfc = async (file: File) => {
    const newModelName = file.name.replace(/\.ifc$/i, "");

    // 중복 로드 방지: 이미 동일한 이름의 모델이 있는지 확인
    for (const [, model] of fragments.list) {
      if ((model as any).name === newModelName) {
        alert(`"${newModelName}" 모델은 이미 로드되어 있습니다.`);
        return;
      }
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const model = await ifcLoader.load(bytes, false, newModelName, {
      instanceCallback: (importer) => {
        importer.includeUniqueAttributes = true;
        importer.includeRelationNames = true;
        importer.addAllAttributes();
        importer.addAllRelations();
      },
    }); // 좌표 원점 조정 해제
    (model as any).name = newModelName;
    updateLoadedModelsList();
    let modelId = (model as any).uuid;
    if (!modelId) {
      for (const [id, m] of fragments.list) {
        if (m === model) {
          modelId = id;
          break;
        }
      }
    }
    
    // 파일 로드 시 원본 버퍼를 ClashService에 캐싱 (정밀 간섭 검토용)
    if (modelId) {
      const clashService = components.get(ClashService);
      clashService.addIfcBuffer(modelId, bytes);
    }

    const fragData = await (model as any).getBuffer(false);
    const fragFile = new File([fragData], file.name.replace(".ifc", ".frag"));

    const activeProjectId = appState.currentProject?.id;
    const ifcid = await sharedIFC.saveIFC(file, activeProjectId);
    let fragid = null;
    if (ifcid) {
      fragid = await sharedFRAG.saveFRAG(fragFile, activeProjectId);
    }

    if (ifcid && fragid) {
      alert("IFC 및 FRAG 파일이 데이터베이스에 저장되었습니다.");
      (model as any).dbId = ifcid;
      sharedIFC.addModelUUID(ifcid, modelId);
      sharedFRAG.addModelUUID(fragid, modelId);
      bcfTopics.onRefresh.trigger();
      await refreshSharedIFCList();
      await refreshSharedFRAGList();
    } else {
      alert("DB 저장 중 오류가 발생하였습니다.");
    }
  };

  // 일반 로컬 IFC 모델 추가
  const onAddIfcModel = createFileInputHandler(".ifc", true, async (file) => {
    await processAndSaveIfc(file);
  });

  // EDB 데이터 추가 처리를 위한 핸들러
  const onProcessEdbData = createFileInputHandler(".ifc", false, async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    
    let fileToLoad = file;
    try {
      const response = await fetch("/api/add-edb-data", { method: "POST", body: formData });
      if (!response.ok) throw new Error("EDB Data processing failed");
      
      const blob = await response.blob();
      fileToLoad = new File([blob], `${file.name}`, { type: file.type || "application/octet-stream" });
    } catch (err) {
      console.error("Error processing EDB Data:", err);
      alert("파일 로드 중 오류가 발생했습니다. 콘솔을 확인하세요.\n(API 응답이 없어 일반 모델로 우회하여 로드합니다.)");
    }

    await processAndSaveIfc(fileToLoad);
  });

  const onLoadedSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    loadedTable.queryString = input.value;
  };

  const onSharedSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    // FRAG 테이블은 자체 검색 기능을 사용합니다.
    fragTable.queryString = input.value;
    // IFC 테이블도 자체 검색 기능을 사용합니다.
    ifcTable.queryString = input.value;
  };

  const loadIFCModel = async (ifcid: number) => {
    for (const [, model] of fragments.list) {
      if ((model as any).dbId === ifcid) {
        alert("이미 로드된 모델입니다.");
        return;
      }
    }

    const ifc = await sharedIFC.loadIFC(ifcid);
    if (ifc && ifc.content) {
      const model = await ifcLoader.load(ifc.content, false, ifc.name, {
        instanceCallback: (importer) => {
          importer.includeUniqueAttributes = true;
          importer.includeRelationNames = true;
          importer.addAllAttributes();
          importer.addAllRelations();
        },
      });
      (model as any).name = ifc.name;
      updateLoadedModelsList();
      (model as any).dbId = ifcid;
      let modelId = (model as any).uuid;
      if (!modelId) {
        for (const [id, m] of fragments.list) {
          if (m === model) {
            modelId = id;
            break;
          }
        }
      }
      if (modelId) {
        sharedIFC.addModelUUID(ifcid, modelId);
        fragments.list.set(modelId, model);

        // 간섭 검토를 위한 원본 IFC 버퍼 캐싱
        const clashService = components.get(ClashService);
        clashService.addIfcBuffer(modelId, ifc.content as Uint8Array);
      }
    }
  };
  
    const downloadIFCModel = async (ifcid: number, cascade = true) => {
      const ifc = await sharedIFC.loadIFC(ifcid);
      if (ifc && ifc.content) {
        const blob = new Blob([ifc.content], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${ifc.name}.ifc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (cascade) {
          const fragFile = sharedFRAG.list.find(f => f.name === ifc.name);
          if (fragFile) {
            await downloadFRAGModel(fragFile.id, false);
          }
        }
      }
    };

  const deleteIFCModel = async (ifcid: number, cascade = true) => {
    const file = sharedIFC.list.find(f => f.id === ifcid);
    const name = file ? file.name : null;

    const success = await sharedIFC.deleteIFC(ifcid);
    if (success) {
      for (const [, model] of fragments.list) {
        if ((model as any).dbId === ifcid) {
          model.dispose();
        }
      }

      await refreshSharedIFCList();

      if (cascade && name) {
        const fragFile = sharedFRAG.list.find(f => f.name === name);
        if (fragFile) {
          await deleteFRAGModel(fragFile.id, false);
        }
      }
    } else {
      alert("IFC 파일 삭제에 실패하였습니다.");
    }
  };

  const loadFRAGModel = async (fragid: number) => {
    for (const [, model] of fragments.list) {
      if ((model as any).dbId === fragid) {
        alert("이미 로드된 모델입니다.");
        return;
      }
    }

    const frag = await sharedFRAG.loadFRAG(fragid);
    if (frag && frag.content) {
      const model = await fragments.core.load(frag.content, { modelId: frag.name });
      (model as any).name = frag.name;
      updateLoadedModelsList();
      (model as any).dbId = fragid;

      let modelId = (model as any).uuid;
      if (!modelId) {
        for (const [id, m] of fragments.list) {
          if (m === model) {
            modelId = id;
            break;
          }
        }
      }

      if (modelId) {
        sharedFRAG.addModelUUID(fragid, modelId);
        bcfTopics.onRefresh.trigger();

        // 간섭 검토용 원본 IFC를 DB에서 가져와 캐싱
        const baseName = frag.name.replace(/\.frag$/i, "");
        const ifcFile = sharedIFC.list.find(f => f.name.replace(/\.ifc$/i, "") === baseName);
        if (ifcFile) {
          const ifcData = await sharedIFC.loadIFC(ifcFile.id);
          if (ifcData && ifcData.content) {
            const clashService = components.get(ClashService);
            clashService.addIfcBuffer(modelId, ifcData.content as Uint8Array);
          }
        } else {
          console.warn(`[ClashService] FRAG 모델 (${frag.name})과 매칭되는 원본 IFC를 찾을 수 없습니다. 정밀 간섭 검토가 불가능할 수 있습니다.`);
        }
      }
    }
  };
  
  const downloadFRAGModel = async (fragid: number, cascade = true) => {
    const frag = await sharedFRAG.loadFRAG(fragid);
    if (frag && frag.content) {
      const blob = new Blob([frag.content], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${frag.name}.frag`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (cascade) {
        const ifcFile = sharedIFC.list.find(f => f.name === frag.name);
        if (ifcFile) {
          await downloadIFCModel(ifcFile.id, false);
        }
      }
    }
  };

  const deleteFRAGModel = async (fragid: number, cascade = true) => {
    const file = sharedFRAG.list.find(f => f.id === fragid);
    const name = file ? file.name : null;

    if (cascade && name) {
      const ifcFile = sharedIFC.list.find(f => f.name === name);
      if (ifcFile) {
        if (!confirm("데이터베이스에서 삭제하시겠습니까?")) return;
        const ifcSuccess = await sharedIFC.deleteIFC(ifcFile.id);
        if (!ifcSuccess) {
          alert("연결된 IFC 파일 삭제에 실패하였습니다. (BCF 파일이 연결되어 있을 수 있습니다)");
          return;
        }
        for (const [, model] of fragments.list) {
          if ((model as any).dbId === ifcFile.id) {
            model.dispose();
          }
        }
        await refreshSharedIFCList();
      }
    }

    const success = await sharedFRAG.deleteFRAG(fragid);
    if (success) {
      for (const [, model] of fragments.list) {
        if ((model as any).dbId === fragid) {
          model.dispose();
        }
      }

      alert("데이터베이스에서 삭제되었습니다.");
      await refreshSharedFRAGList();
    } else {
      alert("FRAG 파일 삭제에 실패하였습니다.");
    }
  };

  // --- Grouping 2단계: FRAG 모델 테이블 및 상태 정의 ---
  const savedFragGroups = localStorage.getItem("app_frag_groups");
  const parsedFragGroups = savedFragGroups ? JSON.parse(savedFragGroups) : [];
  const fragGroups = new Map<number, string>(); // 파일 ID를 키로 하여 그룹명을 저장
  for (const [id, group] of parsedFragGroups) {
    fragGroups.set(id, group);
  }

  const saveFragGroupsToStorage = () => {
    localStorage.setItem("app_frag_groups", JSON.stringify(Array.from(fragGroups.entries())));
  };

  type FRAGTableData = {
    id: number;
    Name: string;
    Group: string;
    _isComputedGroup?: boolean;
    groupedBy?: string[];
    [key: string]: any;
  };

  const fragTable = document.createElement("bim-table") as BUI.Table<FRAGTableData>;
  fragTable.hiddenColumns = ["id", "Group"]; // Group 컬럼도 숨기고 Name 컬럼 안에 전부 통합하여 렌더링
  fragTable.headersHidden = true; // 1. 컬럼명 라인 숨김
  fragTable.expanded = true; // 기본적으로 그룹을 펼쳐서 보여줌
  fragTable.noIndentation = true;
  fragTable.noCarets = true;

  setupBIMTable(fragTable);

  const updateFRAGTableData = () => {
    const filteredList = activeGroupFilter 
      ? sharedFRAG.list.filter(file => {
          let groupName = fragGroups.get(file.id) || "None";
          if (!customGroups.includes(groupName)) groupName = "None";
          return groupName === activeGroupFilter;
        })
      : [...sharedFRAG.list]; // 원본 배열 보호를 위해 복사

    filteredList.sort((a, b) => a.name.localeCompare(b.name));

    fragTable.data = filteredList.map(file => {
      let groupName = fragGroups.get(file.id) || "None";
      // customGroups에 없는 그룹이 할당되어 있다면 'None'으로 리셋 (Select 오작동 방지)
      if (!customGroups.includes(groupName)) groupName = "None";
      return {
        data: {
          id: file.id,
          Name: file.name,
          Group: groupName,
        }
      };
    });
  };

  // 일괄 Load를 위해 선택된 FRAG 모델 ID 추적
  const selectedFragModels = new Set<number>();

  const onSelectAllFragModels = () => {
    // 그룹 헤더 등 id가 없는 computed row를 제외하고 실제 모델 데이터만 필터링
    const visibleData = fragTable.value.map(v => v.data).filter(d => d.id !== undefined);
    const allSelected = visibleData.length > 0 && visibleData.every(d => selectedFragModels.has(d.id as number));
    if (allSelected) {
      visibleData.forEach(d => selectedFragModels.delete(d.id as number));
    } else {
      visibleData.forEach(d => selectedFragModels.add(d.id as number));
    }
    updateFRAGTableData();
  };

  const onLoadSelectedFragModels = async (target: BUI.Button) => {
    if (selectedFragModels.size === 0) {
      alert("선택된 모델이 없습니다.");
      return;
    }
    target.loading = true;
    let skippedCount = 0;
    try {
      for (const id of selectedFragModels) {
        let isLoaded = false;
        for (const [, model] of fragments.list) {
          if ((model as any).dbId === id) {
            isLoaded = true;
            break;
          }
        }
        if (isLoaded) {
          skippedCount++;
          continue;
        }
        await loadFRAGModel(id);
      }
      selectedFragModels.clear();
      updateFRAGTableData();
      if (skippedCount > 0) {
        alert(`${skippedCount}개의 모델은 이미 로드되어 있어 생략되었습니다.`);
      }
    } catch (error) {
      console.error("Error loading selected models:", error);
      alert("선택된 모델을 로드하는 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  // 커스텀 UI 렌더링 설정 (Name 컬럼 하나에 Flexbox를 사용해 빽빽하게 배치)
  fragTable.dataTransform = {
    Name: (value, rowData) => {
      const id = rowData.id as number;
      const currentGroup = rowData.Group as string;
      const name = value as string;
      const isChecked = selectedFragModels.has(id);
      
      return BUI.html`
        <div style="display: flex; align-items: center; width: 100%; gap: 0.25rem; overflow: hidden; margin: 0; padding: 0; height: 1.5rem;">
          <bim-checkbox .checked=${isChecked} @change=${(e: Event) => {
            const cb = e.target;
            if (!(cb instanceof BUI.Checkbox)) return;
            if (cb.checked) selectedFragModels.add(id);
            else selectedFragModels.delete(id);
            updateFRAGTableData(); // 상태를 즉시 동기화
          }} style="flex: 0 0 auto; margin: 0; padding: 0;"></bim-checkbox>
          <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; padding: 0;" title=${name}>
            <bim-label style="margin: 0; padding: 0;">${name}</bim-label>
          </div>
          <div style="flex: 0 0 auto; margin: 0; padding: 0;">
            <select @change=${(e: Event) => {
              const select = e.target as HTMLSelectElement;
              fragGroups.set(id, select.value);
              saveFragGroupsToStorage();
              updateFRAGTableData();
              if (refreshBadges) refreshBadges();
            }} style="padding: 0 0.25rem; margin: 0; border-radius: 4px; background: ${currentGroup === 'None' ? 'var(--bim-ui_bg-contrast-20)' : currentGroup}; border: none; outline: none; cursor: pointer; width: 2.5rem; height: 1.5rem;" title="${currentGroup}">
              ${customGroups.map(g => BUI.html`<option value="${g}" style="background: ${g === 'None' ? 'var(--bim-ui_bg-base)' : g};" title="${g}" ?selected=${g === currentGroup}>&nbsp;&nbsp;&nbsp;&nbsp;</option>`)}
            </select>
          </div>
          <div style="flex: 0 0 auto; display: flex; gap: 0.25rem; margin: 0; padding: 0;">
          <bim-button @click=${() => loadFRAGModel(id)} icon=${appIcons.OPEN} style=${tableButtonStyle} title="Load Model"></bim-button>
          <bim-button @click=${() => downloadFRAGModel(id)} icon=${appIcons.DOWNLOAD} style=${tableButtonStyle} title="Download Model"></bim-button>
          <bim-button @click=${() => deleteFRAGModel(id)} icon=${appIcons.DELETE} style=${tableButtonStyle} title="Delete Model"></bim-button>
          </div>
        </div>
      `;
    },
    Group: (value, _rowData, group) => {
      if (group && ((group as any)._isComputedGroup || (group.data as any)?._isComputedGroup)) {
        return BUI.html`<bim-label icon=${appIcons.FOLDEROPEN} style="font-weight: bold;">${value}</bim-label>`;
      }
      return value;
    }
  };

  // --- Grouping 2단계: IFC 모델 테이블 및 상태 정의 ---
  const savedIfcGroups = localStorage.getItem("app_ifc_groups");
  const parsedIfcGroups = savedIfcGroups ? JSON.parse(savedIfcGroups) : [];
  const ifcGroups = new Map<number, string>(); // 파일 ID를 키로 하여 그룹명을 저장
  for (const [id, group] of parsedIfcGroups) {
    ifcGroups.set(id, group);
  }

  const saveIfcGroupsToStorage = () => {
    localStorage.setItem("app_ifc_groups", JSON.stringify(Array.from(ifcGroups.entries())));
  };

  type IFCTableData = {
    id: number;
    Name: string;
    Group: string;
    _isComputedGroup?: boolean;
    groupedBy?: string[];
    [key: string]: any;
  };

  const ifcTable = document.createElement("bim-table") as BUI.Table<IFCTableData>;
  ifcTable.hiddenColumns = ["id", "Group"];
  ifcTable.headersHidden = true;
  ifcTable.expanded = true;
  ifcTable.noIndentation = true;
  ifcTable.noCarets = true;

  setupBIMTable(ifcTable);

  // 일괄 Load를 위해 선택된 IFC 모델 ID 추적
  const selectedIfcModels = new Set<number>();

  const updateIFCTableData = () => {
    const filteredList = activeGroupFilter 
      ? sharedIFC.list.filter(file => {
          let groupName = ifcGroups.get(file.id) || "None";
          if (!customGroups.includes(groupName)) groupName = "None";
          return groupName === activeGroupFilter;
        })
      : [...sharedIFC.list]; // 원본 배열 보호를 위해 복사

    filteredList.sort((a, b) => a.name.localeCompare(b.name));

    ifcTable.data = filteredList.map(file => {
      let groupName = ifcGroups.get(file.id) || "None";
      if (!customGroups.includes(groupName)) groupName = "None";
      return {
        data: {
          id: file.id,
          Name: file.name,
          Group: groupName,
        }
      };
    });
  };

  ifcTable.dataTransform = {
    Name: (value, rowData) => {
      const id = rowData.id as number;
      const currentGroup = rowData.Group as string;
      const name = value as string;
      const isChecked = selectedIfcModels.has(id);
      
      return BUI.html`
        <div style="display: flex; align-items: center; width: 100%; gap: 0.25rem; overflow: hidden; margin: 0; padding: 0; height: 1.5rem;">
          <bim-checkbox .checked=${isChecked} @change=${(e: Event) => {
            const cb = e.target;
            if (!(cb instanceof BUI.Checkbox)) return;
            if (cb.checked) selectedIfcModels.add(id);
            else selectedIfcModels.delete(id);
            updateIFCTableData(); // 상태를 즉시 동기화
          }} style="flex: 0 0 auto; margin: 0; padding: 0;"></bim-checkbox>
          <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; padding: 0;" title=${name}>
            <bim-label style="margin: 0; padding: 0;">${name}</bim-label>
          </div>
          <div style="flex: 0 0 auto; margin: 0; padding: 0;">
            <select @change=${(e: Event) => {
              const select = e.target as HTMLSelectElement;
              ifcGroups.set(id, select.value);
              saveIfcGroupsToStorage();
              updateIFCTableData();
              if (refreshBadges) refreshBadges();
            }} style="padding: 0 0.25rem; margin: 0; border-radius: 4px; background: ${currentGroup === 'None' ? 'var(--bim-ui_bg-contrast-20)' : currentGroup}; border: none; outline: none; cursor: pointer; width: 2.5rem; height: 1.5rem;" title="${currentGroup}">
              ${customGroups.map(g => BUI.html`<option value="${g}" style="background: ${g === 'None' ? 'var(--bim-ui_bg-base)' : g};" title="${g}" ?selected=${g === currentGroup}>&nbsp;&nbsp;&nbsp;&nbsp;</option>`)}
            </select>
          </div>
          <div style="flex: 0 0 auto; display: flex; gap: 0.25rem; margin: 0; padding: 0;">
          <bim-button @click=${() => loadIFCModel(id)} icon=${appIcons.OPEN} style=${tableButtonStyle} title="Load Model"></bim-button>
          <bim-button @click=${() => downloadIFCModel(id)} icon=${appIcons.DOWNLOAD} style=${tableButtonStyle} title="Download Model"></bim-button>
          <bim-button @click=${() => deleteIFCModel(id)} icon=${appIcons.DELETE} style=${tableButtonStyle} title="Delete Model"></bim-button>
          </div>
        </div>
      `;
    },
    Group: (value, _rowData, group) => {
      if (group && ((group as any)._isComputedGroup || (group.data as any)?._isComputedGroup)) {
        return BUI.html`<bim-label icon=${appIcons.FOLDEROPEN} style="font-weight: bold;">${value}</bim-label>`;
      }
      return value;
    }
  };

  const refreshSharedIFCList = async () => {
    sharedIFC.list = [];
    await sharedIFC.loadIFCFiles(appState.currentProject?.id);
    sharedIFC.list.sort((a, b) => a.name.localeCompare(b.name));
    updateIFCTableData();
  };

  const refreshSharedFRAGList = async () => {
    sharedFRAG.list = [];
    await sharedFRAG.loadFRAGFiles(appState.currentProject?.id);
    if (sharedModelLabel) {
      sharedModelLabel.textContent = `Shared Model (${sharedFRAG.list.length})`;
    }
    if (refreshBadges) refreshBadges();
    updateFRAGTableData();
  };

  refreshSharedIFCList();
  refreshSharedFRAGList();

  return BUI.html`
    <bim-panel-section icon=${appIcons.MODEL} label="IFC List">
      <div slot="header-end" style="display: flex; gap: 0.375rem; align-items: center; margin-right: 0.5rem;">
        <bim-button @click=${(e: Event) => { e.stopPropagation(); onAddIfcModel(e); }} icon=${appIcons.ADD} title="Import Model" style="flex: 0;"></bim-button>
        <bim-button @click=${(e: Event) => { e.stopPropagation(); onProcessEdbData(e); }} icon=${appIcons.ADDBOX} title="Import Model with EDB data" style="flex: 0;"></bim-button>
      </div>
      <div data-flex="false" style="display: flex; flex-direction: column; gap: 0.25rem;">
        <div @click=${onToggleSection} style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <div style="display: flex; align-items: center; gap: 0.5rem; pointer-events: none;">
          <bim-label style="font-weight: bold;" ${BUI.ref((e) => { 
            loadedModelLabel = e as BUI.Label; 
            loadedModelLabel.textContent = `Loaded Model (${fragments.list.size})`; 
          })}>Loaded Model</bim-label>
          <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="--bim-icon--fz: 1.25rem;"></bim-label>
          </div>
          <div style="display: flex; gap: 0.25rem;">
            <bim-button @click=${(e: Event) => { e.stopPropagation(); onSelectAllLoadedModels(); }} label="Select All" style="flex: 0;"></bim-button>
            <bim-button @click=${(e: Event) => { e.stopPropagation(); onDisposeSelectedModels(); }} label="Dispose" style="flex: 0;"></bim-button>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; height: 8.5rem; min-height: 8.5rem; flex-shrink: 0;">
          <div style="display: flex; gap: 0.375rem; align-items: center;">
            <bim-text-input @input=${onLoadedSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; overflow-y: auto; flex: 1; min-height: 0;">
            ${loadedTable}
          </div>
        </div>
      </div>
      
      <div data-flex="true" style="display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-height: 0; overflow: hidden;">
        <div @click=${onToggleSection} style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; flex-shrink: 0;">
          <div style="display: flex; align-items: center; gap: 0.5rem; pointer-events: none;">
          <bim-label style="font-weight: bold;" ${BUI.ref((e) => { 
            sharedModelLabel = e as BUI.Label; 
            sharedModelLabel.textContent = `Shared Model (${sharedFRAG.list.length})`; 
          })}>Shared Model</bim-label>
          <bim-label class="toggle-icon" icon=${appIcons.MINOR} style="--bim-icon--fz: 1.25rem;"></bim-label>
          </div>
          <div style="display: flex; gap: 0.25rem;">
            <bim-button @click=${(e: Event) => { e.stopPropagation(); onSelectAllFragModels(); }} label="Select All" style="flex: 0;"></bim-button>
            <bim-button @click=${(e: Event) => {
              e.stopPropagation();
              const target = (e.target as HTMLElement).closest("bim-button") as BUI.Button;
              if (target) onLoadSelectedFragModels(target);
            }} label="Load" icon=${appIcons.OPEN} style="flex: 0;"></bim-button>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.25rem; overflow-y: auto; flex: 1; min-height: 0;">
          <div style="display: flex; gap: 0.375rem; align-items: center;">
            <bim-text-input @input=${onSharedSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
          </div>
          ${groupBadges}
          <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; overflow-y: auto; flex: 1;">
            ${fragTable}
          </div>
        </div>
      </div>
    </bim-panel-section> 
  `;
};

import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, appState, setupBIMTable, tableButtonStyle } from "../../globals";
import { SharedIFC } from '../../bim-components/SharedIFC';
import { SharedFRAG } from '../../bim-components/SharedFRAG';
import { BCFTopics } from "../../bim-components/BCFTopics";
import { ClashService } from "../../bim-components/ClashService";
import { Highlighter } from "../../bim-components/Highlighter";
import { GISMapComponent } from "../../bim-components/GISMap";

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
  const savedFragGroups = localStorage.getItem("app_frag_groups");
  const parsedFragGroups = savedFragGroups ? JSON.parse(savedFragGroups) : [];
  const fragGroups = new Map<number, string>(); // 파일 ID를 키로 하여 그룹명을 저장
  for (const [id, group] of parsedFragGroups) {
    fragGroups.set(id, group);
  }

  const saveGroupsToBackend = async (): Promise<boolean> => {
    const fragEntries = Array.from(fragGroups.entries());

    localStorage.setItem("app_frag_groups", JSON.stringify(fragEntries));

    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fragGroups: fragEntries }),
      });
      return res.ok;
    } catch (err) {
      console.error("Failed to save groups to setup/groups.json:", err);
      return false;
    }
  };

  const saveFragGroupsToStorage = () => {
    localStorage.setItem("app_frag_groups", JSON.stringify(Array.from(fragGroups.entries())));
  };

  const onSaveGroupConfig = async () => {
    const success = await saveGroupsToBackend();
    if (success) {
      alert("그룹핑 설정이 setup/groups.json 파일에 저장되었습니다.");
    } else {
      alert("그룹핑 설정 저장에 실패하였습니다.");
    }
  };

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
  let sharedModelTab: BUI.Tab;
  let loadedModelTab: BUI.Tab;

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
    updateFRAGTableData();
  };

  // 그룹 뱃지 UI 컴포넌트 생성 (가장 좌측에 아이콘 전용 Save Group 버튼 배치)
  type CustomGroupsState = { groups: string[], activeFilter: string | null, counts: Record<string, number> };
  const groupsCreator: BUI.StatefullComponent<CustomGroupsState> = (state) => {
    return BUI.html`
      <div style="display: flex; gap: 0.375rem; width: 100%; align-items: center;">
        <div 
          @click=${(e: Event) => { e.stopPropagation(); onSaveGroupConfig(); }} 
          title="Save Grouping to setup/groups.json" 
          style="flex: 0 0 auto; height: 1.25rem; padding: 0 0.4rem; background: var(--bim-ui_bg-contrast-20); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 0.25rem; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" 
          onmouseover="this.style.filter='brightness(1.2)'" 
          onmouseout="this.style.filter='none'">
          <span style="font-size: 0.75rem; color: var(--bim-ui_bg-contrast-100, var(--bim-label--c, #ffffff)); font-weight: 600;">Save</span>
        </div>
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
              <span style="font-size: 0.75rem; color: var(--bim-ui_bg-contrast-100, var(--bim-label--c, #ffffff)); font-weight: 600;">${state.counts[g] || 0}</span>
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
    if (loadedModelTab) {
      loadedModelTab.label = `Loaded Model (${models.length})`;
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
  const processAndSaveIfc = async (
    file: File,
    showAlert = true,
    refreshLists = true,
  ): Promise<"success" | "skipped" | "failed"> => {
    const newModelName = file.name.replace(/\.ifc$/i, "");

    // 중복 로드 방지: 이미 동일한 이름의 모델이 있는지 확인
    for (const [, model] of fragments.list) {
      if ((model as any).name === newModelName) {
        if (showAlert) alert(`"${newModelName}" 모델은 이미 로드되어 있습니다.`);
        return "skipped";
      }
    }

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const model = await ifcLoader.load(bytes, false, newModelName, {
        instanceCallback: (importer: any) => {
          if (typeof importer.addAllAttributes === "function") importer.addAllAttributes();
          if (typeof importer.addAllRelations === "function") importer.addAllRelations();
          importer.includeUniqueAttributes = true;
          importer.includeRelationNames = true;
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

      // Detect georeferencing from raw IFC buffer (before any caching)
      const gisMap = components.get(GISMapComponent);
      gisMap.detectGeorefFromBuffer(bytes);

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
        if (showAlert) alert("IFC 및 FRAG 파일이 데이터베이스에 저장되었습니다.");
        (model as any).dbId = ifcid;
        sharedIFC.addModelUUID(ifcid, modelId);
        sharedFRAG.addModelUUID(fragid, modelId);
        if (refreshLists) {
          bcfTopics.onRefresh.trigger();
          await refreshSharedIFCList();
          await refreshSharedFRAGList();
        }
        return "success";
      } else {
        if (showAlert) alert("DB 저장 중 오류가 발생하였습니다.");
        return "failed";
      }
    } catch (err) {
      console.error(`Error processing IFC file (${file.name}):`, err);
      if (showAlert) alert(`"${file.name}" 모델 로드 중 오류가 발생했습니다.`);
      return "failed";
    }
  };

  // 일반 로컬 IFC 모델 추가
  const onAddIfcModel = createFileInputHandler(".ifc", true, async (file) => {
    await processAndSaveIfc(file);
  });

  // 폴더 탐색 및 .ifc 파일 수집 (File System Access API 우선 사용, 구버전/폐쇄망 webkitdirectory 폴백)
  const getIfcFilesFromFolder = async (): Promise<File[] | null> => {
    if ("showDirectoryPicker" in window && typeof (window as any).showDirectoryPicker === "function") {
      try {
        const dirHandle = await (window as any).showDirectoryPicker();
        const files: File[] = [];
        const readDirectory = async (handle: any) => {
          for await (const entry of handle.values()) {
            if (entry.kind === "file") {
              if (entry.name.toLowerCase().endsWith(".ifc")) {
                const file = await entry.getFile();
                files.push(file);
              }
            } else if (entry.kind === "directory") {
              await readDirectory(entry);
            }
          }
        };
        await readDirectory(dirHandle);
        return files;
      } catch (err: any) {
        if (err && err.name === "AbortError") {
          return null; // 사용자가 취소한 경우
        }
        console.warn("showDirectoryPicker 사용 불가/오류 발생, webkitdirectory 폴백 시도:", err);
      }
    }

    // 폐쇄망 및 구버전 브라우저 지원용 webkitdirectory 폴백
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      (input as any).webkitdirectory = true;
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.setAttribute("multiple", "");

      input.addEventListener("change", () => {
        if (!input.files || input.files.length === 0) {
          resolve(null);
          return;
        }
        const files: File[] = [];
        for (let i = 0; i < input.files.length; i++) {
          const file = input.files[i];
          if (file.name.toLowerCase().endsWith(".ifc")) {
            files.push(file);
          }
        }
        resolve(files);
      });

      input.addEventListener("cancel", () => {
        resolve(null);
      });

      input.click();
    });
  };

  const onAddIfcFolder = async (e: Event) => {
    const target = (e.target as HTMLElement).closest("bim-button") as BUI.Button | null;
    try {
      const files = await getIfcFilesFromFolder();
      if (!files) return;

      if (files.length === 0) {
        alert("선택한 폴더 내에 .ifc 파일이 존재하지 않습니다.");
        return;
      }

      if (target) target.loading = true;

      // 파일명 오름차순 순차 처리
      files.sort((a, b) => a.name.localeCompare(b.name));

      let successCount = 0;
      let skipCount = 0;
      let failCount = 0;

      for (const file of files) {
        // 일괄 처리 시 불필요한 반복 목록 갱신을 방지하기 위해 refreshLists=false 전달
        const res = await processAndSaveIfc(file, false, false);
        if (res === "success") successCount++;
        else if (res === "skipped") skipCount++;
        else failCount++;
      }

      // 배치 완료 후 목록 및 주제 1회 일괄 갱신
      if (successCount > 0) {
        bcfTopics.onRefresh.trigger();
        await refreshSharedIFCList();
        await refreshSharedFRAGList();
      }

      alert(`폴더 가져오기 완료: 총 ${files.length}개 IFC 파일 중 ${successCount}개 로드/저장 성공` +
        (skipCount > 0 ? `, ${skipCount}개 중복 생략` : "") +
        (failCount > 0 ? `, ${failCount}개 실패` : ""));
    } catch (error) {
      console.error("Error importing folder:", error);
      alert("폴더 로드 중 오류가 발생했습니다. 콘솔을 확인하세요.");
    } finally {
      if (target) target.loading = false;
      BUI.ContextMenu.removeMenus();
    }
  };

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
    }

    await processAndSaveIfc(fileToLoad);
  });

  const onLoadedSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    loadedTable.queryString = input.value;
  };

  const onSharedSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    fragTable.queryString = input.value;
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
        instanceCallback: (importer: any) => {
          if (typeof importer.addAllAttributes === "function") importer.addAllAttributes();
          if (typeof importer.addAllRelations === "function") importer.addAllRelations();
          importer.includeUniqueAttributes = true;
          importer.includeRelationNames = true;
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

      // Detect georeferencing from raw IFC buffer
      const gisMap = components.get(GISMapComponent);
      gisMap.detectGeorefFromBuffer(ifc.content as Uint8Array);

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
      fragGroups.delete(fragid);
      saveGroupsToBackend();

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

  const loadGroupsFromBackend = async () => {
    try {
      const res = await fetch("/api/groups");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.fragGroups)) {
          fragGroups.clear();
          for (const [id, group] of data.fragGroups) {
            fragGroups.set(Number(id), group);
          }
          localStorage.setItem("app_frag_groups", JSON.stringify(data.fragGroups));
        }
        updateFRAGTableData();
        if (refreshBadges) refreshBadges();
      }
    } catch (err) {
      console.error("Failed to load groups from setup/groups.json:", err);
    }
  };

  type IFCTableData = {
    id: number;
    Name: string;
    [key: string]: any;
  };

  const ifcTable = document.createElement("bim-table") as BUI.Table<IFCTableData>;
  ifcTable.hiddenColumns = ["id"];
  ifcTable.headersHidden = true;
  ifcTable.expanded = true;
  ifcTable.noIndentation = true;
  ifcTable.noCarets = true;

  setupBIMTable(ifcTable);

  // 일괄 Load를 위해 선택된 IFC 모델 ID 추적
  const selectedIfcModels = new Set<number>();

  const updateIFCTableData = () => {
    const list = [...sharedIFC.list];
    list.sort((a, b) => a.name.localeCompare(b.name));

    ifcTable.data = list.map(file => ({
      data: {
        id: file.id,
        Name: file.name,
      }
    }));
  };

  ifcTable.dataTransform = {
    Name: (value, rowData) => {
      const id = rowData.id as number;
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
          <div style="flex: 0 0 auto; display: flex; gap: 0.25rem; margin: 0; padding: 0;">
          <bim-button @click=${() => loadIFCModel(id)} icon=${appIcons.OPEN} style=${tableButtonStyle} title="Load Model"></bim-button>
          <bim-button @click=${() => downloadIFCModel(id)} icon=${appIcons.DOWNLOAD} style=${tableButtonStyle} title="Download Model"></bim-button>
          <bim-button @click=${() => deleteIFCModel(id)} icon=${appIcons.DELETE} style=${tableButtonStyle} title="Delete Model"></bim-button>
          </div>
        </div>
      `;
    }
  };

  // 🌟 외부 연동 시 프로젝트 정보 조회 완료를 보장하는 공통 대기 함수
  const waitForProjectInit = async () => {
    if (appState.hasExternalLink && !appState.currentProject) {
      console.log("[Automation] Waiting for project initialization...");
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (appState.currentProject) break;
      }
    }
  };

  const refreshSharedIFCList = async () => {
    sharedIFC.list = [];
    await waitForProjectInit();
    await sharedIFC.loadIFCFiles(appState.currentProject?.id);
    sharedIFC.list.sort((a, b) => a.name.localeCompare(b.name));
    updateIFCTableData();
  };

  // 🔗 외부 시스템 연동 자동화 대리 수행
  let automationTriggered = false;
  const runExternalAutomation = async () => {
    if (automationTriggered) return;
    const params = new URLSearchParams(window.location.search);
    const paramModel = params.get("model");
    const paramGuid = params.get("guid");

    if (!paramModel) return;
    automationTriggered = true;

    const clearAutomationParams = () => {
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
    };

    try {
      console.log(`[Automation] Searching for model: ${paramModel}`);
      const targetFrag = sharedFRAG.list.find(
        (f) => f.name.replace(/\.frag$/i, "") === paramModel.replace(/\.frag$/i, "")
      );

      if (!targetFrag) {
        console.warn(`[Automation] Model "${paramModel}" not found in DB list.`);
        clearAutomationParams();
        return;
      }

      // 이미 로드된 모델인지 더블 체크 (중복 적재 방지)
      let loadedModel = Array.from(fragments.list.values()).find(
        (m: any) => (m as any).dbId === targetFrag.id || (m as any).name === targetFrag.name
      );

      if (!loadedModel) {
        await loadFRAGModel(targetFrag.id);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      // 1. 모델 전체 줌인 혹은 특정 객체 줌인
      const worlds = components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;
      const cam = world?.camera as any

      if (!paramGuid) {
        clearAutomationParams();
        appState.hasExternalLink = false;
        return;
      }


      // 2. 객체 선택 및 객체 줌인
      try {
        console.log(`[Automation] Finding object GUID: ${paramGuid}`);
        const modelIdMap = await fragments.guidsToModelIdMap([paramGuid]);
        let hasValidItems = false;
        for (const key in modelIdMap) {
          if (modelIdMap[key].size > 0) {
            hasValidItems = true;
            break;
          }
        }

        if (hasValidItems) {
          console.log(`[Automation] Focusing on object: ${paramGuid}`);
          const highlighter = components.get(Highlighter);
          await highlighter.highlightByID("select", modelIdMap);

          if (cam && typeof cam.fitToItems === "function") {
            await cam.fitToItems(modelIdMap);
          }
        } else {
          console.warn(`[Automation] GUID "${paramGuid}" not found in loaded models.`);
        }
      } catch (zoomErr) {
        console.error("[Automation] Focus operation failed:", zoomErr);
      } finally {
        clearAutomationParams();
        appState.hasExternalLink = false;
      }

    } catch (err) {
      console.error("[Automation] Failed:", err);
      clearAutomationParams();
      appState.hasExternalLink = false;
    }
  };

  const refreshSharedFRAGList = async () => {
    sharedFRAG.list = [];
    await waitForProjectInit();
    await sharedFRAG.loadFRAGFiles(appState.currentProject?.id);
    if (sharedModelTab) {
      sharedModelTab.label = `Shared Model (${sharedFRAG.list.length})`;
    }
    if (refreshBadges) refreshBadges();
    updateFRAGTableData();

    // 외부 연동 자동화 수행
    runExternalAutomation();
  };

  (window as any).refreshSharedModelLists = async () => {
    await refreshSharedIFCList();
    await refreshSharedFRAGList();
    await loadGroupsFromBackend();
  };

  (window as any).refreshLoadedModelList = () => {
    updateLoadedModelsList();
  };

  refreshSharedIFCList();
  refreshSharedFRAGList();
  loadGroupsFromBackend();

  return BUI.html`
    <bim-panel-section icon=${appIcons.MODEL} label="IFC List">
      <bim-tabs>
        <bim-tab name="shared" label="Shared Model" icon=${appIcons.MODEL} ${BUI.ref((e) => {
    sharedModelTab = e as BUI.Tab;
    if (sharedModelTab) sharedModelTab.label = `Shared Model (${sharedFRAG.list.length})`;
  })}>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; flex: 1; overflow: hidden;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.25rem;">
              <div style="display: flex; gap: 0.25rem;">
                <bim-button @click=${(e: Event) => { e.stopPropagation(); onAddIfcModel(e); }} icon=${appIcons.ADD} title="Import Model" style="flex: 0;"></bim-button>
                <bim-button @click=${(e: Event) => { e.stopPropagation(); onAddIfcFolder(e); }} icon=${appIcons.FOLDEROPEN} title="Import Folder" style="flex: 0;"></bim-button>
                <bim-button @click=${(e: Event) => { e.stopPropagation(); onProcessEdbData(e); }} icon=${appIcons.ADDBOX} title="Import Model with EDB data" style="flex: 0;"></bim-button>
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
            <div style="display: flex; gap: 0.375rem; align-items: center;">
              <bim-text-input @input=${onSharedSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
            </div>
            ${groupBadges}
            <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; overflow-y: auto; flex: 1;">
              ${fragTable}
            </div>
          </div>
        </bim-tab>

        <bim-tab name="loaded" label="Loaded Model" icon=${appIcons.MODEL} ${BUI.ref((e) => {
      loadedModelTab = e as BUI.Tab;
      if (loadedModelTab) loadedModelTab.label = `Loaded Model (${fragments.list.size})`;
    })}>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; flex: 1; overflow: hidden;">
            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 0.25rem;">
              <bim-button @click=${(e: Event) => { e.stopPropagation(); onSelectAllLoadedModels(); }} label="Select All" style="flex: 0;"></bim-button>
              <bim-button @click=${(e: Event) => { e.stopPropagation(); onDisposeSelectedModels(); }} label="Dispose" style="flex: 0;"></bim-button>
            </div>
            <div style="display: flex; gap: 0.375rem; align-items: center;">
              <bim-text-input @input=${onLoadedSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; overflow-y: auto; flex: 1;">
              ${loadedTable}
            </div>
          </div>
        </bim-tab>
      </bim-tabs>
    </bim-panel-section>
  `;
};

import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { BCFTopics, newTopic, updateTopic } from "../../bim-components/BCFTopics";
import { topicsList } from "../../ui-components/TopicsList";
import { ClashService } from "../../bim-components/ClashService";
import { appIcons, appState, createPaginationTemplate, PaginationRefs, setupBIMTable } from "../../globals";
import { Topic as EngineTopic, BCFTopics as EngineBCFTopics } from "../../bim-components/BCFTopics/src/engine";
import { users } from "../../setup/users";

export interface TopicListState {
  components: OBC.Components;
  view?: "list" | "new" | "update";
}

export const topicListTemplate: BUI.StatefullComponent<
  TopicListState
> = (state) => {
  const { components } = state;
  const bcfTopics = components.get(BCFTopics);
  const [topicListTable, updateTopicListTable] = topicsList({ components });
  setupBIMTable(topicListTable);
  
  let panelSection: BUI.PanelSection;
  const updateTopicCount = () => {
    if (!panelSection) return;
    let open = 0, assigned = 0, closed = 0, resolved = 0, total = 0;
    for (const topic of bcfTopics.list.values()) {
      total++;
      const status = (topic as any).status;
      if (status === "Open") open++;
      else if (status === "Assigned") assigned++;
      else if (status === "Closed") closed++;
      else if (status === "Resolved") resolved++;
    }
    panelSection.label = `Topic List ( Total(${total}) = Open(${open}) + Assigned(${assigned}) + Closed(${closed}) + Resolved(${resolved}) )`;
  };

  let listContainer: HTMLDivElement;
  let newContainer: HTMLDivElement;
  let updateContainer: HTMLDivElement;

  const setView = (view: "list" | "new" | "update") => {
    (bcfTopics as any).isEditingTopic = view !== "list";

    if (listContainer) listContainer.style.display = view === "list" ? "flex" : "none";
    if (newContainer) newContainer.style.display = view === "new" ? "flex" : "none";
    if (updateContainer) updateContainer.style.display = view === "update" ? "flex" : "none";
    
    if (panelSection) {
      if (view === "new") panelSection.label = "New Topic";
      else if (view === "update") panelSection.label = "Update Topic";
      else updateTopicCount();
    }
  };

  // --- Pagination State ---
  let currentPage = 0;
  const pageSize = 30;
  let totalItems = 0;
  let totalPages = 0;
  let currentTopicsCache: any[] = [];
  let searchQuery = "";
  let searchInput: BUI.TextInput;

  // --- Pagination UI Refs ---
  const paginationRefs: PaginationRefs = {};
  
  let updateTopicBtn: BUI.Button | undefined;
  let deleteTopicBtn: BUI.Button | undefined;

  let isMarkersVisible = false;
  let markerBtn: BUI.Button | undefined;

  const updateMarkers = () => {
    const clashService = components.get(ClashService);
    if (isMarkersVisible) {
      const positions: THREE.Vector3[] = [];
      for (const topic of currentTopicsCache) {
        const pt = (topic as any).clashPoint;
        if (pt) {
          if (pt.x !== undefined && pt.y !== undefined && pt.z !== undefined) {
            positions.push(new THREE.Vector3(pt.x, pt.y, pt.z));
          } else if (Array.isArray(pt) && pt.length >= 3) {
            // DB나 JSON을 거치며 배열로 파싱된 경우 (BCF 좌표계 매핑)
            positions.push(new THREE.Vector3(pt[0], pt[2], -pt[1]));
          }
        }
      }
      clashService.drawClashMarkers(positions);
    } else {
      clashService.clearClashMarkers();
    }
  };

  const toggleMarkers = () => {
    isMarkersVisible = !isMarkersVisible;
    if (markerBtn) markerBtn.active = isMarkersVisible;
    updateMarkers();
  };

  const updateButtonStates = () => {
    const hasSelection = topicListTable.selection.size > 0;
    if (updateTopicBtn) updateTopicBtn.disabled = !hasSelection;
    if (deleteTopicBtn) deleteTopicBtn.disabled = !hasSelection;
  };

  topicListTable.addEventListener("change", updateButtonStates);

  const updatePage = () => {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const slicedTopics = currentTopicsCache.slice(start, end);

    updateTopicListTable({ topics: slicedTopics });

    if (paginationRefs.container) {
      paginationRefs.container.style.display = totalPages > 1 ? "flex" : "none";
    }
    if (paginationRefs.label) {
      paginationRefs.label.textContent = `${currentPage + 1} / ${totalPages}`;
    }
    if (paginationRefs.prev) {
      paginationRefs.prev.disabled = currentPage === 0;
    }
    if (paginationRefs.next) {
      paginationRefs.next.disabled = currentPage >= totalPages - 1;
    }
    updateButtonStates();
  };

  const refreshTopicsCache = () => {
    let allTopics = Array.from(bcfTopics.list.values());

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      allTopics = allTopics.filter(t => {
        const title = (t as any).title || "";
        const description = (t as any).description || "";
        return title.toLowerCase().includes(lowerQuery) || description.toLowerCase().includes(lowerQuery);
      });
    }

    currentTopicsCache = allTopics;
    totalItems = currentTopicsCache.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

    updatePage();
    updateMarkers();
  };

  const onPrevPage = () => {
    if (currentPage > 0) {
      currentPage--;
      updatePage();
    }
  };

  const onNextPage = () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      updatePage();
    }
  };

  const [newTopicForm, updateNewTopicForm] = newTopic(components);
  const { panel: updateTopicPanel, show: showUpdateTopic } = updateTopic(bcfTopics);

  // 토픽 행 클릭 시 Viewpoint가 복원되도록 template.ts 에서 이벤트를 처리함
  // 여기서는 restoreViewpoint를 확장하여 더블클릭(수정 패널 열기) 및 행 자동 선택 보장 로직을 추가
  let lastClickedTopicId: string | null = null;
  let lastClickTime = 0;

  const originalRestoreViewpoint = bcfTopics.restoreViewpoint.bind(bcfTopics);
  bcfTopics.restoreViewpoint = async (topic: EngineTopic, options?: { viewpointGuid?: string }): Promise<void> => {
    const targetGroup = topicListTable.value?.find((row: any) => row.data && row.data.Guid === topic.guid);
    if (targetGroup) {
      topicListTable.selection.clear();
      topicListTable.selection.add(targetGroup.data);
      updateButtonStates();
    }

    const now = Date.now();
    const isDoubleClick = lastClickedTopicId === topic.guid && (now - lastClickTime) < 300;
    lastClickedTopicId = topic.guid;
    lastClickTime = now;

    if (isDoubleClick) {
      onUpdateTopicOpen();
      return;
    } else {
      await originalRestoreViewpoint(topic, options);
    }
  };

  let topicCountBeforeNew = 0;
  const onNewTopicOpen = () => {
    topicCountBeforeNew = bcfTopics.list.size;
    let currentCapturedViewpoint: any = null;
    let currentCapturedSnapshot: string | null = null;

    const updateForm = () => {
      updateNewTopicForm({
        components,
        styles: { users },
        capturedViewpoint: currentCapturedViewpoint,
        capturedSnapshot: currentCapturedSnapshot,
        onCancel: () => { setView("list"); },
        onCapture: async () => {
          const { viewpoint, snapshot } = await bcfTopics.captureViewpoint();
          currentCapturedViewpoint = viewpoint;
          currentCapturedSnapshot = snapshot;
          updateForm();
        },
        onImportImage: async (base64Snapshot: string) => {
          const { viewpoint } = await bcfTopics.captureViewpoint();
          currentCapturedViewpoint = viewpoint;
          currentCapturedSnapshot = base64Snapshot;
          updateForm();
        },
        onSubmit: async (newTopic: EngineTopic) => {
          newTopic.creationAuthor = appState.currentUser || "System";
          if (currentCapturedViewpoint) {
            newTopic.viewpoints.add(currentCapturedViewpoint.guid);
            if (currentCapturedSnapshot) {
              (newTopic as any).snapshot = currentCapturedSnapshot;    
            }
          }

          const bcfTopicsEngine = components.get(EngineBCFTopics);
          bcfTopicsEngine.list.onItemUpdated.trigger({ key: newTopic.guid, value: newTopic });

          setView("list");
          alert("변경사항을 공유하려면 Save BCF 버튼을 눌러 데이터베이스에 저장하십시오.");

          if (bcfTopics.list.size > topicCountBeforeNew) {
            setTimeout(() => {          
              refreshTopicsCache(); // 캐시 즉시 동기화
              
              const newTopicIndex = currentTopicsCache.findIndex(t => t.guid === newTopic.guid);
              if (newTopicIndex !== -1) {
                currentPage = Math.floor(newTopicIndex / pageSize);
                updatePage();
              }
              
              const targetGroup = topicListTable.value.find((row: any) => row.data && row.data.Guid === newTopic.guid);
              if (targetGroup) {
                topicListTable.selection.clear();
                topicListTable.selection.add(targetGroup.data);
                updateButtonStates();
              }
            }, 150);
          }
        },
      });
    };

    updateForm();
    setView("new");
  };

  const onUpdateTopicOpen = () => {
    const selectedGuids = Array.from(topicListTable.selection).map((data: any) => data.Guid);

    const switchBackAndRestoreSelection = () => {
      setView("list");
      setTimeout(() => {
        refreshTopicsCache();
        for (const guid of selectedGuids) {
          const targetGroup = topicListTable.value.find((row: any) => row.data && row.data.Guid === guid);
          if (targetGroup) {
            topicListTable.selection.add(targetGroup.data);
          }
        }
        updateButtonStates();
      }, 150);
    };

    showUpdateTopic(topicListTable.selection, {
      onCancel: switchBackAndRestoreSelection,
      onUpdate: switchBackAndRestoreSelection,
    });
    setView("update");
  };

  const onDeleteTopic = () => {
    bcfTopics.delete(topicListTable.selection);
    topicListTable.selection.clear();
    updateButtonStates();
  };
  const onClearTopicsList = () => {
    bcfTopics.deleteAll();
    topicListTable.selection.clear();
    updateButtonStates();
  };
  const onSaveTopicsToBCF = () => {
    bcfTopics.saveBCF();
  };
  const onExportTopicsToJSON = () => {
    bcfTopics.exportJSON();
  };
  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    searchQuery = input.value;
    currentPage = 0;
    refreshTopicsCache();
    topicListTable.queryString = input.value; // 로컬 필터링 보조 유지
  };

  const onClearSearch = () => {
    if (searchInput) searchInput.value = "";
    searchQuery = "";
    currentPage = 0;
    refreshTopicsCache();
    topicListTable.queryString = null;
  };

  const onExcludeSearch = () => {
    if (!searchQuery) return;
    if (currentTopicsCache.length === 0) return;
    
    const toDelete = new Set(currentTopicsCache.map(t => ({ Guid: t.guid })));
    bcfTopics.delete(toDelete);
    
    topicListTable.selection.clear();
    updateButtonStates();
    onClearSearch();
  };

  const onIsolateSearch = () => {
    if (!searchQuery) return;
    if (currentTopicsCache.length === 0) return;

    const keepGuids = new Set(currentTopicsCache.map(t => t.guid));
    const allGuids = Array.from(bcfTopics.list.keys());
    const toDelete = new Set(allGuids.filter(g => !keepGuids.has(g)).map(g => ({ Guid: g })));
    
    if (toDelete.size > 0) bcfTopics.delete(toDelete);
    
    topicListTable.selection.clear();
    updateButtonStates();
    onClearSearch();
  };

  let updateTopicCountTimeout: ReturnType<typeof setTimeout>;
  const debouncedUpdateTopicCount = () => {
    if (updateTopicCountTimeout) clearTimeout(updateTopicCountTimeout);
    updateTopicCountTimeout = setTimeout(() => {
      updateTopicCount();
      refreshTopicsCache();
    }, 500);
  };

  bcfTopics.onRefresh.add(debouncedUpdateTopicCount);
  bcfTopics.list.onItemSet.add(debouncedUpdateTopicCount);
  bcfTopics.list.onItemUpdated.add(debouncedUpdateTopicCount);
  bcfTopics.list.onItemDeleted.add(debouncedUpdateTopicCount);

  // 최초 로드시 전체 목록 캐싱 및 렌더링
  setTimeout(() => refreshTopicsCache(), 0);

  const topicListPanel = BUI.html`
    <div ${BUI.ref(e => listContainer = e as HTMLDivElement)} style="display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 0.5rem; overflow: hidden;">
      <div style="display: flex; gap: 0.5rem; flex-shrink: 0; position: relative; z-index: 10;">
        <div style="display: flex; gap: 0.25rem; flex: 1;">
          <bim-button style="flex: 1;" @click=${onNewTopicOpen} label="Create Topic" icon=${appIcons.ADD}></bim-button>
          <bim-button ${BUI.ref(e => { updateTopicBtn = e as BUI.Button; updateButtonStates(); })} style="flex: 1;" @click=${onUpdateTopicOpen} label="Update Topic" icon=${appIcons.REF} disabled></bim-button>
          <bim-button ${BUI.ref(e => { deleteTopicBtn = e as BUI.Button; updateButtonStates(); })} style="flex: 1;" @click=${onDeleteTopic} label="Delete Topic" icon=${appIcons.DELETE} disabled></bim-button>
          <bim-button ${BUI.ref(e => { markerBtn = e as BUI.Button; })} style="flex: 1;" @click=${toggleMarkers} label="Markers" ?active=${isMarkersVisible} icon=${appIcons.MAP}></bim-button>
          <bim-button style="flex: 1;" @click=${onClearTopicsList} label="Clear" icon=${appIcons.CLEAR}></bim-button>
          <bim-button style="flex: 1;" @click=${onSaveTopicsToBCF} label="Save BCF" icon=${appIcons.SAVE}></bim-button>
          <bim-button style="flex: 1;" @click=${onExportTopicsToJSON} label="Send to TDVS" icon=${appIcons.EXPORT}></bim-button>
        </div>
        <div style="display: flex; gap: 0.25rem; flex: 1; align-items: center;">
          <bim-text-input ${BUI.ref((e) => { searchInput = e as BUI.TextInput; })} @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
          <bim-button @click=${onClearSearch} icon=${appIcons.CLEAR} tooltip-title="Clear Search" style="flex: 0 0 auto;"></bim-button>
          <bim-button @click=${onExcludeSearch} icon=${appIcons.EXCLUDE} tooltip-title="Remove search results from list" style="flex: 0 0 auto;"></bim-button>
          <bim-button @click=${onIsolateSearch} icon=${appIcons.ISOLATE} tooltip-title="Keep only search results" style="flex: 0 0 auto;"></bim-button>
          ${createPaginationTemplate(onPrevPage, onNextPage, paginationRefs)}
        </div>
      </div>

      <div style="flex: 1; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; overflow: hidden; min-width: 0;">
        ${topicListTable}
      </div>
    </div>
  `;

  return BUI.html`
    <bim-panel-section ${BUI.ref((e) => { panelSection = e as BUI.PanelSection; updateTopicCount(); })} fixed icon=${appIcons.TASK} label="Topic List">
      ${topicListPanel}
      <div ${BUI.ref(e => newContainer = e as HTMLDivElement)} style="display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
        ${newTopicForm}
      </div>
      <div ${BUI.ref(e => updateContainer = e as HTMLDivElement)} style="display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
        ${updateTopicPanel}
      </div>
    </bim-panel-section>
  `;
};

export const topicList = (state: TopicListState) => {
  return BUI.Component.create<BUI.Panel, TopicListState>(topicListTemplate, state);
};
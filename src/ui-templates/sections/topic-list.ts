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
              const viewpoints = components.get(OBC.Viewpoints);
              const base64Data = currentCapturedSnapshot.replace(/^data:image\/\w+;base64,/, "");
              const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              viewpoints.snapshots.set(currentCapturedViewpoint.guid, bytes);
              currentCapturedViewpoint.snapshot = currentCapturedViewpoint.guid;
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
  const onSendTopicsToTDVS = async () => {
    const list = Array.from(bcfTopics.list.values());
    if (list.length === 0) {
      alert("전송할 토픽 데이터가 없습니다.");
      return;
    }

    const confirmSend = confirm(`${list.length}개의 토픽을 TDVS(SI_BCF_TOPIC)로 전송하시겠습니까?`);
    if (!confirmSend) return;

    const viewpoints = components.get(OBC.Viewpoints);
    const fragments = components.get(OBC.FragmentsManager);
    
    // BCF와 연동된 첫 번째 IFC 모델명 추출
    let ifcFileName = "";
    if (fragments.list.size > 0) {
      const firstModel = fragments.list.values().next().value;
      if (firstModel && (firstModel as any).name) {
        ifcFileName = (firstModel as any).name;
      }
    }

    const payload = [];

    for (const topic of list) {
      // Topic viewpoint 카메라 좌표 (Z-up 변환: X=x, Y=-z, Z=y)
      let topicCoord = null;
      const firstVpGuid = topic.viewpoints.values().next().value;
      if (firstVpGuid) {
        const vp = viewpoints.list.get(firstVpGuid);
        if (vp && vp.camera) {
          const cam = vp.camera;
          if (cam.camera_view_point) {
            topicCoord = {
              x: cam.camera_view_point.x,
              y: -cam.camera_view_point.z,
              z: cam.camera_view_point.y
            };
          }
        }
      }

      // Comments 및 Comment viewpoint 카메라 좌표 (comments-ui.ts의 페이지 그룹화 방식과 일치시킴)
      const commentsArray = Array.from(topic.comments.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
      
      const groups: { viewpointGuid: string | null; comments: any[] }[] = [];
      const vpMap = new Map<string, any[]>();
      for (const comment of commentsArray) {
        if (comment.viewpoint) {
          if (!vpMap.has(comment.viewpoint)) vpMap.set(comment.viewpoint, []);
          vpMap.get(comment.viewpoint)!.push(comment);
        } else {
          groups.push({ viewpointGuid: null, comments: [comment] });
        }
      }
      for (const [vpGuid, cmts] of vpMap.entries()) {
        groups.push({ viewpointGuid: vpGuid, comments: cmts });
      }

      // 각 그룹의 첫번째 코멘트 작성 시간을 기준으로 정렬
      groups.sort((a, b) => {
        const timeA = a.comments.length > 0 ? a.comments[0].date.getTime() : 0;
        const timeB = b.comments.length > 0 ? b.comments[0].date.getTime() : 0;
        return timeA - timeB;
      });

      const commentsData = [];
      for (const group of groups) {
        let commentCoord = null;
        if (group.viewpointGuid) {
          const vp = viewpoints.list.get(group.viewpointGuid);
          if (vp && vp.camera) {
            const cam = vp.camera;
            if (cam.camera_view_point) {
              commentCoord = {
                x: cam.camera_view_point.x,
                y: -cam.camera_view_point.z,
                z: cam.camera_view_point.y
              };
            }
          }
        }

        // Sort comments chronologically
        const sortedComments = [...group.comments].sort((a, b) => {
          const timeA = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
          const timeB = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
          return timeA - timeB;
        });

        const oldestComment = sortedComments[0];
        const solveComments = sortedComments.slice(1);

        const reviewCommentText = oldestComment ? oldestComment.comment : null;
        const reviewAuthor = oldestComment ? (oldestComment.author || "Admin") : null;
        const reviewDate = oldestComment && oldestComment.date ? oldestComment.date.toISOString() : null;

        const isRepresentative = group.viewpointGuid && group.viewpointGuid === firstVpGuid;

        if (solveComments.length === 0) {
          commentsData.push({
            reviewComment: reviewCommentText || null,
            author: reviewAuthor,
            date: reviewDate,
            
            solveComment: null,
            modifiedAuthor: null,
            modifiedDate: null,

            coord: commentCoord,
            vpGuid: isRepresentative ? null : (group.viewpointGuid || null)
          });
        } else {
          for (const sCmt of solveComments) {
            const solveCommentText = sCmt.comment || null;
            const solveAuthor = sCmt.modifiedAuthor || sCmt.author || "Admin";
            const solveDate = sCmt.date ? sCmt.date.toISOString() : null;

            commentsData.push({
              reviewComment: reviewCommentText || null,
              author: reviewAuthor,
              date: reviewDate,
              
              solveComment: solveCommentText,
              modifiedAuthor: solveAuthor,
              modifiedDate: solveDate,

              coord: commentCoord,
              vpGuid: isRepresentative ? null : (group.viewpointGuid || null)
            });
          }
        }
      }

      payload.push({
        guid: topic.guid,
        mrimsNo: (topic as any).mrimsNo || null,
        title: topic.title,
        description: topic.description || "",
        type: topic.type,
        priority: topic.priority || "",
        status: topic.status,
        creationAuthor: topic.creationAuthor,
        creationDate: topic.creationDate ? topic.creationDate.toISOString() : new Date().toISOString(),
        assignedTo: topic.assignedTo || "",
        dueDate: topic.dueDate ? topic.dueDate.toISOString() : null,
        coord: topicCoord,
        priFile: ifcFileName, // BCF 연계 IFC 파일명 매핑
        comments: commentsData
      });
    }

    try {
      const response = await fetch("/api/bcf/send-to-tdvs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error! status: ${response.status}`);
      }

      // 서버 응답에서 매핑 데이터를 추출하여 로컬 토픽의 mrimsNo 갱신
      const resData = await response.json().catch(() => ({}));
      if (resData.mapping && Array.isArray(resData.mapping)) {
        for (const mapItem of resData.mapping) {
          const t = bcfTopics.list.get(mapItem.guid);
          if (t) {
            (t as any).mrimsNo = mapItem.mrimsNo;
          }
        }
      }

      // 갱신된 내역을 로컬 캐시에 반영하고 동기화 상태 갱신
      refreshTopicsCache();

      alert("성공적으로 TDVS로 데이터를 전송하고 데이터베이스에 저장하였습니다.");
    } catch (error) {
      console.error("Error sending topics to TDVS:", error);
      alert(`TDVS 전송 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
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
          <bim-button style="flex: 1;" @click=${onSendTopicsToTDVS} label="Send to TDVS" icon=${appIcons.EXPORT}></bim-button>
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
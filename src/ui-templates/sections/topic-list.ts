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
  let unsyncedTopicGuidsCache = new Set<string>();
  let isCheckingSync = false;

  // --- Pagination UI Refs ---
  const paginationRefs: PaginationRefs = {};
  
  let syncTdvsBtn: BUI.Button | undefined;

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

  topicListTable.addEventListener("topic-edit", (evt: any) => {
    const { guid, rowData } = evt.detail;
    topicListTable.selection.clear();
    const targetGroup = topicListTable.value?.find((row: any) => row.data && row.data.Guid === guid);
    if (targetGroup) {
      topicListTable.selection.add(targetGroup.data);
    } else if (rowData) {
      topicListTable.selection.add(rowData);
    }
    onUpdateTopicOpen();
  });

  topicListTable.addEventListener("topic-delete", (evt: any) => {
    const { guid, rowData } = evt.detail;
    topicListTable.selection.clear();
    const targetGroup = topicListTable.value?.find((row: any) => row.data && row.data.Guid === guid);
    if (targetGroup) {
      topicListTable.selection.add(targetGroup.data);
    } else if (rowData) {
      topicListTable.selection.add(rowData);
    }
    onDeleteTopic();
  });

  const updatePage = () => {
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const slicedTopics = currentTopicsCache.slice(start, end);

    updateTopicListTable({ topics: slicedTopics, unsyncedTopicGuids: unsyncedTopicGuidsCache });

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
    checkTdvsSyncState();
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
    let isCommentsExpanded = false;

    const updateForm = () => {
      updateNewTopicForm({
        components,
        styles: { users },
        capturedViewpoint: currentCapturedViewpoint,
        capturedSnapshot: currentCapturedSnapshot,
        isCommentsExpanded,
        onToggleComments: () => {
          isCommentsExpanded = !isCommentsExpanded;
          updateForm();
        },
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
  };
  const onClearTopicsList = () => {
    bcfTopics.deleteAll();
    topicListTable.selection.clear();
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

        const isRepresentative = group.viewpointGuid && group.viewpointGuid === firstVpGuid;

        if (group.comments.length === 0) {
          commentsData.push({
            reviewComment: null,
            author: null,
            date: null,
            
            solveComment: null,
            modifiedAuthor: null,
            modifiedDate: null,

            coord: commentCoord,
            vpGuid: isRepresentative ? null : (group.viewpointGuid || null)
          });
        } else {
          // Sort comments chronologically
          const sortedComments = [...group.comments].sort((a, b) => {
            const timeA = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
            const timeB = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
            return timeA - timeB;
          });

          // 1. 모든 comment들을 ;; 구분자로 통합
          const integratedCommentsText = sortedComments.map(c => c.comment).join(";;");

          // 2. 가장 빠른 comment.date
          const oldestDate = sortedComments[0].date ? sortedComments[0].date.toISOString() : null;

          // 3. author(ISSUE_PREPARE_NAME)는 비워둠 (null)
          commentsData.push({
            reviewComment: integratedCommentsText,
            author: null,
            date: oldestDate,
            
            solveComment: null,
            modifiedAuthor: null,
            modifiedDate: null,

            coord: commentCoord,
            vpGuid: isRepresentative ? null : (group.viewpointGuid || null)
          });
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
        comments: commentsData,
        labels: Array.from(topic.labels)
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
      await onSyncWithTDVS(true);

      alert("성공적으로 TDVS로 데이터를 전송하고 데이터베이스에 저장하였습니다.");
    } catch (error) {
      console.error("Error sending topics to TDVS:", error);
      alert(`TDVS 전송 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const checkTdvsSyncState = async () => {
    if (isCheckingSync) return;
    if (!syncTdvsBtn) return;
    
    const fragments = components.get(OBC.FragmentsManager);
    const loadedModelNames = Array.from(fragments.list.values())
      .map(m => (m as any).name)
      .filter(name => !!name);

    if (loadedModelNames.length === 0) {
      syncTdvsBtn.disabled = true;
      syncTdvsBtn.active = false;
      syncTdvsBtn.style.removeProperty("--bim-button--bg");
      syncTdvsBtn.style.removeProperty("--bim-button--c");
      return;
    }

    try {
      isCheckingSync = true;
      const response = await fetch(`/api/bcf/sync?priFiles=${encodeURIComponent(loadedModelNames.join(','))}`);
      if (!response.ok) throw new Error();
      const serverTopics = await response.json();

      const localTopics = Array.from(bcfTopics._bcf.list.values()) as any[];
      let needSync = false;
      const unsyncedTopicGuids = new Set<string>();

      for (const serverTopic of serverTopics) {
        let topic = localTopics.find(t => t.mrimsNo === serverTopic.mrimsNo);
        if (!topic) {
          topic = localTopics.find(t => {
            if (t.mrimsNo) return false;
            const dateDiff = Math.abs(new Date(t.creationDate).getTime() - new Date(serverTopic.creationDate).getTime());
            return t.title === serverTopic.title && dateDiff < 5000;
          });
          if (topic) {
            topic.mrimsNo = serverTopic.mrimsNo;
          }
        }

        if (topic) {
          (topic as any).ackCommentNo = serverTopic.ackCommentNo || 0;
        }

        if (!topic) {
          needSync = true;
          continue;
        }

        if (serverTopic.comments && Array.isArray(serverTopic.comments)) {
          const dismissedCount = serverTopic.ackCommentNo || 0;
          const localComments = Array.from(topic.comments.values()) as any[];
          const isAlreadyImported = (text: string) => {
            return localComments.some(lc => lc.comment === text);
          };

          const hasNewComments = serverTopic.comments.some((item: any) => {
            if (!item || !item.comment) return false;

            const cNo = item.commentNo || 0;
            if (cNo > 0 && cNo <= dismissedCount) {
              return false;
            }

            const parts = item.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
            return parts.some((partText: string) => !isAlreadyImported(partText));
          });

          if (hasNewComments) {
            needSync = true;
            unsyncedTopicGuids.add(topic.guid);
          }
        }
      }

      unsyncedTopicGuidsCache = unsyncedTopicGuids;
      updatePage();

      if (needSync) {
        syncTdvsBtn.disabled = false;
        syncTdvsBtn.active = true;
        syncTdvsBtn.style.setProperty("--bim-button--bg", "var(--bim-ui_accent)");
        syncTdvsBtn.style.setProperty("--bim-button--c", "var(--bim-ui_accent-contrast)");
      } else {
        syncTdvsBtn.disabled = true;
        syncTdvsBtn.active = false;
        syncTdvsBtn.style.removeProperty("--bim-button--bg");
        syncTdvsBtn.style.removeProperty("--bim-button--c");
      }
    } catch (error) {
      console.error("Error checking TDVS sync state for topic list:", error);
      syncTdvsBtn.disabled = true;
      syncTdvsBtn.active = false;
      syncTdvsBtn.style.removeProperty("--bim-button--bg");
      syncTdvsBtn.style.removeProperty("--bim-button--c");
    } finally {
      isCheckingSync = false;
    }
  };

  const onSyncWithTDVS = async (isSilent = false) => {
    const fragments = components.get(OBC.FragmentsManager);
    const loadedModelNames = Array.from(fragments.list.values())
      .map(m => (m as any).name)
      .filter(name => !!name);

    if (loadedModelNames.length === 0) {
      if (!isSilent) {
        alert("로드된 모델이 없습니다. 모델을 먼저 로드해 주세요.");
      }
      return;
    }

    try {
      bcfTopics.loading = true;
      const response = await fetch(`/api/bcf/sync?priFiles=${encodeURIComponent(loadedModelNames.join(','))}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const serverTopics = await response.json();

      if (serverTopics.length === 0) {
        if (!isSilent) {
          alert("로드된 모델과 연결된 토픽 정보가 TDVS 데이터베이스에 존재하지 않습니다.");
        }
        return;
      }

      const viewpoints = components.get(OBC.Viewpoints);
      const worlds = components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;

      const localTopics = Array.from(bcfTopics._bcf.list.values()) as any[];

      for (const serverTopic of serverTopics) {
        let topic = localTopics.find(t => t.mrimsNo === serverTopic.mrimsNo);
        let isNewTopic = false;

        if (!topic) {
          topic = localTopics.find(t => {
            if (t.mrimsNo) return false;
            const dateDiff = Math.abs(new Date(t.creationDate).getTime() - new Date(serverTopic.creationDate).getTime());
            return t.title === serverTopic.title && dateDiff < 5000;
          });
          if (topic) {
            topic.mrimsNo = serverTopic.mrimsNo;
          }
        }

        if (!topic) {
          topic = bcfTopics._bcf.create();
          topic.mrimsNo = serverTopic.mrimsNo;
          topic.status = "Open";
          isNewTopic = true;
        }

        topic.title = serverTopic.title;
        topic.description = serverTopic.description;
        topic.type = serverTopic.type;
        if (!topic.status) {
          topic.status = "Open";
        }
        topic.priority = serverTopic.priority;
        topic.creationAuthor = serverTopic.creationAuthor;
        topic.creationDate = new Date(serverTopic.creationDate);
        topic.assignedTo = serverTopic.assignedTo;
        topic.dueDate = serverTopic.dueDate ? new Date(serverTopic.dueDate) : undefined;
        if (serverTopic.priFile) {
          topic.priFile = serverTopic.priFile;
        }
        (topic as any).ackCommentNo = serverTopic.ackCommentNo || 0;

        if (serverTopic.labels && Array.isArray(serverTopic.labels)) {
          topic.labels.clear();
          for (const label of serverTopic.labels) {
            topic.labels.add(label);
          }
        }

        if (serverTopic.coord && isNewTopic) {
          let existingVp: any = null;
          if (topic.viewpoints.size > 0) {
            const firstVpGuid = Array.from(topic.viewpoints)[0] as string;
            existingVp = viewpoints.list.get(firstVpGuid);
          }

          if (existingVp) {
            if (world) {
              existingVp.world = world;
              existingVp.camera.camera_view_point.x = serverTopic.coord.x;
              existingVp.camera.camera_view_point.y = serverTopic.coord.z;
              existingVp.camera.camera_view_point.z = -serverTopic.coord.y;
              existingVp.camera.camera_direction.x = 0;
              existingVp.camera.camera_direction.y = 0;
              existingVp.camera.camera_direction.z = -1;
            }
          } else {
            const vp = viewpoints.create();
            if (world) {
              vp.world = world;
              vp.camera.camera_view_point.x = serverTopic.coord.x;
              vp.camera.camera_view_point.y = serverTopic.coord.z;
              vp.camera.camera_view_point.z = -serverTopic.coord.y;
              vp.camera.camera_direction.x = 0;
              vp.camera.camera_direction.y = 0;
              vp.camera.camera_direction.z = -1;
            }
            topic.viewpoints.add(vp.guid);
          }
        }
      }

      refreshTopicsCache();
      if (!isSilent) {
        alert("TDVS 외부 시스템의 최신 BCF Topic 및 Comment 데이터를 성공적으로 동기화하였습니다.");
      }
    } catch (error) {
      console.error("Error syncing BCF from TDVS:", error);
      if (!isSilent) {
        alert(`TDVS 동기화 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      bcfTopics.loading = false;
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
          <bim-button ${BUI.ref(e => { markerBtn = e as BUI.Button; })} style="flex: 1;" @click=${toggleMarkers} label="Markers" ?active=${isMarkersVisible} icon=${appIcons.MAP}></bim-button>
          <bim-button style="flex: 1;" @click=${onClearTopicsList} label="Clear" icon=${appIcons.CLEAR}></bim-button>
          <bim-button style="flex: 1;" @click=${onSaveTopicsToBCF} label="Save BCF" icon=${appIcons.SAVE}></bim-button>
          <bim-button style="flex: 1;" @click=${onSendTopicsToTDVS} label="Send to TDVS" icon=${appIcons.EXPORT}></bim-button>
          <bim-button ${BUI.ref(e => { syncTdvsBtn = e as BUI.Button; })} style="flex: 1;" @click=${() => onSyncWithTDVS(false)} label="Sync TDVS" icon=${appIcons.REF} disabled></bim-button>
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
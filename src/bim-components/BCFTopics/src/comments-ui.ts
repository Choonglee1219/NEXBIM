import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, showLightbox, appState } from "../../../globals";
import { BCFTopics as EngineBCFTopics, Topic as EngineTopic } from "./engine";

const copyViewpoint = (src: any, dest: any) => {
  if (!src || !dest) return;
  if (src.camera && dest.camera) {
    dest.camera.camera_view_point.x = src.camera.camera_view_point.x;
    dest.camera.camera_view_point.y = src.camera.camera_view_point.y;
    dest.camera.camera_view_point.z = src.camera.camera_view_point.z;
    if (dest.camera.camera_direction && src.camera.camera_direction) {
      dest.camera.camera_direction.x = src.camera.camera_direction.x;
      dest.camera.camera_direction.y = src.camera.camera_direction.y;
      dest.camera.camera_direction.z = src.camera.camera_direction.z;
    }
    if (dest.camera.camera_up_vector && src.camera.camera_up_vector) {
      dest.camera.camera_up_vector.x = src.camera.camera_up_vector.x;
      dest.camera.camera_up_vector.y = src.camera.camera_up_vector.y;
      dest.camera.camera_up_vector.z = src.camera.camera_up_vector.z;
    }
  }
  if (src.selectionComponents && dest.selectionComponents) {
    dest.selectionComponents.clear();
    for (const guid of src.selectionComponents) {
      dest.selectionComponents.add(guid);
    }
  }
  if (src.exceptionComponents && dest.exceptionComponents) {
    dest.exceptionComponents.clear();
    for (const guid of src.exceptionComponents) {
      dest.exceptionComponents.add(guid);
    }
  }
  if (src.componentColors && dest.componentColors) {
    dest.componentColors.clear();
    for (const [color, guids] of src.componentColors.entries()) {
      dest.componentColors.set(color, [...guids]);
    }
  }
  dest.defaultVisibility = src.defaultVisibility;
  if (src.clipping_planes) {
    dest.clipping_planes = [...src.clipping_planes];
  } else {
    delete dest.clipping_planes;
  }
};

export const createCommentsUI = (components: OBC.Components, bcfTopics: any) => {
  const bcf = components.get(EngineBCFTopics);

  const syncTopicWithTDVS = async (components: OBC.Components, bcfTopics: any) => {
    const fragments = components.get(OBC.FragmentsManager);
    const loadedModelNames = Array.from(fragments.list.values())
      .map(m => (m as any).name)
      .filter(name => !!name);

    if (loadedModelNames.length === 0) return;

    try {
      const response = await fetch(`/api/bcf/sync?priFiles=${encodeURIComponent(loadedModelNames.join(','))}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const serverTopics = await response.json();
      if (serverTopics.length === 0) return;

      const viewpoints = components.get(OBC.Viewpoints);
      const worlds = components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;
      const localTopics = Array.from(bcfTopics._bcf.list.values()) as any[];

      for (const serverTopic of serverTopics) {
        let topic: any = localTopics.find((t: any) => t.mrimsNo === serverTopic.mrimsNo);
        if (!topic) {
          topic = localTopics.find((t: any) => {
            if (t.mrimsNo) return false;
            const dateDiff = Math.abs(new Date(t.creationDate).getTime() - new Date(serverTopic.creationDate).getTime());
            return t.title === serverTopic.title && dateDiff < 5000;
          });
          if (topic) topic.mrimsNo = serverTopic.mrimsNo;
        }

        let isNewTopic = false;
        if (!topic) {
          topic = bcfTopics._bcf.create();
          topic.mrimsNo = serverTopic.mrimsNo;
          isNewTopic = true;
        }

        topic.title = serverTopic.title;
        topic.description = serverTopic.description;
        topic.type = serverTopic.type;
        if (!topic.status) topic.status = "Open";
        topic.priority = serverTopic.priority;
        topic.creationAuthor = serverTopic.creationAuthor;
        topic.creationDate = new Date(serverTopic.creationDate);
        topic.assignedTo = serverTopic.assignedTo;
        topic.dueDate = serverTopic.dueDate ? new Date(serverTopic.dueDate) : undefined;
        if (serverTopic.priFile) topic.priFile = serverTopic.priFile;

        if (serverTopic.coord && isNewTopic) {
          let existingVp: any = null;
          if (topic.viewpoints.size > 0) {
            const firstVpGuid = Array.from(topic.viewpoints)[0] as string;
            existingVp = viewpoints.list.get(firstVpGuid);
          }

          if (existingVp) {
            if (world) {
              existingVp.world = world;
              existingVp.camera.camera_view_point = {
                x: serverTopic.coord.x,
                y: serverTopic.coord.z,
                z: -serverTopic.coord.y
              };
              existingVp.camera.camera_direction = { x: 0, y: 0, z: -1 };
              existingVp.camera.camera_up_vector = { x: 0, y: 1, z: 0 };
            }
          } else {
            const vp = viewpoints.create();
            if (world) {
              vp.world = world;
              vp.camera.camera_view_point = {
                x: serverTopic.coord.x,
                y: serverTopic.coord.z,
                z: -serverTopic.coord.y
              };
              vp.camera.camera_direction = { x: 0, y: 0, z: -1 };
              vp.camera.camera_up_vector = { x: 0, y: 1, z: 0 };
            }
            topic.viewpoints.add(vp.guid);
          }
        }
      }
    } catch (error) {
      console.error("Error syncing BCF from TDVS inside comments UI:", error);
    }
  };

  const commentsContainer = document.createElement("div");
  commentsContainer.style.display = "flex";
  commentsContainer.style.flexDirection = "column";
  commentsContainer.style.gap = "0.5rem";
  commentsContainer.style.flex = "1";
  commentsContainer.style.minHeight = "0";
  commentsContainer.style.overflow = "hidden";
  commentsContainer.style.marginBottom = "0.5rem";
  commentsContainer.style.paddingRight = "0.5rem";

  let currentCommentPage = 0;
  let isAddingNewComment = false;
  let activeViewpointGuid: string | null = null;

  let pendingCommentViewpoint: any = null;
  let pendingCommentSnapshot: string | null = null;

  // 헤더에 붙일 페이지네이션 컨테이너를 미리 생성해 둡니다.
  const paginationContainer = document.createElement("div");
  paginationContainer.style.display = "flex";
  paginationContainer.style.alignItems = "center";
  paginationContainer.style.gap = "0.5rem";

  // TDVS 댓글 수동 동기화 버튼 생성
  const tdvsBtn = document.createElement("bim-button") as BUI.Button;
  tdvsBtn.icon = appIcons.REFRESH;
  tdvsBtn.style.margin = "0";
  tdvsBtn.title = "Sync TDVS Comments";
  tdvsBtn.style.display = "none";

  const showTdvsCommentsModal = (virtualComments: any[], topic: EngineTopic) => {
    const dialog = document.createElement("dialog");
    dialog.style.width = "90vw";
    dialog.style.height = "80vh";
    dialog.style.maxWidth = "1100px";
    dialog.style.maxHeight = "700px";
    dialog.style.padding = "1.5rem";
    dialog.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
    dialog.style.borderRadius = "8px";
    dialog.style.backgroundColor = "var(--bim-ui_bg-base)";
    dialog.style.display = "flex";
    dialog.style.flexDirection = "column";
    dialog.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
    dialog.style.color = "var(--bim-ui_bg-contrast-100)";

    const style = document.createElement("style");
    style.textContent = `
      dialog::backdrop { background-color: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px); }
      .tdvs-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        flex-shrink: 0;
      }
      .tdvs-modal-title {
        font-size: 1.25rem;
        font-weight: bold;
      }
      .tdvs-table-container {
        flex: 1;
        overflow: auto;
        border: 1px solid var(--bim-ui_bg-contrast-20);
        border-radius: 4px;
        margin-bottom: 1rem;
      }
      .tdvs-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
      }
      .tdvs-table th, .tdvs-table td {
        border: 1px solid var(--bim-ui_bg-contrast-20);
        padding: 0.75rem;
        text-align: left;
        vertical-align: top;
      }
      .tdvs-table th {
        background-color: var(--bim-ui_bg-contrast-10);
        font-weight: bold;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .tdvs-table tr:hover {
        background-color: var(--bim-ui_bg-contrast-5);
      }
      .tdvs-comment-meta {
        font-size: 0.7rem;
        color: var(--bim-ui_gray-10);
        margin-top: 0.25rem;
      }
      .tdvs-import-btn {
        margin: 0;
        width: 100%;
        box-sizing: border-box;
      }
    `;
    dialog.appendChild(style);

    // 헤더 구성
    const headerDiv = document.createElement("div");
    headerDiv.className = "tdvs-modal-header";
    
    const title = document.createElement("span");
    title.className = "tdvs-modal-title";
    title.textContent = `TDVS Comments (Topic No: ${(topic as any).mrimsNo})`;
    headerDiv.appendChild(title);

    const closeBtn = document.createElement("bim-button") as BUI.Button;
    closeBtn.icon = appIcons.CLEAR;
    closeBtn.style.margin = "0";
    closeBtn.addEventListener("click", () => dialog.close());
    headerDiv.appendChild(closeBtn);
    
    dialog.appendChild(headerDiv);

    // 테이블 컨테이너
    const tableContainer = document.createElement("div");
    tableContainer.className = "tdvs-table-container custom-scrollbar";

    // 중복 체크용 로컬 댓글 목록
    const localComments = Array.from(topic.comments.values());
    const isAlreadyImported = (text: string) => {
      return localComments.some(lc => lc.comment === text);
    };

    if (virtualComments.length === 0) {
      const noData = document.createElement("div");
      noData.style.padding = "2rem";
      noData.style.textAlign = "center";
      noData.style.color = "var(--bim-ui_gray-10)";
      noData.textContent = "조회된 TDVS 댓글 데이터가 없습니다.";
      tableContainer.appendChild(noData);
    } else {
      const table = document.createElement("table");
      table.className = "tdvs-table";
      
      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr>
          <th style="width: 5%;">No</th>
          <th style="width: 10%;">Type</th>
          <th style="width: 45%;">Comment</th>
          <th style="width: 25%;">Coordinates (X, Y, Z)</th>
          <th style="width: 15%;">Action</th>
        </tr>
      `;
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      virtualComments.forEach((vCmt: any) => {
        const tr = document.createElement("tr");
        
        // No.
        const tdNo = document.createElement("td");
        tdNo.textContent = vCmt.commentNo;
        tr.appendChild(tdNo);

        // Type
        const tdType = document.createElement("td");
        tdType.textContent = vCmt.type;
        tdType.style.fontWeight = "bold";
        tdType.style.color = vCmt.type === "Review" ? "var(--bim-ui_accent)" : "var(--bim-ui_gray-10)";
        tr.appendChild(tdType);

        // Comment
        const tdComment = document.createElement("td");
        const textSpan = document.createElement("span");
        textSpan.style.whiteSpace = "pre-wrap";
        textSpan.style.wordBreak = "break-all";
        textSpan.textContent = vCmt.text;
        tdComment.appendChild(textSpan);
        
        if (vCmt.author || vCmt.date) {
          const metaDiv = document.createElement("div");
          metaDiv.className = "tdvs-comment-meta";
          const dateStr = vCmt.date ? new Date(vCmt.date).toLocaleString() : "";
          metaDiv.textContent = `Author: ${vCmt.author || "Admin"} ${dateStr ? `| Date: ${dateStr}` : ""}`;
          tdComment.appendChild(metaDiv);
        }
        tr.appendChild(tdComment);

        // Coordinates
        const tdCoord = document.createElement("td");
        if (vCmt.coord) {
          const cx = vCmt.coord.x !== null ? vCmt.coord.x.toFixed(2) : "0.00";
          const cy = vCmt.coord.y !== null ? vCmt.coord.y.toFixed(2) : "0.00";
          const cz = vCmt.coord.z !== null ? vCmt.coord.z.toFixed(2) : "0.00";
          tdCoord.textContent = `X: ${cx}, Y: ${cy}, Z: ${cz}`;
        } else {
          tdCoord.textContent = "-";
        }
        tr.appendChild(tdCoord);

        // Action
        const tdAction = document.createElement("td");
        const impBtn = document.createElement("bim-button") as BUI.Button;
        const isImported = isAlreadyImported(vCmt.text);
        
        if (isImported) {
          impBtn.label = "Imported";
          impBtn.disabled = true;
        } else {
          impBtn.label = "Import";
        }
        
        impBtn.className = "tdvs-import-btn";
        impBtn.addEventListener("click", () => {
          if (!activeViewpointGuid) {
            alert("현재 활성화된 뷰포인트(Viewpoint) 페이지가 없습니다. 왼쪽에서 3D 뷰를 복원(Restore 3D View)하여 뷰포인트가 활성화된 페이지로 이동한 후 다시 시도해 주세요.");
            return;
          }
          
          if (confirm(`이 ${vCmt.type} Comment를 현재 뷰포인트 그룹에 추가하시겠습니까?`)) {
            impBtn.loading = true;
            try {
              const newComment = bcfTopics.addComment(topic.guid, vCmt.text);
              if (newComment) {
                newComment.viewpoint = activeViewpointGuid;
                if (vCmt.author) newComment.author = vCmt.author;
                if (vCmt.date) newComment.date = new Date(vCmt.date);
              }
              renderComments(topic);
              
              impBtn.label = "Imported";
              impBtn.disabled = true;
              alert("성공적으로 추가되었습니다.");
            } catch (err) {
              alert(`추가 실패: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              impBtn.loading = false;
            }
          }
        });
        tdAction.appendChild(impBtn);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableContainer.appendChild(table);
    }
    
    dialog.appendChild(tableContainer);

    const footerDiv = document.createElement("div");
    footerDiv.style.display = "flex";
    footerDiv.style.justifyContent = "flex-end";
    footerDiv.style.flexShrink = "0";

    const footerCloseBtn = document.createElement("bim-button") as BUI.Button;
    footerCloseBtn.label = "Close";
    footerCloseBtn.style.margin = "0";
    footerCloseBtn.addEventListener("click", () => dialog.close());
    footerDiv.appendChild(footerCloseBtn);
    
    dialog.appendChild(footerDiv);

    dialog.addEventListener("click", (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const isClickInside =
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width;
      if (!isClickInside) {
        dialog.close();
      }
    });

    dialog.addEventListener("close", () => {
      dialog.remove();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  };

  const getCommentSnapshotUrl = (comment: any) => {
    if (comment.snapshot) return comment.snapshot;
    if (comment.viewpoint) {
      const viewpoints = components.get(OBC.Viewpoints);
      const vp = viewpoints.list.get(comment.viewpoint);
      if (vp && vp.snapshot) {
        const snapshotData = viewpoints.snapshots.get(vp.snapshot);
        if (snapshotData) {
          const blob = new Blob([snapshotData as any], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          comment.snapshot = url;
          return url;
        }
      }
    }
    return null;
  };

  const renderComments = (topic: EngineTopic, forceSync = false, targetViewpointGuid?: string) => {
    commentsContainer.innerHTML = "";
    paginationContainer.innerHTML = "";

    const mrimsNoBefore = (topic as any).mrimsNo;

    const checkAndActivateTdvsBtn = async (mrimsNo: string) => {
      try {
        const res = await fetch(`/api/bcf/comments?mrimsNo=${mrimsNo}`);
        if (!res.ok) throw new Error();
        const comments = await res.json();

        const localComments = Array.from(topic.comments.values());
        const isAlreadyImported = (text: string) => {
          return localComments.some(lc => lc.comment === text);
        };

        const hasSyncData = comments.some((item: any) => {
          const checkPart = (commentObj: any) => {
            if (!commentObj || !commentObj.comment) return false;
            const parts = commentObj.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
            return parts.some((partText: string) => !isAlreadyImported(partText));
          };
          return checkPart(item.reviewComment) || checkPart(item.solveComment);
        });

        if (hasSyncData) {
          tdvsBtn.disabled = false;
          tdvsBtn.active = true;
          tdvsBtn.style.setProperty("--bim-button--bg", "var(--bim-ui_accent)");
          tdvsBtn.style.setProperty("--bim-button--c", "var(--bim-ui_accent-contrast)");
        } else {
          tdvsBtn.disabled = true;
          tdvsBtn.active = false;
          tdvsBtn.style.removeProperty("--bim-button--bg");
          tdvsBtn.style.removeProperty("--bim-button--c");
        }

        tdvsBtn.onclick = async () => {
          // 중복 체크용 로컬 댓글 목록
          const localComments = Array.from(topic.comments.values());
          const isAlreadyImported = (text: string) => {
            return localComments.some(lc => lc.comment === text);
          };

          // 가상 댓글 평탄화 리스트 생성
          let virtualComments: any[] = [];
          comments.forEach((item: any) => {
            const coord = item.coord || null;
            if (item.reviewComment && item.reviewComment.comment) {
              const parts = item.reviewComment.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
              parts.forEach((part: string) => {
                virtualComments.push({
                  commentNo: item.commentNo,
                  text: part,
                  author: item.reviewComment.author || "",
                  date: item.reviewComment.date,
                  type: "Review",
                  coord: coord
                });
              });
            }
            if (item.solveComment && item.solveComment.comment) {
              const parts = item.solveComment.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
              parts.forEach((part: string) => {
                virtualComments.push({
                  commentNo: item.commentNo,
                  text: part,
                  author: item.solveComment.author || "",
                  date: item.solveComment.date,
                  type: "Solve",
                  coord: coord
                });
              });
            }
          });

          // 이미 수입 완료된 조각 댓글은 모달 리스트에서 아예 제외
          virtualComments = virtualComments.filter(vCmt => !isAlreadyImported(vCmt.text));

          // 모든 viewpoint들의 좌표 정보와 매칭 진행 (없으면 신규 생성)
          const viewpoints = components.get(OBC.Viewpoints);
          const worlds = components.get(OBC.Worlds);
          const world = worlds.list.values().next().value;
          
          const remainingComments: any[] = [];
          let autoImportCount = 0;
          let autoCreatedViewpointCount = 0;
          let firstNewVpGuid: string | null = null;

          for (const vCmt of virtualComments) {
            let matchedVpGuid: string | null = null;

            if (vCmt.coord && vCmt.coord.x !== null && vCmt.coord.y !== null && vCmt.coord.z !== null) {
              // 1. 기존 viewpoint 중에서 좌표 매칭 시도
              for (const vpGuid of topic.viewpoints) {
                const vp = viewpoints.list.get(vpGuid);
                if (vp && vp.camera && vp.camera.camera_view_point) {
                  const localDbX = vp.camera.camera_view_point.x;
                  const localDbY = -vp.camera.camera_view_point.z;
                  const localDbZ = vp.camera.camera_view_point.y;

                  const dx = vCmt.coord.x - localDbX;
                  const dy = vCmt.coord.y - localDbY;
                  const dz = vCmt.coord.z - localDbZ;
                  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                  if (dist < 0.05) {
                    matchedVpGuid = vpGuid;
                    break;
                  }
                }
              }

              // 2. 일치하는 기존 viewpoint가 없다면, 새 viewpoint 생성
              if (!matchedVpGuid) {
                const newVp = viewpoints.create();
                if (world) {
                  newVp.world = world;
                  await newVp.updateCamera();
                  
                  newVp.camera.camera_view_point = {
                    x: vCmt.coord.x,
                    y: vCmt.coord.z,
                    z: -vCmt.coord.y
                  };
                  newVp.camera.camera_direction = { x: 0, y: 0, z: -1 };
                  newVp.camera.camera_up_vector = { x: 0, y: 1, z: 0 };
                }
                topic.viewpoints.add(newVp.guid);
                matchedVpGuid = newVp.guid;
                autoCreatedViewpointCount++;
                if (!firstNewVpGuid) {
                  firstNewVpGuid = newVp.guid;
                }
              }
            }

            if (matchedVpGuid) {
              // 텍스트 중복 방지를 한 번 더 확인
              const currentLocalComments = Array.from(topic.comments.values());
              if (currentLocalComments.some(lc => lc.comment === vCmt.text)) {
                continue;
              }
              const newComment = bcfTopics.addComment(topic.guid, vCmt.text);
              if (newComment) {
                newComment.viewpoint = matchedVpGuid;
                if (vCmt.author) newComment.author = vCmt.author;
                if (vCmt.date) newComment.date = new Date(vCmt.date);
                autoImportCount++;
              }
            } else {
              remainingComments.push(vCmt);
            }
          }

          if (autoImportCount > 0) {
            isAddingNewComment = false;
            // UI 갱신 및 신규 생성된 viewpoint 페이지로 포커스
            renderComments(topic, false, firstNewVpGuid || undefined);
            let alertMsg = `${autoImportCount}개의 조각 댓글이 자동으로 추가되었습니다.`;
            if (autoCreatedViewpointCount > 0) {
              alertMsg += ` (새로운 뷰포인트 ${autoCreatedViewpointCount}개 생성됨)`;
            }
            alert(alertMsg);
          }

          // 남은 매칭되지 않는 조각 댓글만 모달로 표시
          if (remainingComments.length > 0) {
            showTdvsCommentsModal(remainingComments, topic);
          } else if (autoImportCount === 0) {
            alert("동기화할 새로운 조각 댓글이 없거나, 토픽 내 viewpoint 좌표와 매칭되는 조각 댓글이 없습니다.");
          }
        };
      } catch (err) {
        console.error("Error checking TDVS comments sync state:", err);
        tdvsBtn.disabled = true;
        tdvsBtn.active = false;
        tdvsBtn.style.removeProperty("--bim-button--bg");
        tdvsBtn.style.removeProperty("--bim-button--c");
        tdvsBtn.onclick = null;
      }
    };

    if (mrimsNoBefore) {
      tdvsBtn.style.display = "flex";
      checkAndActivateTdvsBtn(mrimsNoBefore);
    } else {
      tdvsBtn.style.display = "none";
      tdvsBtn.disabled = true;
      tdvsBtn.active = false;
    }

    if (forceSync) {
      syncTopicWithTDVS(components, bcfTopics).then(() => {
        const mrimsNoAfter = (topic as any).mrimsNo;
        if (mrimsNoAfter) {
          tdvsBtn.style.display = "flex";
          checkAndActivateTdvsBtn(mrimsNoAfter);
        }
      });
    }

    // 코멘트들을 시간 순으로 정렬
    const commentsArray = Array.from(topic.comments.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

    // Viewpoint 기준으로 그룹화 (Viewpoint가 없는 것은 각각 개별 그룹으로 분리)
    const groups: { viewpointGuid: string | null, comments: any[] }[] = [];
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

    // 코멘트가 없는 고아(Orphan) 뷰포인트 찾기
    const orphanViewpoints: string[] = [];
    for (const vpGuid of topic.viewpoints) {
      if (!vpMap.has(vpGuid)) {
        orphanViewpoints.push(vpGuid);
      }
    }

    // 첫 번째 Orphan 뷰포인트는 대표 뷰포인트(viewpoint.bcfv, snapshot.png)이므로 Comments 탭에서 제외하고
    // 두 번째부터만 그룹에 추가합니다.
    for (let i = 1; i < orphanViewpoints.length; i++) {
      groups.push({ viewpointGuid: orphanViewpoints[i], comments: [] });
    }

    // 각 그룹의 가장 처음 작성된 코멘트 시간을 기준으로 그룹 정렬
    groups.sort((a, b) => {
      const timeA = a.comments.length > 0 ? a.comments[0].date.getTime() : 0;
      const timeB = b.comments.length > 0 ? b.comments[0].date.getTime() : 0;
      return timeA - timeB;
    });

    // 표시할 그룹이 전혀 없다면 (코멘트도 없고, 두 번째 뷰포인트도 없다면) 새 코멘트 강제 진입
    if (groups.length === 0 && !isAddingNewComment) {
      isAddingNewComment = true;
    }

    const totalPages = groups.length;

    if (targetViewpointGuid) {
      const idx = groups.findIndex(g => g.viewpointGuid === targetViewpointGuid);
      if (idx !== -1) {
        currentCommentPage = idx;
      }
    }

    const renderPaginationControls = () => {
      paginationContainer.innerHTML = "";
      
      const prevBtn = document.createElement("bim-button") as BUI.Button;
      prevBtn.icon = appIcons.BACK;
      prevBtn.style.margin = "0";
      prevBtn.disabled = isAddingNewComment || currentCommentPage === 0;
      prevBtn.addEventListener("click", () => {
        currentCommentPage--;
        renderComments(topic);
      });

      const pageInfo = document.createElement("bim-label");
      pageInfo.textContent = isAddingNewComment 
          ? (totalPages > 0 ? `New / ${totalPages}` : `1 / 1`)
          : `${currentCommentPage + 1} / ${totalPages}`;
      pageInfo.style.fontSize = "0.75rem";

      const nextBtn = document.createElement("bim-button") as BUI.Button;
      nextBtn.icon = appIcons.FORWARD;
      nextBtn.style.margin = "0";
      nextBtn.disabled = isAddingNewComment || currentCommentPage >= totalPages - 1;
      nextBtn.addEventListener("click", () => {
        currentCommentPage++;
        renderComments(topic);
      });

      const addBtn = document.createElement("bim-button") as BUI.Button;
      addBtn.icon = appIcons.ADD;
      addBtn.style.margin = "0";
      addBtn.title = "Add New Comment with Viewpoint";
      addBtn.disabled = isAddingNewComment;
      addBtn.addEventListener("click", () => {
        isAddingNewComment = true;
        pendingCommentViewpoint = null;
        pendingCommentSnapshot = null;
        renderComments(topic);
      });

      if (totalPages > 0) {
          paginationContainer.append(prevBtn, pageInfo, nextBtn, tdvsBtn, addBtn);
      } else {
          // totalPages가 0인 상황(뷰포인트가 없을 때)에도 Sync 버튼은 항상 보여줌
          paginationContainer.append(tdvsBtn);
          if (!isAddingNewComment) paginationContainer.append(addBtn);
      }
    };

    if (isAddingNewComment) {
      activeViewpointGuid = null;
      const pageWrapper = document.createElement("div");
      pageWrapper.style.display = "flex";
      pageWrapper.style.gap = "0.5rem";
      pageWrapper.style.height = "100%";
      pageWrapper.style.minHeight = "0";
      pageWrapper.style.overflow = "hidden";

      // 1. Snapshot Wrapper Placeholder
      const snapshotWrapper = document.createElement("div");
      snapshotWrapper.style.width = "12rem";
      snapshotWrapper.style.flexShrink = "0";
      snapshotWrapper.style.display = "flex";
      snapshotWrapper.style.flexDirection = "column";
      snapshotWrapper.style.gap = "0.5rem";
      snapshotWrapper.style.minHeight = "0";
      snapshotWrapper.style.overflowY = "auto";
      snapshotWrapper.style.overflowX = "hidden";
      snapshotWrapper.classList.add("custom-scrollbar");

      if (pendingCommentSnapshot) {
        const img = document.createElement("img");
        img.src = pendingCommentSnapshot;
        img.style.width = "100%";
        img.style.aspectRatio = "4 / 3";
        img.style.flex = "none";
        img.style.boxSizing = "border-box";
        img.style.objectFit = "contain";
        img.style.borderRadius = "0.25rem";
        img.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
        img.style.backgroundColor = "var(--bim-ui_bg-base, transparent)";
        img.style.cursor = "zoom-in";
        img.style.transition = "filter 0.2s";
        img.onmouseover = () => img.style.filter = "brightness(1.1)";
        img.onmouseout = () => img.style.filter = "none";
        img.addEventListener("click", () => showLightbox(pendingCommentSnapshot!));
        snapshotWrapper.append(img);
      } else {
        const infoCard = document.createElement("div");
        infoCard.style.border = "1px dashed var(--bim-ui_bg-contrast-40)";
        infoCard.style.padding = "1rem";
        infoCard.style.borderRadius = "0.25rem";
        infoCard.style.backgroundColor = "var(--bim-ui_bg-base, transparent)";
        infoCard.style.display = "flex";
        infoCard.style.flexDirection = "column";
        infoCard.style.alignItems = "center";
        infoCard.style.justifyContent = "center";
        infoCard.style.gap = "0.5rem";
        infoCard.style.flex = "none";
        infoCard.style.aspectRatio = "4 / 3";
        infoCard.style.color = "var(--bim-ui_gray-10)";
        infoCard.style.boxSizing = "border-box";
        infoCard.style.minHeight = "0";
        infoCard.style.textAlign = "center";

        const infoIcon = document.createElement("bim-label") as any;
        infoIcon.icon = appIcons.CAMERA;
        infoIcon.style.setProperty("--bim-icon--fz", "2rem");

        const infoText = document.createElement("bim-label");
        infoText.textContent = "Manual Capture Required\n(Click Capture)";
        infoText.style.fontStyle = "italic";
        infoText.style.fontSize = "0.75rem";
        infoText.style.whiteSpace = "pre-wrap";
        infoCard.append(infoIcon, infoText);
        snapshotWrapper.append(infoCard);
      }

      const btnContainer = document.createElement("div");
      btnContainer.style.display = "flex";
      btnContainer.style.gap = "0.25rem";
      btnContainer.style.width = "100%";
      btnContainer.style.marginBottom = "auto";
      btnContainer.style.flex = "none";

      const fakeViewBtn = document.createElement("bim-button") as BUI.Button;
      fakeViewBtn.title = "Restore";
      fakeViewBtn.icon = appIcons.FOCUS;
      fakeViewBtn.style.margin = "0";
      fakeViewBtn.style.flex = "1";
      fakeViewBtn.style.boxSizing = "border-box";
      fakeViewBtn.disabled = true;

      const captureBtn = document.createElement("bim-button") as BUI.Button;
      captureBtn.title = "Capture";
      captureBtn.icon = appIcons.CAMERA;
      captureBtn.style.margin = "0";
      captureBtn.style.flex = "1";
      captureBtn.style.boxSizing = "border-box";
      captureBtn.addEventListener("click", async () => {
        captureBtn.loading = true;
        const { viewpoint, snapshot } = await bcfTopics.captureViewpoint();
        pendingCommentViewpoint = viewpoint;
        pendingCommentSnapshot = snapshot;
        captureBtn.loading = false;
        renderComments(topic);
      });

      const importBtn = document.createElement("bim-button") as BUI.Button;
      importBtn.title = "Import";
      importBtn.icon = appIcons.IMPORT;
      importBtn.style.margin = "0";
      importBtn.style.flex = "1";
      importBtn.style.boxSizing = "border-box";
      importBtn.addEventListener("click", () => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/png, image/jpeg";
        fileInput.onchange = async (e: Event) => {
          const input = e.target as HTMLInputElement;
          if (input.files && input.files[0]) {
            importBtn.loading = true;
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = async (event) => {
              const base64Snapshot = event.target?.result as string;
              const { viewpoint } = await bcfTopics.captureViewpoint();
              pendingCommentViewpoint = viewpoint;
              pendingCommentSnapshot = base64Snapshot;
              importBtn.loading = false;
              renderComments(topic);
            };
            reader.readAsDataURL(file);
          }
        };
        fileInput.click();
      });

      btnContainer.append(fakeViewBtn, captureBtn, importBtn);
      snapshotWrapper.append(btnContainer);

      // 2. Comments List Wrapper Placeholder
      const commentsListWrapper = document.createElement("div");
      commentsListWrapper.style.flex = "1";
      commentsListWrapper.style.minWidth = "0";
      commentsListWrapper.style.display = "flex";
      commentsListWrapper.style.flexDirection = "column";
      commentsListWrapper.style.gap = "0.5rem";

      const replySection = document.createElement("div");
      replySection.style.display = "flex";
      replySection.style.flexDirection = "row";
      replySection.style.alignItems = "flex-end";
      replySection.style.gap = "0.25rem";
      replySection.style.flexShrink = "0";

      const replyInput = document.createElement("bim-text-input") as BUI.TextInput;
      replyInput.label = `${appState.currentUser} | ${new Date().toLocaleString()}`;
      replyInput.vertical = true;
      replyInput.type = "area";
      replyInput.rows = 1;
      replyInput.resize = "vertical";
      replyInput.style.flex = "1";

      const replyBtn = document.createElement("bim-button") as BUI.Button;
      replyBtn.icon = appIcons.ADD;
      replyBtn.style.flex = "0";
      replyBtn.style.margin = "0";
      replyBtn.style.height = "2rem";
      replyBtn.title = "Add Comment";
      replyBtn.addEventListener("click", async () => {
        if (!replyInput.value.trim()) return;
        if (!pendingCommentViewpoint) {
           alert("코멘트를 추가하려면 먼저 [Capture] 또는 [Import] 버튼을 눌러 뷰를 캡처하거나 이미지를 업로드해야 합니다.");
           return;
        }
        replyBtn.loading = true;
        bcf.config.author = appState.currentUser;

        topic.viewpoints.add(pendingCommentViewpoint.guid);

        const newComment = bcfTopics.addComment(topic.guid, replyInput.value.trim());
        if (newComment) {
            newComment.viewpoint = pendingCommentViewpoint.guid;
            if (pendingCommentSnapshot) (newComment as any).snapshot = pendingCommentSnapshot;
        }
        
        isAddingNewComment = false;
        pendingCommentViewpoint = null;
        pendingCommentSnapshot = null;
        currentCommentPage = Number.MAX_SAFE_INTEGER;
        renderComments(topic);
      });

      const cancelBtn = document.createElement("bim-button") as BUI.Button;
      cancelBtn.icon = appIcons.CLEAR;
      cancelBtn.style.flex = "0";
      cancelBtn.style.margin = "0";
      cancelBtn.style.height = "2rem";

      if (totalPages > 0) {
          cancelBtn.title = "Cancel";
          cancelBtn.addEventListener("click", () => {
              isAddingNewComment = false;
              pendingCommentViewpoint = null;
              pendingCommentSnapshot = null;
              renderComments(topic);
          });
      } else {
          cancelBtn.title = "Clear";
          cancelBtn.addEventListener("click", () => {
              replyInput.value = "";
          });
      }
      
      replySection.append(replyInput, replyBtn, cancelBtn);
      commentsListWrapper.append(replySection);
      pageWrapper.append(snapshotWrapper, commentsListWrapper);
      commentsContainer.append(pageWrapper);

      renderPaginationControls();
      return;
    }

    if (currentCommentPage >= totalPages) currentCommentPage = Math.max(0, totalPages - 1);
    const currentGroup = groups[currentCommentPage];
    activeViewpointGuid = currentGroup ? currentGroup.viewpointGuid : null;

    // 1. Viewpoint 페이지의 전체 레이아웃 컨테이너
    const pageWrapper = document.createElement("div");
    pageWrapper.style.display = "flex";
    pageWrapper.style.gap = "0.5rem";
    pageWrapper.style.height = "100%";
    pageWrapper.style.minHeight = "0";
    pageWrapper.style.overflow = "hidden";

    // 1. 고정된 스냅샷 이미지 (그룹의 첫번째 코멘트 기준)
    let snapshotUrl: string | null = null;
    if (currentGroup.comments.length > 0) {
      snapshotUrl = getCommentSnapshotUrl(currentGroup.comments[0]);
    }
    if (!snapshotUrl && currentGroup.viewpointGuid) {
      // 코멘트가 없는 경우 뷰포인트 GUID를 래핑하여 기존 스냅샷 추출 로직을 재사용
      snapshotUrl = getCommentSnapshotUrl({ viewpoint: currentGroup.viewpointGuid });
    }
    if (snapshotUrl || currentGroup.viewpointGuid) {
      const snapshotWrapper = document.createElement("div");
      snapshotWrapper.style.width = "12rem";
      snapshotWrapper.style.flexShrink = "0";
      snapshotWrapper.style.display = "flex";
      snapshotWrapper.style.flexDirection = "column";
      snapshotWrapper.style.gap = "0.5rem";
      snapshotWrapper.style.minHeight = "0";
      snapshotWrapper.style.overflowY = "auto";
      snapshotWrapper.style.overflowX = "hidden";
      snapshotWrapper.classList.add("custom-scrollbar");
      
      if (snapshotUrl) {
        const validSnapshotUrl = snapshotUrl;
        const img = document.createElement("img");
        img.src = snapshotUrl;
        img.style.width = "100%";
        img.style.aspectRatio = "4 / 3";
        img.style.flex = "none";
        img.style.boxSizing = "border-box";
        img.style.objectFit = "contain";
        img.style.borderRadius = "0.25rem";
        img.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
        img.style.backgroundColor = "var(--bim-ui_bg-base, transparent)";
        img.style.cursor = "zoom-in";
        img.style.transition = "filter 0.2s";
        img.onmouseover = () => img.style.filter = "brightness(1.1)";
        img.onmouseout = () => img.style.filter = "none";
        img.addEventListener("click", () => showLightbox(validSnapshotUrl));
        snapshotWrapper.append(img);
      } else {
        // 스냅샷이 없는 경우 플레이스홀더 표시
        const noImgCard = document.createElement("div");
        noImgCard.style.border = "1px dashed var(--bim-ui_bg-contrast-40)";
        noImgCard.style.padding = "1rem";
        noImgCard.style.borderRadius = "0.25rem";
        noImgCard.style.backgroundColor = "var(--bim-ui_bg-base, transparent)";
        noImgCard.style.display = "flex";
        noImgCard.style.flexDirection = "column";
        noImgCard.style.alignItems = "center";
        noImgCard.style.justifyContent = "center";
        noImgCard.style.gap = "0.5rem";
        noImgCard.style.flex = "none";
        noImgCard.style.aspectRatio = "4 / 3";
        noImgCard.style.color = "var(--bim-ui_gray-10)";
        noImgCard.style.boxSizing = "border-box";
        noImgCard.style.minHeight = "0";
        noImgCard.style.textAlign = "center";

        const noImgIcon = document.createElement("bim-label") as any;
        noImgIcon.icon = appIcons.CAMERA;
        noImgIcon.style.setProperty("--bim-icon--fz", "2rem");

        const noImgText = document.createElement("bim-label");
        noImgText.textContent = "No Image";
        noImgText.style.fontStyle = "italic";
        noImgText.style.fontSize = "0.75rem";
        noImgCard.append(noImgIcon, noImgText);
        snapshotWrapper.append(noImgCard);
      }

      // 해당 그룹에 Viewpoint가 존재하면 복원, 캡처, 가져오기 및 삭제 버튼을 추가
      if (currentGroup.viewpointGuid) {
        const btnContainer = document.createElement("div");
        btnContainer.style.display = "flex";
        btnContainer.style.gap = "0.25rem";
        btnContainer.style.width = "100%";
        btnContainer.style.flex = "none";

        const viewBtn = document.createElement("bim-button") as BUI.Button;
        viewBtn.title = "Restore";
        viewBtn.icon = appIcons.FOCUS;
        viewBtn.style.margin = "0";
        viewBtn.style.flex = "1";
        viewBtn.style.boxSizing = "border-box";
        viewBtn.addEventListener("click", async () => {
          viewBtn.loading = true;
          await bcfTopics.restoreViewpoint(topic, { viewpointGuid: currentGroup.viewpointGuid });
          viewBtn.loading = false;
        });

        const captureBtn = document.createElement("bim-button") as BUI.Button;
        captureBtn.title = "Capture";
        captureBtn.icon = appIcons.CAMERA;
        captureBtn.style.margin = "0";
        captureBtn.style.flex = "1";
        captureBtn.style.boxSizing = "border-box";
        captureBtn.addEventListener("click", async () => {
          captureBtn.loading = true;
          try {
            const { viewpoint, snapshot } = await bcfTopics.captureViewpoint();
            const viewpoints = components.get(OBC.Viewpoints);
            const vp = currentGroup.viewpointGuid ? viewpoints.list.get(currentGroup.viewpointGuid) : null;
            if (vp) {
              copyViewpoint(viewpoint, vp);
              if (snapshot) {
                const base64Data = snapshot.replace(/^data:image\/\w+;base64,/, "");
                const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                viewpoints.snapshots.set(vp.guid, bytes);
                vp.snapshot = vp.guid;
                currentGroup.comments.forEach((c: any) => c.snapshot = null);
              }
            }
            renderComments(topic);
            alert("뷰포인트가 현재 3D 뷰 상태로 업데이트되었습니다.");
          } catch (err) {
            alert(`캡처 실패: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            captureBtn.loading = false;
          }
        });

        const importBtn = document.createElement("bim-button") as BUI.Button;
        importBtn.title = "Import";
        importBtn.icon = appIcons.IMPORT;
        importBtn.style.margin = "0";
        importBtn.style.flex = "1";
        importBtn.style.boxSizing = "border-box";
        importBtn.addEventListener("click", () => {
          const fileInput = document.createElement("input");
          fileInput.type = "file";
          fileInput.accept = "image/png, image/jpeg";
          fileInput.onchange = async (e: Event) => {
            const input = e.target as HTMLInputElement;
            if (input.files && input.files[0]) {
              importBtn.loading = true;
              const file = input.files[0];
              const reader = new FileReader();
              reader.onload = async (event) => {
                try {
                  const base64Snapshot = event.target?.result as string;
                  const { viewpoint } = await bcfTopics.captureViewpoint();
                  const viewpoints = components.get(OBC.Viewpoints);
                  const vp = currentGroup.viewpointGuid ? viewpoints.list.get(currentGroup.viewpointGuid) : null;
                  if (vp) {
                    copyViewpoint(viewpoint, vp);
                    if (base64Snapshot) {
                      const base64Data = base64Snapshot.replace(/^data:image\/\w+;base64,/, "");
                      const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                      viewpoints.snapshots.set(vp.guid, bytes);
                      vp.snapshot = vp.guid;
                      currentGroup.comments.forEach((c: any) => c.snapshot = null);
                    }
                  }
                  renderComments(topic);
                  alert("뷰포인트 카메라와 이미지가 업로드한 스냅샷으로 업데이트되었습니다.");
                } catch (err) {
                  alert(`가져오기 실패: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  importBtn.loading = false;
                }
              };
              reader.readAsDataURL(file);
            }
          };
          fileInput.click();
        });

        btnContainer.append(viewBtn, captureBtn, importBtn);
        snapshotWrapper.append(btnContainer);

        const deleteVpBtn = document.createElement("bim-button") as BUI.Button;
        deleteVpBtn.label = "Delete Viewpoint";
        deleteVpBtn.icon = appIcons.DELETE;
        deleteVpBtn.style.margin = "0";
        deleteVpBtn.style.flex = "none";
        deleteVpBtn.style.marginTop = "0.25rem";
        deleteVpBtn.style.width = "100%";
        deleteVpBtn.style.boxSizing = "border-box";
        deleteVpBtn.style.setProperty("--bim-button--bg", "#f44336");
        deleteVpBtn.style.setProperty("--bim-button--c", "#ffffff");
        deleteVpBtn.addEventListener("click", () => {
          if (confirm("이 뷰포인트와 여기에 속한 모든 댓글을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
            deleteVpBtn.loading = true;
            try {
              for (const comment of currentGroup.comments) {
                bcfTopics.deleteComment(topic.guid, comment.guid);
              }
              if (currentGroup.viewpointGuid) {
                topic.viewpoints.delete(currentGroup.viewpointGuid);
                const viewpoints = components.get(OBC.Viewpoints);
                viewpoints.list.delete(currentGroup.viewpointGuid);
              }
              if (currentCommentPage >= totalPages - 1) {
                currentCommentPage = Math.max(0, totalPages - 2);
              }
              renderComments(topic);
              alert("뷰포인트와 관련 댓글이 삭제되었습니다.");
            } catch (err) {
              alert(`삭제 실패: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              deleteVpBtn.loading = false;
            }
          }
        });
        snapshotWrapper.append(deleteVpBtn);
      }

      pageWrapper.append(snapshotWrapper);
    }

    // 2. 스크롤 가능한 코멘트 목록과 답글 폼을 담을 컨테이너
    const commentsListWrapper = document.createElement("div");
    commentsListWrapper.style.flex = "1";
    commentsListWrapper.style.minWidth = "0";
    commentsListWrapper.style.display = "flex";
    commentsListWrapper.style.flexDirection = "column";
    commentsListWrapper.style.gap = "0.5rem";
    
    const commentsScroll = document.createElement("div");
    commentsScroll.style.flex = "1";
    commentsScroll.style.minHeight = "0";
    commentsScroll.style.overflowY = "auto";
    commentsScroll.style.display = "flex";
    commentsScroll.style.flexDirection = "column";
    commentsScroll.style.gap = "0.5rem";
    commentsScroll.classList.add("custom-scrollbar");

    // 3. 각 Comment 카드 렌더링
    for (const comment of currentGroup.comments) {
      const commentRow = document.createElement("div");
      commentRow.style.display = "flex";
      commentRow.style.flexDirection = "row";
      commentRow.style.alignItems = "flex-end";
      commentRow.style.gap = "0.25rem";
      commentRow.style.flexShrink = "0";
      commentRow.style.width = "100%";

      const commentCard = document.createElement("div");
      commentCard.style.border = "1px solid var(--bim-ui_bg-contrast, gray)";
      commentCard.style.padding = "0.5rem";
      commentCard.style.borderRadius = "0.25rem";
      commentCard.style.backgroundColor = "var(--bim-ui_bg-base, transparent)";
      commentCard.style.display = "flex";
      commentCard.style.flexDirection = "column";
      commentCard.style.gap = "0.25rem";
      commentCard.style.flex = "1";
      commentCard.style.minWidth = "0";
      commentCard.style.color = "var(--bim-ui_bg-contrast-100)";

      const cardHeader = document.createElement("div");
      cardHeader.style.display = "flex";
      cardHeader.style.justifyContent = "space-between";
      cardHeader.style.alignItems = "center";
      cardHeader.style.fontSize = "0.75rem";
      cardHeader.style.opacity = "0.8";

      const author = comment.modifiedAuthor || comment.author || "Admin";
      const rawDate = comment.modifiedDate || comment.date;
      const date = rawDate instanceof Date ? rawDate : new Date(rawDate);

      const authorSpan = document.createElement("span");
      authorSpan.innerHTML = `<b>${author}</b>`;

      const dateSpan = document.createElement("span");
      dateSpan.textContent = date.toLocaleString();

      cardHeader.append(authorSpan, dateSpan);

      const cardBody = document.createElement("div");
      cardBody.textContent = comment.comment;
      cardBody.style.whiteSpace = "pre-wrap";
      cardBody.style.wordBreak = "break-word";
      cardBody.style.fontSize = "0.75rem";
      cardBody.style.lineHeight = "1.4";

      const editInput = document.createElement("bim-text-input") as BUI.TextInput;
      editInput.value = comment.comment;
      editInput.type = "area";
      editInput.rows = 2;
      editInput.style.fontSize = "0.75rem";
      editInput.style.display = "none";

      commentCard.append(cardHeader, cardBody, editInput);

      const actionContainer = document.createElement("div");
      actionContainer.style.display = "flex";
      actionContainer.style.flexDirection = "row";
      actionContainer.style.gap = "0.25rem";
      actionContainer.style.flexShrink = "0";

      const editBtn = document.createElement("bim-button") as BUI.Button;
      editBtn.icon = appIcons.EDIT;
      editBtn.style.flex = "0";
      editBtn.style.margin = "0";
      editBtn.style.height = "2rem";
      editBtn.title = "Edit Comment";

      const deleteBtn = document.createElement("bim-button") as BUI.Button;
      deleteBtn.icon = appIcons.DELETE;
      deleteBtn.style.flex = "0";
      deleteBtn.style.margin = "0";
      deleteBtn.style.height = "2rem";
      deleteBtn.title = "Delete Comment";

      const saveBtn = document.createElement("bim-button") as BUI.Button;
      saveBtn.icon = appIcons.SAVE || "/icons/material-symbols--save.svg";
      saveBtn.style.flex = "0";
      saveBtn.style.margin = "0";
      saveBtn.style.height = "2rem";
      saveBtn.title = "Save Edit";
      saveBtn.style.display = "none";

      const cancelEditBtn = document.createElement("bim-button") as BUI.Button;
      cancelEditBtn.icon = appIcons.CLEAR;
      cancelEditBtn.style.flex = "0";
      cancelEditBtn.style.margin = "0";
      cancelEditBtn.style.height = "2rem";
      cancelEditBtn.title = "Cancel Edit";
      cancelEditBtn.style.display = "none";

      actionContainer.append(editBtn, deleteBtn, saveBtn, cancelEditBtn);
      commentRow.append(commentCard, actionContainer);

      editBtn.addEventListener("click", () => {
        cardBody.style.display = "none";
        editInput.style.display = "block";
        editBtn.style.display = "none";
        deleteBtn.style.display = "none";
        saveBtn.style.display = "flex";
        cancelEditBtn.style.display = "flex";
        editInput.value = comment.comment;
        editInput.focus();
      });

      cancelEditBtn.addEventListener("click", () => {
        cardBody.style.display = "block";
        editInput.style.display = "none";
        editBtn.style.display = "flex";
        deleteBtn.style.display = "flex";
        saveBtn.style.display = "none";
        cancelEditBtn.style.display = "none";
      });

      saveBtn.addEventListener("click", () => {
        const updatedText = editInput.value.trim();
        if (!updatedText) {
          alert("댓글 내용을 입력해 주세요.");
          return;
        }

        saveBtn.loading = true;
        try {
          bcfTopics.updateComment(topic.guid, comment.guid, updatedText);
          renderComments(topic);
        } catch (err) {
          alert(`댓글 수정 실패: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          saveBtn.loading = false;
        }
      });

      deleteBtn.addEventListener("click", () => {
        if (confirm("이 댓글을 정말로 삭제하시겠습니까?")) {
          deleteBtn.loading = true;
          try {
            bcfTopics.deleteComment(topic.guid, comment.guid);
            renderComments(topic);
          } catch (err) {
            alert(`댓글 삭제 실패: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            deleteBtn.loading = false;
          }
        }
      });

      commentsScroll.append(commentRow);
    }
    
    commentsListWrapper.append(commentsScroll);

    // 4. "Add Reply" 섹션 추가 (뷰포인트가 있는 페이지에만)
    if (currentGroup.viewpointGuid) {
      const replySection = document.createElement("div");
      replySection.style.display = "flex";
      replySection.style.flexDirection = "row";
      replySection.style.alignItems = "flex-end";
      replySection.style.gap = "0.25rem";
      replySection.style.paddingTop = "0.5rem";
      replySection.style.borderTop = "1px dashed var(--bim-ui_bg-contrast-20)";
      replySection.style.flexShrink = "0";

      const replyInput = document.createElement("bim-text-input") as BUI.TextInput;
      replyInput.label = `${appState.currentUser} | ${new Date().toLocaleString()}`;
      replyInput.vertical = true;
      replyInput.type = "area";
      replyInput.rows = 1;
      replyInput.resize = "vertical";
      replyInput.style.flex = "1";

      const replyBtn = document.createElement("bim-button") as BUI.Button;
      replyBtn.icon = appIcons.ADD;
      replyBtn.style.flex = "0";
      replyBtn.style.margin = "0";
      replyBtn.style.height = "2rem";
      replyBtn.title = "Add Comment";
      replyBtn.addEventListener("click", () => {
        if (!replyInput.value.trim()) return;
        replyBtn.loading = true;
        bcf.config.author = appState.currentUser;
        const newComment = bcfTopics.addComment(topic.guid, replyInput.value.trim());
        if (newComment) newComment.viewpoint = currentGroup.viewpointGuid;
        renderComments(topic);
      });

      const cancelBtn = document.createElement("bim-button") as BUI.Button;
      cancelBtn.icon = appIcons.CLEAR;
      cancelBtn.style.flex = "0";
      cancelBtn.style.margin = "0";
      cancelBtn.style.height = "2rem";
      cancelBtn.title = "Clear";
      cancelBtn.addEventListener("click", () => {
        replyInput.value = "";
      });

      replySection.append(replyInput, replyBtn, cancelBtn);
      commentsScroll.append(replySection);
    }

    pageWrapper.append(commentsListWrapper);
    commentsContainer.append(pageWrapper);

    renderPaginationControls();
  };

  // Comments UI Wrapper 생성
  const commentsWrapper = document.createElement("div");
  commentsWrapper.style.display = "flex";
  commentsWrapper.style.flexDirection = "column";
  commentsWrapper.style.height = "100%";
  commentsWrapper.style.minHeight = "0";

  const commentsHeaderWrapper = document.createElement("div");
  commentsHeaderWrapper.style.display = "flex";
  commentsHeaderWrapper.style.justifyContent = "space-between";
  commentsHeaderWrapper.style.alignItems = "center";
  commentsHeaderWrapper.style.flexShrink = "0";
  commentsHeaderWrapper.style.gap = "0.5rem";
  
  const commentsHeader = document.createElement("bim-label");
  commentsHeader.textContent = "Comments";
  commentsHeader.style.fontWeight = "bold";

  commentsHeaderWrapper.append(commentsHeader, paginationContainer);
  commentsWrapper.append(commentsHeaderWrapper, commentsContainer);

  const resetState = () => {
    isAddingNewComment = false;
    currentCommentPage = 0;
    pendingCommentViewpoint = null;
    pendingCommentSnapshot = null;
  };

  return {
    ui: commentsWrapper,
    render: renderComments,
    resetState
  };
};
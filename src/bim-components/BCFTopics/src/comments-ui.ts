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



  const commentsContainer = document.createElement("div");
  commentsContainer.style.display = "flex";
  commentsContainer.style.flexDirection = "column";
  commentsContainer.style.gap = "0.5rem";
  commentsContainer.style.flex = "1";
  commentsContainer.style.minHeight = "0";
  commentsContainer.style.overflow = "hidden";
  commentsContainer.style.marginBottom = "0.5rem";
  commentsContainer.style.paddingRight = "0.5rem";
  commentsContainer.style.flexDirection = "row";

  let currentCommentPage = 0;
  let isAddingNewComment = false;

  let pendingCommentViewpoint: any = null;
  let pendingCommentSnapshot: string | null = null;

  // Cache variables for TDVS comments
  let tdvsComments: any[] = [];
  let isFetchingTdvsComments = false;
  let lastFetchedTopicGuid: string | null = null;



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

    const mrimsNo = (topic as any).mrimsNo;
    if (mrimsNo && (lastFetchedTopicGuid !== topic.guid || forceSync)) {
      if (!isFetchingTdvsComments) {
        isFetchingTdvsComments = true;
        fetch(`/api/bcf/comments?mrimsNo=${mrimsNo}`)
          .then(res => res.json())
          .then(data => {
            tdvsComments = data;
            lastFetchedTopicGuid = topic.guid;
            isFetchingTdvsComments = false;
            renderComments(topic);
          })
          .catch(err => {
            console.error("Error fetching TDVS comments:", err);
            isFetchingTdvsComments = false;
          });
      }
    } else if (!mrimsNo) {
      tdvsComments = [];
      lastFetchedTopicGuid = topic.guid;
    }

    const localCommentsForFlat = Array.from(topic.comments.values());
    const isAlreadyImported = (text: string) => {
      return localCommentsForFlat.some(lc => lc.comment === text);
    };

    const flatTdvsComments: any[] = [];
    tdvsComments.forEach((item: any) => {
      const coord = item.coord || null;
      if (item.reviewComment && item.reviewComment.comment) {
        const parts = item.reviewComment.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
        parts.forEach((part: string) => {
          if (!isAlreadyImported(part)) {
            flatTdvsComments.push({
              commentNo: item.commentNo,
              text: part,
              author: item.reviewComment.author || "",
              date: item.reviewComment.date,
              type: "Review",
              coord: coord
            });
          }
        });
      }
      if (item.solveComment && item.solveComment.comment) {
        const parts = item.solveComment.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
        parts.forEach((part: string) => {
          if (!isAlreadyImported(part)) {
            flatTdvsComments.push({
              commentNo: item.commentNo,
              text: part,
              author: item.solveComment.author || "",
              date: item.solveComment.date,
              type: "Solve",
              coord: coord
            });
          }
        });
      }
    });

    const viewpoints = components.get(OBC.Viewpoints);

    const getMatchingServerComments = (vpGuid: string | null) => {
      if (!vpGuid) return [];
      const vp = viewpoints.list.get(vpGuid);
      if (!vp || !vp.camera || !vp.camera.camera_view_point) return [];

      const localDbX = vp.camera.camera_view_point.x;
      const localDbY = -vp.camera.camera_view_point.z;
      const localDbZ = vp.camera.camera_view_point.y;

      return flatTdvsComments.filter(vCmt => {
        if (!vCmt.coord || vCmt.coord.x === null || vCmt.coord.y === null || vCmt.coord.z === null) return false;
        const dx = vCmt.coord.x - localDbX;
        const dy = vCmt.coord.y - localDbY;
        const dz = vCmt.coord.z - localDbZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return dist < 0.05;
      });
    };

    const leftPane = document.createElement("div");
    leftPane.style.width = "13rem";
    leftPane.style.flexShrink = "0";
    leftPane.style.display = "flex";
    leftPane.style.flexDirection = "column";
    leftPane.style.borderRight = "1px solid var(--bim-ui_bg-contrast-20)";
    leftPane.style.paddingRight = "0.5rem";
    leftPane.style.gap = "0.5rem";
    leftPane.style.minHeight = "0";

    const leftToolbar = document.createElement("div");
    leftToolbar.style.display = "flex";
    leftToolbar.style.gap = "0.25rem";
    leftToolbar.style.flexShrink = "0";

    const generalSyncBtn = document.createElement("bim-button") as BUI.Button;
    generalSyncBtn.label = "Sync All";
    generalSyncBtn.icon = appIcons.REFRESH;
    generalSyncBtn.style.flex = "1";
    generalSyncBtn.style.margin = "0";
    generalSyncBtn.title = "Sync all comments and viewpoints from TDVS";

    if (mrimsNo) {
      generalSyncBtn.disabled = false;

      const dismissedCount = (topic as any).ackCommentNo || 0;
      const maxServerCommentNo = tdvsComments.length > 0 ? Math.max(...tdvsComments.map(c => c.commentNo || 0)) : 0;
      const isDismissed = maxServerCommentNo <= dismissedCount;

      if (flatTdvsComments.length > 0 && !isDismissed) {
        generalSyncBtn.active = true;
        generalSyncBtn.style.setProperty("--bim-button--bg", "var(--bim-ui_accent, #3880ff)");
        generalSyncBtn.style.setProperty("--bim-button--c", "var(--bim-ui_accent-contrast, #ffffff)");
      } else {
        generalSyncBtn.active = false;
        generalSyncBtn.style.removeProperty("--bim-button--bg");
        generalSyncBtn.style.removeProperty("--bim-button--c");
      }
      generalSyncBtn.addEventListener("click", async () => {
        generalSyncBtn.loading = true;
        try {
          // 1. Fetch server comments for this specific topic
          const res = await fetch(`/api/bcf/comments?mrimsNo=${mrimsNo}`);
          if (!res.ok) throw new Error("TDVS 댓글 호출 실패");
          const serverCmts = await res.json();

          // 2. Flatten and filter un-synced comments
          const localComments = Array.from(topic.comments.values());
          const isAlreadyImported = (text: string) => {
            return localComments.some(lc => lc.comment === text);
          };

          const virtualComments: any[] = [];
          serverCmts.forEach((item: any) => {
            const coord = item.coord || null;
            if (item.reviewComment && item.reviewComment.comment) {
              const parts = item.reviewComment.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
              parts.forEach((part: string) => {
                if (!isAlreadyImported(part)) {
                  virtualComments.push({
                    text: part,
                    author: item.reviewComment.author || "",
                    date: item.reviewComment.date,
                    coord: coord
                  });
                }
              });
            }
            if (item.solveComment && item.solveComment.comment) {
              const parts = item.solveComment.comment.split(";;").map((p: string) => p.trim()).filter((p: string) => p !== "");
              parts.forEach((part: string) => {
                if (!isAlreadyImported(part)) {
                  virtualComments.push({
                    text: part,
                    author: item.solveComment.author || "",
                    date: item.solveComment.date,
                    coord: coord
                  });
                }
              });
            }
          });

          if (virtualComments.length === 0) {
            alert("동기화할 새로운 TDVS 댓글이 없습니다.");
            return;
          }

          // 3. Batch import comments
          const viewpointsObj = components.get(OBC.Viewpoints);
          const worlds = components.get(OBC.Worlds);
          const world = worlds.list.values().next().value;
          
          let importCount = 0;
          let newVpCount = 0;

          for (const vCmt of virtualComments) {
            let matchedVpGuid: string | null = null;

            if (vCmt.coord && vCmt.coord.x !== null && vCmt.coord.y !== null && vCmt.coord.z !== null) {
              // 1. 기존 viewpoint 중에서 좌표 매칭 시도
              for (const vpGuid of topic.viewpoints) {
                const vp = viewpointsObj.list.get(vpGuid);
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
                const newVp = viewpointsObj.create();
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
                newVpCount++;
              }
            }

            // 4. Import comment
            const newComment = bcfTopics.addComment(topic.guid, vCmt.text);
            if (newComment) {
              if (matchedVpGuid) newComment.viewpoint = matchedVpGuid;
              if (vCmt.author) newComment.author = vCmt.author;
              if (vCmt.date) newComment.date = new Date(vCmt.date);
              importCount++;
            }
          }

          let alertMsg = `성공적으로 ${importCount}개의 댓글이 동기화되었습니다.`;
          if (newVpCount > 0) {
            alertMsg += ` (새로운 뷰포인트 ${newVpCount}개 생성됨)`;
          }
          alert(alertMsg);
          renderComments(topic, true); // force re-fetch to clear sync status and rebuild lists

        } catch (err) {
          alert(`일괄 동기화 실패: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          generalSyncBtn.loading = false;
        }
      });
    } else {
      generalSyncBtn.disabled = true;
    }

    const addNewGroupBtn = document.createElement("bim-button") as BUI.Button;
    addNewGroupBtn.label = "+ Group";
    addNewGroupBtn.icon = appIcons.ADD;
    addNewGroupBtn.style.flex = "1";
    addNewGroupBtn.style.margin = "0";
    addNewGroupBtn.title = "Add New Comment with Viewpoint";
    addNewGroupBtn.addEventListener("click", () => {
      isAddingNewComment = true;
      pendingCommentViewpoint = null;
      pendingCommentSnapshot = null;
      renderComments(topic);
    });

    const leftSubToolbar = document.createElement("div");
    leftSubToolbar.style.display = "flex";
    leftSubToolbar.style.gap = "0.25rem";
    leftSubToolbar.style.flexShrink = "0";

    const ackSyncBtn = document.createElement("bim-button") as BUI.Button;
    ackSyncBtn.style.flex = "1";
    ackSyncBtn.style.margin = "0";

    const dismissedCount = (topic as any).ackCommentNo || 0;
    const maxServerCommentNo = tdvsComments.length > 0 ? Math.max(...tdvsComments.map(c => c.commentNo || 0)) : 0;
    const isDismissed = maxServerCommentNo <= dismissedCount;

    if (mrimsNo && flatTdvsComments.length > 0 && !isDismissed) {
      ackSyncBtn.disabled = false;
      ackSyncBtn.label = "Acknowledge Sync";
      ackSyncBtn.icon = appIcons.IDS_CHECK;
      ackSyncBtn.title = "Mark this topic's comments as synced / acknowledged";
      ackSyncBtn.addEventListener("click", async () => {
        ackSyncBtn.loading = true;
        try {
          const response = await fetch("/api/bcf/acknowledge-sync", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ mrimsNo, ackCommentNo: maxServerCommentNo })
          });
          if (!response.ok) throw new Error("네트워크 오류");
          
          (topic as any).ackCommentNo = maxServerCommentNo;
          bcfTopics.onRefresh.trigger();
          alert("이 토픽의 동기화 경고를 해제(완료 처리)했습니다.");
          renderComments(topic, true);
        } catch (err) {
          alert(`동기화 완료 처리 실패: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          ackSyncBtn.loading = false;
        }
      });
    } else {
      ackSyncBtn.disabled = true;
      ackSyncBtn.label = "Synced / Acknowledged";
      ackSyncBtn.icon = appIcons.IDS_CHECK;
    }

    leftSubToolbar.append(ackSyncBtn);

    leftToolbar.append(generalSyncBtn, addNewGroupBtn);
    leftPane.append(leftToolbar, leftSubToolbar);

    const listScroll = document.createElement("div");
    listScroll.style.flex = "1";
    listScroll.style.overflowY = "auto";
    listScroll.style.display = "flex";
    listScroll.style.flexDirection = "column";
    listScroll.style.gap = "0.375rem";
    listScroll.classList.add("custom-scrollbar");

    const rightPane = document.createElement("div");
    rightPane.style.flex = "1";
    rightPane.style.minWidth = "0";
    rightPane.style.display = "flex";
    rightPane.style.flexDirection = "column";
    rightPane.style.gap = "0.5rem";
    rightPane.style.minHeight = "0";

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

    groups.forEach((g, i) => {
      const card = document.createElement("div");
      card.style.display = "flex";
      card.style.gap = "0.375rem";
      card.style.padding = "0.375rem";
      card.style.borderRadius = "4px";
      card.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
      card.style.cursor = "pointer";
      card.style.alignItems = "center";
      card.style.justifyContent = "space-between";
      card.style.flexShrink = "0";
      card.style.minWidth = "0";

      if (!isAddingNewComment && currentCommentPage === i) {
        card.style.backgroundColor = "var(--bim-ui_bg-contrast-10)";
        card.style.borderColor = "var(--bim-ui_accent)";
      }

      card.addEventListener("click", () => {
        isAddingNewComment = false;
        currentCommentPage = i;
        renderComments(topic);
      });

      const thumb = document.createElement("div");
      thumb.style.width = "3rem";
      thumb.style.height = "2.25rem";
      thumb.style.flexShrink = "0";
      thumb.style.borderRadius = "2px";
      thumb.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
      thumb.style.backgroundColor = "var(--bim-ui_bg-contrast-5)";
      thumb.style.display = "flex";
      thumb.style.alignItems = "center";
      thumb.style.justifyContent = "center";
      thumb.style.overflow = "hidden";

      const imgUrl = getCommentSnapshotUrl(g.comments.length > 0 ? g.comments[0] : { viewpoint: g.viewpointGuid });
      if (imgUrl) {
        const img = document.createElement("img");
        img.src = imgUrl;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        thumb.append(img);
      } else {
        const placeholderIcon = document.createElement("bim-label") as any;
        placeholderIcon.icon = appIcons.CAMERA;
        placeholderIcon.style.opacity = "0.5";
        placeholderIcon.style.setProperty("--bim-icon--fz", "1rem");
        thumb.append(placeholderIcon);
      }

      const info = document.createElement("div");
      info.style.flex = "1";
      info.style.minWidth = "0";
      info.style.display = "flex";
      info.style.flexDirection = "column";
      info.style.gap = "0.125rem";
      info.style.marginLeft = "0.25rem";

      const titleLabel = document.createElement("span");
      titleLabel.style.fontSize = "0.75rem";
      titleLabel.style.fontWeight = "bold";
      titleLabel.style.whiteSpace = "nowrap";
      titleLabel.style.overflow = "hidden";
      titleLabel.style.textOverflow = "ellipsis";
      
      if (g.viewpointGuid) {
        const vpIndex = Array.from(topic.viewpoints).indexOf(g.viewpointGuid);
        titleLabel.textContent = vpIndex === 0 ? "Rep. Viewpoint" : `Viewpoint ${vpIndex + 1}`;
      } else {
        titleLabel.textContent = "General";
      }

      const cmtCountLabel = document.createElement("span");
      cmtCountLabel.style.fontSize = "0.7rem";
      cmtCountLabel.style.opacity = "0.7";
      cmtCountLabel.textContent = `${g.comments.length} comment(s)`;

      info.append(titleLabel, cmtCountLabel);

      card.append(thumb, info);

      const matchingServerCmts = getMatchingServerComments(g.viewpointGuid);
      if (matchingServerCmts.length > 0) {
        const syncItemBtn = document.createElement("bim-button") as BUI.Button;
        syncItemBtn.icon = appIcons.REFRESH;
        syncItemBtn.style.margin = "0";
        syncItemBtn.style.flex = "none";
        syncItemBtn.active = true;
        syncItemBtn.title = `${matchingServerCmts.length} un-synced comment(s) on TDVS. Click to sync.`;
        syncItemBtn.style.setProperty("--bim-button--bg", "var(--bim-ui_accent, #3880ff)");
        syncItemBtn.style.setProperty("--bim-button--c", "var(--bim-ui_accent-contrast, #ffffff)");
        
        syncItemBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          syncItemBtn.loading = true;
          try {
            let count = 0;
            for (const match of matchingServerCmts) {
              const newComment = bcfTopics.addComment(topic.guid, match.text);
              if (newComment) {
                newComment.viewpoint = g.viewpointGuid;
                if (match.author) newComment.author = match.author;
                if (match.date) newComment.date = new Date(match.date);
                count++;
              }
            }
            alert(`성공적으로 ${count}개의 댓글을 이 뷰포인트에 동기화하였습니다.`);
            renderComments(topic, true);
          } catch (err) {
            alert(`동기화 실패: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            syncItemBtn.loading = false;
          }
        });

        card.append(syncItemBtn);
      }

      listScroll.append(card);
    });

    leftPane.append(listScroll);



    if (isAddingNewComment) {
      if (!pendingCommentViewpoint && flatTdvsComments.length > 0) {
        const firstUnsynced = flatTdvsComments[0];
        const viewpointsObj = components.get(OBC.Viewpoints);
        if (firstUnsynced.coord && firstUnsynced.coord.x !== null && firstUnsynced.coord.y !== null && firstUnsynced.coord.z !== null) {
          const worlds = components.get(OBC.Worlds);
          const world = worlds.list.values().next().value;
          const newVp = viewpointsObj.create();
          if (world) {
            newVp.world = world;
            newVp.camera.camera_view_point = {
              x: Number(firstUnsynced.coord.x),
              y: Number(firstUnsynced.coord.z),
              z: -Number(firstUnsynced.coord.y)
            };
            newVp.camera.camera_direction = { x: 0, y: 0, z: -1 };
            newVp.camera.camera_up_vector = { x: 0, y: 1, z: 0 };
          }
          pendingCommentViewpoint = newVp;
        } else {
          if (topic.viewpoints.size > 0) {
            const repVpGuid = Array.from(topic.viewpoints)[0];
            const repVp = viewpointsObj.list.get(repVpGuid);
            if (repVp) {
              const newVp = viewpointsObj.create();
              copyViewpoint(repVp, newVp);
              if (repVp.snapshot) {
                newVp.snapshot = newVp.guid;
                const snapshotData = viewpointsObj.snapshots.get(repVp.snapshot);
                if (snapshotData) {
                  viewpointsObj.snapshots.set(newVp.guid, snapshotData);
                  const blob = new Blob([snapshotData as any], { type: "image/png" });
                  pendingCommentSnapshot = URL.createObjectURL(blob);
                }
              }
              pendingCommentViewpoint = newVp;
            }
          }
        }
      }

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
      if (pendingCommentViewpoint) {
        fakeViewBtn.disabled = false;
        fakeViewBtn.addEventListener("click", async () => {
          fakeViewBtn.loading = true;
          await bcfTopics.restoreViewpoint(topic, { viewpointGuid: pendingCommentViewpoint.guid });
          fakeViewBtn.loading = false;
        });
      } else {
        fakeViewBtn.disabled = true;
      }

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
      rightPane.append(pageWrapper);
      commentsContainer.append(leftPane, rightPane);
      return;
    }

    if (currentCommentPage >= totalPages) currentCommentPage = Math.max(0, totalPages - 1);
    const currentGroup = groups[currentCommentPage];


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
    rightPane.append(pageWrapper);
    commentsContainer.append(leftPane, rightPane);
  };

  // Comments UI Wrapper 생성
  const commentsWrapper = document.createElement("div");
  commentsWrapper.style.display = "flex";
  commentsWrapper.style.flexDirection = "column";
  commentsWrapper.style.height = "100%";
  commentsWrapper.style.minHeight = "0";

  commentsWrapper.append(commentsContainer);

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
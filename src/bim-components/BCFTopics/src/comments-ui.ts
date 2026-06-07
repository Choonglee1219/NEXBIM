import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, showLightbox, appState } from "../../../globals";
import { BCFTopics as EngineBCFTopics, Topic as EngineTopic } from "./engine";

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

  let currentCommentPage = 0;
  let isAddingNewComment = false;

  let pendingCommentViewpoint: any = null;
  let pendingCommentSnapshot: string | null = null;

  // 헤더에 붙일 페이지네이션 컨테이너를 미리 생성해 둡니다.
  const paginationContainer = document.createElement("div");
  paginationContainer.style.display = "flex";
  paginationContainer.style.alignItems = "center";
  paginationContainer.style.gap = "0.5rem";

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

  const renderComments = (topic: EngineTopic) => {
    commentsContainer.innerHTML = "";
    paginationContainer.innerHTML = "";

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
      addBtn.tooltipTitle = "Add New Comment with Viewpoint";
      addBtn.disabled = isAddingNewComment;
      addBtn.addEventListener("click", () => {
        isAddingNewComment = true;
        pendingCommentViewpoint = null;
        pendingCommentSnapshot = null;
        renderComments(topic);
      });

      if (totalPages > 0) {
          paginationContainer.append(prevBtn, pageInfo, nextBtn, addBtn);
      } else {
          if (!isAddingNewComment) paginationContainer.append(addBtn);
      }
    };

    if (isAddingNewComment) {
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
      replyBtn.tooltipTitle = "Add Comment";
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
          cancelBtn.tooltipTitle = "Cancel";
          cancelBtn.addEventListener("click", () => {
              isAddingNewComment = false;
              pendingCommentViewpoint = null;
              pendingCommentSnapshot = null;
              renderComments(topic);
          });
      } else {
          cancelBtn.tooltipTitle = "Clear";
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
    if (snapshotUrl) {
      const validSnapshotUrl = snapshotUrl;
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

      // 해당 그룹에 Viewpoint가 존재하면 복원 버튼을 스냅샷 아래에 추가
      if (currentGroup.viewpointGuid) {
        const viewBtn = document.createElement("bim-button") as BUI.Button;
        viewBtn.label = "Restore 3D View";
        viewBtn.icon = appIcons.FOCUS;
        viewBtn.style.margin = "0";
        viewBtn.style.flex = "none";
        viewBtn.style.marginBottom = "auto";
        viewBtn.style.width = "100%";
        viewBtn.style.boxSizing = "border-box";
        viewBtn.addEventListener("click", async () => {
          viewBtn.loading = true;
          await bcfTopics.restoreViewpoint(topic, { viewpointGuid: currentGroup.viewpointGuid });
          viewBtn.loading = false;
        });
        snapshotWrapper.append(viewBtn);
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
      const commentCard = document.createElement("div");
      commentCard.style.border = "1px solid var(--bim-ui_bg-contrast, gray)";
      commentCard.style.padding = "0.5rem";
      commentCard.style.borderRadius = "0.25rem";
      commentCard.style.backgroundColor = "var(--bim-ui_bg-base, transparent)";
      commentCard.style.display = "flex";
      commentCard.style.flexDirection = "column";
      commentCard.style.gap = "0.25rem";
      commentCard.style.flexShrink = "0";
      commentCard.style.color = "var(--bim-ui_bg-contrast-100)";

      const cardHeader = document.createElement("div");
      cardHeader.style.display = "flex";
      cardHeader.style.justifyContent = "space-between";
      cardHeader.style.fontSize = "0.75rem";
      cardHeader.style.opacity = "0.8";
      cardHeader.innerHTML = `<span><b>${comment.author}</b></span><span>${comment.date.toLocaleString()}</span>`;

      const cardBody = document.createElement("div");
      cardBody.textContent = comment.comment;
      cardBody.style.whiteSpace = "pre-wrap";
      cardBody.style.wordBreak = "break-word";
      cardBody.style.fontSize = "0.75rem";
      cardBody.style.lineHeight = "1.4";

      commentCard.append(cardHeader, cardBody);
      commentsScroll.append(commentCard);
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
      replyBtn.tooltipTitle = "Add Comment";
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
      cancelBtn.tooltipTitle = "Clear";
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
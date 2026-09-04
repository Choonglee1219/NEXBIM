import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import JSZip from "jszip";
import { SharedBCF } from "../../bim-components/SharedBCF";
import { SharedIFC } from "../../bim-components/SharedIFC";
import { BCFTopics } from "../../bim-components/BCFTopics";
import { appIcons, appState, createModalDialog, setupBIMTable, tableButtonStyle } from "../../globals";

export interface BCFListPanelState {
  components: OBC.Components;
}

export const bcfListPanelTemplate: BUI.StatefullComponent<BCFListPanelState> = (state) => {
  const { components } = state;
  const sharedBCF = new SharedBCF();
  const sharedIFC = new SharedIFC();
  const fragments = components.get(OBC.FragmentsManager);
  const bcfTopics = components.get(BCFTopics);

  // 일괄 처리를 위해 선택된 BCF ID 추적
  const selectedBcfIds = new Set<number>();

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const loadBCF = async (bcfId: number) => {
    const bcf = await sharedBCF.loadBCF(bcfId);
    if (bcf && bcf.content) {
      bcfTopics.deleteAll(); // 이전 토픽 목록을 지웁니다.
      await bcfTopics.loadBCFContent(bcf.content as Uint8Array);
    }
  };

  const downloadBCF = async (bcfId: number) => {
    const bcf = await sharedBCF.loadBCF(bcfId);
    if (bcf && bcf.content) {
      const blob = new Blob([bcf.content], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bcf.name}.bcf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const deleteBCF = async (bcfId: number) => {
    if (!confirm("데이터베이스에서 삭제하시겠습니까?")) return;
    const success = await sharedBCF.deleteBCF(bcfId);
    if (success) {
      alert("데이터베이스에서 삭제되었습니다.");
      selectedBcfIds.delete(bcfId);
      await refreshSharedBCFList();
    } else {
      alert("BCF 파일 삭제에 실패하였습니다.");
    }
  };

  // --- BCF 파일/폴더 수집 헬퍼 ---
  const getBcfFilesFromFolder = async (): Promise<File[] | null> => {
    if ("showDirectoryPicker" in window && typeof (window as any).showDirectoryPicker === "function") {
      try {
        const dirHandle = await (window as any).showDirectoryPicker();
        const files: File[] = [];
        const readDirectory = async (handle: any) => {
          for await (const entry of handle.values()) {
            if (entry.kind === "file") {
              if (entry.name.toLowerCase().endsWith(".bcf")) {
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
          return null;
        }
        console.warn("showDirectoryPicker 사용 불가/오류 발생, webkitdirectory 폴백 시도:", err);
      }
    }

    // fallback
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
          if (file.name.toLowerCase().endsWith(".bcf")) {
            files.push(file);
          }
        }
        resolve(files);
      });

      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  };

  const getBcfFilesFromInput = (): Promise<File[] | null> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".bcf";
      input.multiple = true;
      input.addEventListener("change", () => {
        if (!input.files || input.files.length === 0) {
          resolve(null);
          return;
        }
        const files: File[] = [];
        for (let i = 0; i < input.files.length; i++) {
          const file = input.files[i];
          if (file.name.toLowerCase().endsWith(".bcf")) {
            files.push(file);
          }
        }
        resolve(files);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  };

  // --- BCF 업로드 모달 ---
  const showBcfUploadModal = async (initialFiles: File[]) => {
    if (initialFiles.length === 0) {
      alert("선택된 BCF 파일이 없습니다.");
      return;
    }

    const currentProjectId = appState.currentProject?.id;
    const ifcHelper = new SharedIFC();
    await ifcHelper.loadIFCFiles(currentProjectId);
    const projectIfcs = ifcHelper.list;

    if (projectIfcs.length === 0) {
      alert("현재 프로젝트에 등록된 Shared IFC 모델이 없습니다. 먼저 IFC 모델을 등록해주세요.");
      return;
    }

    // 파일 이름순 정렬 및 남은 파일 목록 초기화
    let remainingFiles: File[] = [...initialFiles].sort((a, b) => a.name.localeCompare(b.name));
    let visibleFiles: File[] = [];
    const selectedFileNames = new Set<string>();

    // IFC 이름에서 앞 14문자만 추출
    const getIfcBaseName = (name: string) => name.replace(/\.ifc$/i, "").trim().slice(0, 14);

    const { dialog, titleContainer, contentContainer } = createModalDialog({
      title: "Upload & Link BCF Files",
      icon: appIcons.TASK,
      maxWidth: "660px",
      maxHeight: "85vh",
      closeOnBackdropClick: false,
    });

    const hoverStyle = document.createElement("style");
    hoverStyle.textContent = `.bcf-upload-modal-row:hover { background-color: var(--bim-ui_bg-contrast-20); }`;
    dialog.appendChild(hoverStyle);

    const totalCountBadge = document.createElement("span");
    totalCountBadge.style.fontSize = "0.8rem";
    totalCountBadge.style.color = "var(--bim-ui_bg-contrast-60)";
    totalCountBadge.style.fontWeight = "normal";
    totalCountBadge.textContent = `(잔여: ${remainingFiles.length}개)`;
    titleContainer.appendChild(totalCountBadge);

    // IFC 선택 섹션
    const ifcSelectSection = document.createElement("div");
    ifcSelectSection.style.display = "flex";
    ifcSelectSection.style.flexDirection = "column";
    ifcSelectSection.style.gap = "0.375rem";

    const ifcLabel = document.createElement("label");
    ifcLabel.style.fontSize = "0.825rem";
    ifcLabel.style.fontWeight = "600";
    ifcLabel.style.color = "var(--bim-ui_bg-contrast-80)";
    ifcLabel.textContent = "1. 연결할 Shared IFC 모델 선택:";

    const ifcSelect = document.createElement("select");
    ifcSelect.style.width = "100%";
    ifcSelect.style.height = "2.25rem";
    ifcSelect.style.padding = "0 0.5rem";
    ifcSelect.style.background = "var(--bim-ui_bg-contrast-10)";
    ifcSelect.style.border = "1px solid var(--bim-ui_bg-contrast-30)";
    ifcSelect.style.borderRadius = "4px";
    ifcSelect.style.color = "var(--bim-label--c, #ffffff)";
    ifcSelect.style.fontSize = "0.875rem";
    ifcSelect.style.outline = "none";
    ifcSelect.style.cursor = "pointer";

    for (const ifc of projectIfcs) {
      const option = document.createElement("option");
      option.value = String(ifc.id);
      option.textContent = ifc.name;
      option.style.background = "var(--bim-ui_bg-base)";
      ifcSelect.appendChild(option);
    }

    ifcSelectSection.appendChild(ifcLabel);
    ifcSelectSection.appendChild(ifcSelect);
    contentContainer.appendChild(ifcSelectSection);

    // 검색 필터 (Search Input) 섹션
    const searchSection = document.createElement("div");
    searchSection.style.display = "flex";
    searchSection.style.flexDirection = "column";
    searchSection.style.gap = "0.375rem";

    const searchLabel = document.createElement("label");
    searchLabel.style.fontSize = "0.825rem";
    searchLabel.style.fontWeight = "600";
    searchLabel.style.color = "var(--bim-ui_bg-contrast-80)";
    searchLabel.textContent = "2. BCF 파일명 필터링 (Search):";

    const searchInputWrapper = document.createElement("div");
    searchInputWrapper.style.display = "flex";
    searchInputWrapper.style.gap = "0.375rem";
    searchInputWrapper.style.alignItems = "center";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "검색할 키워드 입력 (IFC 앞 14글자로 자동 입력됨)...";
    searchInput.style.flex = "1";
    searchInput.style.height = "2rem";
    searchInput.style.padding = "0 0.6rem";
    searchInput.style.background = "var(--bim-ui_bg-contrast-10)";
    searchInput.style.border = "1px solid var(--bim-ui_bg-contrast-30)";
    searchInput.style.borderRadius = "4px";
    searchInput.style.color = "var(--bim-label--c, #ffffff)";
    searchInput.style.fontSize = "0.825rem";
    searchInput.style.outline = "none";

    const clearSearchBtn = document.createElement("bim-button") as BUI.Button;
    clearSearchBtn.label = "Clear";
    clearSearchBtn.style.flex = "0";
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      applySearchFilter("");
    });

    searchInputWrapper.appendChild(searchInput);
    searchInputWrapper.appendChild(clearSearchBtn);
    searchSection.appendChild(searchLabel);
    searchSection.appendChild(searchInputWrapper);
    contentContainer.appendChild(searchSection);

    // BCF 파일 목록 섹션
    const listSection = document.createElement("div");
    listSection.style.display = "flex";
    listSection.style.flexDirection = "column";
    listSection.style.gap = "0.375rem";
    listSection.style.flex = "1";
    listSection.style.minHeight = "0";

    const listHeader = document.createElement("div");
    listHeader.style.display = "flex";
    listHeader.style.justifyContent = "space-between";
    listHeader.style.alignItems = "center";

    const listLabel = document.createElement("label");
    listLabel.style.fontSize = "0.825rem";
    listLabel.style.fontWeight = "600";
    listLabel.style.color = "var(--bim-ui_bg-contrast-80)";
    listLabel.textContent = "3. 업로드할 BCF 파일 선택:";

    const countLabel = document.createElement("span");
    countLabel.style.fontSize = "0.8rem";
    countLabel.style.color = "var(--bim-ui_bg-contrast-60)";
    countLabel.textContent = `선택됨: 0 / 필터링: 0 (잔여: ${remainingFiles.length}개)`;

    listHeader.appendChild(listLabel);
    listHeader.appendChild(countLabel);
    listSection.appendChild(listHeader);

    // 테이블 헤더 (전체 선택 체크박스)
    const tableHeader = document.createElement("div");
    tableHeader.style.display = "flex";
    tableHeader.style.alignItems = "center";
    tableHeader.style.padding = "0.375rem 0.5rem";
    tableHeader.style.background = "var(--bim-ui_bg-contrast-20)";
    tableHeader.style.borderRadius = "4px 4px 0 0";
    tableHeader.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
    tableHeader.style.borderBottom = "none";
    tableHeader.style.gap = "0.5rem";
    tableHeader.style.fontSize = "0.8rem";
    tableHeader.style.fontWeight = "600";

    const selectAllCheckbox = document.createElement("input");
    selectAllCheckbox.type = "checkbox";
    selectAllCheckbox.checked = true;
    selectAllCheckbox.style.cursor = "pointer";
    selectAllCheckbox.style.margin = "0";

    const headerNameSpan = document.createElement("span");
    headerNameSpan.style.flex = "1";
    headerNameSpan.textContent = "BCF 파일명";

    const headerSizeSpan = document.createElement("span");
    headerSizeSpan.style.width = "4rem";
    headerSizeSpan.style.textAlign = "right";
    headerSizeSpan.textContent = "크기";

    tableHeader.appendChild(selectAllCheckbox);
    tableHeader.appendChild(headerNameSpan);
    tableHeader.appendChild(headerSizeSpan);
    listSection.appendChild(tableHeader);

    // 파일 리스트 스크롤 영역
    const fileListContainer = document.createElement("div");
    fileListContainer.style.display = "flex";
    fileListContainer.style.flexDirection = "column";
    fileListContainer.style.maxHeight = "210px";
    fileListContainer.style.overflowY = "auto";
    fileListContainer.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
    fileListContainer.style.borderRadius = "0 0 4px 4px";
    fileListContainer.style.background = "var(--bim-ui_bg-contrast-10)";

    let rowCheckboxes: { file: File; cb: HTMLInputElement }[] = [];

    const updateCountText = () => {
      const selectedCountInVisible = visibleFiles.filter(f => selectedFileNames.has(f.name)).length;
      countLabel.textContent = `선택됨: ${selectedCountInVisible} / 필터링: ${visibleFiles.length} (잔여: ${remainingFiles.length}개)`;
      totalCountBadge.textContent = `(잔여: ${remainingFiles.length}개)`;

      selectAllCheckbox.checked = visibleFiles.length > 0 && selectedCountInVisible === visibleFiles.length;
      selectAllCheckbox.indeterminate = selectedCountInVisible > 0 && selectedCountInVisible < visibleFiles.length;
      uploadBtn.disabled = selectedCountInVisible === 0;
      uploadBtn.label = `Upload (${selectedCountInVisible}개)`;
    };

    selectAllCheckbox.addEventListener("change", () => {
      if (selectAllCheckbox.checked) {
        visibleFiles.forEach(f => selectedFileNames.add(f.name));
        rowCheckboxes.forEach(item => item.cb.checked = true);
      } else {
        visibleFiles.forEach(f => selectedFileNames.delete(f.name));
        rowCheckboxes.forEach(item => item.cb.checked = false);
      }
      updateCountText();
    });

    const renderFileList = () => {
      fileListContainer.innerHTML = "";
      rowCheckboxes = [];

      if (visibleFiles.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.style.padding = "1rem";
        emptyDiv.style.textAlign = "center";
        emptyDiv.style.color = "var(--bim-ui_bg-contrast-60)";
        emptyDiv.style.fontSize = "0.825rem";
        emptyDiv.textContent = "검색 조건과 일치하는 BCF 파일이 없습니다.";
        fileListContainer.appendChild(emptyDiv);
        updateCountText();
        return;
      }

      visibleFiles.forEach((file, index) => {
        const row = document.createElement("div");
        row.className = "bcf-upload-modal-row";
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.padding = "0.375rem 0.5rem";
        row.style.borderBottom = index === visibleFiles.length - 1 ? "none" : "1px solid var(--bim-ui_bg-contrast-20)";
        row.style.gap = "0.5rem";
        row.style.fontSize = "0.825rem";
        row.style.cursor = "pointer";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selectedFileNames.has(file.name);
        cb.style.cursor = "pointer";
        cb.style.margin = "0";
        rowCheckboxes.push({ file, cb });

        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          if (cb.checked) {
            selectedFileNames.add(file.name);
          } else {
            selectedFileNames.delete(file.name);
          }
          updateCountText();
        });

        row.addEventListener("click", () => {
          cb.checked = !cb.checked;
          if (cb.checked) {
            selectedFileNames.add(file.name);
          } else {
            selectedFileNames.delete(file.name);
          }
          updateCountText();
        });

        const nameSpan = document.createElement("span");
        nameSpan.style.flex = "1";
        nameSpan.style.overflow = "hidden";
        nameSpan.style.textOverflow = "ellipsis";
        nameSpan.style.whiteSpace = "nowrap";
        nameSpan.textContent = file.name;
        nameSpan.title = file.name;

        const sizeSpan = document.createElement("span");
        sizeSpan.style.width = "4rem";
        sizeSpan.style.textAlign = "right";
        sizeSpan.style.color = "var(--bim-ui_bg-contrast-60)";
        sizeSpan.style.fontSize = "0.75rem";
        sizeSpan.textContent = formatFileSize(file.size);

        row.appendChild(cb);
        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);
        fileListContainer.appendChild(row);
      });

      updateCountText();
    };

    const applySearchFilter = (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) {
        visibleFiles = [...remainingFiles];
      } else {
        visibleFiles = remainingFiles.filter(f => f.name.toLowerCase().includes(q));
      }

      // 검색된 파일들은 기본적으로 선택 상태로 지정
      selectedFileNames.clear();
      visibleFiles.forEach(f => selectedFileNames.add(f.name));

      renderFileList();
    };

    // IFC 드롭다운 변경 이벤트: 선택된 IFC 앞 14문자를 검색창에 자동 채움 & 필터링
    const handleIfcChange = () => {
      const selectedIfcId = parseInt(ifcSelect.value, 10);
      const selectedIfc = projectIfcs.find(ifc => ifc.id === selectedIfcId);
      if (selectedIfc) {
        const baseName = getIfcBaseName(selectedIfc.name);
        searchInput.value = baseName;
        applySearchFilter(baseName);
      }
    };

    ifcSelect.addEventListener("change", handleIfcChange);
    searchInput.addEventListener("input", () => {
      applySearchFilter(searchInput.value);
    });

    listSection.appendChild(fileListContainer);
    contentContainer.appendChild(listSection);

    // 프로그레스 바 영역 (업로드 시 표시)
    const progressDiv = document.createElement("div");
    progressDiv.style.display = "none";
    progressDiv.style.flexDirection = "column";
    progressDiv.style.gap = "0.25rem";

    const progressText = document.createElement("span");
    progressText.style.fontSize = "0.8rem";
    progressText.style.color = "var(--bim-ui_main-base)";
    progressText.textContent = "업로드 준비 중...";

    const progressBarOuter = document.createElement("div");
    progressBarOuter.style.width = "100%";
    progressBarOuter.style.height = "6px";
    progressBarOuter.style.background = "var(--bim-ui_bg-contrast-20)";
    progressBarOuter.style.borderRadius = "3px";
    progressBarOuter.style.overflow = "hidden";

    const progressBarInner = document.createElement("div");
    progressBarInner.style.width = "0%";
    progressBarInner.style.height = "100%";
    progressBarInner.style.background = "var(--bim-ui_main-base)";
    progressBarInner.style.transition = "width 0.2s ease";

    progressBarOuter.appendChild(progressBarInner);
    progressDiv.appendChild(progressText);
    progressDiv.appendChild(progressBarOuter);
    contentContainer.appendChild(progressDiv);

    // 하단 버튼 영역
    const footerDiv = document.createElement("div");
    footerDiv.style.display = "flex";
    footerDiv.style.justifyContent = "space-between";
    footerDiv.style.alignItems = "center";
    footerDiv.style.borderTop = "1px solid var(--bim-ui_bg-contrast-20)";
    footerDiv.style.paddingTop = "0.75rem";

    const statusMessage = document.createElement("span");
    statusMessage.style.fontSize = "0.8rem";
    statusMessage.style.color = "var(--bim-ui_main-base)";
    statusMessage.textContent = "";

    const btnGroup = document.createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "0.5rem";

    const cancelBtn = document.createElement("bim-button") as BUI.Button;
    cancelBtn.label = "Close";
    cancelBtn.style.flex = "0";
    cancelBtn.addEventListener("click", () => dialog.close());

    // 모든 IFC에 대해 일괄 자동 매핑 및 업로드 버튼
    const autoMatchBtn = document.createElement("bim-button") as BUI.Button;
    autoMatchBtn.label = "Auto Match All";
    autoMatchBtn.icon = appIcons.ADDBOX;
    autoMatchBtn.style.flex = "0";
    autoMatchBtn.title = "모든 Shared IFC 모델(앞 14문자 기준)에 대해 일치하는 BCF를 일괄 자동 매핑 및 업로드";
    (autoMatchBtn.style as any).setProperty("--bim-button--bgc", "var(--bim-ui_bg-contrast-30)");

    autoMatchBtn.addEventListener("click", async () => {
      if (remainingFiles.length === 0) {
        alert("업로드할 잔여 BCF 파일이 없습니다.");
        return;
      }

      if (!confirm(`모든 Shared IFC 모델(${projectIfcs.length}개)의 앞 14문자 키워드를 기준으로 BCF 파일을 자동 매핑하여 일괄 업로드하시겠습니까?`)) {
        return;
      }

      uploadBtn.loading = true;
      autoMatchBtn.loading = true;
      cancelBtn.disabled = true;
      ifcSelect.disabled = true;
      searchInput.disabled = true;
      clearSearchBtn.disabled = true;
      progressDiv.style.display = "flex";
      statusMessage.textContent = "";

      let totalSuccess = 0;
      let totalFail = 0;
      const uploadedNames = new Set<string>();

      // 매칭 계획 수립: { ifc, files }[]
      const matchPlan: { ifc: { id: number; name: string }; files: File[] }[] = [];
      let currentPool = [...remainingFiles];

      for (const ifc of projectIfcs) {
        const key = getIfcBaseName(ifc.name).toLowerCase();
        if (!key) continue;

        const matched = currentPool.filter(f => f.name.toLowerCase().includes(key));
        if (matched.length > 0) {
          matchPlan.push({ ifc, files: matched });
          // 한 번 매칭된 파일은 다음 IFC 매칭 풀에서 제외
          const matchedSet = new Set(matched.map(m => m.name));
          currentPool = currentPool.filter(f => !matchedSet.has(f.name));
        }
      }

      const totalPlanFiles = matchPlan.reduce((acc, p) => acc + p.files.length, 0);

      if (totalPlanFiles === 0) {
        uploadBtn.loading = false;
        autoMatchBtn.loading = false;
        cancelBtn.disabled = false;
        ifcSelect.disabled = false;
        searchInput.disabled = false;
        clearSearchBtn.disabled = false;
        progressDiv.style.display = "none";
        alert("IFC 모델 이름(앞 14문자)과 일치하는 BCF 파일을 찾을 수 없습니다. 수동으로 매핑을 진행해주세요.");
        return;
      }

      let processedCount = 0;
      for (const plan of matchPlan) {
        for (const file of plan.files) {
          processedCount++;
          const percent = Math.round((processedCount / totalPlanFiles) * 100);
          progressText.textContent = `자동 매핑 업로드 (${processedCount}/${totalPlanFiles}): [${plan.ifc.name}] -> ${file.name}`;
          progressBarInner.style.width = `${percent}%`;

          try {
            const res = await sharedBCF.saveBCF(file, plan.ifc.id);
            if (res) {
              totalSuccess++;
              uploadedNames.add(file.name);
            } else {
              totalFail++;
            }
          } catch (err) {
            console.error(`Error auto-uploading BCF (${file.name}):`, err);
            totalFail++;
          }
        }
      }

      remainingFiles = remainingFiles.filter(f => !uploadedNames.has(f.name));

      uploadBtn.loading = false;
      autoMatchBtn.loading = false;
      cancelBtn.disabled = false;
      ifcSelect.disabled = false;
      searchInput.disabled = false;
      clearSearchBtn.disabled = false;
      progressDiv.style.display = "none";

      await refreshSharedBCFList();
      bcfTopics.onRefresh.trigger();

      if (remainingFiles.length === 0) {
        alert(`총 ${totalSuccess}개의 BCF 파일이 모든 IFC에 자동 매핑되어 성공적으로 업로드되었습니다.`);
        dialog.close();
      } else {
        alert(`일괄 자동 업로드 완료: 성공 ${totalSuccess}개, 실패 ${totalFail}개\n(매칭되지 않은 잔여 파일 ${remainingFiles.length}개는 수동으로 업로드할 수 있습니다.)`);
        statusMessage.textContent = `✅ ${totalSuccess}개 자동 업로드 완료 (잔여: ${remainingFiles.length}개)`;
        handleIfcChange();
      }
    });

    const uploadBtn = document.createElement("bim-button") as BUI.Button;
    uploadBtn.label = "Upload (0개)";
    uploadBtn.icon = appIcons.IMPORT;
    uploadBtn.style.flex = "0";
    (uploadBtn.style as any).setProperty("--bim-button--bgc", "var(--bim-ui_main-base)");
    (uploadBtn.style as any).setProperty("--bim-button--c", "#ffffff");

    uploadBtn.addEventListener("click", async () => {
      const selectedIfcId = parseInt(ifcSelect.value, 10);
      if (isNaN(selectedIfcId)) {
        alert("연결할 IFC 모델을 선택해주세요.");
        return;
      }

      const filesToUpload = visibleFiles.filter(f => selectedFileNames.has(f.name));
      if (filesToUpload.length === 0) {
        alert("선택된 BCF 파일이 없습니다.");
        return;
      }

      uploadBtn.loading = true;
      autoMatchBtn.disabled = true;
      cancelBtn.disabled = true;
      ifcSelect.disabled = true;
      searchInput.disabled = true;
      clearSearchBtn.disabled = true;
      progressDiv.style.display = "flex";
      statusMessage.textContent = "";

      let successCount = 0;
      let failCount = 0;
      const uploadedNames = new Set<string>();

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        const percent = Math.round(((i + 1) / filesToUpload.length) * 100);
        progressText.textContent = `업로드 중 (${i + 1}/${filesToUpload.length}): ${file.name}`;
        progressBarInner.style.width = `${percent}%`;

        try {
          const res = await sharedBCF.saveBCF(file, selectedIfcId);
          if (res) {
            successCount++;
            uploadedNames.add(file.name);
          } else {
            failCount++;
          }
        } catch (err) {
          console.error(`Error uploading BCF (${file.name}):`, err);
          failCount++;
        }
      }

      // 업로드 완료된 파일들을 remainingFiles에서 제거
      remainingFiles = remainingFiles.filter(f => !uploadedNames.has(f.name));

      uploadBtn.loading = false;
      autoMatchBtn.disabled = false;
      cancelBtn.disabled = false;
      ifcSelect.disabled = false;
      searchInput.disabled = false;
      clearSearchBtn.disabled = false;
      progressDiv.style.display = "none";

      await refreshSharedBCFList();
      bcfTopics.onRefresh.trigger();

      if (remainingFiles.length === 0) {
        alert(`모든 BCF 파일(${successCount}개)이 성공적으로 업로드되었습니다.`);
        dialog.close();
      } else {
        statusMessage.textContent = `✅ ${successCount}개 업로드 완료 (잔여: ${remainingFiles.length}개)`;

        // 다음 IFC가 있다면 자동으로 다음 IFC로 넘어가도록 지원
        const currentIdx = ifcSelect.selectedIndex;
        if (currentIdx < projectIfcs.length - 1) {
          ifcSelect.selectedIndex = currentIdx + 1;
        }
        handleIfcChange();
      }
    });

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(autoMatchBtn);
    btnGroup.appendChild(uploadBtn);
    footerDiv.appendChild(statusMessage);
    footerDiv.appendChild(btnGroup);
    contentContainer.appendChild(footerDiv);

    dialog.addEventListener("close", () => {
      dialog.remove();
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    // 초기 실행: 첫 번째 IFC 기준으로 검색어 자동 채움 및 필터링 적용
    handleIfcChange();
  };

  const onAddBcfFile = async () => {
    if ((bcfTopics as any).isEditingTopic) {
      alert("Topic List에서 토픽을 작성하거나 수정 중일 때에는 BCF를 업로드할 수 없습니다.");
      return;
    }
    const files = await getBcfFilesFromInput();
    if (files && files.length > 0) {
      await showBcfUploadModal(files);
    }
  };

  const onAddBcfFolder = async () => {
    if ((bcfTopics as any).isEditingTopic) {
      alert("Topic List에서 토픽을 작성하거나 수정 중일 때에는 BCF를 업로드할 수 없습니다.");
      return;
    }
    const files = await getBcfFilesFromFolder();
    if (files && files.length > 0) {
      await showBcfUploadModal(files);
    } else if (files && files.length === 0) {
      alert("선택한 폴더 내에 .bcf 파일이 존재하지 않습니다.");
    }
  };

  type BCFTableData = {
    id: number;
    Name: string;
    models: string[];
    [key: string]: any;
  };

  const bcfTable = document.createElement("bim-table") as BUI.Table<BCFTableData>;
  bcfTable.hiddenColumns = ["id", "models"];
  bcfTable.headersHidden = true;
  bcfTable.noIndentation = true;
  bcfTable.noCarets = true;

  setupBIMTable(bcfTable);

  const onSelectAllBCFs = () => {
    const visibleData = bcfTable.value.map(v => v.data).filter(d => d.id !== undefined);
    const allSelected = visibleData.length > 0 && visibleData.every(d => selectedBcfIds.has(d.id as number));
    if (allSelected) {
      visibleData.forEach(d => selectedBcfIds.delete(d.id as number));
    } else {
      visibleData.forEach(d => selectedBcfIds.add(d.id as number));
    }
    updateBCFTableData();
  };

  const onLoadSelectedBCFs = async (target: BUI.Button) => {
    if ((bcfTopics as any).isEditingTopic) {
      alert("Topic List에서 토픽을 작성하거나 수정 중일 때에는 BCF를 불러올 수 없습니다. 작업을 완료하거나 취소한 후 다시 시도해주세요.");
      return;
    }
    if (selectedBcfIds.size === 0) {
      alert("선택된 BCF가 없습니다.");
      return;
    }

    target.loading = true;
    try {
      bcfTopics.deleteAll(); // 이전 토픽 목록 1회 초기화
      let loadedCount = 0;

      for (const id of selectedBcfIds) {
        const bcf = await sharedBCF.loadBCF(id);
        if (bcf && bcf.content) {
          await bcfTopics.loadBCFContent(bcf.content as Uint8Array);
          loadedCount++;
        }
      }

      selectedBcfIds.clear();
      updateBCFTableData();
      if (loadedCount > 0) {
        alert(`${loadedCount}개의 BCF 토픽을 불러왔습니다.`);
      }
    } catch (error) {
      console.error("Error loading selected BCFs:", error);
      alert("선택된 BCF를 로드하는 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  const onDownloadSelectedBCFs = async (target: BUI.Button) => {
    if (selectedBcfIds.size === 0) {
      alert("선택된 BCF가 없습니다.");
      return;
    }

    target.loading = true;
    try {
      for (const id of selectedBcfIds) {
        await downloadBCF(id);
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (error) {
      console.error("Error downloading selected BCFs:", error);
      alert("선택된 BCF를 다운로드하는 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  const onDeleteSelectedBCFs = async (target: BUI.Button) => {
    if (selectedBcfIds.size === 0) {
      alert("선택된 BCF가 없습니다.");
      return;
    }

    if (!confirm(`선택한 ${selectedBcfIds.size}개의 BCF 파일을 데이터베이스에서 삭제하시겠습니까?`)) {
      return;
    }

    target.loading = true;
    try {
      let successCount = 0;
      for (const id of selectedBcfIds) {
        const success = await sharedBCF.deleteBCF(id);
        if (success) successCount++;
      }
      selectedBcfIds.clear();
      await refreshSharedBCFList();
      alert(`${successCount}개의 BCF 파일이 삭제되었습니다.`);
    } catch (error) {
      console.error("Error deleting selected BCFs:", error);
      alert("선택된 BCF를 삭제하는 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  interface BcfTopicRow {
    bcfName: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    type: string;
    labels: string;
    comments: string[];
  }

  /**
   * BCF ZIP 바이트로부터 markup.bcf 파일들을 찾아 토픽 및 코멘트 데이터를 추출
   */
  const extractTopicsFromBcfBuffer = async (bcfName: string, buffer: ArrayBuffer | Uint8Array): Promise<BcfTopicRow[]> => {
    const zip = new JSZip();
    await zip.loadAsync(buffer);
    const rows: BcfTopicRow[] = [];
    const parser = new DOMParser();

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir || !relativePath.endsWith("markup.bcf")) continue;

      const xmlStr = await zipEntry.async("string");
      const xmlDoc = parser.parseFromString(xmlStr, "application/xml");
      const topicNode = xmlDoc.getElementsByTagName("Topic")[0];
      if (!topicNode) continue;

      const title = topicNode.getElementsByTagName("Title")[0]?.textContent?.trim()
        || topicNode.getAttribute("Title")
        || "";
      const description = topicNode.getElementsByTagName("Description")[0]?.textContent?.trim()
        || topicNode.getAttribute("Description")
        || "";
      const priority = topicNode.getElementsByTagName("Priority")[0]?.textContent?.trim()
        || topicNode.getAttribute("Priority")
        || "";
      const status = topicNode.getAttribute("TopicStatus")
        || topicNode.getAttribute("Status")
        || topicNode.getElementsByTagName("TopicStatus")[0]?.textContent?.trim()
        || topicNode.getElementsByTagName("Status")[0]?.textContent?.trim()
        || "";
      const type = topicNode.getAttribute("TopicType")
        || topicNode.getAttribute("Type")
        || topicNode.getElementsByTagName("TopicType")[0]?.textContent?.trim()
        || topicNode.getElementsByTagName("Type")[0]?.textContent?.trim()
        || "";

      // Labels 수집
      const labelsList: string[] = [];
      const labelNodes = xmlDoc.getElementsByTagName("Label");
      if (labelNodes.length > 0) {
        for (let i = 0; i < labelNodes.length; i++) {
          const val = labelNodes[i].textContent?.trim();
          if (val) labelsList.push(val);
        }
      } else {
        const labelsTag = topicNode.getElementsByTagName("Labels")[0];
        if (labelsTag?.textContent?.trim()) {
          labelsList.push(labelsTag.textContent.trim());
        } else if (topicNode.getAttribute("Labels")) {
          labelsList.push(topicNode.getAttribute("Labels")!);
        }
      }

      // Comments 수집
      const commentNodes = xmlDoc.getElementsByTagName("Comment");
      const comments: string[] = [];
      for (let i = 0; i < commentNodes.length; i++) {
        const cNode = commentNodes[i];
        const textNode = cNode.getElementsByTagName("Comment")[0];
        const cText = (textNode ? textNode.textContent : cNode.textContent)?.trim() || "";
        if (cText) comments.push(cText);
      }

      rows.push({
        bcfName,
        title,
        description,
        priority,
        status,
        type,
        labels: labelsList.join(", "),
        comments,
      });
    }
    return rows;
  };

  /**
   * 고유 텍스트 배열을 백엔드 LLM 서비스를 통해 일괄 한국어 번역
   */
  const translateUniqueTexts = async (uniqueTexts: string[], chunkSize = 25): Promise<Map<string, string>> => {
    const translationMap = new Map<string, string>();
    if (uniqueTexts.length === 0) return translationMap;

    for (let i = 0; i < uniqueTexts.length; i += chunkSize) {
      const chunk = uniqueTexts.slice(i, i + chunkSize);
      try {
        const res = await fetch("/api/chat/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: chunk, targetLang: "Korean" }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.translations && Array.isArray(data.translations)) {
            chunk.forEach((orig, idx) => {
              translationMap.set(orig, data.translations[idx] || orig);
            });
          } else {
            chunk.forEach(orig => translationMap.set(orig, orig));
          }
        } else {
          chunk.forEach(orig => translationMap.set(orig, orig));
        }
      } catch (e) {
        console.warn("[Translation API] Request error:", e);
        chunk.forEach(orig => translationMap.set(orig, orig));
      }
    }
    return translationMap;
  };

  /**
   * 토픽 행 목록과 번역 맵을 조합하여 UTF-8 BOM 인코딩된 CSV 텍스트 생성
   */
  const buildTopicsCsv = (rows: BcfTopicRow[], translationMap: Map<string, string>): string => {
    const maxComments = Math.max(0, ...rows.map(r => r.comments.length));
    const escapeCsvCell = (val: string | null | undefined): string => {
      if (val === undefined || val === null) return '""';
      return `"${String(val).replace(/"/g, '""')}"`;
    };

    const commentHeaders: string[] = [];
    for (let i = 1; i <= maxComments; i++) {
      commentHeaders.push(`Comment-${i}`);
    }

    const headers = [
      "BCF 이름",
      "Topic 제목",
      "Description(원문)",
      "Description(번역)",
      "Priority",
      "Status",
      "Type",
      "Labels",
      ...commentHeaders,
    ];

    const lines = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map(r => {
        const rawDesc = r.description || "";
        const trimmedDesc = rawDesc.trim();
        const translatedDesc = translationMap.get(trimmedDesc) || translationMap.get(rawDesc) || rawDesc;
        const rowCells = [
          r.bcfName,
          r.title,
          r.description,
          translatedDesc,
          r.priority,
          r.status,
          r.type,
          r.labels,
        ];
        for (let i = 0; i < maxComments; i++) {
          rowCells.push(r.comments[i] || "");
        }
        return rowCells.map(escapeCsvCell).join(",");
      }),
    ];

    return "\uFEFF" + lines.join("\r\n");
  };

  /**
   * Blob 파일을 브라우저에서 다운로드
   */
  const downloadBlobFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * BCF 목록의 토픽 정보를 CSV로 일괄 내보내기 (LLM 한국어 번역 포함)
   */
  const onExportTopicsToCSV = async (target: BUI.Button) => {
    const targetBcfs = selectedBcfIds.size > 0
      ? allRelevantBCFs.filter(b => selectedBcfIds.has(b.id))
      : allRelevantBCFs;

    if (targetBcfs.length === 0) {
      alert("내보낼 BCF 파일이 목록에 없습니다.");
      return;
    }

    target.loading = true;
    try {
      // 1. 토픽 데이터 수집
      const allRows: BcfTopicRow[] = [];
      for (const entry of targetBcfs) {
        const bcf = await sharedBCF.loadBCF(entry.id);
        if (bcf?.content) {
          const bcfName = bcf.name.toLowerCase().endsWith(".bcf") ? bcf.name : `${bcf.name}.bcf`;
          const rows = await extractTopicsFromBcfBuffer(bcfName, bcf.content as Uint8Array);
          allRows.push(...rows);
        }
      }

      if (allRows.length === 0) {
        alert("선택한 BCF 내에 추출할 토픽 정보가 없습니다.");
        return;
      }

      // 2. 고유 Description 한국어 번역
      const uniqueDescriptions = Array.from(
        new Set(allRows.map(r => (r.description || "").trim()).filter(Boolean))
      );
      const translationMap = await translateUniqueTexts(uniqueDescriptions);

      // 3. CSV 생성 및 다운로드
      const csvContent = buildTopicsCsv(allRows, translationMap);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadBlobFile(blob, `BCF_Topics_${dateStr}.csv`);
    } catch (error) {
      console.error("[CSV Export] Error:", error);
      alert("BCF 토픽을 CSV로 내보내는 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  bcfTable.dataTransform = {
    Name: (value, rowData) => {
      const name = value as string;
      const { id } = rowData as BCFTableData;
      const isChecked = selectedBcfIds.has(id);

      return BUI.html`
        <div style="display: flex; align-items: center; width: 100%; gap: 0.25rem; overflow: hidden; margin: 0; padding: 0; height: 1.5rem;">
          <bim-checkbox .checked=${isChecked} @change=${(e: Event) => {
          const cb = e.target;
          if (!(cb instanceof BUI.Checkbox)) return;
          if (cb.checked) selectedBcfIds.add(id);
          else selectedBcfIds.delete(id);
        }} style="flex: 0 0 auto; margin: 0; padding: 0;"></bim-checkbox>
          <bim-label style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; padding: 0;" title=${name}>
            ${name}
          </bim-label>
          <div style="display: flex; gap: 0.25rem; flex-shrink: 0; margin: 0; padding: 0;">
            <bim-button style=${tableButtonStyle} @click=${async (e: Event) => {
          if ((bcfTopics as any).isEditingTopic) {
            alert("Topic List에서 토픽을 작성하거나 수정 중일 때에는 BCF를 불러올 수 없습니다. 작업을 완료하거나 취소한 후 다시 시도해주세요.");
            return;
          }
          const btn = (e.target as HTMLElement).closest("bim-button") as BUI.Button;
          if (btn) btn.loading = true;
          try { await loadBCF(id); } finally { if (btn) btn.loading = false; }
        }} icon=${appIcons.OPEN} title="Load Topics"></bim-button>
            <bim-button style=${tableButtonStyle} @click=${() => downloadBCF(id)} icon=${appIcons.DOWNLOAD} title="Download BCF"></bim-button>
            <bim-button style=${tableButtonStyle} @click=${() => deleteBCF(id)} icon=${appIcons.DELETE} title="Delete BCF"></bim-button>
          </div>
        </div>
      `;
    }
  };

  const missingDataLabel = document.createElement("bim-label");
  missingDataLabel.textContent = "⚠️ No related BCF files found";
  missingDataLabel.setAttribute("slot", "missing-data");
  bcfTable.append(missingDataLabel);

  let allRelevantBCFs: { id: number; name: string; models: string[] }[] = [];

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    bcfTable.queryString = input.value;
  };

  const updateBCFTableData = () => {
    const container = bcfTable.parentElement;
    const prevScroll = container ? container.scrollTop : 0;
    bcfTable.data = allRelevantBCFs.map(file => ({
      data: {
        id: file.id,
        Name: file.name,
        models: file.models,
      }
    }));
    if (container && prevScroll > 0) {
      requestAnimationFrame(() => {
        container.scrollTop = prevScroll;
      });
    }
  };

  const refreshSharedBCFList = async () => {
    sharedBCF.list = [];
    await sharedBCF.loadBCFFiles();

    const currentProjId = appState.currentProject?.id;
    sharedIFC.list = [];
    await sharedIFC.loadIFCFiles(currentProjId);

    // 현재 프로젝트의 Shared IFC ID 수집 및 이름 매핑
    const projectIfcMap = new Map<number, string>();
    for (const ifc of sharedIFC.list) {
      projectIfcMap.set(ifc.id, ifc.name);
    }

    // 현재 로드되어 있는 모델들의 IFC DB ID 수집
    const loadedIfcIds = new Set<number>();
    if (fragments.list.size > 0) {
      for (const [uuid, model] of fragments.list) {
        const m = model as any;
        // 1. model.dbId 직접 확인
        if (m.dbId && projectIfcMap.has(m.dbId)) {
          loadedIfcIds.add(m.dbId);
        }
        // 2. uuid 매핑 확인
        const uuidIfcId = sharedIFC.getIfcIdByModelUUID(uuid);
        if (uuidIfcId && projectIfcMap.has(uuidIfcId)) {
          loadedIfcIds.add(uuidIfcId);
        }
        // 3. 파일 이름(확장자 무시)으로 sharedIFC 매칭
        const mName = m.name || "";
        const mBase = mName.replace(/\.(frag|ifc)$/i, "").toLowerCase();
        if (mBase) {
          const matchedIfc = sharedIFC.list.find(
            f => f.name.replace(/\.(frag|ifc)$/i, "").toLowerCase() === mBase
          );
          if (matchedIfc) {
            loadedIfcIds.add(matchedIfc.id);
          }
        }
      }
    }

    const bcfMap = new Map<number, { name: string, ifcIds: Set<number> }>();
    for (const bcf of sharedBCF.list) {
      if (!bcfMap.has(bcf.id)) {
        bcfMap.set(bcf.id, { name: bcf.name, ifcIds: new Set() });
      }
      bcfMap.get(bcf.id)!.ifcIds.add(bcf.ifcid);
    }

    const hasLoadedModels = loadedIfcIds.size > 0;

    allRelevantBCFs = [];
    for (const [id, data] of bcfMap) {
      const matchedIfcNames: string[] = [];
      let isConnectedToLoadedModel = false;

      for (const ifcId of data.ifcIds) {
        if (projectIfcMap.has(ifcId)) {
          matchedIfcNames.push(projectIfcMap.get(ifcId)!);
        }
        if (hasLoadedModels && loadedIfcIds.has(ifcId)) {
          isConnectedToLoadedModel = true;
        }
      }

      // 조건:
      // - 현재 프로젝트의 Shared IFC와 적어도 하나 연결되어 있어야 함 (또는 프로젝트 제한 없을 때)
      // - 로드된 모델이 없을 경우: 현재 프로젝트 Shared IFC와 연결된 모든 BCF 표시
      // - 로드된 모델이 있을 경우: 로드된 모델과 연결된 BCF만 표시
      const isInCurrentProject = !currentProjId || matchedIfcNames.length > 0;
      if (isInCurrentProject) {
        if (!hasLoadedModels || isConnectedToLoadedModel) {
          const displayNames = matchedIfcNames.length > 0 ? matchedIfcNames : Array.from(data.ifcIds).map(ifcId => `Model ${ifcId}`);
          allRelevantBCFs.push({ id, name: data.name, models: displayNames });
        }
      }
    }

    allRelevantBCFs.sort((a, b) => a.name.localeCompare(b.name));
    updateBCFTableData();
  };

  // 전역 리프레시 훅 등록
  (window as any).refreshSharedBCFList = refreshSharedBCFList;

  // 관련 이벤트 발생 시 목록 갱신
  fragments.list.onItemSet.add(refreshSharedBCFList);
  fragments.list.onItemUpdated.add(refreshSharedBCFList);
  fragments.list.onItemDeleted.add(refreshSharedBCFList);
  bcfTopics.onRefresh.add(refreshSharedBCFList);

  refreshSharedBCFList();

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TASK} label="BCF List">
      <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; flex: 1; overflow: hidden;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.25rem;">
          <div style="display: flex; gap: 0.25rem;">
            <bim-button @click=${onAddBcfFile} icon=${appIcons.ADD} title="Import BCF File" style="flex: 0;"></bim-button>
            <bim-button @click=${onAddBcfFolder} icon=${appIcons.FOLDEROPEN} title="Import BCF Folder" style="flex: 0;"></bim-button>
          </div>
          <div style="display: flex; gap: 0.25rem;">
            <bim-button @click=${onSelectAllBCFs} icon=${appIcons.CHECK_ALL} title="Select All" style="flex: 0;"></bim-button>
            <bim-button @click=${(e: Event) => {
      const target = (e.target as HTMLElement).closest("bim-button") as BUI.Button;
      if (target) onLoadSelectedBCFs(target);
    }} icon=${appIcons.OPEN} style="flex: 0;" title="Load Selected Topics"></bim-button>
            <bim-button @click=${(e: Event) => {
      const target = (e.target as HTMLElement).closest("bim-button") as BUI.Button;
      if (target) onDownloadSelectedBCFs(target);
    }} icon=${appIcons.DOWNLOAD} style="flex: 0;" title="Download Selected BCFs"></bim-button>
            <bim-button @click=${(e: Event) => {
      const target = (e.target as HTMLElement).closest("bim-button") as BUI.Button;
      if (target) onDeleteSelectedBCFs(target);
    }} icon=${appIcons.DELETE} style="flex: 0;" title="Delete Selected BCFs"></bim-button>
            <bim-button @click=${(e: Event) => {
      const target = (e.target as HTMLElement).closest("bim-button") as BUI.Button;
      if (target) onExportTopicsToCSV(target);
    }} icon=${appIcons.EXPORT} title="Export Topics to CSV" style="flex: 0;"></bim-button>
          </div>
        </div>
        <div style="display: flex; gap: 0.375rem; align-items: center;">
          <bim-text-input @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; flex: 1; min-height: 0; overflow-y: auto;">
          ${bcfTable}
        </div>
      </div>
    </bim-panel-section>
  `;
};

import * as BUI from "@thatopen/ui";

export interface ActiveProject {
  id: number;
  name: string;
  description?: string;
  security: "free" | "general";
}

const getSavedUser = () => {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage.getItem("current_user") || "";
  }
  return "";
};

const getSavedProj = (): ActiveProject | null => {
  if (typeof window !== "undefined" && window.sessionStorage) {
    const val = window.sessionStorage.getItem("active_project");
    try {
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }
  return null;
};

const getSavedIsAdmin = () => {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage.getItem("is_admin") === "true";
  }
  return false;
};

export const appState = {
  get isAdmin() {
    return getSavedIsAdmin();
  },
  set isAdmin(val: boolean) {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem("is_admin", String(val));
    }
  },
  get currentUser() {
    return getSavedUser();
  },
  set currentUser(val: string) {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem("current_user", val);
    }
  },
  get currentProject() {
    return getSavedProj();
  },
  set currentProject(val: ActiveProject | null) {
    if (typeof window !== "undefined" && window.sessionStorage) {
      if (val) {
        window.sessionStorage.setItem("active_project", JSON.stringify(val));
      } else {
        window.sessionStorage.removeItem("active_project");
      }
    }
  }
};

export const CONTENT_GRID_ID = "app-content";
export const CONTENT_GRID_GAP = "1rem";
export const SMALL_COLUMN_WIDTH = "22rem";
export const MEDIUM_COLUMN_WIDTH = "25rem";

export const appIcons = {
  ADD: "/icons/mdi--plus.svg",
  ADDBOX: "/icons/mdi--plus-box.svg",
  SELECT: "/icons/solar--cursor-bold.svg",
  CLIPPING: "/icons/fluent--cut-16-filled.svg",
  SHOW: "/icons/mdi--eye.svg",
  HIDE: "/icons/mdi--eye-off.svg",
  LEFT: "/icons/tabler--chevron-compact-left.svg",
  RIGHT: "/icons/tabler--chevron-compact-right.svg",
  SETTINGS: "/icons/solar--settings-bold.svg",
  COLORIZE: "/icons/famicons--color-fill.svg",
  EXPAND: "/icons/eva--expand-fill.svg",
  EXPORT: "/icons/ph--export-fill.svg",
  IMPORT: "/icons/mdi--import.svg",
  TASK: "/icons/material-symbols--task.svg",
  CAMERA: "/icons/solar--camera-bold.svg",
  FOCUS: "/icons/ri--focus-mode.svg",
  TRANSPARENT: "/icons/mdi--ghost.svg",
  ISOLATE: "/icons/mdi--lightbulb-on.svg",
  EXCLUDE: "/icons/mdi--lightbulb-off.svg",
  RULER: "/icons/solar--ruler-bold.svg",
  MODEL: "/icons/mage--box-3d-fill.svg",
  TREE: "/icons/mdi--file-tree-outline.svg",
  LAYOUT: "/icons/tabler--layout-filled.svg",
  SEARCH: "/icons/gravity-ui--magnifier.svg",
  FULL_SCREEN: "/icons/mdi--fit-to-screen.svg",
  HELP: "/icons/mdi--help.svg",
  LINK: "/icons/mdi--external-link.svg",
  SAVE: "/icons/material-symbols--save.svg",
  REF: "/icons/mdi--file-document-outline.svg",
  OBSIDIAN: "/icons/simple-icons--obsidian.svg",
  PLANT: "/icons/openmoji--nuclear-power-plant.svg",
  OPEN: "/icons/mdi--open-in-app.svg",
  DOWNLOAD: "/icons/oi--cloud-download.svg",
  DELETE: "/icons/mdi--delete-forever.svg",
  EDIT: "/icons/mdi--edit.svg",
  REFRESH: "/icons/mdi--refresh.svg",
  CLEAR: "/icons/mdi--clear-circle-outline.svg",
  CLASH: "/icons/openmoji--overlapping-white-squares.svg",
  HOLD: "/icons/flowbite--circle-pause-outline.svg",
  MINOR: "/icons/mingcute--arrows-down-fill.svg",
  NORMAL: "/icons/fa7--grip-lines.svg",
  MAJOR: "/icons/mingcute--arrows-up-fill.svg",
  CRITICAL: "/icons/ph--warning.svg",
  STATUS: "/icons/prime--circle-fill.svg",
  IMAGE: "/icons/mdi--image-outline.svg",
  CHART: "/icons/mdi--chart-bar.svg",
  MAP: "/icons/mdi--map-marker-radius.svg",
  PLAY: "/icons/mdi--play.svg",
  PAUSE: "/icons/mdi--pause.svg",
  IDS_CHECK: "/icons/mdi--check-bold.svg",
  TABLE: "/icons/mdi--table-filter.svg",
  BACK: "/icons/eva--arrow-ios-back-outline.svg",
  FORWARD: "/icons/eva--arrow-ios-forward-outline.svg",
  FLY: "/icons/mdi--airplane.svg",
  COMPASS: "/icons/mdi--compass.svg",
  LAYERS: "/icons/mdi--layers-outline.svg",
  COMMENT: "/icons/majesticons--comment-line.svg",
  FOLDEROPEN: "/icons/material-symbols--folder-open.svg",
  WARNING: "/icons/ic--round-warning.svg",
  ERRORALT: "/icons/bxs--error-alt.svg",
  LENGTH: "/icons/lucide--ruler-dimension-line.svg",
  AREA: "/icons/radix-icons--dimensions.svg",
  CLEARANCE: "/icons/material-symbols--social-distance.svg",
  DRAWING: "/icons/material-symbols--2d-2.svg",
  GANTT: "/icons/mdi--chart-gantt.svg",
  DRAFT: "/icons/mdi--flash.svg",
  SORT: "/icons/mdi--sort-clock-ascending.svg",
  REPEAT: "/icons/mdi--repeat.svg",
  CLIPPER_FACE: "/icons/at-icons--face.svg",
  CLIPPER_BOX: "/icons/at-icons--box.svg",
  CHATBOT: "/icons/hugeicons--chat-bot.svg",
};

// 테이블 내 아이콘 버튼들의 공통 컴팩트 스타일
export const tableButtonStyle = "flex: 0; margin: 0; padding: 0; --bim-button--p: 0.125rem 0.25rem; --bim-icon--fz: 1rem;";

export const onToggleSection = (e: Event) => {
  const header = e.currentTarget as HTMLElement;
  const wrapper = header.parentElement as HTMLElement;
  const content = header.nextElementSibling as HTMLElement;
  const icon = header.querySelector(".toggle-icon") as any;

  if (content.style.display === "none") {
    content.style.display = "flex";
    icon.icon = appIcons.MINOR;
    if (wrapper.dataset.flex === "true") wrapper.style.flex = "1";
  } else {
    content.style.display = "none";
    icon.icon = appIcons.RIGHT;
    if (wrapper.dataset.flex === "true") wrapper.style.flex = "none";
  }
};

export const tooltips = {
  FOCUS: {
    TITLE: "Items Focusing (F)",
    TEXT: "Move the camera to focus the selected items. If no items are selected, all models will be focused.",
  },
  HIDE: {
    TITLE: "Hide Selection (H)",
    TEXT: "Hide the currently selected items.",
  },
  ISOLATE: {
    TITLE: "Isolate Selection (I)",
    TEXT: "Hide everything expect the currently selected items.",
  },
  GHOST: {
    TITLE: "Ghost Mode (G)",
    TEXT: "Set all models transparent, so selections and colors can be seen better.",
  },
  SHOW_ALL: {
    TITLE: "Show All Items (A)",
    TEXT: "Reset the visibility of all hidden items, so they become visible again.",
  },
  CLEARANCE: {
    TITLE: "Clearance Check",
    TEXT: "Measure the North-South or East-West clearance of the two selected objects.",
  },
  TOGGLE_HIDDEN: {
    TITLE: "Toggle Hidden Items (S)",
    TEXT: "Show or hide permanently hidden elements such as spaces, spatial zones, and openings.",
  },
  COLORIZE: {
    TITLE: "Apply Color",
    TEXT: "Open a color palette to apply a custom color to the selected items, or clear applied colors.",
  },
  FLY: {
    TITLE: "Fly Mode (L)",
    TEXT: "Toggle first-person fly mode to navigate the 3D model using keyboard (W, A, S, D) and mouse.",
  },
  CLEAR_MEASUREMENTS: {
    TITLE: "Clear All Measurements",
    TEXT: "Remove all length and area measurements from the 3D view.",
  },
  FLOOR_EXPLODE: {
    TITLE: "Floor Exploder (E)",
    TEXT: "Explode the 3D model by floors to easily view the interior, or restore it to its original state.",
  },
};

export const tableDefaultContentTemplate = (value: any) => {
  const text = value !== null && value !== undefined ? String(value) : "";
  return BUI.html`<bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; width: 100%;" title=${text}>${text}</bim-label>`;
};

const copyToClipboard = (text: string): Promise<void> => {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  } else {
    return new Promise((resolve, reject) => {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (successful) {
          resolve();
        } else {
          reject(new Error("Copy command failed"));
        }
      } catch (err) {
        reject(err);
      }
    });
  }
};

export const onTableCellCreated = (e: Event) => {
  const { detail } = e as CustomEvent<BUI.CellCreatedEventDetail<any>>;
  if (!detail) return;
  const { cell } = detail;
  cell.style.border = `1px solid var(--bim-ui_bg-contrast-20)`;
  cell.style.padding = "4px 8px";

  cell.style.whiteSpace = "nowrap";
  cell.style.overflow = "hidden";
  cell.style.textOverflow = "ellipsis";
  cell.style.userSelect = "text";
  cell.style.cursor = "copy";
  cell.style.minWidth = "0";

  // 우클릭 시 텍스트를 클립보드에 바로 복사
  cell.addEventListener("contextmenu", async (evt) => {
    evt.preventDefault();
    let textToCopy = cell.shadowRoot?.textContent?.trim() || cell.textContent?.trim();
    if (!textToCopy) {
      const col = (cell as any).column;
      if (col && cell.rowData && (cell.rowData as any)[col] !== undefined) {
        textToCopy = String((cell.rowData as any)[col]);
      }
    }
    if (textToCopy) {
      try {
        await copyToClipboard(textToCopy);
        const originalBg = cell.style.backgroundColor;
        cell.style.backgroundColor = "var(--bim-ui_bg-contrast-20)";
        setTimeout(() => { cell.style.backgroundColor = originalBg; }, 150);
        alert(`복사되었습니다: ${textToCopy}`);
      } catch (err) { }
    }
  });
};

export const onTableRowCreated = (e: Event) => {
  const customEvent = e as CustomEvent<BUI.RowCreatedEventDetail<any>>;
  customEvent.stopImmediatePropagation();
  if (!customEvent.detail) return;
  const { row } = customEvent.detail;
  row.style.minHeight = "2rem";
  row.style.margin = "0";
};

export const setupBIMTable = (table: BUI.Table<any>) => {
  table.defaultContentTemplate = tableDefaultContentTemplate;
  table.addEventListener("cellcreated", onTableCellCreated);
  table.addEventListener("rowcreated", onTableRowCreated);
};

export const showLightbox = (url: string) => {
  if (!url) return;
  const dialog = document.createElement("dialog");
  dialog.style.margin = "auto";
  dialog.style.padding = "0";
  dialog.style.border = "none";
  dialog.style.background = "transparent";
  dialog.style.maxWidth = "90vw";
  dialog.style.maxHeight = "90vh";

  dialog.addEventListener("click", () => {
    dialog.close();
    dialog.remove();
  });

  const style = document.createElement("style");
  style.textContent = `dialog::backdrop { background-color: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); }`;
  dialog.appendChild(style);

  const img = document.createElement("img");
  img.src = url;
  img.style.display = "block";
  img.style.maxWidth = "100%";
  img.style.maxHeight = "90vh";
  img.style.objectFit = "contain";
  img.style.cursor = "zoom-out";
  img.style.borderRadius = "0.5rem";
  img.style.boxShadow = "0 4px 30px rgba(0,0,0,0.5)";

  dialog.appendChild(img);
  document.body.appendChild(dialog);
  dialog.showModal();
};

export interface PaginationRefs {
  container?: HTMLDivElement;
  prev?: BUI.Button;
  next?: BUI.Button;
  label?: BUI.Label;
}

export const createPaginationTemplate = (
  onPrev: (e: Event) => void,
  onNext: (e: Event) => void,
  refs: PaginationRefs,
  extraStyle: string = ""
) => {
  return BUI.html`
    <div ${BUI.ref(e => refs.container = e as HTMLDivElement)} style="display: none; gap: 0.25rem; align-items: center; justify-content: center; background: var(--bim-ui_bg-contrast-10); border-radius: 4px; padding: 0.125rem 0.25rem; flex-shrink: 0; ${extraStyle}">
      <bim-button ${BUI.ref(e => refs.prev = e as BUI.Button)} @click=${onPrev} icon=${appIcons.BACK} title="Previous Page" style="flex: 0; margin: 0;"></bim-button>
      <bim-label ${BUI.ref(e => refs.label = e as BUI.Label)} style="white-space: nowrap; margin: 0 0.25rem; font-size: 0.75rem;"></bim-label>
      <bim-button ${BUI.ref(e => refs.next = e as BUI.Button)} @click=${onNext} icon=${appIcons.FORWARD} title="Next Page" style="flex: 0; margin: 0;"></bim-button>
    </div>
  `;
};

import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, tooltips } from "../../globals";
import { hideSelection, isolateSelection, toggleClipperBox } from "../../ui-templates/toolbars/viewer-toolbar";
import { Highlighter } from "../../bim-components/Highlighter";
import { itemsData } from "../ItemsData";

const openItemsDataDialog = (components: OBC.Components, selection: OBC.ModelIdMap) => {
  const dialog = document.createElement("dialog");
  dialog.style.width = "50vw";
  dialog.style.height = "70vh";
  dialog.style.maxWidth = "900px";
  dialog.style.maxHeight = "700px";
  dialog.style.minWidth = "400px";
  dialog.style.minHeight = "450px";
  dialog.style.padding = "1.5rem";
  dialog.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
  dialog.style.borderRadius = "8px";
  dialog.style.backgroundColor = "var(--bim-ui_bg-base)";
  dialog.style.display = "flex";
  dialog.style.flexDirection = "column";
  dialog.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
  dialog.style.color = "var(--bim-ui_main-contrast)";

  const style = document.createElement("style");
  style.textContent = `
    dialog::backdrop {
      background-color: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
    }
  `;
  dialog.appendChild(style);

  // Table
  const [propsTable] = itemsData({
    components,
    modelIdMap: selection,
  });
  propsTable.preserveStructureOnFilter = true;
  propsTable.style.flex = "1";
  propsTable.style.overflow = "auto";

  // Header
  const headerDiv = document.createElement("div");
  headerDiv.style.display = "flex";
  headerDiv.style.justifyContent = "space-between";
  headerDiv.style.alignItems = "center";
  headerDiv.style.marginBottom = "1rem";
  headerDiv.style.flexShrink = "0";

  const title = document.createElement("bim-label");
  title.textContent = "Selection Data";
  title.style.fontSize = "1.1rem";
  title.style.fontWeight = "bold";
  headerDiv.appendChild(title);

  // Search & Toolbar Container
  const toolbarDiv = document.createElement("div");
  toolbarDiv.style.display = "flex";
  toolbarDiv.style.gap = "0.5rem";
  toolbarDiv.style.alignItems = "center";
  toolbarDiv.style.marginLeft = "auto";
  toolbarDiv.style.marginRight = "1rem";

  const searchInput = document.createElement("input");
  searchInput.placeholder = "Search...";
  searchInput.style.padding = "0.4rem 0.8rem";
  searchInput.style.fontSize = "0.75rem";
  searchInput.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
  searchInput.style.borderRadius = "4px";
  searchInput.style.backgroundColor = "var(--bim-ui_bg-contrast-10)";
  searchInput.style.color = "var(--bim-ui_main-contrast)";
  searchInput.style.width = "180px";
  searchInput.addEventListener("input", (e) => {
    propsTable.queryString = (e.target as HTMLInputElement).value;
  });
  toolbarDiv.appendChild(searchInput);

  const expandBtn = document.createElement("bim-button");
  (expandBtn as any).icon = appIcons.EXPAND;
  (expandBtn as any).title = "Toggle Expanded";
  expandBtn.addEventListener("click", () => {
    propsTable.expanded = !propsTable.expanded;
  });
  toolbarDiv.appendChild(expandBtn);

  const exportBtn = document.createElement("bim-button");
  (exportBtn as any).icon = appIcons.EXPORT;
  (exportBtn as any).title = "Export Data";
  exportBtn.addEventListener("click", () => {
    propsTable.downloadData("ElementData", "json");
  });
  toolbarDiv.appendChild(exportBtn);

  headerDiv.appendChild(toolbarDiv);

  // Close Button
  const closeBtn = document.createElement("bim-button");
  (closeBtn as any).label = "Close";
  (closeBtn as any).title = "Close";
  closeBtn.addEventListener("click", () => dialog.close());
  headerDiv.appendChild(closeBtn);

  dialog.appendChild(headerDiv);

  // Append Table directly as a DOM element
  const bodyDiv = document.createElement("div");
  bodyDiv.style.flex = "1";
  bodyDiv.style.overflow = "auto";
  bodyDiv.style.display = "flex";
  bodyDiv.appendChild(propsTable);

  dialog.appendChild(bodyDiv);

  // Backdrop click close handler
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

export const setupContextMenu = (components: OBC.Components, world: OBC.World, viewport: BUI.Viewport) => {
  const highlighter = components.get(Highlighter);

  const contextMenu = BUI.Component.create(() => {
    return BUI.html`
      <div class="custom-context-menu" @change=${() => { contextMenu.style.display = "none"; }} style="position: absolute; display: none; flex-direction: column; gap: 0.25rem; background-color: var(--bim-ui_bg-base); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 0.5rem; padding: 0.5rem; z-index: 9999; box-shadow: 0px 4px 10px rgba(0,0,0,0.3); min-width: 150px;">
        <style>
          .custom-context-menu bim-button {
            --bim-button--jc: flex-start;
          }
          .custom-context-menu bim-color-input {
            justify-content: flex-start;
          }
        </style>
        <bim-button label="Items Data" tooltip-title="Items Data" tooltip-text="Show properties of the selected objects." icon=${appIcons.TASK} @click=${() => {
          const selection = highlighter.selection.select;
          if (OBC.ModelIdMapUtils.isEmpty(selection)) {
            alert("선택된 객체가 없습니다.");
            return;
          }
          openItemsDataDialog(components, selection);
          contextMenu.style.display = "none";
        }}></bim-button>
        <bim-button label="Focus" tooltip-title=${tooltips.FOCUS.TITLE} tooltip-text=${tooltips.FOCUS.TEXT} icon=${appIcons.FOCUS} @click=${async (e: Event) => {
          const btn = e.target as BUI.Button;
          btn.loading = true;
          const selection = highlighter.selection.select;
          if (world.camera instanceof OBC.SimpleCamera) {
            await world.camera.fitToItems(
              OBC.ModelIdMapUtils.isEmpty(selection) ? undefined : selection
            );
          }
          btn.loading = false;
          contextMenu.style.display = "none";
        }}></bim-button>
        <bim-button label="Hide" tooltip-title=${tooltips.HIDE.TITLE} tooltip-text=${tooltips.HIDE.TEXT} icon=${appIcons.HIDE} @click=${async (e: Event) => {
          const btn = e.target as BUI.Button;
          btn.loading = true;
          await hideSelection(components);
          btn.loading = false;
          contextMenu.style.display = "none";
        }}></bim-button>
        <bim-button label="Isolate" tooltip-title=${tooltips.ISOLATE.TITLE} tooltip-text=${tooltips.ISOLATE.TEXT} icon=${appIcons.ISOLATE} @click=${async (e: Event) => {
          const btn = e.target as BUI.Button;
          btn.loading = true;
          await isolateSelection(components);
          btn.loading = false;
          contextMenu.style.display = "none";
        }}></bim-button>
        <bim-button label="Clipper Box" tooltip-title="Clipper Box" tooltip-text="Toggle clipping box around the selection or whole model." icon=${appIcons.CLIPPER_BOX} @click=${() => {
          toggleClipperBox(components);
          contextMenu.style.display = "none";
        }}></bim-button>
      </div>
    `;
  });

  viewport.append(contextMenu);

  contextMenu.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  viewport.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const menuWidth = 150; 
    const menuHeight = 200; 
    const adjustedX = x + menuWidth > rect.width ? rect.width - menuWidth - 10 : x;
    const adjustedY = y + menuHeight > rect.height ? rect.height - menuHeight - 10 : y;

    contextMenu.style.left = `${adjustedX}px`;
    contextMenu.style.top = `${adjustedY}px`;
    contextMenu.style.display = "flex";
  });

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 2) {
      if (!event.composedPath().includes(contextMenu)) {
        contextMenu.style.display = "none";
      }
    }
  });

  if (world.camera.controls) {
    world.camera.controls.addEventListener("control", () => {
      contextMenu.style.display = "none";
    });
  }
};

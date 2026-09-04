import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, createModalDialog, tooltips } from "../../globals";
import { hideSelection, isolateSelection, toggleClipperBox } from "../../ui-templates/toolbars/viewer-toolbar";
import { Highlighter } from "../../bim-components/Highlighter";
import { itemsData } from "../ItemsData";

const openItemsDataDialog = (components: OBC.Components, selection: OBC.ModelIdMap) => {
  const { dialog, header, contentContainer, closeButton } = createModalDialog({
    title: "Selection Data",
    width: "50vw",
    height: "70vh",
    maxWidth: "900px",
    maxHeight: "700px",
    minWidth: "400px",
    minHeight: "450px",
  });

  // Table
  const [propsTable] = itemsData({
    components,
    modelIdMap: selection,
  });
  propsTable.preserveStructureOnFilter = true;
  propsTable.style.flex = "1";
  propsTable.style.overflow = "auto";

  // Search & Toolbar Container
  const toolbarDiv = document.createElement("div");
  toolbarDiv.style.display = "flex";
  toolbarDiv.style.gap = "0.5rem";
  toolbarDiv.style.alignItems = "center";
  toolbarDiv.style.marginLeft = "auto";
  toolbarDiv.style.marginRight = "0.75rem";

  const searchInput = document.createElement("input");
  searchInput.placeholder = "Search...";
  searchInput.style.padding = "0.35rem 0.75rem";
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

  const expandBtn = document.createElement("bim-button") as BUI.Button;
  expandBtn.style.flex = "0";
  expandBtn.icon = appIcons.EXPAND;
  expandBtn.title = "Toggle Expanded";
  expandBtn.addEventListener("click", () => {
    propsTable.expanded = !propsTable.expanded;
  });
  toolbarDiv.appendChild(expandBtn);
  
  const exportBtn = document.createElement("bim-button") as BUI.Button;
  exportBtn.style.flex = "0";
  exportBtn.icon = appIcons.EXPORT;
  exportBtn.title = "Export Data";
  exportBtn.addEventListener("click", () => {
    propsTable.downloadData("ElementData", "json");
  });
  toolbarDiv.appendChild(exportBtn);
  
  header.insertBefore(toolbarDiv, closeButton);

  // Append Table directly as a DOM element
  const bodyDiv = document.createElement("div");
  bodyDiv.style.flex = "1";
  bodyDiv.style.overflow = "auto";
  bodyDiv.style.display = "flex";
  bodyDiv.appendChild(propsTable);

  contentContainer.appendChild(bodyDiv);

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

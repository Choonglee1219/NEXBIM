import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, tooltips } from "../../globals";
import { showAllItems, toggleGhostMode, hideSelection, isolateSelection } from "../../ui-templates/toolbars/viewer-toolbar";
import { Highlighter } from "../../bim-components/Highlighter";
import { CustomCameraControl } from "../../bim-components/CustomCameraControl";

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
        <bim-button label="Show All" tooltip-title=${tooltips.SHOW_ALL.TITLE} tooltip-text=${tooltips.SHOW_ALL.TEXT} icon=${appIcons.SHOW} @click=${async (e: Event) => {
          const btn = e.target as BUI.Button;
          btn.loading = true;
          await showAllItems(components);
          btn.loading = false;
          contextMenu.style.display = "none";
        }}></bim-button>
        <bim-button label="Ghost" tooltip-title=${tooltips.GHOST.TITLE} tooltip-text=${tooltips.GHOST.TEXT} icon=${appIcons.TRANSPARENT} @click=${() => {
          toggleGhostMode(components);
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
        <bim-button label="Fly Mode" tooltip-title=${tooltips.FLY.TITLE} tooltip-text=${tooltips.FLY.TEXT} icon=${appIcons.FLY} @click=${() => {
          const customCameraControl = components.get(CustomCameraControl as any) as CustomCameraControl;
          customCameraControl.flyMode.toggle();
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

import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { appIcons, tooltips } from "../../globals";
import { Highlighter } from "../../bim-components/Highlighter";

const paletteColors = [
  "#C00000", "#FFC000", "#00B050", "#00B0F0", "#0070C0", "#7030A0",
];

export const Colorize = (components: OBC.Components) => {
  const highlighter = components.get(Highlighter);

  const applyColor = async (colorValue: string) => {
    const selection = highlighter.selection.select;
    if (OBC.ModelIdMapUtils.isEmpty(selection) || !colorValue) return;
    const color = new THREE.Color(colorValue);
    const style = [...highlighter.styles.entries()].find(([, definition]) => {
      if (!definition) return false;
      return definition.color.getHex() === color.getHex();
    });
    if (style) {
      const name = style[0];
      if (name === "select") {
        return;
      }
      await highlighter.highlightByID(name, selection, false, false);
    } else {
      highlighter.styles.set(colorValue, {
        color,
        renderedFaces: FRAGS.RenderedFaces.ONE,
        opacity: 0.5,
        transparent: true,
        depthTest: true,
      });
      await highlighter.highlightByID(colorValue, selection, false, false);
    }
    await highlighter.clear("select");
  };

  const colorMenuId = BUI.Manager.newRandomId();

  const onToggleColorMenu = () => {
    const menu = document.getElementById(colorMenuId);
    if (menu) {
      menu.style.display = menu.style.display === "none" ? "grid" : "none";
    }
  };

  const onColorSelected = async (color: string) => {
    const menu = document.getElementById(colorMenuId);
    if (menu) menu.style.display = "none";
    await applyColor(color);
  };

  const onClearColor = async () => {
    const menu = document.getElementById(colorMenuId);
    if (menu) menu.style.display = "none";
    await highlighter.clear();
  };

  return BUI.html`
    <div style="position: relative;">
      <bim-button tooltip-title=${tooltips.COLORIZE.TITLE} tooltip-text=${tooltips.COLORIZE.TEXT} icon=${appIcons.COLORIZE} @click=${onToggleColorMenu}></bim-button>
      <div id=${colorMenuId} style="display: none; position: absolute; bottom: 100%; left: 0; z-index: 100; background: var(--bim-ui_bg-base); border: 1px solid var(--bim-ui_bg-contrast-20); padding: 0.5rem; grid-template-columns: repeat(8, 1fr); gap: 0.25rem; border-radius: 0.25rem; margin-bottom: 0.25rem;">
        ${paletteColors.map(color => BUI.html`
          <div style="width: 1.5rem; height: 1.5rem; background-color: ${color}; cursor: pointer; border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 0.125rem;" @click=${() => onColorSelected(color)}></div>
        `)}
        <bim-button @click=${onClearColor} icon=${appIcons.CLEAR} tooltip-title="Clear Color" style="width: 1.5rem; height: 1.5rem; min-width: 0; padding: 0; display: flex; justify-content: center; align-items: center;"></bim-button>
      </div>
    </div>
  `;
};
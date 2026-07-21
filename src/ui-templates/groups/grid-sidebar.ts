import * as BUI from "@thatopen/ui";
import { appIcons, appState } from "../../globals";

export interface GridSidebarState {
  grid: BUI.Grid<any, any>;
  isCompact: boolean;
  layoutIcons: Record<string, string>;
}

export const gridSidebarTemplate: BUI.StatefullComponent<GridSidebarState> = (
  state,
  update,
) => {
  const { grid, isCompact, layoutIcons } = state;

  const onToggleCompact = () => {
    update({ isCompact: !state.isCompact });
  };

  const onBackToProjects = () => {
    appState.currentProject = null;
    window.location.hash = "projects";
    const mainGrid = document.getElementById("app") as any;
    if (mainGrid) {
      mainGrid.layout = "ProjectSelection";
    }
    window.location.reload();
  };

  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
    borderRight: "1px solid var(--bim-ui_bg-contrast-40)",
    padding: "0.5rem",
  };

  const collapseBtnStyle = {
    width: "fit-content",
    flex: "0",
    backgroundColor: "transparent",
    borderRadius: isCompact ? "100%" : "0",
  };

  return BUI.html`
  <div style=${BUI.styleMap(containerStyle)}>
    <div class="sidebar">
      <!-- Back to Project Selection Page Button -->
      <bim-button style="--bim-button--jc: flex-start; --bim-button--bgc: var(--bim-ui_bg-contrast-40); margin-bottom: 0.5rem;" @click=${onBackToProjects} ?label-hidden=${isCompact} icon=${appIcons.BACK} label="Projects" title="Go back to Project List"></bim-button>

      ${Object.keys(grid.layouts).map((layout) => {
        // Admin이 아닐 때 특정 레이아웃 버튼 숨김 처리
        if (!appState.isAdmin && (layout === "Properties" || layout === "ViewPoints")) {
          return "";
        }
        const layoutIcon = layoutIcons[layout];
        const icon = !layoutIcon ? appIcons.LAYOUT : layoutIcon;
        return BUI.html`
          <bim-button style="--bim-button--jc: flex-start;" ?active=${grid.layout === layout} @click=${() => (grid.layout = layout)} ?label-hidden=${isCompact} icon=${icon} label=${layout} title=${layout}></bim-button>
        `;
      })}
    </div>
    <bim-button ?label-hidden=${isCompact} label="Collapse" style=${BUI.styleMap(collapseBtnStyle)} icon=${isCompact ? appIcons.RIGHT : appIcons.LEFT} @click=${onToggleCompact}></bim-button>
  </div>
`;
};

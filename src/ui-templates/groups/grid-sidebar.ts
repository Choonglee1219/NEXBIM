import * as BUI from "@thatopen/ui";
import { appIcons, appState } from "../../globals";
import { users } from "../../setup/users";

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

  // 초기 사용자 설정 (앱 실행 시 한 번만 설정됨, 또는 이전 사용자가 목록에서 삭제된 경우)
  if (!appState.currentUser || !users[appState.currentUser]) {
    appState.currentUser = Object.keys(users)[0] || "choonglee1219@kepco-enc.com";
    appState.isAdmin = users[appState.currentUser].security === "free";
  }

  const onUserChange = async (e: Event) => {
    const dropdown = e.target as BUI.Dropdown;
    const selectedEmail = dropdown.value[0];
    if (!selectedEmail || !users[selectedEmail]) return;

    appState.currentUser = selectedEmail;

    // 현재 열려있는 프로젝트에 대한 권한이 있는지 체크
    if (appState.currentProject) {
      try {
        const response = await fetch(`/api/projects?email=${selectedEmail}`);
        if (response.ok) {
          const userProjects = await response.json();
          const activeProj = userProjects.find((p: any) => p.id === appState.currentProject?.id);
          if (!activeProj) {
            alert(`"${users[selectedEmail].name}" 사용자는 현재 프로젝트에 대한 접근 권한이 없습니다. 프로젝트 선택 화면으로 이동합니다.`);
            appState.currentProject = null;
            appState.isAdmin = users[selectedEmail].security === "free";
            const mainGrid = document.getElementById("app") as any;
            if (mainGrid) mainGrid.layout = "ProjectSelection";
            window.location.reload();
            return;
          } else {
            // 프로젝트별 권한 갱신
            appState.currentProject.security = activeProj.security;
            appState.isAdmin = activeProj.security === "free";
          }
        }
      } catch (err) {
        console.error("Error checking user project permission:", err);
      }
    } else {
      appState.isAdmin = users[selectedEmail].security === "free";
    }

    if (!appState.isAdmin && (grid.layout === "Properties" || grid.layout === "ViewPoints")) {
      grid.layout = "Viewer";
    }
    update({});
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
      ${
        !isCompact
          ? BUI.html`
            <div style="margin-top: 1rem; width: 100%; border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.5rem;">
              <bim-dropdown vertical label="Login User" @change=${onUserChange}>
                ${Object.keys(users).map((email) => {
                  const user = users[email];
                  return BUI.html`<bim-option label=${user.name} value=${email} ?checked=${appState.currentUser === email}></bim-option>`;
                })}
              </bim-dropdown>
            </div>`
          : ""
      }
    </div>
    <bim-button ?label-hidden=${isCompact} label="Collapse" style=${BUI.styleMap(collapseBtnStyle)} icon=${isCompact ? appIcons.RIGHT : appIcons.LEFT} @click=${onToggleCompact}></bim-button>
  </div>
`;
};

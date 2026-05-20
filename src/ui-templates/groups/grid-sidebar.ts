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

  // 초기 사용자 설정 (앱 실행 시 한 번만 설정됨)
  if (!appState.currentUser) {
    appState.currentUser = Object.keys(users)[1]; // "user_a@something.com" (일반 권한 기본 선택)
    appState.isAdmin = users[appState.currentUser].security === "free";
  }

  const onUserChange = (e: Event) => {
    const dropdown = e.target as BUI.Dropdown;
    const selectedEmail = dropdown.value[0];
    if (!selectedEmail || !users[selectedEmail]) return;

    appState.currentUser = selectedEmail;
    appState.isAdmin = users[selectedEmail].security === "free";

    if (!appState.isAdmin && (grid.layout === "Properties" || grid.layout === "ViewPoints")) {
      grid.layout = "Viewer";
    }
    update({});
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

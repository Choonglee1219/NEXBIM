import * as BUI from "@thatopen/ui";
import { appIcons, appState } from "../../globals";
import { users } from "../../setup/users";

export interface ProjectSelectorState {
  onProjectSelect: (project: { id: number; name: string; description?: string; security: "free" | "general" }) => void;
}

// State variables preserved across re-renders
let loadedProjects: any[] = [];
let registeredUsers: any[] = [];
let projectUsersList: any[] = [];
let currentProjectIdForSettings: number | null = null;
let currentProjectNameForSettings: string = "";
let showCreateModal = false;
let showSettingsModal = false;

// Form state for Create Project
let newProjectName = "";
let newProjectDesc = "";
let newProjectMembers: { email: string; security: "free" | "general" }[] = [];

// Form state for Settings (invite user)
let inviteEmail = "";
let inviteSecurity: "free" | "general" = "general";

export const projectSelectorTemplate: BUI.StatefullComponent<ProjectSelectorState> = (
  state,
  update,
) => {
  const { onProjectSelect } = state;

  // Initialize current user if not set, or if the stored user is invalid (no longer exists)
  if (!appState.currentUser || !users[appState.currentUser]) {
    appState.currentUser = Object.keys(users)[0] || "choonglee1219@kepco-enc.com";
    appState.isAdmin = users[appState.currentUser]?.security === "free";
  }

  // Load projects from API
  const fetchProjects = async () => {
    try {
      const response = await fetch(`/api/projects?email=${appState.currentUser}`);
      if (response.ok) {
        loadedProjects = await response.json();
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    }
  };

  // Load all users from API
  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/users");
      if (response.ok) {
        registeredUsers = await response.json();
      }
    } catch (err) {
      console.error("Error fetching users list:", err);
    }
  };

  // Load project users for settings
  const fetchProjectUsers = async (projId: number) => {
    try {
      const response = await fetch(`/api/projects/${projId}/users`);
      if (response.ok) {
        projectUsersList = await response.json();
      }
    } catch (err) {
      console.error("Error fetching project users:", err);
    }
  };

  // Async load data when user changes
  const initData = async () => {
    await fetchProjects();
    await fetchUsers();
    update({});
  };

  // Run on initial load
  if (loadedProjects.length === 0 && registeredUsers.length === 0) {
    initData();
  }

  // User Switcher handler
  const onUserChange = async (e: Event) => {
    const dropdown = e.target as BUI.Dropdown;
    const selectedEmail = dropdown.value[0];
    if (!selectedEmail) return;

    appState.currentUser = selectedEmail;
    // Set global admin status
    const selectedUserInfo = registeredUsers.find(u => u.email === selectedEmail);
    appState.isAdmin = selectedUserInfo?.security === "free";

    // Clear current project
    appState.currentProject = null;

    // Reload projects for this user
    await fetchProjects();
    update({});
  };

  // Open settings for a project
  const openProjectSettings = async (projId: number, projName: string) => {
    currentProjectIdForSettings = projId;
    currentProjectNameForSettings = projName;
    await fetchProjectUsers(projId);
    showSettingsModal = true;
    update({});
  };

  // Add user to project
  const handleAddProjectUser = async () => {
    if (!currentProjectIdForSettings || !inviteEmail) return;
    try {
      const response = await fetch(`/api/projects/${currentProjectIdForSettings}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, security: inviteSecurity }),
      });
      if (response.ok) {
        await fetchProjectUsers(currentProjectIdForSettings);
        inviteEmail = "";
        update({});
      } else {
        alert("사용자 권한 설정에 실패하였습니다.");
      }
    } catch (err) {
      console.error("Error setting project user:", err);
    }
  };

  // Remove user from project
  const handleRemoveProjectUser = async (email: string) => {
    if (!currentProjectIdForSettings) return;
    if (email === appState.currentUser) {
      alert("자신의 권한은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`"${email}" 사용자의 프로젝트 접근 권한을 제거하시겠습니까?`)) return;
    try {
      const response = await fetch(`/api/projects/${currentProjectIdForSettings}/users/${email}`, {
        method: "DELETE",
      });
      if (response.ok) {
        await fetchProjectUsers(currentProjectIdForSettings);
        update({});
      } else {
        alert("사용자 권한 제거에 실패하였습니다.");
      }
    } catch (err) {
      console.error("Error removing project user:", err);
    }
  };

  // Project Creation handler
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      alert("프로젝트명을 입력해 주세요.");
      return;
    }
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName,
          description: newProjectDesc,
          creatorEmail: appState.currentUser,
        }),
      });

      if (response.ok) {
        const newProj = await response.json();
        // Invite custom members if any
        for (const member of newProjectMembers) {
          await fetch(`/api/projects/${newProj.id}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: member.email, security: member.security }),
          });
        }
        alert("프로젝트가 성공적으로 생성되었습니다.");
        showCreateModal = false;
        newProjectName = "";
        newProjectDesc = "";
        newProjectMembers = [];
        await fetchProjects();
        update({});
      } else {
        alert("프로젝트 생성에 실패했습니다.");
      }
    } catch (err) {
      console.error("Error creating project:", err);
    }
  };

  return BUI.html`
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%; box-sizing: border-box; background-color: var(--bim-ui_bg-base);">
      <!-- Top Sleek Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-40); background-color: var(--bim-ui_bg-contrast-10); backdrop-filter: blur(8px);">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="background-color: var(--bim-ui_main-base); padding: 0.5rem; border-radius: 6px; display: flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem;">
            <bim-label icon="/favicon.svg" style="--bim-icon--fz: 1.5rem; --bim-label--c: #ffffff;"></bim-label>
          </div>
          <div>
            <h1 style="font-size: 1.25rem; font-weight: 800; color: var(--bim-label--c); margin: 0; line-height: 1.2;">NEXBIM</h1>
            <span style="font-size: 0.75rem; color: var(--bim-ui_bg-contrast-80);">Next Engineering eXpert for BIM</span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 1rem;">
          <!-- Current User Profile Switcher -->
          <div style="display: flex; align-items: center; gap: 0.5rem; background: var(--bim-ui_bg-contrast-20); padding: 0.25rem 0.75rem; border-radius: 20px; border: 1px solid var(--bim-ui_bg-contrast-40);">
            <div style="width: 1.5rem; height: 1.5rem; border-radius: 50%; overflow: hidden; background-color: var(--bim-ui_accent-base); display: flex; align-items: center; justify-content: center;">
              ${(() => {
                const curUser = registeredUsers.find(u => u.email === appState.currentUser);
                return curUser?.picture 
                  ? BUI.html`<img src="${curUser.picture}" style="width: 100%; height: 100%; object-fit: cover;"/>`
                  : BUI.html`<span style="font-size: 0.75rem; font-weight: bold; color: #ffffff;">${curUser?.name?.slice(0, 1) || "U"}</span>`;
              })()}
            </div>
            <div style="display: flex; flex-direction: column;">
              <bim-dropdown @change=${onUserChange} style="--bim-input--bgc: transparent; border: none; margin: 0; font-size: 0.85rem; font-weight: bold;">
                ${registeredUsers.map(u => BUI.html`
                  <bim-option label="${u.name} (${u.security})" value="${u.email}" ?checked=${u.email === appState.currentUser}></bim-option>
                `)}
              </bim-dropdown>
            </div>
          </div>
          
          <bim-button @click=${() => { showCreateModal = true; update({}); }} icon=${appIcons.ADD} label="New Project" style="--bim-button--bgc: var(--bim-ui_main-base); --bim-button--c: #ffffff;"></bim-button>
        </div>
      </div>

      <!-- Main Project Selection Container -->
      <div style="flex: 1; padding: 2rem; overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.5rem;">
        <div>
          <h2 style="font-size: 1.5rem; font-weight: 700; color: var(--bim-label--c); margin-bottom: 0.25rem;">My Projects</h2>
          <p style="font-size: 0.875rem; color: var(--bim-ui_bg-contrast-80);">Select a project below to start viewing and collaborating on 3D models.</p>
        </div>

        <!-- Cards Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; width: 100%; box-sizing: border-box;">
          ${loadedProjects.map(proj => {
            const isAdmin = proj.security === "free";
            return BUI.html`
              <div class="project-card" style="
                background-color: var(--bim-ui_bg-contrast-10);
                border: 1px solid var(--bim-ui_bg-contrast-40);
                border-radius: 8px;
                padding: 1.25rem;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                min-height: 200px;
                box-sizing: border-box;
                position: relative;
                transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
              ">
                <!-- Card Header with Badges -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                  <!-- Role Badge -->
                  <span style="
                    font-size: 0.7rem;
                    font-weight: 700;
                    padding: 0.2rem 0.5rem;
                    border-radius: 4px;
                    text-transform: uppercase;
                    background-color: ${isAdmin ? "rgba(0, 168, 232, 0.15)" : "rgba(220, 220, 220, 0.15)"};
                    color: ${isAdmin ? "var(--bim-ui_accent-base)" : "var(--bim-ui_bg-contrast-80)"};
                    border: 1px solid ${isAdmin ? "var(--bim-ui_accent-base)" : "var(--bim-ui_bg-contrast-40)"};
                  ">
                    ${isAdmin ? "Admin" : "Viewer"}
                  </span>
                  
                  <!-- Settings Icon (Only for Admin) -->
                  ${isAdmin ? BUI.html`
                    <bim-button @click=${() => openProjectSettings(proj.id, proj.name)} icon=${appIcons.SETTINGS} style="flex: 0; --bim-button--p: 0.125rem 0.25rem; --bim-icon--fz: 1.1rem; background-color: transparent;" title="Project Settings"></bim-button>
                  ` : ""}
                </div>

                <!-- Card Info -->
                <div style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
                  <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--bim-label--c); margin: 0; line-height: 1.3;">${proj.name}</h3>
                  <p style="font-size: 0.8rem; color: var(--bim-ui_bg-contrast-80); margin: 0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;" title="${proj.description || ""}">
                    ${proj.description || "No description provided."}
                  </p>
                </div>

                <!-- Card Footer (Stats and Button) -->
                <div style="margin-top: 1.25rem; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem;">
                  <!-- Stats -->
                  <div style="display: flex; gap: 0.75rem;">
                    <span style="font-size: 0.75rem; color: var(--bim-ui_bg-contrast-80); display: flex; align-items: center; gap: 0.25rem;">
                      <bim-label icon=${appIcons.MODEL} style="--bim-icon--fz: 0.85rem; --bim-label--c: var(--bim-ui_bg-contrast-80);"></bim-label>
                      ${proj.ifcCount || 0} IFC
                    </span>
                  </div>

                  <!-- Enter Project Button -->
                  <bim-button @click=${() => onProjectSelect({ id: proj.id, name: proj.name, description: proj.description, security: proj.security })} icon=${appIcons.OPEN} label="Enter" style="flex: 0; --bim-button--bgc: var(--bim-ui_bg-contrast-20); --bim-button--p: 0.25rem 0.6rem; font-size: 0.85rem;"></bim-button>
                </div>
              </div>
            `;
          })}

          <!-- New Project Card (Dashed Border) -->
          <div @click=${() => { showCreateModal = true; update({}); }} style="
            background-color: transparent;
            border: 2px dashed var(--bim-ui_bg-contrast-40);
            border-radius: 8px;
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 200px;
            cursor: pointer;
            box-sizing: border-box;
            transition: border-color 0.2s, background-color 0.2s;
          " onmouseover="this.style.borderColor='var(--bim-ui_accent-base)'; this.style.backgroundColor='var(--bim-ui_bg-contrast-10)';" onmouseout="this.style.borderColor='var(--bim-ui_bg-contrast-40)'; this.style.backgroundColor='transparent';">
            <bim-label icon=${appIcons.ADD} style="--bim-icon--fz: 2rem; --bim-label--c: var(--bim-ui_bg-contrast-60); margin-bottom: 0.5rem;"></bim-label>
            <span style="font-weight: 700; color: var(--bim-ui_bg-contrast-60); font-size: 0.95rem;">New Project</span>
          </div>
        </div>
      </div>

      <!-- Create Project Modal Dialog -->
      ${showCreateModal ? BUI.html`
        <div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px);">
          <div style="background-color: var(--bim-ui_bg-base); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 8px; width: 450px; max-width: 90vw; padding: 1.5rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.4);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--bim-label--c); margin: 0;">Create New Project</h3>
              <bim-button @click=${() => { showCreateModal = false; update({}); }} icon=${appIcons.CLEAR} style="flex: 0; background-color: transparent; --bim-button--p: 0.25rem;"></bim-button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              <bim-text-input label="Project Name" placeholder="e.g. Seoul Plaza Structure" @input=${(e: Event) => newProjectName = (e.target as HTMLInputElement).value} value="${newProjectName}"></bim-text-input>
              <bim-text-input label="Description" placeholder="Project details or location..." @input=${(e: Event) => newProjectDesc = (e.target as HTMLInputElement).value} value="${newProjectDesc}"></bim-text-input>
            </div>

            <!-- Team Invite Section -->
            <div style="border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;">
              <span style="font-size: 0.8rem; font-weight: bold; color: var(--bim-ui_bg-contrast-80);">Invite Team Members</span>
              
              <div style="display: flex; flex-direction: column; gap: 0.35rem; max-height: 120px; overflow-y: auto; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0.25rem;">
                ${registeredUsers.filter(u => u.email !== appState.currentUser).map(u => {
                  const member = newProjectMembers.find(m => m.email === u.email);
                  const isChecked = !!member;
                  const security = member ? member.security : "general";

                  return BUI.html`
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.25rem 0.5rem; font-size: 0.8rem;">
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <bim-checkbox .checked=${isChecked} @change=${(e: Event) => {
                          const cb = e.target as BUI.Checkbox;
                          if (cb.checked) {
                            newProjectMembers.push({ email: u.email, security: "general" });
                          } else {
                            newProjectMembers = newProjectMembers.filter(m => m.email !== u.email);
                          }
                          update({});
                        }}></bim-checkbox>
                        <span style="color: var(--bim-label--c); font-weight: bold;">${u.name}</span>
                      </div>
                      ${isChecked ? BUI.html`
                        <select @change=${(e: Event) => {
                          const val = (e.target as HTMLSelectElement).value as "free" | "general";
                          const m = newProjectMembers.find(member => member.email === u.email);
                          if (m) m.security = val;
                        }} style="background: var(--bim-ui_bg-contrast-20); border: none; border-radius: 4px; color: var(--bim-label--c); font-size: 0.75rem; padding: 0.1rem 0.25rem;">
                          <option value="general" ?selected=${security === "general"}>Viewer</option>
                          <option value="free" ?selected=${security === "free"}>Admin</option>
                        </select>
                      ` : ""}
                    </div>
                  `;
                })}
              </div>
            </div>

            <!-- Footer Buttons -->
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem; margin-top: 0.5rem;">
              <bim-button @click=${() => { showCreateModal = false; update({}); }} label="Cancel" style="--bim-button--bgc: var(--bim-ui_bg-contrast-20);"></bim-button>
              <bim-button @click=${handleCreateProject} label="Create" style="--bim-button--bgc: var(--bim-ui_main-base); --bim-button--c: #ffffff;"></bim-button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Project Settings Dialog Modal -->
      ${showSettingsModal ? BUI.html`
        <div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px);">
          <div style="background-color: var(--bim-ui_bg-base); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 8px; width: 500px; max-width: 90vw; padding: 1.5rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.4);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--bim-label--c); margin: 0;">Project Settings</h3>
                <span style="font-size: 0.8rem; color: var(--bim-ui_accent-base); font-weight: bold;">${currentProjectNameForSettings}</span>
              </div>
              <bim-button @click=${() => { showSettingsModal = false; update({}); }} icon=${appIcons.CLEAR} style="flex: 0; background-color: transparent; --bim-button--p: 0.25rem;"></bim-button>
            </div>

            <!-- Members List & Management -->
            <div style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1;">
              <span style="font-size: 0.85rem; font-weight: 700; color: var(--bim-label--c); border-bottom: 1px solid var(--bim-ui_bg-contrast-20); padding-bottom: 0.25rem;">Project Members (${projectUsersList.length})</span>
              
              <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 180px; overflow-y: auto; padding-right: 0.25rem;">
                ${projectUsersList.map(pu => {
                  const isSelf = pu.email === appState.currentUser;
                  return BUI.html`
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.6rem; background-color: var(--bim-ui_bg-contrast-10); border-radius: 4px; border: 1px solid var(--bim-ui_bg-contrast-20);">
                      <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                        <span style="font-size: 0.85rem; font-weight: bold; color: var(--bim-label--c);">${pu.name} ${isSelf ? "(나)" : ""}</span>
                        <span style="font-size: 0.7rem; color: var(--bim-ui_bg-contrast-80);">${pu.email}</span>
                      </div>
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <select @change=${async (e: Event) => {
                          const val = (e.target as HTMLSelectElement).value;
                          inviteEmail = pu.email;
                          inviteSecurity = val as "free" | "general";
                          await handleAddProjectUser();
                        }} ?disabled=${isSelf} style="background: var(--bim-ui_bg-contrast-20); border: none; border-radius: 4px; color: var(--bim-label--c); font-size: 0.75rem; padding: 0.2rem 0.4rem; outline: none; cursor: pointer;">
                          <option value="general" ?selected=${pu.security === "general"}>Viewer</option>
                          <option value="free" ?selected=${pu.security === "free"}>Admin</option>
                        </select>
                        
                        <bim-button @click=${() => handleRemoveProjectUser(pu.email)} ?disabled=${isSelf} icon=${appIcons.DELETE} style="flex: 0; --bim-button--p: 0.15rem 0.3rem; --bim-icon--fz: 0.95rem; background-color: transparent;" title="Remove Access"></bim-button>
                      </div>
                    </div>
                  `;
                })}
              </div>
            </div>

            <!-- Invite New User Section -->
            <div style="border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;">
              <span style="font-size: 0.85rem; font-weight: 700; color: var(--bim-label--c);">Invite Member</span>
              
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <select @change=${(e: Event) => inviteEmail = (e.target as HTMLSelectElement).value} style="flex: 1; background: var(--bim-ui_bg-contrast-20); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 4px; color: var(--bim-label--c); font-size: 0.85rem; padding: 0.4rem; outline: none; height: 2.25rem;">
                  <option value="">Select user...</option>
                  ${registeredUsers.filter(u => !projectUsersList.some(pu => pu.email === u.email)).map(u => BUI.html`
                    <option value="${u.email}">${u.name} (${u.email})</option>
                  `)}
                </select>

                <select @change=${(e: Event) => inviteSecurity = (e.target as HTMLSelectElement).value as "free" | "general"} style="background: var(--bim-ui_bg-contrast-20); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 4px; color: var(--bim-label--c); font-size: 0.85rem; padding: 0.4rem; outline: none; height: 2.25rem;">
                  <option value="general">Viewer</option>
                  <option value="free">Admin</option>
                </select>

                <bim-button @click=${handleAddProjectUser} icon=${appIcons.ADD} label="Add" style="flex: 0; --bim-button--bgc: var(--bim-ui_main-base); --bim-button--c: #ffffff; height: 2.25rem;"></bim-button>
              </div>
            </div>

            <!-- Footer Close Button -->
            <div style="display: flex; justify-content: flex-end; border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem; margin-top: 0.5rem;">
              <bim-button @click=${() => { showSettingsModal = false; update({}); }} label="Close" style="--bim-button--bgc: var(--bim-ui_bg-contrast-20);"></bim-button>
            </div>
          </div>
        </div>
      ` : ""}
    </div>
  `;
};

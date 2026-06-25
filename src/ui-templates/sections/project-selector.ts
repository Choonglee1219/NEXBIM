import * as BUI from "@thatopen/ui";
import { appIcons, appState } from "../../globals";
import { users } from "../../setup/users";

export interface ProjectSelectorState {
  onProjectSelect: (project: { id: number; name: string; description?: string; security: "free" | "general" }) => void;
}

// ─── Shared style constants ────────────────────────────────────────────────────
const SECTION_LABEL_STYLE = "font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--bim-ui_bg-contrast-60);";
const INPUT_SELECT_STYLE   = "flex: 1; min-width: 0; background: var(--bim-ui_bg-contrast-20); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 4px; color: var(--bim-label--c); font-size: 0.825rem; padding: 0 0.5rem; outline: none; height: 2rem; cursor: pointer;";
const ROLE_SELECT_STYLE    = "flex-shrink: 0; background: var(--bim-ui_bg-contrast-20); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 4px; color: var(--bim-label--c); font-size: 0.825rem; padding: 0 0.5rem; outline: none; height: 2rem; cursor: pointer;";
const MEMBER_ROW_STYLE     = "display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.6rem; background-color: var(--bim-ui_bg-contrast-10); border-radius: 4px; border: 1px solid var(--bim-ui_bg-contrast-20);";
const SCROLLABLE_STYLE     = "max-height: 200px; overflow-y: auto;";
const MODAL_SECTION_STYLE  = "display: flex; flex-direction: column; gap: 0.75rem; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 6px; padding: 1rem;";
const BTN_PRIMARY          = "--bim-button--bgc: var(--bim-ui_main-base); --bim-button--c: #ffffff;";
const BTN_SECONDARY        = "--bim-button--bgc: var(--bim-ui_bg-contrast-20);"; 

// ─── Module-level state (preserved across re-renders) ─────────────────────────
let loadedProjects: any[] = [];
let registeredUsers: any[] = [];
let projectUsersList: any[] = [];
let currentProjectIdForSettings: number | null = null;
let currentProjectNameForSettings: string = "";
let showCreateModal = false;
let showSettingsModal = false;

// Create Project form state
let newProjectName = "";
let newProjectCode = "";
let newProjectDesc = "";
let newProjectMembers: { email: string; security: "free" | "general" }[] = [];

// Settings — invite state
let inviteEmail = "";
let inviteSecurity: "free" | "general" = "general";

// Settings — edit project state
let editProjectName = "";
let editProjectCode = "";
let editProjectDesc = "";

// ─── Component ────────────────────────────────────────────────────────────────
export const projectSelectorTemplate: BUI.StatefullComponent<ProjectSelectorState> = (
  state,
  update,
) => {
  const { onProjectSelect } = state;

  // Initialise current user
  if (!appState.currentUser || !users[appState.currentUser]) {
    appState.currentUser = Object.keys(users)[0] || "";
    appState.isAdmin = users[appState.currentUser]?.security === "free";
  }

  // ── API helpers ────────────────────────────────────────────────────────────
  const fetchProjects = async () => {
    try {
      const res = await fetch(`/api/projects?email=${appState.currentUser}`);
      if (res.ok) loadedProjects = await res.json();
    } catch (err) { console.error("Error fetching projects:", err); }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) registeredUsers = await res.json();
    } catch (err) { console.error("Error fetching users:", err); }
  };

  const fetchProjectUsers = async (projId: number) => {
    try {
      const res = await fetch(`/api/projects/${projId}/users`);
      if (res.ok) projectUsersList = await res.json();
    } catch (err) { console.error("Error fetching project users:", err); }
  };

  const initData = async () => {
    await fetchProjects();
    await fetchUsers();
    update({});
  };

  if (loadedProjects.length === 0 && registeredUsers.length === 0) initData();

  // ── Event handlers ─────────────────────────────────────────────────────────
  const onUserChange = async (e: Event) => {
    const dropdown = e.target as BUI.Dropdown;
    const email = dropdown.value[0];
    if (!email) return;
    appState.currentUser = email;
    appState.isAdmin = registeredUsers.find(u => u.email === email)?.security === "free";
    appState.currentProject = null;
    await fetchProjects();
    update({});
  };

  const openProjectSettings = async (proj: any) => {
    currentProjectIdForSettings = proj.id;
    currentProjectNameForSettings = proj.name;
    editProjectName = proj.name || "";
    editProjectCode = proj.code || "";
    editProjectDesc = proj.description || "";
    await fetchProjectUsers(proj.id);
    showSettingsModal = true;
    update({});
  };

  const handleAddProjectUser = async () => {
    if (!currentProjectIdForSettings || !inviteEmail) return;
    try {
      const res = await fetch(`/api/projects/${currentProjectIdForSettings}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, security: inviteSecurity }),
      });
      if (res.ok) {
        await fetchProjectUsers(currentProjectIdForSettings);
        inviteEmail = "";
        update({});
      } else {
        alert("Failed to update user permissions.");
      }
    } catch (err) { console.error("Error setting project user:", err); }
  };

  const handleRemoveProjectUser = async (email: string) => {
    if (!currentProjectIdForSettings) return;
    if (email === appState.currentUser) { alert("You cannot remove your own access."); return; }
    if (!confirm(`Remove access for "${email}"?`)) return;
    try {
      const res = await fetch(`/api/projects/${currentProjectIdForSettings}/users/${email}`, { method: "DELETE" });
      if (res.ok) { await fetchProjectUsers(currentProjectIdForSettings); update({}); }
      else alert("Failed to remove user access.");
    } catch (err) { console.error("Error removing project user:", err); }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) { alert("Please enter a project name."); return; }
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName, code: newProjectCode, description: newProjectDesc, creatorEmail: appState.currentUser }),
      });
      if (res.ok) {
        const newProj = await res.json();
        for (const member of newProjectMembers) {
          await fetch(`/api/projects/${newProj.id}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: member.email, security: member.security }),
          });
        }
        alert("Project created successfully.");
        showCreateModal = false;
        newProjectName = ""; newProjectCode = ""; newProjectDesc = ""; newProjectMembers = [];
        await fetchProjects();
        update({});
      } else {
        alert("Failed to create project.");
      }
    } catch (err) { console.error("Error creating project:", err); }
  };

  const handleUpdateProject = async () => {
    if (!currentProjectIdForSettings) return;
    if (!editProjectName.trim()) { alert("Please enter a project name."); return; }
    try {
      const res = await fetch(`/api/projects/${currentProjectIdForSettings}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editProjectName, code: editProjectCode, description: editProjectDesc, requestorEmail: appState.currentUser }),
      });
      if (res.ok) {
        currentProjectNameForSettings = editProjectName;
        await fetchProjects();
        alert("Project updated successfully.");
        update({});
      } else {
        const err = await res.json();
        alert(`Failed to update project: ${err.error || res.statusText}`);
      }
    } catch (err) { console.error("Error updating project:", err); alert("An error occurred while updating the project."); }
  };

  const handleDeleteProject = async () => {
    if (!currentProjectIdForSettings) return;
    const proj = loadedProjects.find(p => p.id === currentProjectIdForSettings);
    const ifcCount = proj?.ifcCount || 0;

    if (!confirm(`Delete project "${currentProjectNameForSettings}"?\n\nThis action cannot be undone.`)) return;
    if (ifcCount > 0 && !confirm(`⚠ Warning: This project contains ${ifcCount} IFC file(s).\n\nAll associated IFC, FRAG, and BCF data will be permanently deleted.\n\nAre you absolutely sure?`)) return;

    try {
      const res = await fetch(
        `/api/projects/${currentProjectIdForSettings}?requestorEmail=${encodeURIComponent(appState.currentUser)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        showSettingsModal = false;
        currentProjectIdForSettings = null;
        currentProjectNameForSettings = "";
        await fetchProjects();
        alert("Project deleted.");
        update({});
      } else {
        const err = await res.json();
        alert(`Failed to delete project: ${err.error || res.statusText}`);
      }
    } catch (err) { console.error("Error deleting project:", err); alert("An error occurred while deleting the project."); }
  };

  // ── Template ───────────────────────────────────────────────────────────────
  return BUI.html`
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%; box-sizing: border-box; background-color: var(--bim-ui_bg-base);">

      <!-- ── Top Header ── -->
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
          <div style="display: flex; align-items: center; gap: 0.5rem; background: var(--bim-ui_bg-contrast-20); padding: 0.25rem 0.75rem; border-radius: 20px; border: 1px solid var(--bim-ui_bg-contrast-40);">
            <div style="width: 1.5rem; height: 1.5rem; border-radius: 50%; overflow: hidden; background-color: var(--bim-ui_accent-base); display: flex; align-items: center; justify-content: center;">
              ${(() => {
                const curUser = registeredUsers.find(u => u.email === appState.currentUser);
                return curUser?.picture
                  ? BUI.html`<img src="${curUser.picture}" style="width: 100%; height: 100%; object-fit: cover;"/>`
                  : BUI.html`<span style="font-size: 0.75rem; font-weight: bold; color: #ffffff;">${curUser?.name?.slice(0, 1) || "U"}</span>`;
              })()}
            </div>
            <bim-dropdown @change=${onUserChange} style="--bim-input--bgc: transparent; border: none; margin: 0; font-size: 0.85rem; font-weight: bold;">
              ${registeredUsers.map(u => BUI.html`
                <bim-option label="${u.name} (${u.security})" value="${u.email}" ?checked=${u.email === appState.currentUser}></bim-option>
              `)}
            </bim-dropdown>
          </div>
          <bim-button @click=${() => { showCreateModal = true; update({}); }} icon=${appIcons.ADD} label="New Project" style="${BTN_PRIMARY}"></bim-button>
        </div>
      </div>

      <!-- ── Project Grid ── -->
      <div style="flex: 1; padding: 2rem; overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.5rem;">
        <div>
          <h2 style="font-size: 1.5rem; font-weight: 700; color: var(--bim-label--c); margin-bottom: 0.25rem;">My Projects</h2>
          <p style="font-size: 0.875rem; color: var(--bim-ui_bg-contrast-80);">Select a project below to start viewing and collaborating on 3D models.</p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; width: 100%; box-sizing: border-box;">
          ${loadedProjects.map(proj => {
            const isAdmin = proj.security === "free";
            return BUI.html`
              <div class="project-card" style="background-color: var(--bim-ui_bg-contrast-10); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between; min-height: 200px; box-sizing: border-box; position: relative; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;">

                <!-- Card Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                  <span style="font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; background-color: ${isAdmin ? "rgba(0, 168, 232, 0.15)" : "rgba(200,200,200,0.12)"}; color: ${isAdmin ? "var(--bim-ui_accent-base)" : "var(--bim-ui_bg-contrast-80)"}; border: 1px solid ${isAdmin ? "var(--bim-ui_accent-base)" : "var(--bim-ui_bg-contrast-40)"};">
                    ${isAdmin ? "Admin" : "Viewer"}
                  </span>
                  ${isAdmin ? BUI.html`
                    <bim-button @click=${() => openProjectSettings(proj)} icon=${appIcons.SETTINGS} style="flex: 0; --bim-button--p: 0.125rem 0.25rem; --bim-icon--fz: 1.1rem; background-color: transparent;" title="Project Settings"></bim-button>
                  ` : ""}
                </div>

                <!-- Card Body -->
                <div style="flex: 1; display: flex; flex-direction: column; gap: 0.4rem;">
                  <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--bim-label--c); margin: 0; line-height: 1.3;">${proj.name}</h3>
                  ${proj.code ? BUI.html`
                    <span style="display: inline-flex; align-items: center; width: fit-content; font-size: 0.8rem; font-weight: 600; font-family: ui-monospace, 'Cascadia Code', monospace; padding: 0.15rem 0.55rem; border-radius: 999px; background-color: var(--bim-ui_bg-contrast-20); color: var(--bim-ui_accent-base); border: 1px solid var(--bim-ui_bg-contrast-40); letter-spacing: 0.03em;">${proj.code}</span>
                  ` : ""}
                  <p style="font-size: 0.8rem; color: var(--bim-ui_bg-contrast-80); margin: 0; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;" title="${proj.description || ""}">
                    ${proj.description || "No description provided."}
                  </p>
                </div>

                <!-- Card Footer -->
                <div style="margin-top: 1.25rem; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem;">
                  <span style="font-size: 0.75rem; color: var(--bim-ui_bg-contrast-80); display: flex; align-items: center; gap: 0.25rem;">
                    <bim-label icon=${appIcons.MODEL} style="--bim-icon--fz: 0.85rem; --bim-label--c: var(--bim-ui_bg-contrast-80);"></bim-label>
                    ${proj.ifcCount || 0} IFC
                  </span>
                  <bim-button @click=${() => onProjectSelect({ id: proj.id, name: proj.name, description: proj.description, security: proj.security })} icon=${appIcons.OPEN} label="Enter" style="flex: 0; ${BTN_SECONDARY} --bim-button--p: 0.25rem 0.6rem; font-size: 0.85rem;"></bim-button>
                </div>
              </div>
            `;
          })}

          <!-- New Project card -->
          <div @click=${() => { showCreateModal = true; update({}); }} style="background-color: transparent; border: 2px dashed var(--bim-ui_bg-contrast-40); border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 200px; cursor: pointer; box-sizing: border-box; transition: border-color 0.2s, background-color 0.2s;"
            onmouseover="this.style.borderColor='var(--bim-ui_accent-base)'; this.style.backgroundColor='var(--bim-ui_bg-contrast-10)';"
            onmouseout="this.style.borderColor='var(--bim-ui_bg-contrast-40)'; this.style.backgroundColor='transparent';">
            <bim-label icon=${appIcons.ADD} style="--bim-icon--fz: 2rem; --bim-label--c: var(--bim-ui_bg-contrast-60); margin-bottom: 0.5rem;"></bim-label>
            <span style="font-weight: 700; color: var(--bim-ui_bg-contrast-60); font-size: 0.95rem;">New Project</span>
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════
           Create Project Modal
           ════════════════════════════════════════ -->
      ${showCreateModal ? BUI.html`
        <div style="position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px);">
          <div class="bim-scroll" style="background-color: var(--bim-ui_bg-base); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 8px; width: 520px; max-width: 90vw; max-height: 90vh; overflow-y: auto; padding: 1.5rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.25rem; box-shadow: 0 12px 32px rgba(0,0,0,0.5);">

            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 style="font-size: 1rem; font-weight: 700; color: var(--bim-label--c); margin: 0;">Create New Project</h3>
              <bim-button @click=${() => { showCreateModal = false; update({}); }} icon=${appIcons.CLEAR} style="flex: 0; background-color: transparent; --bim-button--p: 0.25rem;"></bim-button>
            </div>

            <!-- Project Info -->
            <div style="display: flex; flex-direction: column; gap: 0.6rem;">
              <bim-text-input label="Project Name *" placeholder="e.g. Seoul Plaza Structure" @input=${(e: Event) => newProjectName = (e.target as HTMLInputElement).value} value="${newProjectName}"></bim-text-input>
              <bim-text-input label="Project Code" placeholder="e.g. PRJ-001" @input=${(e: Event) => newProjectCode = (e.target as HTMLInputElement).value} value="${newProjectCode}"></bim-text-input>
              <bim-text-input label="Description" placeholder="Project details or location..." @input=${(e: Event) => newProjectDesc = (e.target as HTMLInputElement).value} value="${newProjectDesc}"></bim-text-input>
            </div>

            <!-- Invite Team Members -->
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <span style="${SECTION_LABEL_STYLE}">Invite Team Members</span>
              <div class="bim-scroll" style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 130px; overflow-y: auto; border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0.35rem;">
                ${registeredUsers.filter(u => u.email !== appState.currentUser).map(u => {
                  const member = newProjectMembers.find(m => m.email === u.email);
                  const isChecked = !!member;
                  const security = member ? member.security : "general";
                  return BUI.html`
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.2rem 0.4rem;">
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <bim-checkbox .checked=${isChecked} @change=${(e: Event) => {
                          const cb = e.target as BUI.Checkbox;
                          if (cb.checked) newProjectMembers.push({ email: u.email, security: "general" });
                          else newProjectMembers = newProjectMembers.filter(m => m.email !== u.email);
                          update({});
                        }}></bim-checkbox>
                        <span style="font-size: 0.825rem; color: var(--bim-label--c); font-weight: 600;">${u.name}</span>
                        <span style="font-size: 0.75rem; color: var(--bim-ui_bg-contrast-60);">${u.email}</span>
                      </div>
                      ${isChecked ? BUI.html`
                        <select @change=${(e: Event) => {
                          const val = (e.target as HTMLSelectElement).value as "free" | "general";
                          const m = newProjectMembers.find(mb => mb.email === u.email);
                          if (m) m.security = val;
                        }} style="${ROLE_SELECT_STYLE} height: 1.75rem; font-size: 0.775rem; padding: 0 0.35rem;">
                          <option value="general" ?selected=${security === "general"}>Viewer</option>
                          <option value="free" ?selected=${security === "free"}>Admin</option>
                        </select>
                      ` : ""}
                    </div>
                  `;
                })}
              </div>
            </div>

            <!-- Footer -->
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem;">
              <bim-button @click=${() => { showCreateModal = false; update({}); }} label="Cancel" style="${BTN_SECONDARY}"></bim-button>
              <bim-button @click=${handleCreateProject} label="Create Project" icon=${appIcons.ADD} style="${BTN_PRIMARY}"></bim-button>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- ════════════════════════════════════════
           Project Settings Modal
           ════════════════════════════════════════ -->
      ${showSettingsModal ? BUI.html`
        <div style="position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px);">
          <div class="bim-scroll" style="background-color: var(--bim-ui_bg-base); border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 8px; width: 680px; max-width: 95vw; max-height: 90vh; overflow-y: auto; padding: 1.5rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 0.875rem; box-shadow: 0 12px 32px rgba(0,0,0,0.5);">

            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-shrink: 0;">
              <div style="display: flex; flex-direction: column; gap: 0.15rem;">
                <h3 style="font-size: 1rem; font-weight: 700; color: var(--bim-label--c); margin: 0;">Project Settings</h3>
                <span style="font-size: 0.8rem; color: var(--bim-ui_accent-base); font-weight: 600;">${currentProjectNameForSettings}</span>
              </div>
              <bim-button @click=${() => { showSettingsModal = false; update({}); }} icon=${appIcons.CLEAR} style="flex: 0; background-color: transparent; --bim-button--p: 0.25rem;"></bim-button>
            </div>

            <!-- ── Section 1: Edit Project Info ── -->
            <div style="${MODAL_SECTION_STYLE}">
              <span style="${SECTION_LABEL_STYLE}">Project Info</span>
              <div style="display: flex; flex-direction: column; gap: 0.6rem; --bim-label--fz: 0.8rem;">
                <bim-text-input label="Project Name *" placeholder="Enter project name" @input=${(e: Event) => { editProjectName = (e.target as HTMLInputElement).value; }} value="${editProjectName}"></bim-text-input>
                <bim-text-input label="Project Code" placeholder="e.g. PRJ-001" @input=${(e: Event) => { editProjectCode = (e.target as HTMLInputElement).value; }} value="${editProjectCode}"></bim-text-input>
                <bim-text-input label="Description" placeholder="Enter project description" @input=${(e: Event) => { editProjectDesc = (e.target as HTMLInputElement).value; }} value="${editProjectDesc}"></bim-text-input>
              </div>
              <div style="display: flex; justify-content: flex-end;">
                <bim-button @click=${handleUpdateProject} icon=${appIcons.SAVE} label="Save Changes" style="${BTN_PRIMARY} height: 2rem;"></bim-button>
              </div>
            </div>

            <!-- ── Section 2: Members ── -->
            <div style="${MODAL_SECTION_STYLE}">
              <span style="${SECTION_LABEL_STYLE}">Members (${projectUsersList.length})</span>

              <!-- Member list -->
              <div class="bim-scroll" style="${SCROLLABLE_STYLE} display: flex; flex-direction: column; gap: 0.4rem; padding-right: 0.25rem;">
                ${projectUsersList.map(pu => {
                  const isSelf = pu.email === appState.currentUser;
                  return BUI.html`
                    <div style="${MEMBER_ROW_STYLE}">
                      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem;">
                        <span style="font-size: 0.825rem; font-weight: 600; color: var(--bim-label--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                          ${pu.name}${isSelf ? " (me)" : ""}
                        </span>
                        <span style="font-size: 0.75rem; color: var(--bim-ui_bg-contrast-60); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pu.email}</span>
                      </div>
                      <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; margin-left: 0.75rem;">
                        <select @change=${async (e: Event) => {
                          const val = (e.target as HTMLSelectElement).value;
                          inviteEmail = pu.email;
                          inviteSecurity = val as "free" | "general";
                          await handleAddProjectUser();
                        }} ?disabled=${isSelf} style="${ROLE_SELECT_STYLE}${isSelf ? " opacity: 0.5; cursor: not-allowed;" : ""}">
                          <option value="general" ?selected=${pu.security === "general"}>Viewer</option>
                          <option value="free" ?selected=${pu.security === "free"}>Admin</option>
                        </select>
                        <bim-button @click=${() => handleRemoveProjectUser(pu.email)} ?disabled=${isSelf} icon=${appIcons.DELETE} style="flex: 0; --bim-button--p: 0.15rem 0.3rem; --bim-icon--fz: 0.9rem; background-color: transparent;" title="Remove Access"></bim-button>
                      </div>
                    </div>
                  `;
                })}
              </div>

              <!-- Invite row -->
              <div style="display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid var(--bim-ui_bg-contrast-20); padding-top: 0.75rem;">
                <span style="${SECTION_LABEL_STYLE}">Invite Member</span>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <select @change=${(e: Event) => inviteEmail = (e.target as HTMLSelectElement).value} style="${INPUT_SELECT_STYLE}">
                    <option value="">Select user…</option>
                    ${registeredUsers.filter(u => !projectUsersList.some(pu => pu.email === u.email)).map(u => BUI.html`
                      <option value="${u.email}">${u.name} (${u.email})</option>
                    `)}
                  </select>
                  <select @change=${(e: Event) => inviteSecurity = (e.target as HTMLSelectElement).value as "free" | "general"} style="${ROLE_SELECT_STYLE}">
                    <option value="general">Viewer</option>
                    <option value="free">Admin</option>
                  </select>
                  <bim-button @click=${handleAddProjectUser} icon=${appIcons.ADD} label="Add" style="flex-shrink: 0; ${BTN_PRIMARY} height: 2rem;"></bim-button>
                </div>
              </div>
            </div>

            <!-- ── Section 3: Danger Zone ── -->
            <div style="border: 1px solid rgba(220,60,60,0.35); border-radius: 6px; padding: 1rem; background-color: rgba(220,60,60,0.04);">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
                <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                  <span style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #d94f4f;">⚠ Danger Zone</span>
                  <p style="font-size: 0.78rem; color: var(--bim-ui_bg-contrast-60); margin: 0; line-height: 1.4;">
                    Deleting the project will permanently remove all associated IFC, FRAG, and BCF data.
                  </p>
                </div>
                <bim-button @click=${handleDeleteProject} icon=${appIcons.DELETE} label="Delete Project" style="flex-shrink: 0; --bim-button--bgc: rgba(200,40,40,0.85); --bim-button--c: #ffffff; height: 2rem;"></bim-button>
              </div>
            </div>
          </div>
        </div>
      ` : ""}
    </div>
  `;
};

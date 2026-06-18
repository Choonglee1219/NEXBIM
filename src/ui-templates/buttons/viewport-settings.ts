import * as THREE from "three";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { appIcons } from "../../globals";

interface ViewportSettingsState {
  components: OBC.Components;
  world: OBC.SimpleWorld<
    OBC.SimpleScene,
    OBC.OrthoPerspectiveCamera,
    OBF.PostproductionRenderer
  >;
}

export const viewportSettingsTemplate: BUI.StatefullComponent<
  ViewportSettingsState
> = (state) => {
  const { components, world } = state;

  const grids = components.get(OBC.Grids);

  const worldGrid = grids.list.get(world.uuid);
  let worldEnableCheckbox: BUI.TemplateResult | undefined;
  if (worldGrid) {
    const onToggleGrid = ({ target }: { target: BUI.Checkbox }) => {
      worldGrid.visible = target.checked;
      target.checked = worldGrid.visible;
    };

    worldEnableCheckbox = BUI.html`
      <bim-checkbox style="width: 15rem;" ?checked=${worldGrid.visible} label="Grid" @change=${onToggleGrid}></bim-checkbox>
    `;
  }

  let cameraNearInput: HTMLInputElement | undefined;
  let cameraNearLabel: HTMLElement | undefined;
  let cameraFarInput: HTMLInputElement | undefined;
  let cameraFarLabel: HTMLElement | undefined;

  const onProjectionChange = ({ target }: { target: BUI.Dropdown }) => {
    const [projection] = target.value;
    if (!projection) return;
    world.camera.projection.set(projection);

    setTimeout(() => {
      const activeCam = world.camera.three as any;
      if (activeCam) {
        if (cameraNearInput) cameraNearInput.value = String(activeCam.near);
        if (cameraNearLabel) cameraNearLabel.textContent = activeCam.near.toFixed(2);
        if (cameraFarInput) cameraFarInput.value = String(activeCam.far);
        if (cameraFarLabel) cameraFarLabel.textContent = Math.round(activeCam.far).toString();
      }
    }, 50);
  };

  const onNearChange = (e: Event) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (cameraNearLabel) {
      cameraNearLabel.textContent = val.toFixed(2);
    }
    const activeCam = world.camera.three as any;
    if (activeCam && ("near" in activeCam)) {
      activeCam.near = val;
      activeCam.updateProjectionMatrix();
    }
  };

  const onFarChange = (e: Event) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (cameraFarLabel) {
      cameraFarLabel.textContent = Math.round(val).toString();
    }
    const activeCam = world.camera.three as any;
    if (activeCam && ("far" in activeCam)) {
      activeCam.far = val;
      activeCam.updateProjectionMatrix();
    }
  };

  const html = document.querySelector("html")!;
  const onThemeChange = ({ target }: { target: BUI.Dropdown }) => {
    const [mode] = target.value;
    const selected = String(mode);
    html.classList.remove("bim-ui-dark", "bim-ui-light");
    if (selected === "1") {
      html.classList.add("bim-ui-dark");
      world.scene.three.background = new THREE.Color(0x2a2438);
    } else if (selected === "2") {
      html.classList.add("bim-ui-light");
      world.scene.three.background = new THREE.Color(0xd6d9dc);
    }
  };

  const activeCam = world.camera.three as any;
  const currentNear = activeCam ? activeCam.near : 0.5;
  const currentFar = activeCam ? activeCam.far : 1000;

  return BUI.html`
    <bim-button style="position: absolute; top: 0.5rem; right: 0.5rem; background-color: transparent;" icon=${appIcons.SETTINGS}>
      <bim-context-menu style="width: 15rem; gap: 0.25rem">
        ${worldEnableCheckbox}
        <bim-dropdown label="Camera Projection" @change=${onProjectionChange}>
          <bim-option label="Perspective" ?checked=${world.camera.projection.current === "Perspective"}></bim-option> 
          <bim-option label="Orthographic" ?checked=${world.camera.projection.current === "Orthographic"}></bim-option> 
        </bim-dropdown>

        <div style="display: flex; flex-direction: column; gap: 0.375rem; padding: 0.25rem;">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--bim-ui_gray-10);">
            <span>Near Plane</span>
            <span ${BUI.ref(e => { cameraNearLabel = e as HTMLElement; })}>${currentNear.toFixed(2)}</span>
          </div>
          <input ${BUI.ref(e => { cameraNearInput = e as HTMLInputElement; })} type="range" min="0.05" max="20.0" step="0.05" value=${currentNear} @input=${onNearChange} style="width: 100%; cursor: pointer;">
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.375rem; padding: 0.25rem;">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--bim-ui_gray-10);">
            <span>Far Plane</span>
            <span ${BUI.ref(e => { cameraFarLabel = e as HTMLElement; })}>${Math.round(currentFar)}</span>
          </div>
          <input ${BUI.ref(e => { cameraFarInput = e as HTMLInputElement; })} type="range" min="30" max="2000" step="0.5" value=${currentFar} @input=${onFarChange} style="width: 100%; cursor: pointer;">
        </div>

        <bim-dropdown label="Color Mode" @change=${onThemeChange}>
          <bim-option value="1" label="Dark" .checked=${html.classList.contains("bim-ui-dark")}></bim-option>
          <bim-option value="2" label="Light" .checked=${html.classList.contains("bim-ui-light")}></bim-option>
        </bim-dropdown>
      </bim-context-menu> 
    </bim-button>
  `;
};

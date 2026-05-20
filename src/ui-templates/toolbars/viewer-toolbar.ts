import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import { appIcons, tooltips } from "../../globals";
import { Colorize } from "../../ui-components/Colorize";
import { Highlighter } from "../../bim-components/Highlighter";
import { CustomCameraControl } from "../../bim-components/CustomCameraControl";
import { FloorExploder } from "../../bim-components/FloorExploder";

export interface ViewerToolbarState {
  components: OBC.Components;
  world: OBC.World;
}

const originalColors = new WeakMap<
  FRAGS.BIMMaterial,
  { color: number; transparent: boolean; opacity: number; depthWrite: boolean; isColor: boolean }
>();
let isGhostModeActive = false;

export const setModelTransparent = (components: OBC.Components) => {
  if (isGhostModeActive) return;
  isGhostModeActive = true;
  const worlds = components.get(OBC.Worlds);
  for (const world of worlds.list.values()) {
    if (world.renderer instanceof OBF.PostproductionRenderer) {
      world.renderer.postproduction.edgesPass.enabled = false;
    }
  }

  const fragments = components.get(OBC.FragmentsManager);
  for (const material of fragments.core.models.materials.list.values()) {
    if (material.userData.customId) continue;
    // save colors
    let color: number | undefined;
    let isColor = false;
    if ("color" in material) {
      color = material.color.getHex();
      isColor = true;
    } else {
      color = material.lodColor.getHex();
    }

    originalColors.set(material, {
      color,
      transparent: material.transparent,
      opacity: material.opacity,
      depthWrite: material.depthWrite,
      isColor,
    });

    // set color
    material.transparent = true;
    material.needsUpdate = true;
    material.depthWrite = false;
    if (isColor && "color" in material) {
      material.opacity = 0.01;
      material.color.set("#2FA4D7");
    } else if ("lodColor" in material) {
      material.opacity = 0.001;
      material.lodColor.set("#1c5e7a");
    }
  }
};

export const restoreModelMaterials = (components: OBC.Components) => {
  const worlds = components.get(OBC.Worlds);
  for (const world of worlds.list.values()) {
    if (world.renderer instanceof OBF.PostproductionRenderer) {
      world.renderer.postproduction.edgesPass.enabled = true;
    }
  }
  
  const fragments = components.get(OBC.FragmentsManager);
  for (const material of fragments.core.models.materials.list.values()) {
    const data = originalColors.get(material);
    if (data) {
      material.transparent = data.transparent;
      material.opacity = data.opacity;
      material.depthWrite = data.depthWrite;
      if (data.isColor && "color" in material) {
        material.color.setHex(data.color);
      } else if (!data.isColor && "lodColor" in material) {
        material.lodColor.setHex(data.color);
      }
      material.needsUpdate = true;
      originalColors.delete(material);
    }
  }
  isGhostModeActive = false;
};

// Context Menu 및 다른 곳에서 재사용할 수 있도록 핸들러 로직들을 분리
let lastHiddenSelection: OBC.ModelIdMap | null = null;
let isCurrentlyHidden = false;

const areModelIdMapsEqual = (a: OBC.ModelIdMap, b: OBC.ModelIdMap | null) => {
  if (!b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const setA = a[key];
    const setB = b[key];
    if (!setB || setA.size !== setB.size) return false;
    for (const val of setA) {
      if (!setB.has(val)) return false;
    }
  }
  return true;
};

const cloneModelIdMap = (map: OBC.ModelIdMap) => {
  const clone: OBC.ModelIdMap = {};
  for (const key in map) {
    clone[key] = new Set(map[key]);
  }
  return clone;
};

// 단축키 연동을 위한 버튼 DOM 참조 변수
let showAllBtn: BUI.Button | undefined;
let ghostBtn: BUI.Button | undefined;
let hiddenItemsBtn: BUI.Button | undefined;
let focusBtnRef: BUI.Button | undefined;
let hideBtn: BUI.Button | undefined;
let isolateBtn: BUI.Button | undefined;
let isFlyModeActive = false; // Fly Mode 상태를 추적하기 위한 변수
let floorExploder: FloorExploder | null = null;
let explodeBtn: BUI.Button | undefined;
let yScaleInput: HTMLInputElement | undefined;
let scaleContainer: HTMLDivElement | undefined;

const onScaleChange = () => {
  if (floorExploder) {
    const y = parseFloat(yScaleInput?.value || "5");
    floorExploder.setScales(y);
  }
};

if (!(window as any)._toolbarHotkeyRegistered) {
  (window as any)._toolbarHotkeyRegistered = true;
  window.addEventListener("keydown", (e) => {
    // Shadow DOM 내부의 input 요소에 포커스가 있는 경우 단축키 비활성화
    let activeEl = document.activeElement;
      while (activeEl?.shadowRoot?.activeElement) {
      activeEl = activeEl.shadowRoot.activeElement;
    }
    if (activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA") {
        e.stopPropagation(); // 캡처 단계에서 이벤트를 중단하여 외부 모듈의 전역 단축키(L 등) 방지
      return;
    }
    const key = e.key.toLowerCase();

    // Fly Mode가 켜져 있을 때는 이동 키(W, A, S, D)가 단축키로 작동하지 않도록 방지
    if (isFlyModeActive && ['w', 'a', 's', 'd'].includes(key)) {
      return;
    }

    if (key === 'a') showAllBtn?.click();
    if (key === 'g') ghostBtn?.click();
    if (key === 's') hiddenItemsBtn?.click();
    if (key === 'f') focusBtnRef?.click();
    if (key === 'h') hideBtn?.click();
    if (key === 'i') isolateBtn?.click();
    if (key === 'e') explodeBtn?.click();
    }, { capture: true }); // 다른 전역 리스너보다 먼저 이벤트를 가로채도록 캡처링 옵션 사용
}

export const showAllItems = async (components: OBC.Components) => {
  if (floorExploder?.isExploded) {
    floorExploder.setVisibility(true);
    const classifier = components.get(OBC.Classifier);
    const hiddenItemsGroup = classifier.list.get("PermanentHidden")?.get("HiddenItems");
    if (hiddenItemsGroup) {
      const hiddenItems = await hiddenItemsGroup.get();
      if (!OBC.ModelIdMapUtils.isEmpty(hiddenItems)) {
        floorExploder.setVisibility(false, hiddenItems);
      }
    }
    isCurrentlyHidden = false;
    lastHiddenSelection = null;
    return;
  }
  const hider = components.get(OBC.Hider);
  await hider.set(true);
  const classifier = components.get(OBC.Classifier);
  const hiddenItemsGroup = classifier.list.get("PermanentHidden")?.get("HiddenItems");
  if (hiddenItemsGroup) {
    const hiddenItems = await hiddenItemsGroup.get();
    if (!OBC.ModelIdMapUtils.isEmpty(hiddenItems)) {
      await hider.set(false, hiddenItems);
    }
  }
  isCurrentlyHidden = false;
  lastHiddenSelection = null;
};

export const toggleGhostMode = (components: OBC.Components) => {
  if (isGhostModeActive) {
    restoreModelMaterials(components);
  } else {
    setModelTransparent(components);
  }
  if (floorExploder) {
    floorExploder.setGhostMode(isGhostModeActive);
  }
  lastHiddenSelection = null;
  isCurrentlyHidden = false;
};

export const hideSelection = async (components: OBC.Components) => {
  const highlighter = components.get(Highlighter);
  const hider = components.get(OBC.Hider);
  const selection = highlighter.selection.select;
  if (OBC.ModelIdMapUtils.isEmpty(selection)) return;

  if (areModelIdMapsEqual(selection, lastHiddenSelection) && isCurrentlyHidden) {
    if (floorExploder?.isExploded) {
      floorExploder.setVisibility(true, selection);
    } else {
      await hider.set(true, selection); // 이미 숨긴 상태에서 또 누르면 다시 표시
    }
    isCurrentlyHidden = false;
    lastHiddenSelection = null;
  } else {
    if (floorExploder?.isExploded) {
      floorExploder.setVisibility(false, selection);
    } else {
      await hider.set(false, selection); // 처음 숨기는 경우
    }
    isCurrentlyHidden = true;
    lastHiddenSelection = cloneModelIdMap(selection);
  }
};

export const isolateSelection = async (components: OBC.Components) => {
  const highlighter = components.get(Highlighter);
  const hider = components.get(OBC.Hider);
  const selection = highlighter.selection.select;
  if (OBC.ModelIdMapUtils.isEmpty(selection)) return;
  if (floorExploder?.isExploded) {
    floorExploder.isolate(selection);
  } else {
    await hider.isolate(selection);
  }
};

export const viewerToolbarTemplate: BUI.StatefullComponent<
ViewerToolbarState
> = (state) => {
  const { components, world } = state;
  
  const highlighter = components.get(Highlighter);
  const hider = components.get(OBC.Hider);
  
  if (!floorExploder) {
    floorExploder = new FloorExploder(components);
  }

  const onShowAll = async ({ target }: { target: BUI.Button }) => {
    target.loading = true;
    await showAllItems(components);
    if (hiddenItemsBtn) hiddenItemsBtn.active = false;
    if (hideBtn) hideBtn.active = false;
    target.loading = false;
  };

  const onToggleGhost = () => {
    toggleGhostMode(components);
    if (ghostBtn) ghostBtn.active = isGhostModeActive;
    if (hideBtn) hideBtn.active = isCurrentlyHidden; // 고스트 모드가 켜지면 Hide 상태가 초기화되므로 동기화
  };

  const onToggleHidden = async ({ target }: { target: BUI.Button }) => {
    const classifier = components.get(OBC.Classifier);
    const hiddenItemsGroup = classifier.list.get("PermanentHidden")?.get("HiddenItems");
    if (!hiddenItemsGroup) return;
    const hiddenItems = await hiddenItemsGroup.get();
    if (OBC.ModelIdMapUtils.isEmpty(hiddenItems)) return;

    target.loading = true;
    const show = !target.active;
    if (floorExploder?.isExploded) {
      floorExploder.setVisibility(show, hiddenItems);
    } else {
      await hider.set(show, hiddenItems);
    }
    target.active = show;
    target.loading = false;
  };

  let focusBtn: BUI.TemplateResult | undefined;
  if (world.camera instanceof OBC.SimpleCamera) {
    const onFocus = async ({ target }: { target: BUI.Button }) => {
      if (floorExploder?.isExploded) {
        target.loading = true;
        await floorExploder.focusSelection();
        target.loading = false;
        return;
      }
      if (!(world.camera instanceof OBC.SimpleCamera)) return;
      const selection = highlighter.selection.select;
      target.loading = true;
      await world.camera.fitToItems(
        OBC.ModelIdMapUtils.isEmpty(selection) ? undefined : selection,
      );
      target.loading = false;
    };

    focusBtn = BUI.html`<bim-button ${BUI.ref((e) => { focusBtnRef = e as BUI.Button; })} tooltip-title=${tooltips.FOCUS.TITLE} tooltip-text=${tooltips.FOCUS.TEXT} icon=${appIcons.FOCUS} @click=${onFocus}></bim-button>`;
  }

  const onHide = async ({ target }: { target: BUI.Button }) => {
    target.loading = true;
    await hideSelection(components);
    if (hideBtn) hideBtn.active = isCurrentlyHidden;
    target.loading = false;
  };

  const onIsolate = async ({ target }: { target: BUI.Button }) => {
    target.loading = true;
    await isolateSelection(components);
    target.loading = false;
  };

  const customCameraControl = components.get(CustomCameraControl as any) as CustomCameraControl;
  isFlyModeActive = customCameraControl.flyMode.isFlyMode;

  const onToggleFlyMode = () => {
    customCameraControl.flyMode.toggle();
  };

  const setupFlyModeBtn = (e?: Element) => {
    if (!e) return;
    const btn = e as BUI.Button;
    btn.active = customCameraControl.flyMode.isFlyMode;

    // HUD(비행기 조종간) 오버레이 요소 생성
    let cockpitOverlay = document.getElementById("fly-mode-hud");
    if (!cockpitOverlay) {
      cockpitOverlay = document.createElement("div");
      cockpitOverlay.id = "fly-mode-hud";
      cockpitOverlay.style.position = "absolute";
      cockpitOverlay.style.inset = "0";
      cockpitOverlay.style.pointerEvents = "none";
      cockpitOverlay.style.zIndex = "50";
      cockpitOverlay.style.display = btn.active ? "block" : "none";
      cockpitOverlay.innerHTML = `
        <div style="position: absolute; inset: 0; box-shadow: inset 0 0 150px rgba(0,0,0,0.8);"></div>
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">
          <div style="width: 40px; height: 2px; background: rgba(0, 255, 0, 0.6); position: absolute; top: 0; left: -20px;"></div>
          <div style="width: 2px; height: 40px; background: rgba(0, 255, 0, 0.6); position: absolute; left: 0; top: -20px;"></div>
          <div style="width: 30px; height: 30px; border: 2px solid rgba(0, 255, 0, 0.6); border-radius: 50%; position: absolute; top: -15px; left: -15px;"></div>
        </div>
        <div id="fly-mode-coords" style="position: absolute; bottom: 30px; left: 30px; color: rgba(0, 255, 0, 0.8); font-family: monospace; font-size: 1.2rem;">
          <div>POS X: 0.00</div>
          <div>POS Y: 0.00</div>
          <div>POS Z: 0.00</div>
        </div>
        <div style="position: absolute; top: 30px; right: 30px; color: rgba(0, 255, 0, 0.8); font-family: monospace; font-size: 1.2rem; text-align: right;">
          <div>[ FLY MODE ]</div>
          <div style="font-size: 0.9rem; opacity: 0.8;">WASD to move</div>
        </div>
      `;
      const viewportElement = document.querySelector("bim-viewport");
      if (viewportElement) viewportElement.appendChild(cockpitOverlay);
    }

    const updateCoords = () => {
      if (!isFlyModeActive) return;
      const coordsEl = document.getElementById("fly-mode-coords");
      if (coordsEl && world.camera) {
        const pos = (world.camera as any).three?.position;
        if (pos) {
          coordsEl.innerHTML = `
            <div>POS X: ${pos.x.toFixed(2)}</div>
            <div>POS Y: ${pos.y.toFixed(2)}</div>
            <div>POS Z: ${pos.z.toFixed(2)}</div>
          `;
        }
      }
      requestAnimationFrame(updateCoords);
    };

    if ((btn as any)._flyModeListener) {
      customCameraControl.flyMode.onToggle.remove((btn as any)._flyModeListener);
    }
    (btn as any)._flyModeListener = (isFlyMode: boolean) => { 
      btn.active = isFlyMode; 
      isFlyModeActive = isFlyMode; // Fly Mode 상태 동기화
      if (cockpitOverlay) cockpitOverlay.style.display = isFlyMode ? "block" : "none";
      if (isFlyMode) updateCoords();
    };
    customCameraControl.flyMode.onToggle.add((btn as any)._flyModeListener);
  };

  const onToggleExplode = async ({ target }: { target: BUI.Button }) => {
    if (!floorExploder) return;
    target.loading = true;
    const wasExploded = floorExploder.isExploded;
    floorExploder.setGhostMode(isGhostModeActive);
    const success = await floorExploder.toggleExplode();
    if (success) {
      target.active = !wasExploded;
      if (scaleContainer) {
        scaleContainer.style.display = target.active ? "flex" : "none";
      }

      const applyHiddenStates = async (isExploding: boolean) => {
        if (hiddenItemsBtn && !hiddenItemsBtn.active) {
          const classifier = components.get(OBC.Classifier);
          const hiddenItemsGroup = classifier.list.get("PermanentHidden")?.get("HiddenItems");
          if (hiddenItemsGroup) {
            const hiddenItems = await hiddenItemsGroup.get();
            if (!OBC.ModelIdMapUtils.isEmpty(hiddenItems)) {
              if (isExploding) floorExploder!.setVisibility(false, hiddenItems);
              else await components.get(OBC.Hider).set(false, hiddenItems);
            }
          }
        }
        if (hideBtn && isCurrentlyHidden && lastHiddenSelection) {
          if (isExploding) floorExploder!.setVisibility(false, lastHiddenSelection);
          else await components.get(OBC.Hider).set(false, lastHiddenSelection);
        }
      };

      if (target.active) {
        await applyHiddenStates(true);
      } else {
        setTimeout(() => { applyHiddenStates(false); }, 1100);
      }
    }
    target.loading = false;
  };

  return BUI.html`
    <bim-toolbar style="overflow: visible; z-index: 100;">
      <bim-toolbar-section style="overflow: visible;">
        <bim-button ${BUI.ref((e) => { showAllBtn = e as BUI.Button; })} tooltip-title=${tooltips.SHOW_ALL.TITLE} tooltip-text=${tooltips.SHOW_ALL.TEXT} icon=${appIcons.SHOW} @click=${onShowAll}></bim-button> 
        <bim-button ${BUI.ref((e) => { ghostBtn = e as BUI.Button; if(ghostBtn) ghostBtn.active = isGhostModeActive; })} tooltip-title=${tooltips.GHOST.TITLE} tooltip-text=${tooltips.GHOST.TEXT} icon=${appIcons.TRANSPARENT} @click=${onToggleGhost}></bim-button>
        <bim-button ${BUI.ref((e) => { hiddenItemsBtn = e as BUI.Button; })} tooltip-title=${tooltips.TOGGLE_HIDDEN.TITLE} tooltip-text=${tooltips.TOGGLE_HIDDEN.TEXT} icon=${appIcons.MODEL} @click=${onToggleHidden}></bim-button>
      </bim-toolbar-section> 
      <bim-toolbar-section style="overflow: visible;">
        ${focusBtn}
        <bim-button ${BUI.ref((e) => { hideBtn = e as BUI.Button; if(hideBtn) hideBtn.active = isCurrentlyHidden; })} tooltip-title=${tooltips.HIDE.TITLE} tooltip-text=${tooltips.HIDE.TEXT} icon=${appIcons.HIDE} @click=${onHide}></bim-button> 
        <bim-button ${BUI.ref((e) => { isolateBtn = e as BUI.Button; })} tooltip-title=${tooltips.ISOLATE.TITLE} tooltip-text=${tooltips.ISOLATE.TEXT} icon=${appIcons.ISOLATE} @click=${onIsolate}></bim-button>
        ${Colorize(components)}
      </bim-toolbar-section> 
      <bim-toolbar-section style="overflow: visible;">
        <bim-button ${BUI.ref(setupFlyModeBtn)} tooltip-title=${tooltips.FLY.TITLE} tooltip-text=${tooltips.FLY.TEXT} icon=${appIcons.FLY} @click=${onToggleFlyMode}></bim-button>
        <div style="position: relative;">
          <bim-button ${BUI.ref((e) => { explodeBtn = e as BUI.Button; if(explodeBtn && floorExploder) explodeBtn.active = floorExploder.isExploded; })} tooltip-title=${tooltips.FLOOR_EXPLODE.TITLE} tooltip-text=${tooltips.FLOOR_EXPLODE.TEXT} icon=${appIcons.LAYERS} @click=${onToggleExplode}></bim-button>
          <div ${BUI.ref(e => { scaleContainer = e as HTMLDivElement; if(scaleContainer && floorExploder) scaleContainer.style.display = floorExploder.isExploded ? "flex" : "none"; })} style="display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); z-index: 100; background: var(--bim-ui_bg-base); border: 1px solid var(--bim-ui_bg-contrast-20); padding: 0.5rem; border-radius: 0.25rem; margin-bottom: 0.25rem; flex-direction: column; gap: 0.5rem; min-width: 120px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
            <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--bim-ui_gray-10);">
              <span>Y Scale</span>
              <span ${BUI.ref(e => { if(e) e.textContent = floorExploder?.yScale.toFixed(1) || "5.0"; })}>5.0</span>
            </div>
            <input ${BUI.ref(e => { yScaleInput = e as HTMLInputElement; })} type="range" min="2" max="20" step="0.5" value="5" @input=${(e: Event) => {
              const val = (e.target as HTMLInputElement).value;
              (e.target as HTMLElement).previousElementSibling!.children[1].textContent = Number(val).toFixed(1);
              onScaleChange();
            }} style="width: 100%; cursor: pointer;">
          </div>
        </div>
      </bim-toolbar-section>
    </bim-toolbar>
  `;
};

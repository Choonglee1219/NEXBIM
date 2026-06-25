import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";
import { html } from "lit";
import * as TEMPLATES from "./ui-templates";
import { appIcons, CONTENT_GRID_ID, appState } from "./globals";
import { setupFinders } from "./setup/finders";
import { setupViewTemplates } from "./setup/templaters";
import { initDrawingEditor } from "./ui-templates/sections/drawing";
import { setupViewCube } from "./ui-components/ViewCube";
import { Highlighter } from "./bim-components/Highlighter";
import { setupContextMenu } from "./ui-components/ContextMenu";
import { CustomCameraControl } from "./bim-components/CustomCameraControl";
import { setupBoxSelection } from "./ui-components/BoxSelection";
import { Measurer } from "./bim-components/Measurer";
import { ClipperBox } from "./bim-components/ClipperBox";
import { bimChatPanel } from "./bim-components";

// 🎨Override the bim-label template to use a local SVG icon and apply custom colors
// @ts-ignore
BUI.Label.prototype.render = function () {
  const isSvgIcon = this.icon?.includes(".svg");
  const iconTemplate = isSvgIcon
    ? html`<div
          style="
            background-color: var(--bim-label--c, var(--bim-ui_main-base));
            -webkit-mask-image: url(${this.icon});
            mask-image: url(${this.icon});
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-size: 100% 100%;
            mask-size: 100% 100%;
            width: var(--bim-icon--fz, var(--bim-ui_size-sm));
            height: var(--bim-icon--fz, var(--bim-ui_size-sm));
          "
        ></div>`
    : BUI.html`<bim-icon .icon=${this.icon}></bim-icon>`;
  return html`<div class="parent" title=${this.textContent}>
    ${this.img ? html`<img src=${this.img} alt=${this.textContent || ""} />` : ""}
    ${!this.iconHidden && this.icon ? iconTemplate : ""}
    <p><slot></slot></p>
  </div>`;
};

// 🛫Interface Initialization
BUI.Manager.init();
CUI.Manager.init();

// 🌐Components Setup
const components = new OBC.Components();

// 🌐Worlds Setup and Configuration
const worlds = components.get(OBC.Worlds);

const world = worlds.create<
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBF.PostproductionRenderer
>();

world.name = "Main";
world.scene = new OBC.SimpleScene(components);
world.scene.setup();
world.scene.three.background = null;

const viewport = BUI.Component.create<BUI.Viewport>(() => {
  return BUI.html`<bim-viewport></bim-viewport>`;
});

world.renderer = new OBF.PostproductionRenderer(components, viewport);
world.renderer.showLogo = false;
world.renderer.enabled = false;
world.camera = new OBC.OrthoPerspectiveCamera(components);
world.camera.threePersp.near = 0.5;
world.camera.threePersp.far = 100000;
world.camera.threePersp.updateProjectionMatrix();
world.camera.controls.restThreshold = 0.05;

// 🧊 ViewCube Setup
setupViewCube(world, viewport);

const worldGrid = components.get(OBC.Grids).create(world);
worldGrid.material.uniforms.uColor.value = new THREE.Color(0x494b50);
worldGrid.material.uniforms.uSize1.value = 2;
worldGrid.material.uniforms.uSize2.value = 10;
worldGrid.visible = false;
worldGrid.three.position.y = -20;

const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0) {
      if (world.renderer) {
        world.renderer.enabled = true;
        world.renderer.resize();
      }
      world.camera?.updateAspect();
    } else {
      if (world.renderer) {
        world.renderer.enabled = false;
      }
    }
  }
});
resizeObserver.observe(viewport);

world.dynamicAnchor = false;

components.init();

components.get(OBC.Raycasters).get(world);

// 🖼️Post-production Setup
const { postproduction } = world.renderer;
postproduction.enabled = true;
postproduction.style = OBF.PostproductionAspect.COLOR_PEN_SHADOWS;

const { aoPass, edgesPass } = world.renderer.postproduction;

edgesPass.enabled = true;
edgesPass.color = new THREE.Color(0x494b50);
edgesPass.width = 1;

const aoParameters = {
  radius: 0.25,
  distanceExponent: 1,
  thickness: 0.1,
  scale: 1,
  samples: 16,
  distanceFallOff: 1,
  screenSpaceRadius: true,
};

const pdParameters = {
  lumaPhi: 10,
  depthPhi: 2,
  normalPhi: 3,
  radius: 4,
  radiusExponent: 1,
  rings: 2,
  samples: 16,
};

aoPass.updateGtaoMaterial(aoParameters);
aoPass.updatePdMaterial(pdParameters);

// 🧩FragmentsManager Setup
const fragments = components.get(OBC.FragmentsManager);
fragments.init("/node_modules/@thatopen/fragments/dist/Worker/worker.mjs");

fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
  const isLod = "isLodMaterial" in material && material.isLodMaterial;
  if (isLod) {
    world.renderer!.postproduction.basePass.isolatedMaterials.push(material);
  }
  material.polygonOffset = true;
  material.polygonOffsetUnits = 4;
  material.polygonOffsetFactor = 2;
  // This logic is to apply a default transparency to the base model materials.
  // We must avoid overriding materials created by the Highlighter.
  const isHighlighterMaterial = !!material.userData.customId;
  if (!isHighlighterMaterial) {
    material.transparent = true;
    material.opacity = 0.95;
  }
});

// 📷Camera EventHandler
world.camera.projection.onChanged.add(() => {
  for (const [_, model] of fragments.list) {
    world.renderer!.postproduction.basePass.camera = world.camera.three;
    world.renderer!.postproduction.aoPass.camera = world.camera.three;
    model.useCamera(world.camera.three);
  }
});

world.camera.controls.addEventListener("rest", () => {
  fragments.core.update(true);
});

// 🚚IfcLoader Setup
const ifcLoader = components.get(OBC.IfcLoader);
await ifcLoader.setup({
  autoSetWasm: false,
  wasm: {
    absolute: true,
    path: "/node_modules/web-ifc/",
  },
  webIfc: {
    COORDINATE_TO_ORIGIN: false,  // 좌표 원점 조정 해제
  },
});

// ✅Highlighter Setup
const highlighter = new Highlighter(components);

highlighter.setup({
  world,
  selectMaterialDefinition: {
    color: new THREE.Color("#8fbc0c"),
    renderedFaces: 1,
    opacity: 0.6,
    transparent: true,
  },
});

// 🎨 Custom highlighter style for Spatial Entities
highlighter.styles.set("transparentCyan", {
  color: new THREE.Color("#00ffff"),
  renderedFaces: 1,
  opacity: 0.02,
  transparent: true,
});

// ✂️Clipper Setup
const clipper = components.get(OBC.Clipper);
clipper.onAfterCreate.add((plane: any) => {
  const mat = clipper.material.clone();
  mat.transparent = true;
  mat.opacity = 0.01;

  if ("planeMaterial" in plane) {
    plane.planeMaterial = mat;
  } else if ("material" in plane) {
    plane.material = mat;
  }

  if (plane.controls) {
    plane.controls.size = 0.7;
  }
});

viewport.ondblclick = () => {
  if (clipper.enabled && !components.get(ClipperBox).enabled) clipper.create(world);
};

window.addEventListener("keydown", (event) => {
  if (event.code === "Delete" || event.code === "Backspace") {
    clipper.delete(world);
  }
});

// ‍♂️ Custom Camera Control 초기화
new CustomCameraControl(components, world, viewport, highlighter);

// 📐 Measurer Setup
const measurer = components.get(Measurer);
measurer.init(world, viewport);

// 📦 Clipper Box Setup
const clipperBox = components.get(ClipperBox);
clipperBox.init(world);

// 🔲 Box Selection Setup
setupBoxSelection(components, world, viewport, highlighter);

// 📌 Context Menu Setup
setupContextMenu(components, world, viewport);

let fitCameraTimeout: ReturnType<typeof setTimeout> | null = null;
const fitCameraToAllModels = () => {
  if (fitCameraTimeout) {
    clearTimeout(fitCameraTimeout);
  }
  fitCameraTimeout = setTimeout(async () => {
    if (world.camera instanceof OBC.SimpleCamera) {
      await world.camera.fitToItems();
    }
  }, 500);
};

// 🚚Model Load EventHandler
fragments.list.onItemSet.add(async ({ value: model }) => {
  const finder = components.get(OBC.ItemsFinder);
  for (const [_, query] of finder.list) {
    query.clearCache();
  }

  model.useCamera(world.camera.three);
  model.getClippingPlanesEvent = () => {
    return Array.from(world.renderer!.three.clippingPlanes) || [];
  };
  world.scene.three.add(model.object);
  await fragments.core.update(true);

  const classifier = components.get(OBC.Classifier);
  const hider = components.get(OBC.Hider);
  const categoryNames = ["IFCSPACE", "IFCSPATIALZONE", "IFCOPENINGELEMENT"];
  const categoriesRegex = categoryNames.map((cat) => new RegExp(`^${cat}$`));
  const items = await model.getItemsOfCategories(categoriesRegex);
  const localIds = Object.values(items).flat();
  const modelIdMap = { [model.modelId]: new Set(localIds) };
  classifier.addGroupItems("PermanentHidden", "HiddenItems", modelIdMap);

  await highlighter.highlightByID("transparentCyan", modelIdMap, false, false);
  await hider.set(false, modelIdMap);

  if (!appState.hasExternalLink) {
    fitCameraToAllModels();
  }
});

fragments.list.onItemDeleted.add(async () => {
  const finder = components.get(OBC.ItemsFinder);
  for (const [_, query] of finder.list) {
    query.clearCache();
  }
  await highlighter.clear("select");
  await fragments.core.update(true);
});

// 🔎Finder Setup - "src > setup > finders.ts"
setupFinders(components);

// 🔭ViewTemplater Setup - "src > setup > templaters.ts"
setupViewTemplates(components);

// 🖥️UI Layout Configuration
const [viewportSettings] = BUI.Component.create(TEMPLATES.viewportSettingsTemplate, {
  components,
  world,
});

viewport.append(viewportSettings);

const [viewportGrid] = BUI.Component.create(TEMPLATES.viewportGridTemplate, {
  components,
  world,
});

viewport.append(viewportGrid);

const viewportCardTemplate = () => BUI.html`
  <div class="dashboard-card" style="padding: 0px;">
    ${viewport}
  </div>
`;

// 🏁Content Grid Setup
const [contentGrid] = BUI.Component.create<
  BUI.Grid<TEMPLATES.ContentGridLayouts, TEMPLATES.ContentGridElements>,
  TEMPLATES.ContentGridState
>(TEMPLATES.contentGridTemplate, {
  components,
  id: CONTENT_GRID_ID,
  viewportTemplate: viewportCardTemplate,
  world,
});

const setInitialLayout = () => {
  if (window.location.hash) {
    const hash = window.location.hash.slice(
      1,
    ) as TEMPLATES.ContentGridLayouts[number];
    if (Object.keys(contentGrid.layouts).includes(hash)) {
      contentGrid.layout = hash;
    } else {
      contentGrid.layout = "Viewer";
      window.location.hash = "Viewer";
    }
  } else {
    window.location.hash = "Viewer";
    contentGrid.layout = "Viewer";
  }
};

setInitialLayout();

contentGrid.addEventListener("layoutchange", () => {
  window.location.hash = contentGrid.layout as string;
});

const contentGridIcons: Record<TEMPLATES.ContentGridLayouts[number], string> = {
  Viewer: appIcons.MODEL,
  BCFManager: appIcons.REF,
  Queries: appIcons.SEARCH,
  Properties: appIcons.EDIT,
  Quantities: appIcons.TABLE,
  FullScreen: appIcons.FULL_SCREEN,
  ViewPoints: appIcons.CAMERA,
  IDSCheck: appIcons.IDS_CHECK,
  ClashDetection: appIcons.CLASH,
  DrawingEditor: appIcons.DRAWING,
  Timeline: appIcons.GANTT,
};

// 🏁App Grid Setup
type AppLayouts = ["App", "ProjectSelection"];

type Sidebar = {
  name: "sidebar";
  state: TEMPLATES.GridSidebarState;
};

type ContentGrid = {
  name: "contentGrid";
  state: TEMPLATES.ContentGridState;
};

type ProjectSelector = {
  name: "projectSelector";
  state: TEMPLATES.ProjectSelectorState;
};

type RightSidebar = {
  name: "rightSidebar";
  state: any;
};

type AppGridElements = [Sidebar, ContentGrid, ProjectSelector, RightSidebar];

const app = document.getElementById("app") as BUI.Grid<
  AppLayouts,
  AppGridElements
>;

// ---------------------------------------------------------
// 📐 2D Drawing Editor 설정
// ---------------------------------------------------------
await initDrawingEditor(components, world);

// 🤖 BimChat Panel setup as Right Sidebar
const [chatPanel] = bimChatPanel({ components, world });
chatPanel.id = "bim-chat-panel";
chatPanel.style.display = "none";
chatPanel.style.width = "0px";
chatPanel.style.height = "100%";

// Define toggle function globally
(window as any).toggleBimChat = (force?: boolean) => {
  const panel = document.getElementById("bim-chat-panel") as HTMLElement;
  const toggleBtn = document.getElementById("bim-chat-toggle-btn") as any;
  if (!panel) return;

  const show = force !== undefined ? force : (panel.style.display === "none");
  if (show) {
    panel.style.display = "flex";
    panel.style.width = "360px";
    if (toggleBtn) toggleBtn.active = true;
    setTimeout(() => {
      const textarea = panel.querySelector("textarea") as HTMLTextAreaElement;
      if (textarea) textarea.focus();
    }, 100);
  } else {
    panel.style.display = "none";
    panel.style.width = "0px";
    if (toggleBtn) toggleBtn.active = false;
  }
};

app.elements = {
  sidebar: {
    template: TEMPLATES.gridSidebarTemplate,
    initialState: {
      grid: contentGrid,
      isCompact: true,
      layoutIcons: contentGridIcons,
    },
  },
  contentGrid,
  rightSidebar: chatPanel,
  projectSelector: {
    template: TEMPLATES.projectSelectorTemplate,
    initialState: {
      onProjectSelect: (project) => {
        appState.currentProject = project;
        appState.isAdmin = project.security === "free";
        window.location.hash = "Viewer";
        window.location.reload();
      },
    },
  },
};

contentGrid.addEventListener("layoutchange", () =>
  app.updateComponent.sidebar(),
);

app.layouts = {
  App: {
    template: `
      "sidebar contentGrid rightSidebar" 1fr
      /auto 1fr auto
    `,
  },
  ProjectSelection: {
    template: `
      "projectSelector" 1fr
      /1fr
    `,
  },
};

const params = new URLSearchParams(window.location.search);
appState.hasExternalLink = params.has("project");

// 🔗 외부 시스템 연동 (URL Parameter 처리 - 프로젝트 진입 및 레이아웃 설정 전담)
const handleExternalLink = async () => {
  const paramProject = params.get("project");
  if (!paramProject) return;

  // 동기적으로 레이아웃과 뷰어 해시를 먼저 선점하여 화면 튕김 현상 방지
  app.layout = "App";
  window.location.hash = "Viewer";

  // 1. 현재 사용자 확인 및 기본 데모 계정 할당
  if (!appState.currentUser) {
    appState.currentUser = "choonglee1219@kepco-enc.com";
    appState.isAdmin = true;
  }

  try {
    console.log(`[ExternalLink] Searching for project: ${paramProject}`);
    // 2. 프로젝트 리스트를 조회하여 이름이 일치하는 프로젝트 검색
    const res = await fetch(`/api/projects?email=${appState.currentUser}`);
    if (!res.ok) throw new Error("Failed to fetch projects");
    const projects = await res.json();
    const targetProject = projects.find((p: any) => p.name === paramProject);

    if (!targetProject) {
      console.warn(`[ExternalLink] Project "${paramProject}" not found.`);
      appState.hasExternalLink = false;
      return;
    }

    console.log(`[ExternalLink] Entering project: ${targetProject.name} (ID: ${targetProject.id})`);
    // 3. 프로젝트 진입 상태 설정
    appState.currentProject = {
      id: targetProject.id,
      name: targetProject.name,
      description: targetProject.description,
      security: targetProject.security,
    };
    appState.isAdmin = targetProject.security === "free";

  } catch (err) {
    console.error("[ExternalLink] Automation failed:", err);
    appState.hasExternalLink = false;
  }
};

const handleMainRouting = () => {
  const hash = window.location.hash;
  if (appState.hasExternalLink) {
    app.layout = "App";
    window.location.hash = "Viewer";
  } else if (hash === "" || hash === "#projects" || !appState.currentProject) {
    appState.currentProject = null;
    window.location.hash = "projects";
    app.layout = "ProjectSelection";
  } else {
    app.layout = "App";
  }
};

window.addEventListener("hashchange", () => {
  if (window.location.hash === "#projects") {
    appState.currentProject = null;
    app.layout = "ProjectSelection";
  }
});

// 외부 연동 파라미터가 있을 경우 핸들러 비동기 구동
if (appState.hasExternalLink) {
  await handleExternalLink();
}

handleMainRouting();

import * as THREE from "three";
import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";
import * as OBC from "@thatopen/components";
import * as OBF from "../../bim-components/DrawingEditor";
import { appIcons, tableButtonStyle } from "../../globals";

export interface DrawingEditorState {
  components: OBC.Components;
  world: OBC.World;
}

let activeTool: "linear" | "angle" | "callout" | "leader" | "block" | "slope" | null = null;
let projected = false;
let paperEditMode = false;
let activeVpEl: HTMLElement | null = null;
let board: CUI.SheetBoard | null = null;
let isEventsRegistered = false;
let sectionClipId: string | null = null;
let cutElevation = 1.2;
let activeBlockName: "COLUMN" | "DOOR" = "COLUMN";
let lastInsertedBlockUuid: string | null = null;
let activeColorLayer: string | null = null;
let layerTable: BUI.Table<any> | null = null;

// ─── Style lookup maps ────────────────────────────────────────────────────────
const LINE_TICKS: Record<string, any> = {
  "Diagonal":   OBC.DiagonalTick,
  "Arrow":      OBC.ArrowTick,
  "Open Arrow": OBC.OpenArrowTick,
  "Dot":        OBC.DotTick,
  "None":       OBC.NoTick,
};

// 튜토리얼에서 제공된 커스텀 마름모(Diamond) 마커 기하학 생성 함수
const DiamondTick: OBC.MeshTickBuilder = (tip, lineDir, size) => {
  const perp  = new THREE.Vector3(-lineDir.z, 0, lineDir.x);
  const mid   = tip.clone().addScaledVector(lineDir, -size * 0.5);
  const back  = tip.clone().addScaledVector(lineDir, -size);
  const left  = mid.clone().addScaledVector(perp, -size * 0.3);
  const right = mid.clone().addScaledVector(perp,  size * 0.3);
  return [
    tip.x,   tip.y,   tip.z,   left.x,  left.y,  left.z,  back.x,  back.y,  back.z,
    tip.x,   tip.y,   tip.z,   back.x,  back.y,  back.z,  right.x, right.y, right.z,
  ];
};

const MESH_TICKS: Record<string, any | undefined> = {
  "Filled Arrow":  OBC.FilledArrowTick,
  "Filled Circle": OBC.FilledCircleTick,
  "Filled Square": OBC.FilledSquareTick,
  "Diamond (Custom)": DiamondTick,
  "None":          undefined,
};

const DIM_UNITS: Record<string, any> = {
  "Meters (m)": OBC.Units.m,
  "Centimeters (cm)": OBC.Units.cm,
  "Millimeters (mm)": OBC.Units.mm,
  "Feet (ft)": OBC.Units.ft,
  "Inches (in)": OBC.Units.in,
};

const ENCLOSURES: Record<string, any> = {
  "Cloud":     OBC.CloudEnclosure,
  "Rectangle": OBC.RectEnclosure,
  "Circle":    OBC.CircleEnclosure,
};

const ACI_COLORS = [
  "#000000", "#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF00FF", "#FFFFFF", "#414141", "#808080",
  "#FF0000", "#FFAAAA", "#BD0000", "#BD7E7E", "#810000", "#815656", "#680000", "#684545", "#4F0000", "#4F3535",
  "#FF3F00", "#FFBFAA", "#BD2E00", "#BD8D7E", "#811F00", "#816056", "#681900", "#684E45", "#4F1300", "#4F3B35",
  "#FF7F00", "#FFD4AA", "#BD5E00", "#BD9D7E", "#814000", "#816B56", "#683400", "#685645", "#4F2700", "#4F4235",
  "#FFBF00", "#FFEAAA", "#BD8D00", "#BDAD7E", "#816000", "#817656", "#684E00", "#685F45", "#4F3B00", "#4F4935",
  "#FFFF00", "#FFFFAA", "#BDBD00", "#BDBD7E", "#818100", "#818156", "#686800", "#686845", "#4F4F00", "#4F4F35",
  "#BFFF00", "#EAFFAA", "#8DBD00", "#ADBD7E", "#608100", "#768156", "#4E6800", "#5F6845", "#3B4F00", "#494F35",
  "#7FFF00", "#D4FFAA", "#5EBD00", "#9DBD7E", "#408100", "#6B8156", "#346800", "#566845", "#274F00", "#424F35",
  "#3FFF00", "#BFFFAA", "#2EBD00", "#8DBD7E", "#1F8100", "#608156", "#196800", "#4E6845", "#134F00", "#3B4F35",
  "#00FF00", "#AAFFAA", "#00BD00", "#7EBD7E", "#008100", "#568156", "#006800", "#456845", "#004F00", "#354F35",
  "#00FF3F", "#AAFFBF", "#00BD2E", "#7EBD8D", "#00811F", "#568160", "#006819", "#45684E", "#004F13", "#354F3B",
  "#00FF7F", "#AAFFD4", "#00BD5E", "#7EBD9D", "#008140", "#56816B", "#006834", "#456856", "#004F27", "#354F42",
  "#00FFBF", "#AAFFEA", "#00BD8D", "#7EBDAD", "#008160", "#568176", "#00684E", "#45685F", "#004F3B", "#354F49",
  "#00FFFF", "#AAFFFF", "#00BDBD", "#7EBDBD", "#008181", "#568181", "#006868", "#456868", "#004F4F", "#354F4F",
  "#00BFFF", "#AAEAFF", "#008DBD", "#7EADBD", "#006081", "#567681", "#004E68", "#455F68", "#003B4F", "#35494F",
  "#007FFF", "#AAD4FF", "#005EBD", "#7E9DBD", "#004081", "#566B81", "#003468", "#455668", "#00274F", "#35424F",
  "#003FFF", "#AABFFF", "#002EBD", "#7E8DBD", "#001F81", "#566081", "#001968", "#454E68", "#00134F", "#353B4F",
  "#0000FF", "#AAAAFF", "#0000BD", "#7E7EBD", "#000081", "#565681", "#000068", "#454568", "#00004F", "#35354F",
  "#3F00FF", "#BFAAFF", "#2E00BD", "#8D7EBD", "#1F0081", "#605681", "#190068", "#4E4568", "#13004F", "#3B354F",
  "#7F00FF", "#D4AAFF", "#5E00BD", "#9D7EBD", "#400081", "#6B5681", "#340068", "#564568", "#27004F", "#42354F",
  "#BF00FF", "#EAAAFF", "#8D00BD", "#AD7EBD", "#600081", "#765681", "#4E0068", "#5F4568", "#3B004F", "#49354F",
  "#FF00FF", "#FFAAFF", "#BD00BD", "#BD7EBD", "#810081", "#815681", "#680068", "#684568", "#4F004F", "#4F354F",
  "#FF00BF", "#FFAAEA", "#BD008D", "#BD7EAD", "#810060", "#815676", "#68004E", "#68455F", "#4F003B", "#4F3549",
  "#FF007F", "#FFAAD4", "#BD005E", "#BD7E9D", "#810040", "#81566B", "#680034", "#684556", "#4F0027", "#4F3542",
  "#FF003F", "#FFAABF", "#BD002E", "#BD7E8D", "#81001F", "#815660", "#680019", "#68454E", "#4F0013", "#4F353B",
  "#333333", "#505050", "#696969", "#828282", "#BEBEBE", "#FFFFFF"
];

function lookupKey<T>(map: Record<string, T>, val: T, fallback = "None"): string {
  return Object.entries(map).find(([, v]) => v === val)?.[0] ?? fallback;
}

function hexStr(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

export const drawingEditorTemplate: BUI.StatefullComponent<DrawingEditorState> = (state, update) => {
  const { components, world } = state;
  const editor = components.get(OBF.DrawingEditor);
  const techDrawings = components.get(OBC.TechnicalDrawings);

  const dimTool = editor.use(OBF.LinearAnnotationsTool);
  const angleTool = editor.use(OBF.AngleAnnotationsTool);
  const calloutTool = editor.use(OBF.CalloutAnnotationsTool);
  const leaderTool = editor.use(OBF.LeaderAnnotationsTool);
  const blockTool = editor.use(OBF.BlockAnnotationsTool);
  const slopeTool = editor.use(OBF.SlopeAnnotationsTool);

  const setActiveTool = (key: "linear" | "angle" | "callout" | "leader" | "block" | "slope" | null) => {
    activeTool = key;
    editor.activeTool =
      key === "linear" ? OBF.LinearAnnotationsTool :
      key === "angle" ? OBF.AngleAnnotationsTool :
      key === "callout" ? OBF.CalloutAnnotationsTool :
      key === "leader" ? OBF.LeaderAnnotationsTool :
      key === "block" ? OBF.BlockAnnotationsTool :
      key === "slope" ? OBF.SlopeAnnotationsTool :
      null;
    update();
  };

  const projectFromModel = async (button: BUI.Button) => {
    const target = editor.activeDrawing;
    if (!target) return;
    
    button.loading = true;
    update();

    // 사용자가 설정한 Cut Elevation(단면 높이)을 도면 투영 평면에 적용
    target.three.position.set(0, cutElevation, 0);
    target.three.updateMatrixWorld(true);

    try {
      const fragments = components.get(OBC.FragmentsManager);
      const hider = components.get(OBC.Hider);
      const classifier = components.get(OBC.Classifier);
      
      try {
        await classifier.byCategory({ classificationName: "entities" });
      } catch (e) {
        console.warn("Classifier grouping error:", e);
      }
      const entitiesGroup = classifier.list.get("entities");
      
      // 1. 현재 화면에서 명시적으로 숨겨진(Hidden) 객체만 추출
      const hiddenItemsMap = await hider.getVisibilityMap(false);
      const modelIdMap: OBC.ModelIdMap = {};
      
      for (const [id, model] of fragments.list) {
        // 💡 1. 모델 전체가 숨김 처리된 경우 투영에서 완전히 제외
        if ((model.object && !model.object.visible) || (model as any).visible === false) continue;

        const idsWithGeometry = await model.getItemsIdsWithGeometry();
        
        // 💡 2. 해당 모델에서 숨김 처리된 객체 ID들을 Set으로 구성
        const hiddenSet = new Set(hiddenItemsMap[id] || []);
        
        // 기하학적 형태가 있으면서 '숨겨지지 않은' 객체만 필터링 (Subtract 방식)
        const filteredIds = idsWithGeometry.filter(itemId => !hiddenSet.has(itemId));
        if (filteredIds.length > 0) {
          modelIdMap[id] = new Set(filteredIds);
        }
      }

      // 2. 필터링된 객체들만의 경계 상자를 계산하여 뷰포트 자동 맞춤
      const boxer = components.get(OBC.BoundingBoxer);
      boxer.list.clear();
      
      if (Object.keys(modelIdMap).length > 0) {
        await boxer.addFromModelIdMap(modelIdMap);
      }
      
      const box = boxer.get();
      boxer.list.clear();
  
      if (!box.isEmpty()) {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
  
        // 도면의 중심을 모델의 중심으로 이동
        target.three.position.set(center.x, cutElevation, center.z);
        target.three.updateMatrixWorld(true);
  
        // 뷰포트 크기를 모델 크기에 맞게 조정 (약간의 여백 추가)
        const viewport = Array.from(target.viewports.values())[0];
        if (viewport) {
          const margin = 1.2;
          viewport.left = -(size.x / 2) * margin;
          viewport.right = (size.x / 2) * margin;
          viewport.top = (size.z / 2) * margin;
          viewport.bottom = -(size.z / 2) * margin;
        }
      }
  
      const clipper = components.get(OBC.Clipper);
      clipper.enabled = true;
      if (sectionClipId) {
        await clipper.delete(world, sectionClipId);
        sectionClipId = null;
      }
      
      // 3. 기존에 투영된 선들(투영선)만 찾아서 도면에서 확실하게 제거 (메모리 누수 및 잔상 방지)
      const linesToRemove: THREE.Object3D[] = [];
      target.three.children.forEach((child) => {
        const layerName = child.userData.layer;
        if (child instanceof THREE.LineSegments && layerName && layerName !== "Annotations" && layerName !== "0") {
          linesToRemove.push(child);
        }
      });
      linesToRemove.forEach((child) => {
        child.removeFromParent();
        if ((child as THREE.LineSegments).geometry) {
          (child as THREE.LineSegments).geometry.dispose();
        }
        if ((child as any).material) {
          if (Array.isArray((child as any).material)) {
            (child as any).material.forEach((m: any) => m.dispose());
          } else {
            (child as any).material.dispose();
          }
        }
      });
  
      // 4. 필터링된 객체들만 도면으로 투영
      if (Object.keys(modelIdMap).length > 0) {
        if (entitiesGroup) {
          // 엔티티별로 그룹화된 데이터를 순회하며 레이어를 동적으로 생성 및 투영
          for (const [catName, group] of entitiesGroup.entries()) {
            const mapData = await (group as any).get();
            const intersectedMap: OBC.ModelIdMap = {};
            let hasItems = false;
            
            // 현재 화면에 보이고 투영할 객체(modelIdMap)와 엔티티 그룹(mapData)의 교집합 추출
            for (const modelId in mapData) {
              if (modelIdMap[modelId]) {
                const visibleIds = modelIdMap[modelId];
                const intersectedIds = Array.from(mapData[modelId]).filter(id => visibleIds.has(id as number));
                if (intersectedIds.length > 0) {
                  intersectedMap[modelId] = new Set(intersectedIds as number[]);
                  hasItems = true;
                }
              }
            }

            if (hasItems) {
              const cleanCatName = catName.replace(/^IFC/i, "");
              const visibleLayer = `${cleanCatName}_Visible`;
              const hiddenLayer = `${cleanCatName}_Hidden`;

              if (!target.layers.has(visibleLayer)) {
                // 카테고리 이름 문자열 해시를 통해 고유 색상(랜덤하지만 일관된 컬러) 생성
                const hash = [...cleanCatName].reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
                const colorHex = new THREE.Color(`hsl(${Math.abs(hash) % 360}, 70%, 40%)`).getHex();
                target.layers.create(visibleLayer, { material: new THREE.LineBasicMaterial({ color: colorHex }) });
                target.layers.create(hiddenLayer, { material: new THREE.LineDashedMaterial({ color: 0x888888, dashSize: 0.2, gapSize: 0.1 }), visible: false });
              }

              await target.addProjectionFromItems(intersectedMap, {
                layers: { visible: visibleLayer, hidden: hiddenLayer }
              });
            }
          }
        } else {
          // Classifier 실패 시 기본 방식
          if (!target.layers.has("Visible")) {
            target.layers.create("Visible", { material: new THREE.LineBasicMaterial({ color: 0x000000 }) });
            target.layers.create("Hidden", { material: new THREE.LineDashedMaterial({ color: 0x888888, dashSize: 0.2, gapSize: 0.1 }), visible: false });
          }
          await target.addProjectionFromItems(modelIdMap, {
            layers: { visible: "Visible", hidden: "Hidden" }
          });
        }
      }
  
      // 5. 도면 평면 윗부분을 잘라내어(Clip) 투영된 도면만 명확하게 보이게 처리
      target.three.updateWorldMatrix(true, false);
      const clipNormal = new THREE.Vector3(0, -1, 0).transformDirection(target.three.matrixWorld).normalize();
      const clipPoint = new THREE.Vector3().setFromMatrixPosition(target.three.matrixWorld).addScaledVector(clipNormal, -0.05);
      sectionClipId = clipper.createFromNormalAndCoplanarPoint(world, clipNormal, clipPoint);
      const plane = clipper.list.get(sectionClipId);
      if (plane) plane.visible = false;
  
      projected = true;
      if (board) board.requestRender();
    } catch (error) {
      console.error("Error projecting drawing:", error);
      alert("도면 투영 중 오류가 발생했습니다.");
    } finally {
      // 에러가 발생해도 항상 버튼의 로딩 상태를 해제함
      button.loading = false;
      update();
    }
  };

  // 3D 뷰포트 원래대로 복구 & 재투영 대기 상태로 전환
  const reset3DView = async () => {
    const clipper = components.get(OBC.Clipper);
    if (sectionClipId) {
      await clipper.delete(world, sectionClipId);
      sectionClipId = null;
    }
    
    const target = editor.activeDrawing;
    if (target) {
      const linesToRemove: THREE.Object3D[] = [];
      target.three.children.forEach((child) => {
        const layerName = child.userData.layer;
        if (child instanceof THREE.LineSegments && layerName && layerName !== "Annotations" && layerName !== "0") {
          linesToRemove.push(child);
        }
      });
      linesToRemove.forEach((child) => {
        child.removeFromParent();
        if ((child as THREE.LineSegments).geometry) {
          (child as THREE.LineSegments).geometry.dispose();
        }
        if ((child as any).material) {
          if (Array.isArray((child as any).material)) {
            (child as any).material.forEach((m: any) => m.dispose());
          } else {
            (child as any).material.dispose();
          }
        }
      });
    }
    
    projected = false;
    update();
    if (board) board.requestRender();
  };

  // 전체 도면을 DXF 포맷으로 내보내는 기능
  const exportDxf = () => {
    if (!editor.activeDrawing) return;
    const dxfExporter = components.get(OBC.DxfManager).exporter;
    const dxf = dxfExporter.export([{ drawing: editor.activeDrawing, viewports: [{}] }]);
    const blob = new Blob([dxf], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "technical-drawing.dxf";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onBoardCreated = (e?: Element) => {
    if (!e) return;
    board = e as CUI.SheetBoard;
    board.components = components;
  };

  const onPaperCreated = (e?: Element) => {
    if (!e) return;
    const paper = e as BUI.PaperSpace;
    paper.style.backgroundColor = "white";
    paper.sheetNumber = "A-01";
    paper.size = "A1";
    paper.orientation = "landscape";
    paper.titleBlockTemplate = (mm: (units: number) => string, drawingArea: any) => BUI.html`
      <div style="width:100%;height:100%;border:${mm(0.7)} solid #222;overflow:hidden;box-sizing:border-box;">
        ${drawingArea}
      </div>
    `;
  };

  const exitPaperMode = () => {
    editor.cancel();
    if (activeVpEl) {
      editor.clearSource(activeVpEl);
      activeVpEl = null;
    }
    editor.setSource(world);
    if (board) {
      board.exitEditMode();
      board.requestRender();
    }
    paperEditMode = false;
    update();
  };

  const rotateLastBlock = () => {
    if (!lastInsertedBlockUuid || !editor.activeDrawing) return;
    const drawing = editor.activeDrawing;
    const insertion = drawing.annotations.getBySystem(blockTool.system).get(lastInsertedBlockUuid);
    if (!insertion) return;
    blockTool.system.update(editor.activeDrawing, [lastInsertedBlockUuid], { rotation: insertion.rotation + Math.PI / 4 });
    if (board) board.requestRender();
  };

  const setActiveBlock = (name: "COLUMN" | "DOOR") => {
    activeBlockName = name;
    (blockTool as any).blockName = name;
    update();
  };

  const onContainerCreated = async (e?: Element) => {
    if (!e) return;
    if ((e as any)._isSetup) return;
    (e as any)._isSetup = true; // DOM 엘리먼트 자체에 초기화 플래그를 부여하여 리렌더링 시 중복 실행 방지

    const drawingLayout = e as HTMLElement;
    
    // 💡 [수정됨] 메인 렌더링 시점의 Race Condition 방지를 위해 도면을 여기서 직접 초기화합니다.
    let drawing = Array.from(techDrawings.list.values())[0];
    if (!drawing) {
      drawing = techDrawings.create(world);
      drawing.orientTo(new THREE.Vector3(0, -1, 0));
      drawing.three.position.set(0, cutElevation, 0);
      drawing.far = 4;

      drawing.layers.create("Annotations", { material: new THREE.LineBasicMaterial({ color: 0x000000 }) });
      drawing.activeLayer = "Annotations";

      drawing.viewports.create({ left: -50, right: 50, top: 50, bottom: -50, scale: 200, name: "Floor Plan" });
    }

    const floorPlanViewport = Array.from(drawing.viewports.values())[0];

    if (!editor.fonts.font) {
      await editor.fonts.load("https://thatopen.github.io/engine_components/resources/fonts/PlusJakartaSans-Medium.ttf");
    }
    editor.setSource(world);
    editor.activeDrawing = drawing;

    dimTool.system.styles.set("default", { color: 0xe13333, fontSize: 0.3, textOffset: 0.4, tickSize: 0.25, extensionGap: 0.05, extensionOvershoot: 0.2, unit: OBC.Units.m,  lineTick: OBC.NoTick,  meshTick: OBC.FilledCircleTick });
    angleTool.system.styles.set("default", { color: 0xe13333, fontSize: 0.3, textOffset: 0.5, tickSize: 0.25, extensionGap: 0.05, lineTick: OBC.NoTick, meshTick: OBC.FilledArrowTick });
    calloutTool.system.styles.set("default", { color: 0xe13333, fontSize: 0.3, textOffset: 0.1, tickSize: 0.25, enclosure: OBC.CloudEnclosure, meshTick: OBC.FilledArrowTick });
    leaderTool.system.styles.set("default", { color: 0xe13333, fontSize: 0.3, textOffset: 0.1, tickSize: 0.25, lineTick: OBC.NoTick, meshTick: OBC.FilledArrowTick });
    slopeTool.system.styles.set("percentage", {
      lineTick: OBC.NoTick,
      meshTick: OBC.FilledArrowTick,
      tickSize: 0.09,
      length: 0.6,
      color: 0xdd3300,
      textOffset: 0.14,
      fontSize: 0.14,
      format: "percentage",
    });
    slopeTool.system.styles.set("degrees", { ...slopeTool.system.styles.get("percentage")!, color: 0x0055cc, format: "degrees" });
    slopeTool.system.activeStyle = "percentage";

    blockTool.system.styles.set("COLUMN", { color: 0x0055cc, textOffset: 0, fontSize: 0 });
    blockTool.system.styles.set("DOOR",   { color: 0xcc4400, textOffset: 0, fontSize: 0 });

    // Define block geometries
    const colPts: number[] = [];
    const COL_R = 0.35;
    const COL_SEGS = 16;
    for (let i = 0; i < COL_SEGS; i++) {
      const a0 = (i / COL_SEGS) * Math.PI * 2;
      const a1 = ((i + 1) / COL_SEGS) * Math.PI * 2;
      colPts.push(Math.cos(a0) * COL_R, 0, Math.sin(a0) * COL_R);
      colPts.push(Math.cos(a1) * COL_R, 0, Math.sin(a1) * COL_R);
    }
    const columnGeo = new THREE.BufferGeometry();
    columnGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(colPts), 3));
    blockTool.system.define("COLUMN", { lines: columnGeo });

    const DOOR_W = 0.9;
    const DOOR_SEGS = 12;
    const doorPts: number[] = [];
    for (let i = 0; i < DOOR_SEGS; i++) {
      const a0 = (i / DOOR_SEGS) * (Math.PI / 2);
      const a1 = ((i + 1) / DOOR_SEGS) * (Math.PI / 2);
      doorPts.push(Math.cos(a0) * DOOR_W, 0, Math.sin(a0) * DOOR_W);
      doorPts.push(Math.cos(a1) * DOOR_W, 0, Math.sin(a1) * DOOR_W);
    }
    doorPts.push(0, 0, 0, DOOR_W, 0, 0);
    doorPts.push(0, 0, 0, 0, 0, DOOR_W);
    const doorGeo = new THREE.BufferGeometry();
    doorGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(doorPts), 3));
    blockTool.system.define("DOOR", { lines: doorGeo });
    (blockTool as any).blockName = activeBlockName;

    if (!isEventsRegistered) {
      dimTool.system.onMachineStateChanged.add(() => { update(); if (board) board.requestRender(); });
      angleTool.system.onMachineStateChanged.add(() => { update(); if (board) board.requestRender(); });
      calloutTool.onEnterText.add(({ isEdit, currentText }) => {
        setTimeout(() => {
          const label = isEdit ? "Modify text:" : "Callout text:";
          const text = prompt(label, currentText) ?? (isEdit ? currentText : "Label");
          calloutTool.submitText(text);
        }, 0);
      });
      leaderTool.system.onMachineStateChanged.add((state: any) => {
        if (state.kind === "enteringText") {
          setTimeout(() => {
            const { isEdit, currentText } = state;
            const label = isEdit ? "Modify leader text:" : "Leader text:";
            const text = prompt(label, currentText) ?? (isEdit ? currentText : "Label");
            leaderTool.system.sendMachineEvent(
              text.trim() 
                ? { type: "SUBMIT_TEXT", text: text.trim() } 
                : { type: "ESCAPE" }
            );
          }, 0);
        }
        update();
        if (board) board.requestRender();
      });
      blockTool.system.onCommit.add((committed) => {
        lastInsertedBlockUuid = committed[0].item.uuid;
        update();
        if (board) board.requestRender();
      });
      editor.onDrawingMouseMove.add(() => { if (board) board.requestRender(); });
      dimTool.system.onCommit.add(() => { if (board) board.requestRender(); });
      dimTool.system.onDelete.add(() => { if (board) board.requestRender(); });
      angleTool.system.onCommit.add(() => { if (board) board.requestRender(); });
      angleTool.system.onDelete.add(() => { if (board) board.requestRender(); });
      calloutTool.system.onCommit.add(() => { if (board) board.requestRender(); });
      calloutTool.system.onDelete.add(() => { if (board) board.requestRender(); });
      leaderTool.system.onCommit.add(() => { if (board) board.requestRender(); });
      leaderTool.system.onDelete.add(() => { if (board) board.requestRender(); });
      blockTool.system.onDelete.add(() => { if (board) board.requestRender(); });
      slopeTool.system.onCommit.add(() => { if (board) board.requestRender(); });
      slopeTool.system.onDelete.add(() => { if (board) board.requestRender(); });
      isEventsRegistered = true;
    }

    requestAnimationFrame(() => {
      const paper = drawingLayout.querySelector("#paper") as BUI.PaperSpace;
      if (board && paper && drawing && floorPlanViewport) {
        board.addViewport(paper, drawing.uuid, floorPlanViewport.uuid, { x: 0, y: 0 });

        board.addEventListener("viewportactivate", (ev: any) => {
          const { drawingId, viewportId } = ev.detail;
          const d = techDrawings.list.get(drawingId);
          const vp = d?.viewports.get(viewportId);
          if (!d || !vp) return;

          if (paperEditMode) exitPaperMode();

          editor.activeDrawing = d;
          const vpEl = board!.getViewportElement(drawingId, viewportId);
          activeVpEl = vpEl;
          if (vpEl) editor.setSource(vpEl, vp);
          board!.enterEditMode(drawingId, viewportId);
          
          if (vpEl) {
            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><line x1='10' y1='0' x2='10' y2='20' stroke='white' stroke-width='3'/><line x1='0' y1='10' x2='20' y2='10' stroke='white' stroke-width='3'/><line x1='10' y1='0' x2='10' y2='20' stroke='#222' stroke-width='1.5'/><line x1='0' y1='10' x2='20' y2='10' stroke='#222' stroke-width='1.5'/></svg>`;
            vpEl.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, crosshair`;
          }
          paperEditMode = true;
          update();
        });

        board.addEventListener("click", () => {
          if (paperEditMode && editor.activeDrawing) {
            editor.step();
            board!.requestRender();
          }
        });

        board.addEventListener("viewportdxfexport", (ev: any) => {
          const { drawingId, viewportId, dxf } = ev.detail;
          const name = techDrawings.list.get(drawingId)?.viewports.get(viewportId)?.name ?? viewportId;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([dxf], { type: "application/dxf" }));
          a.download = `${name}.dxf`;
          a.click();
          URL.revokeObjectURL(a.href);
        });

        board.addEventListener("paperdxfexport", (ev: any) => {
          const { paper: p, dxf } = ev.detail;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([dxf], { type: "application/dxf" }));
          a.download = `${p.getAttribute("label") || "drawing"}.dxf`;
          a.click();
          URL.revokeObjectURL(a.href);
        });
      }
    });

    const worldCanvas = world.renderer!.three.domElement;
    worldCanvas.addEventListener("click", async () => {
      if (activeTool === "slope") {
        const caster = components.get(OBC.Raycasters).get(world);
        const hit = await caster.castRay();
        if (!hit?.normal) return;

        const worldNormal = hit.normal as THREE.Vector3;
        const run = Math.sqrt(worldNormal.x ** 2 + worldNormal.z ** 2);
        if (run < 1e-6) return;

        const yAbs = Math.abs(worldNormal.y);
        if (yAbs < 1e-6) return;

        const slope = run / yAbs;
        const direction = new THREE.Vector3(worldNormal.x, 0, worldNormal.z).normalize();
        
        const drawing = editor.activeDrawing;
        if (!drawing) return;

        const position = drawing.three.worldToLocal(hit.point.clone());
        position.y = 0;

        slopeTool.system.add(drawing, { position, direction, slope, style: slopeTool.system.activeStyle });
        if (board) board.requestRender();
      } else if (!paperEditMode && drawingLayout.clientWidth > 0) {
        editor.step();
        if (board) board.requestRender();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (drawingLayout.clientWidth > 0) {
        if (ev.key === "Escape") {
          const hasOpenMenu = !!document.body.querySelector("[data-context-dialog]");
          if (hasOpenMenu) return;
          
          const currentTool =
            activeTool === "linear"  ? dimTool :
            activeTool === "angle"   ? angleTool :
            activeTool === "callout" ? calloutTool :
            activeTool === "leader"  ? leaderTool :
            activeTool === "block"   ? blockTool :
            activeTool === "slope"   ? slopeTool : null;
            
          const isIdle = currentTool?.isIdle ?? true;

          if (!isIdle) {
            editor.cancel();
            if (board) board.requestRender();
          } else if (paperEditMode) {
            exitPaperMode();
          } else if (activeTool !== null) {
            setActiveTool(null);
          }
        }
        if (ev.key === "Delete" || ev.key === "Backspace") {
          editor.delete();
          if (board) board.requestRender();
        }
      }
    });
  };

  const onLayerTableCreated = (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table<any>;
    layerTable = table;
    if ((table as any)._isSetup) return;
    (table as any)._isSetup = true;

    table.headersHidden = true;
    table.noIndentation = true;
    table.hiddenColumns = ["layer"];
    table.columns = [
      { name: "Name", width: "1fr" },
      { name: "Visible", width: "32px" },
      { name: "Color", width: "32px" },
      { name: "Style", width: "100px" }
    ];

    table.dataTransform = {
      Visible: (_, rowData) => {
        const layer = rowData.layer;
        return BUI.html`
          <div style="display: flex; align-items: center; justify-content: center; height: 100%;">
            <bim-button @click=${(e: Event) => {
              e.stopPropagation();
              editor.activeDrawing!.layers.setVisibility(rowData.Name, !layer.visible);
              if (board) board.requestRender();
              update();
            }} icon=${layer.visible ? appIcons.SHOW : appIcons.HIDE} style=${tableButtonStyle} title="Visibility"></bim-button>
          </div>
        `;
      },
      Name: (value) => {
        return BUI.html`
          <div style="display: flex; align-items: center; height: 100%; min-width: 0;">
            <bim-label style="margin: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;" title=${value}>${value}</bim-label>
          </div>
        `;
      },
      Color: (value, rowData) => {
        const layer = rowData.layer;
        return BUI.html`
          <div style="display: flex; align-items: center; justify-content: center; height: 100%;">
            <div @click=${() => { activeColorLayer = value; update(); }} style="width: 24px; height: 24px; border: 1px solid var(--bim-ui_bg-contrast-40); border-radius: 4px; cursor: pointer; background-color: ${hexStr(layer.material.color.getHex())}; flex-shrink: 0;" title="Select Color"></div>
          </div>
        `;
      },
      Style: (value, rowData) => {
        const layer = rowData.layer;
        return BUI.html`
          <div style="display: flex; align-items: center; justify-content: flex-end; height: 100%;">
            <bim-dropdown @change=${(e: any) => {
              const isDashed = e.target.value[0] === "dashed";
              const color = layer.material.color.getHex();
              const mat = isDashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.2, gapSize: 0.1 }) : new THREE.LineBasicMaterial({ color });
              editor.activeDrawing!.layers.setMaterial(value, mat);
              if (isDashed) {
                editor.activeDrawing!.three.traverse((child) => {
                  if (child.userData.layer === value && (child as THREE.LineSegments).isLineSegments) {
                    (child as THREE.LineSegments).computeLineDistances();
                  }
                });
              }
              if (board) board.requestRender();
              update();
            }} style="width: 90px; flex-shrink: 0; margin: 0;">
              <bim-option label="Solid" value="solid" ?checked=${!(layer.material instanceof THREE.LineDashedMaterial)}></bim-option>
              <bim-option label="Dashed" value="dashed" ?checked=${layer.material instanceof THREE.LineDashedMaterial}></bim-option>
            </bim-dropdown>
          </div>
        `;
      }
    };

    table.addEventListener("cellcreated", (ev: Event) => {
      const { cell } = (ev as CustomEvent).detail;
      cell.style.padding = "0.25rem";
    });
  };

  setTimeout(() => {
    if (layerTable && editor.activeDrawing) {
      const rows = [...editor.activeDrawing.layers]
        .filter(([name]) => name !== "0")
        .map(([name, layer]) => ({
          data: { Visible: "", Name: name, Color: name, Style: name, layer }
        }));
      layerTable.data = rows;
    } else if (layerTable) {
      layerTable.data = [];
    }
  }, 0);

  return BUI.html`
    <div ${BUI.ref(onContainerCreated)} style="display: flex; flex-direction: row; width: 100%; height: 100%; overflow: hidden; background-color: var(--bim-ui_bg-contrast-20, #f0f0f0); position: relative;">
      <style>
        .drawing-scroll-wrapper::-webkit-scrollbar {
          height: 8px;
          width: 8px;
        }
        .drawing-scroll-wrapper::-webkit-scrollbar-track {
          background: transparent;
        }
        .drawing-scroll-wrapper::-webkit-scrollbar-thumb {
          background: var(--bim-ui_bg-contrast-20);
          border-radius: 4px;
        }
        .drawing-scroll-wrapper::-webkit-scrollbar-thumb:hover {
          background: var(--bim-ui_bg-contrast-40);
        }
      </style>
      
      <!-- ⬅️ 좌측: 리본 메뉴 및 도면 영역 -->
      <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; position: relative;">

      <!-- 🛠️ 상단: 도면 및 주석 도구 패널 (Ribbon Menu Style) -->
      <div style="width: 100%; height: 150px; min-height: 150px; max-height: 150px; background-color: var(--bim-ui_bg-base, white); border-bottom: 1px solid var(--bim-ui_bg-contrast-10, #ccc); display: flex; flex-direction: column; z-index: 10; box-shadow: 0 2px 5px rgba(0,0,0,0.05); flex-shrink: 0; overflow: hidden;">
        <bim-tabs active="annotate" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
          
          <bim-tab name="view" label="View & Export" style="flex: 1; overflow: hidden;">
            <div class="drawing-scroll-wrapper" style="display: flex; flex-direction: row; gap: 2rem; padding: 0.5rem 1rem; height: 100%; box-sizing: border-box; overflow-x: auto; overflow-y: hidden;">
              <!-- Projection Group -->
              <div style="display: flex; flex-direction: column; gap: 0.5rem; min-width: 250px;">
                <bim-label style="font-weight: bold; border-bottom: 1px solid var(--bim-ui_bg-contrast-20); padding-bottom: 0.25rem;">Projection</bim-label>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <bim-label style="white-space: nowrap;">Cut Elevation (Y)</bim-label>
                  <bim-number-input slider min="-50" max="50" step="0.5" .value=${cutElevation} @change=${(e: Event) => { cutElevation = Number((e.target as BUI.NumberInput).value); }} style="flex: 1;"></bim-number-input>
                </div>
                ${!projected ? BUI.html`
                  <bim-button label="Project from model" @click=${(e: Event) => projectFromModel(e.target as BUI.Button)}></bim-button>
                ` : BUI.html`
                  <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <bim-button label="Update Projection" @click=${(e: Event) => projectFromModel(e.target as BUI.Button)} style="flex: 1;"></bim-button>
                    <bim-button label="Reset 3D View" @click=${reset3DView} style="flex: 0 0 auto;"></bim-button>
                  </div>
                `}
              </div>

              <!-- Model Group -->
              <div style="display: flex; flex-direction: column; gap: 0.5rem; min-width: 150px;">
                <bim-label style="font-weight: bold; border-bottom: 1px solid var(--bim-ui_bg-contrast-20); padding-bottom: 0.25rem;">Model</bim-label>
                <bim-checkbox label="Show 3D Model" checked @change=${(e: any) => { 
                  const fragments = components.get(OBC.FragmentsManager);
                  for(const [, model] of fragments.list) {
                      model.object.visible = e.target.checked;
                  }
                }}></bim-checkbox>
                <bim-label style="color: var(--bim-ui_main-base); font-size: 0.85rem;">Input: ${paperEditMode ? "Paper space (Esc to exit)" : "3D canvas"}</bim-label>
              </div>

              <!-- Export Group -->
              <div style="display: flex; flex-direction: column; gap: 0.5rem; min-width: 150px;">
                <bim-label style="font-weight: bold; border-bottom: 1px solid var(--bim-ui_bg-contrast-20); padding-bottom: 0.25rem;">Export</bim-label>
                <bim-button label="Export DXF" @click=${exportDxf}></bim-button>
              </div>
            </div>
          </bim-tab>

          <bim-tab name="annotate" label="Annotations" style="flex: 1; overflow: hidden;">
            <div class="drawing-scroll-wrapper" style="display: flex; flex-direction: row; gap: 2rem; padding: 0.5rem 1rem; height: 100%; box-sizing: border-box; overflow-x: auto; overflow-y: hidden;">
              <!-- Tools Group -->
              <div style="display: flex; flex-direction: column; gap: 0.5rem; min-width: 250px;">
                <bim-label style="font-weight: bold; border-bottom: 1px solid var(--bim-ui_bg-contrast-20); padding-bottom: 0.25rem;">Tools</bim-label>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <bim-dropdown required label="Active tool" @change=${({ target }: { target: BUI.Dropdown }) => setActiveTool(target.value[0] as any)} style="flex: 1;">
                    <bim-option label="None" value=${null} ?checked=${activeTool === null}></bim-option>
                    <bim-option label="Linear Dimensions" value="linear" ?checked=${activeTool === "linear"}></bim-option>
                    <bim-option label="Angle Dimensions" value="angle" ?checked=${activeTool === "angle"}></bim-option>
                    <bim-option label="Callout Annotations" value="callout" ?checked=${activeTool === "callout"}></bim-option>
                    <bim-option label="Leader Annotations" value="leader" ?checked=${activeTool === "leader"}></bim-option>
                    <bim-option label="Block Annotations" value="block" ?checked=${activeTool === "block"}></bim-option>
                    <bim-option label="Slope Annotations" value="slope" ?checked=${activeTool === "slope"}></bim-option>
                  </bim-dropdown>
                </div>
                <bim-button label="Clear All Annotations" @click=${() => { dimTool.system.clear([editor.activeDrawing!]); angleTool.system.clear([editor.activeDrawing!]); calloutTool.system.clear([editor.activeDrawing!]); leaderTool.system.clear([editor.activeDrawing!]); blockTool.system.clear([editor.activeDrawing!]); slopeTool.system.clear([editor.activeDrawing!]); lastInsertedBlockUuid = null; update(); }}></bim-button>
              </div>

              <!-- Tool Settings Group (Contextual) -->
              <div style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1;">
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--bim-ui_bg-contrast-20); padding-bottom: 0.25rem;">
                  <bim-label style="font-weight: bold;">Tool Settings</bim-label>
                  <bim-label style="font-size: 0.85rem; color: var(--bim-ui_main-base);">
                    ${activeTool === "linear" ? `State: ${dimTool.state.kind}` : 
                      activeTool === "angle" ? `State: ${angleTool.state.kind}` : 
                      activeTool === "callout" ? `State: ${calloutTool.state.kind}` : 
                      activeTool === "leader" ? `State: ${leaderTool.state.kind}` : ""}
                  </bim-label>
                </div>
                
                <div class="drawing-scroll-wrapper" style="display: flex; flex-direction: row; gap: 0.5rem; flex-wrap: wrap; overflow-y: auto; align-items: center; max-height: 70px; align-content: flex-start;">
                  ${activeTool === "linear" ? (() => {
                    const s = dimTool.system.styles.get("default")!;
                    const set = (patch: Partial<typeof s>) => { 
                        const cur = dimTool.system.styles.get("default")!; 
                        dimTool.system.styles.set("default", { ...cur, ...patch }); 
                        if (board) board.requestRender(); update();
                    };
                    return BUI.html`
                      <bim-color-input label="Color" color=${hexStr(s.color)} @input=${({ target }: any) => set({ color: parseInt(target.color.replace("#", ""), 16) })} style="width: 100px;"></bim-color-input>
                      <bim-number-input slider label="Font size" min="0.05" max="2" step="0.05" .value=${s.fontSize} @change=${({ target }: any) => set({ fontSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Text offset" min="0" max="2" step="0.05" .value=${s.textOffset} @change=${({ target }: any) => set({ textOffset: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Tick size" min="0.05" max="1" step="0.05" .value=${s.tickSize} @change=${({ target }: any) => set({ tickSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Ext. gap" min="0" max="0.5" step="0.01" .value=${s.extensionGap} @change=${({ target }: any) => set({ extensionGap: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Ext. over" min="0" max="0.5" step="0.01" .value=${s.extensionOvershoot} @change=${({ target }: any) => set({ extensionOvershoot: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-dropdown label="Unit" @change=${({ target }: any) => set({ unit: DIM_UNITS[target.value[0]] })} style="width: 140px;">
                        ${Object.keys(DIM_UNITS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(DIM_UNITS, s.unit ?? OBC.Units.m) === k}></bim-option>`)}
                      </bim-dropdown>
                      <bim-dropdown label="Line tick" @change=${({ target }: any) => {
                        const val = LINE_TICKS[target.value[0]];
                        set(val !== OBC.NoTick ? { lineTick: val, meshTick: undefined } : { lineTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(LINE_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(LINE_TICKS, s.lineTick ?? OBC.NoTick) === k}></bim-option>`)}
                      </bim-dropdown>
                      <bim-dropdown label="Mesh tick" @change=${({ target }: any) => {
                        const val = MESH_TICKS[target.value[0]];
                        set(val !== undefined ? { meshTick: val, lineTick: OBC.NoTick } : { meshTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(MESH_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(MESH_TICKS, s.meshTick) === k}></bim-option>`)}
                      </bim-dropdown>
                      <bim-dropdown label="Mode" @change=${({ target }: any) => { dimTool.setMode(target.value[0] as string); update(); }} style="width: 140px;">
                        ${[...dimTool.modes.keys()].map((key) => BUI.html`<bim-option label=${key} value=${key} ?checked=${dimTool.activeMode === key}></bim-option>`)}
                      </bim-dropdown>
                    `;
                  })() : activeTool === "angle" ? (() => {
                    const s = angleTool.system.styles.get("default")!;
                    const set = (patch: Partial<typeof s>) => { const cur = angleTool.system.styles.get("default")!; angleTool.system.styles.set("default", { ...cur, ...patch }); if(board) board.requestRender(); update(); };
                    return BUI.html`
                      <bim-color-input label="Color" color=${hexStr(s.color)} @input=${({ target }: any) => set({ color: parseInt(target.color.replace("#", ""), 16) })} style="width: 100px;"></bim-color-input>
                      <bim-number-input slider label="Font size" min="0.05" max="2" step="0.05" .value=${s.fontSize} @change=${({ target }: any) => set({ fontSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Text offset" min="0" max="2" step="0.05" .value=${s.textOffset} @change=${({ target }: any) => set({ textOffset: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Tick size" min="0.05" max="1" step="0.05" .value=${s.tickSize} @change=${({ target }: any) => set({ tickSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Ext. gap" min="0" max="0.5" step="0.01" .value=${s.extensionGap} @change=${({ target }: any) => set({ extensionGap: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-dropdown label="Line tick" @change=${({ target }: any) => {
                        const val = LINE_TICKS[target.value[0]];
                        set(val !== OBC.NoTick ? { lineTick: val, meshTick: undefined } : { lineTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(LINE_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(LINE_TICKS, s.lineTick ?? OBC.NoTick) === k}></bim-option>`)}
                      </bim-dropdown>
                      <bim-dropdown label="Mesh tick" @change=${({ target }: any) => {
                        const val = MESH_TICKS[target.value[0]];
                        set(val !== undefined ? { meshTick: val, lineTick: OBC.NoTick } : { meshTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(MESH_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(MESH_TICKS, s.meshTick) === k}></bim-option>`)}
                      </bim-dropdown>
                    `;
                  })() : activeTool === "callout" ? (() => {
                    const s = calloutTool.system.styles.get("default")!;
                    const set = (patch: Partial<typeof s>) => { const cur = calloutTool.system.styles.get("default")!; calloutTool.system.styles.set("default", { ...cur, ...patch }); if(board) board.requestRender(); update(); };
                    return BUI.html`
                      <bim-color-input label="Color" color=${hexStr(s.color)} @input=${({ target }: any) => set({ color: parseInt(target.color.replace("#", ""), 16) })} style="width: 100px;"></bim-color-input>
                      <bim-number-input slider label="Font size" min="0.05" max="2" step="0.05" .value=${s.fontSize} @change=${({ target }: any) => set({ fontSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Text offset" min="0" max="2" step="0.05" .value=${s.textOffset} @change=${({ target }: any) => set({ textOffset: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Tick size" min="0.05" max="1" step="0.05" .value=${s.tickSize} @change=${({ target }: any) => set({ tickSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-dropdown label="Enclosure" @change=${({ target }: any) => set({ enclosure: ENCLOSURES[target.value[0]] })} style="width: 140px;">
                        ${Object.keys(ENCLOSURES).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(ENCLOSURES, s.enclosure) === k}></bim-option>`)}
                      </bim-dropdown>
                      <bim-dropdown label="Line tick" @change=${({ target }: any) => {
                        const val = LINE_TICKS[target.value[0]];
                        set(val !== OBC.NoTick ? { lineTick: val, meshTick: undefined } : { lineTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(LINE_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(LINE_TICKS, s.lineTick ?? OBC.NoTick) === k}></bim-option>`)}
                      </bim-dropdown>
                      <bim-dropdown label="Mesh tick" @change=${({ target }: any) => {
                        const val = MESH_TICKS[target.value[0]];
                        set(val !== undefined ? { meshTick: val, lineTick: OBC.NoTick } : { meshTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(MESH_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(MESH_TICKS, s.meshTick) === k}></bim-option>`)}
                      </bim-dropdown>
                    `;
                  })() : activeTool === "leader" ? (() => {
                    const s = leaderTool.system.styles.get("default")!;
                    const set = (patch: Partial<typeof s>) => { const cur = leaderTool.system.styles.get("default")!; leaderTool.system.styles.set("default", { ...cur, ...patch }); if(board) board.requestRender(); update(); };
                    return BUI.html`
                      <bim-color-input label="Color" color=${hexStr(s.color)} @input=${({ target }: any) => set({ color: parseInt(target.color.replace("#", ""), 16) })} style="width: 100px;"></bim-color-input>
                      <bim-number-input slider label="Font size" min="0.05" max="2" step="0.05" .value=${s.fontSize} @change=${({ target }: any) => set({ fontSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Text offset" min="0" max="2" step="0.05" .value=${s.textOffset} @change=${({ target }: any) => set({ textOffset: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-number-input slider label="Tick size" min="0.05" max="1" step="0.05" .value=${s.tickSize} @change=${({ target }: any) => set({ tickSize: target.value })} style="width: 140px;"></bim-number-input>
                      <bim-dropdown label="Line tick" @change=${({ target }: any) => {
                        const val = LINE_TICKS[target.value[0]];
                        set(val !== OBC.NoTick ? { lineTick: val, meshTick: undefined } : { lineTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(LINE_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(LINE_TICKS, s.lineTick ?? OBC.NoTick) === k}></bim-option>`)}
                      </bim-dropdown>
                      <bim-dropdown label="Mesh tick" @change=${({ target }: any) => {
                        const val = MESH_TICKS[target.value[0]];
                        set(val !== undefined ? { meshTick: val, lineTick: OBC.NoTick } : { meshTick: val });
                      }} style="width: 140px;">
                        ${Object.keys(MESH_TICKS).map((k) => BUI.html`<bim-option label=${k} value=${k} ?checked=${lookupKey(MESH_TICKS, s.meshTick) === k}></bim-option>`)}
                      </bim-dropdown>
                    `;
                  })() : activeTool === "slope" ? BUI.html`
                    <bim-label style="margin-right: 1rem;">Click any surface to annotate its slope.</bim-label>
                    <bim-button label="Toggle style (percentage / degrees)" @click=${() => {
                        slopeTool.system.activeStyle = slopeTool.system.activeStyle === "percentage" ? "degrees" : "percentage";
                        update();
                      }}>
                    </bim-button>
                  ` : activeTool === "block" ? BUI.html`
                    <bim-dropdown label="Block" @change=${(e: any) => setActiveBlock(e.target.value[0])} style="width: 150px;">
                      <bim-option label="Column" value="COLUMN" ?checked=${activeBlockName === "COLUMN"}></bim-option>
                      <bim-option label="Door" value="DOOR" ?checked=${activeBlockName === "DOOR"}></bim-option>
                    </bim-dropdown>
                    <bim-button label="Rotate last 45°" ?disabled=${!lastInsertedBlockUuid} @click=${rotateLastBlock}></bim-button>
                    ${(() => {
                      const insertions = editor.activeDrawing ? [...editor.activeDrawing.annotations.getBySystem(blockTool.system).values()] : [];
                      return BUI.html`<bim-label style="margin-left: 1rem;">Stats - Columns: ${insertions.filter((i) => i.blockName === "COLUMN").length} · Doors: ${insertions.filter((i) => i.blockName === "DOOR").length}</bim-label>`;
                    })()}
                  ` : BUI.html`
                    <bim-label style="color: var(--bim-ui_gray-10);">Select a tool to view its settings.</bim-label>
                  `}
                </div>
              </div>
            </div>
          </bim-tab>

        </bim-tabs>
      </div>

      <!-- 📐 하단: 도면이 표시될 SheetBoard 영역 -->
      <div style="flex: 1; position: relative; min-height: 0;">
        <bim-sheet-board id="board" ${BUI.ref(onBoardCreated)} style="width: 100%; height: 100%; display: block;">
          <bim-paper-space id="paper" label="Floor Plan" ${BUI.ref(onPaperCreated)}></bim-paper-space>
        </bim-sheet-board>
      </div>
      
      </div> <!-- 좌측 컨테이너 끝 -->

      <!-- 🏳️‍🌈 우측: Layer Management Panel -->
      <div style="width: 320px; border-left: 1px solid var(--bim-ui_bg-contrast-10, #ccc); box-shadow: -2px 0 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; z-index: 20; flex-shrink: 0; position: relative; background-color: var(--bim-ui_bg-base, white);">
        <bim-tabs active="layers" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
          <bim-tab name="layers" label="Layer Management" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
            <div style="padding: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; height: 100%; box-sizing: border-box;">
            ${editor.activeDrawing ? BUI.html`
              <div style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
                <bim-table ${BUI.ref(onLayerTableCreated)} style="width: 100%; height: 100%;"></bim-table>
              </div>
            ` : BUI.html`<bim-label style="color: var(--bim-ui_gray-10);">No drawing projected.</bim-label>`}
            </div>
          </bim-tab>
        </bim-tabs>

          ${activeColorLayer ? BUI.html`
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: var(--bim-ui_bg-base); display: flex; flex-direction: column; z-index: 20;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-20);">
                <bim-label style="font-weight: bold; color: var(--bim-ui_main-contrast); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="Color for '${activeColorLayer}'">Color for '${activeColorLayer}'</bim-label>
                <div @click=${() => { activeColorLayer = null; update(); }} style="cursor: pointer; padding: 0.25rem; font-weight: bold; color: var(--bim-ui_main-contrast); flex-shrink: 0;">✕</div>
              </div>
              <div class="drawing-scroll-wrapper" style="display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px; overflow-y: auto; flex: 1; align-content: start;">
                ${ACI_COLORS.map((c, i) => BUI.html`
                  <div title="ACI ${i}: ${c}" @click=${() => {
                    if (editor.activeDrawing && activeColorLayer) {
                      editor.activeDrawing.layers.setColor(activeColorLayer, parseInt(c.slice(1), 16));
                      if(board) board.requestRender();
                    }
                    activeColorLayer = null;
                    update();
                  }} style="width: 100%; aspect-ratio: 1; background-color: ${c}; cursor: pointer; border: 1px solid rgba(0,0,0,0.1); border-radius: 2px; box-sizing: border-box;"
                  onmouseover="this.style.transform='scale(1.2)'; this.style.zIndex='10'" onmouseout="this.style.transform='scale(1)'; this.style.zIndex='1'"></div>
                `)}
              </div>
            </div>
          ` : ""}
      </div>
      
    </div>
  `;
};

export const initDrawingEditor = async (_components: OBC.Components, _world: OBC.World) => {
};
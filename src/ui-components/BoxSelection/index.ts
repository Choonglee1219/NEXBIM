import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { Highlighter } from "../../bim-components/Highlighter";

export const CustomBoxSelector = {
  isActive: false,
  onIntersect: null as ((topLeft: THREE.Vector2, bottomRight: THREE.Vector2, fullyIncluded: boolean) => OBC.ModelIdMap) | null
};

export function setupBoxSelection(
  components: OBC.Components,
  world: OBC.World,
  viewport: HTMLElement,
  highlighter: Highlighter
) {
  const fragments = components.get(OBC.FragmentsManager);
  let selectionMode: "add" | "remove" | null = null;

  let selectionStart: THREE.Vector2 | null = null;
  let selectionBox: HTMLDivElement | null = null;
  let originalCursor: string = "";

  const onPointerDown = (event: PointerEvent) => {
    // Ctrl 또는 Shift + 좌클릭 조합으로 박스 선택 시작
    if (event.button !== 0 || (!event.ctrlKey && !event.shiftKey)) {
      selectionMode = null;
      return;
    }

    // Ctrl 키는 추가, Shift 키는 제거 모드로 설정 (Ctrl 우선)
    if (event.ctrlKey) {
      selectionMode = "add";
    } else {
      selectionMode = "remove";
    }

    originalCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";

    const rect = viewport.getBoundingClientRect();
    selectionStart = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);

    selectionBox = document.createElement("div");
    selectionBox.style.position = "absolute";
    selectionBox.style.border = "1px solid rgba(0, 120, 215, 0.8)";
    selectionBox.style.backgroundColor = "rgba(0, 120, 215, 0.2)";
    selectionBox.style.pointerEvents = "none";
    selectionBox.style.zIndex = "999";
    selectionBox.style.left = `${selectionStart.x}px`;
    selectionBox.style.top = `${selectionStart.y}px`;
    selectionBox.style.width = "0px";
    selectionBox.style.height = "0px";

    viewport.append(selectionBox);

    if (world.camera.controls) {
      world.camera.controls.enabled = false;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!selectionStart || !selectionBox) return;

    const rect = viewport.getBoundingClientRect();
    const current = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);

    const minX = Math.min(selectionStart.x, current.x);
    const minY = Math.min(selectionStart.y, current.y);
    const width = Math.abs(selectionStart.x - current.x);
    const height = Math.abs(selectionStart.y - current.y);

    const isLeftToRight = current.x >= selectionStart.x;
    if (isLeftToRight) {
      selectionBox.style.border = "1px solid rgba(0, 120, 215, 0.8)";
      selectionBox.style.backgroundColor = "rgba(0, 120, 215, 0.2)";
    } else {
      selectionBox.style.border = "1px dashed rgba(143, 188, 12, 0.8)";
      selectionBox.style.backgroundColor = "rgba(143, 188, 12, 0.2)";
    }

    selectionBox.style.left = `${minX}px`;
    selectionBox.style.top = `${minY}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
  };

  const onPointerUp = async (event: PointerEvent) => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);

    document.body.style.cursor = originalCursor;

    if (world.camera.controls) {
      world.camera.controls.enabled = true;
    }


    if (!selectionStart || !selectionBox) {
      selectionBox?.remove();
      selectionStart = null;
      selectionBox = null;
      return;
    }

    // selectionMode가 설정되지 않았다면, 로직을 중단합니다.
    if (!selectionMode) {
      return;
    }


    const rect = viewport.getBoundingClientRect();
    const end = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);

    const fullyIncluded = end.x >= selectionStart.x;

    const topLeft = new THREE.Vector2(Math.min(selectionStart.x, end.x), Math.min(selectionStart.y, end.y));
    const bottomRight = new THREE.Vector2(Math.max(selectionStart.x, end.x), Math.max(selectionStart.y, end.y));

    selectionBox.remove();
    selectionStart = null;
    selectionBox = null;


    // 박스 크기가 너무 작으면 단순 클릭으로 간주
    if (Math.abs(bottomRight.x - topLeft.x) < 5 && Math.abs(bottomRight.y - topLeft.y) < 5) {
      return;
    }

    const raycastTopLeft = new THREE.Vector2(topLeft.x + rect.left, topLeft.y + rect.top);
    const raycastBottomRight = new THREE.Vector2(bottomRight.x + rect.left, bottomRight.y + rect.top);

    let modelIdMap: OBC.ModelIdMap = {};

    if (CustomBoxSelector.isActive && CustomBoxSelector.onIntersect) {
      modelIdMap = CustomBoxSelector.onIntersect(raycastTopLeft, raycastBottomRight, fullyIncluded);
    } else {
      for (const [, model] of fragments.list) {
        if (!model.object.visible) continue;
  
        const res = await (model as any).rectangleRaycast({
          camera: world.camera.three,
          dom: world.renderer!.three.domElement,
          topLeft: raycastTopLeft,
          bottomRight: raycastBottomRight,
          fullyIncluded: fullyIncluded,
        });
  
        if (res && res.localIds.length) {
          modelIdMap[model.modelId] = new Set(res.localIds);
        }
      }
    }

    if (Object.keys(modelIdMap).length > 0) {
      if (selectionMode === "add") {
        // 기존 선택에 추가 (removePrevious: false)
        await highlighter.highlightByID(
          highlighter.config.selectName,
          modelIdMap,
          false, // removePrevious
          false  // fitToView
        );
      } else if (selectionMode === "remove") {
        // 기존 선택에서 제거
        const selectName = highlighter.config.selectName;
        const currentSelection = highlighter.selection[selectName];
        
        if (currentSelection) {
          const newSelection: OBC.ModelIdMap = {};
          let hasRemaining = false;
          
          for (const modelId in currentSelection) {
            const currentSet = currentSelection[modelId];
            const removeSet = modelIdMap[modelId];
            
            newSelection[modelId] = new Set(currentSet);
            
            if (removeSet) {
              for (const id of removeSet) {
                newSelection[modelId].delete(id);
              }
            }
            
            if (newSelection[modelId].size > 0) {
              hasRemaining = true;
            } else {
              delete newSelection[modelId];
            }
          }

          await highlighter.clear(selectName);
          if (hasRemaining) {
            await highlighter.highlightByID(
              selectName,
              newSelection,
              true, // removePrevious
              false // fitToView
            );
          }
        }
      }
    }

    selectionMode = null;
  };

  viewport.addEventListener("pointerdown", onPointerDown);
}
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, appState } from "../../globals";
import { GISMapComponent } from "../../bim-components/GISMap";
import { Highlighter } from "../../bim-components/Highlighter";
import { SharedIFC } from "../../bim-components/SharedIFC";
import { SharedFRAG } from "../../bim-components/SharedFRAG";
import { ClashService } from "../../bim-components/ClashService";

export interface GISSettingsPanelState {
  components: OBC.Components;
}

let originalGeoreferencing: {
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  rotationAngle: number;
} | null = null;

export const gisSettingsPanelTemplate: BUI.StatefullComponent<
  GISSettingsPanelState
> = (state, update) => {
  const { components } = state;
  const gisMap = components.get(GISMapComponent);
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(Highlighter);
  const ifcLoader = components.get(OBC.IfcLoader);
  const clashService = components.get(ClashService);
  const sharedIFC = new SharedIFC();
  const sharedFRAG = new SharedFRAG();

  const data = gisMap.mapData || gisMap.manualData;
  const isDetected = gisMap.mapData !== null;

  if (isDetected && data && originalGeoreferencing === null) {
    const angleRad = Math.atan2(data.xAxisOrdinate, data.xAxisAbscissa);
    let angleDeg = Number(((angleRad * 180) / Math.PI).toFixed(4));
    if (angleDeg < 0) angleDeg += 360;
    angleDeg = Number(angleDeg.toFixed(4));

    originalGeoreferencing = {
      eastings: data.eastings,
      northings: data.northings,
      orthogonalHeight: data.orthogonalHeight,
      rotationAngle: angleDeg
    };
  } else if (!isDetected) {
    originalGeoreferencing = null;
  }

  // Convert current rotation vector to degrees
  const currentAngleRad = Math.atan2(data.xAxisOrdinate, data.xAxisAbscissa);
  let currentAngleDeg = Number(((currentAngleRad * 180) / Math.PI).toFixed(4));
  if (currentAngleDeg < 0) currentAngleDeg += 360;
  currentAngleDeg = Number(currentAngleDeg.toFixed(4));

  (window as any).refreshGISMapSettingsSection = () => {
    update();
  };

  fragments.list.onItemDeleted.add(() => {
    originalGeoreferencing = null;
  });
  fragments.list.onItemSet.add(() => {
    originalGeoreferencing = null;
  });

  const onHeightChange = (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      gisMap.heightOffset = val;
    }
  };

  const onZoomChange = (e: Event) => {
    const val = Number((e.target as HTMLSelectElement).value);
    gisMap.zoom = val;
  };

  const onGridChange = (e: Event) => {
    const val = Number((e.target as HTMLSelectElement).value);
    gisMap.gridSize = val;
  };

  const onSourceChange = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value as any;
    gisMap.mapSource = val;
  };

  // References for manual coordinates inputs
  let eastingInput: HTMLInputElement | undefined;
  let northingInput: HTMLInputElement | undefined;
  let heightInput: HTMLInputElement | undefined;
  let rotationInput: HTMLInputElement | undefined;
  let rotVectorVal: HTMLInputElement | undefined;

  const onRotationInput = () => {
    if (rotationInput && rotVectorVal) {
      const deg = Number(rotationInput.value);
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      rotVectorVal.value = `${cos.toFixed(4)}, ${sin.toFixed(4)}`;
    }
  };

  const onApplyManual = async (e: Event) => {
    const manualApplyBtn = e.target as HTMLButtonElement;
    if (!eastingInput || !northingInput || !heightInput || !rotationInput) return;

    const originalText = manualApplyBtn.textContent;
    manualApplyBtn.textContent = "Applying...";
    manualApplyBtn.disabled = true;

    const east = Number(eastingInput.value);
    const north = Number(northingInput.value);
    const height = Number(heightInput.value);
    const deg = Number(rotationInput.value);

    gisMap.manualData.eastings = east;
    gisMap.manualData.northings = north;
    gisMap.manualData.orthogonalHeight = height;

    const rad = (deg * Math.PI) / 180;
    gisMap.manualData.xAxisAbscissa = Math.cos(rad);
    gisMap.manualData.xAxisOrdinate = Math.sin(rad);

    // Render local tiles immediately
    gisMap.updateMapTiles();

    try {
      const res = await fetch("/api/download-map-tiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
          eastings: east, 
          northings: north,
          zoom: gisMap.zoom,
          gridSize: gisMap.gridSize
        })
      });

      const result = await res.json();
      if (res.ok) {
        gisMap.updateMapTiles();
        alert(`Manual coordinates applied!\n\nBackend Download Status: ${result.message}`);
      } else {
        alert(`Manual coordinates applied locally, but backend download failed: ${result.error}`);
      }
    } catch (err: any) {
      console.error("[GISMap] Failed to download tiles from backend:", err);
      alert(`Manual coordinates applied locally, but backend download failed due to connection error: ${err.message}`);
    } finally {
      manualApplyBtn.textContent = originalText;
      manualApplyBtn.disabled = false;
      update();
    }
  };

  const checkValuesModified = () => {
    if (!eastingInput || !northingInput || !heightInput || !rotationInput) return;

    const east = Number(eastingInput.value);
    const north = Number(northingInput.value);
    const height = Number(heightInput.value);
    const rotationDeg = Number(rotationInput.value);

    let isModified = true;

    if (isDetected && originalGeoreferencing) {
      const dEast = Math.abs(east - originalGeoreferencing.eastings) > 1e-5;
      const dNorth = Math.abs(north - originalGeoreferencing.northings) > 1e-5;
      const dHeight = Math.abs(height - originalGeoreferencing.orthogonalHeight) > 1e-5;
      const dRot = Math.abs(rotationDeg - originalGeoreferencing.rotationAngle) > 1e-5;

      isModified = dEast || dNorth || dHeight || dRot;
    }

    const injectBtn = document.getElementById("gis-manual-inject-btn") as BUI.Button | null;
    if (injectBtn) {
      injectBtn.disabled = !isModified;
    }
  };

  const onInjectGeoreferencing = async (e: Event) => {
    const injectBtn = e.target as BUI.Button;
    
    const loadedModels = Array.from(fragments.list.values()) as any[];
    if (loadedModels.length === 0) {
      alert("현재 3D 뷰어에 로드된 모델이 없습니다.");
      return;
    }

    const validModels = loadedModels.filter(m => m.dbId !== undefined && m.dbId !== null);
    if (validModels.length === 0) {
      alert("데이터베이스 ID(dbId)가 존재하는 로드된 모델이 없습니다. DB에서 로드된 모델만 Georeferencing 주입이 가능합니다.");
      return;
    }

    if (!eastingInput || !northingInput || !heightInput || !rotationInput) {
      alert("좌표 입력 양식이 준비되지 않았습니다.");
      return;
    }

    const east = Number(eastingInput.value);
    const north = Number(northingInput.value);
    const height = Number(heightInput.value);
    const rotationDeg = Number(rotationInput.value);

    if (isNaN(east) || isNaN(north) || isNaN(height) || isNaN(rotationDeg)) {
      alert("동향(Eastings), 북향(Northings), 높이 및 회전각에 올바른 숫자를 입력해주세요.");
      return;
    }

    // 대상 모델들의 정보 리스트 미리 추출
    const modelTargets = validModels.map(m => ({
      uuid: m.uuid,
      dbId: (m as any).dbId,
      name: (m as any).name || "model"
    }));

    const activeProjectId = appState.currentProject?.id;
    injectBtn.loading = true;

    try {
      // 뷰어 리셋 및 하이라이트 지우기
      await highlighter.clear("select");
      highlighter.events.select.onClear.trigger();
      await fragments.core.update(true);

      let successCount = 0;

      for (const target of modelTargets) {
        const { dbId, name: originalName } = target;

        // 1. DB에서 원본 IFC 다운로드
        const ifcData = await sharedIFC.loadIFC(dbId);
        if (!ifcData || !ifcData.content) {
          console.warn(`[GISMap] DB에서 원본 IFC 바이너리를 로드하는 데 실패했습니다. Target ID: ${dbId}`);
          continue;
        }
        const ifcBuffer = ifcData.content as Uint8Array;

        // 2. 백엔드 파이썬 마이크로서비스 호출을 위한 FormData 생성
        const formData = new FormData();
        const blob = new Blob([ifcBuffer as any], { type: "application/octet-stream" });
        
        let baseName = originalName;
        if (baseName.toLowerCase().endsWith(".ifc")) {
          baseName = baseName.substring(0, baseName.length - 4);
        }
        const geoName = `${baseName}_geo`;

        formData.append("file", blob, `${geoName}.ifc`);
        formData.append("eastings", String(east));
        formData.append("northings", String(north));
        formData.append("orthogonalHeight", String(height));
        formData.append("rotationAngle", String(rotationDeg));
        
        // S-JTSK 디폴트 좌표 파라미터 주입
        formData.append("crsName", "EPSG:5514");
        formData.append("crsDescription", "S-JTSK / Krovak East North");
        formData.append("crsGeodeticDatum", "S-JTSK");
        formData.append("crsVerticalDatum", "Baltic after adjustment");
        formData.append("crsMapProjection", "Krovak");
        formData.append("crsMapZone", "Undefined");
        formData.append("scale", "1.0");

        const response = await fetch("/api/inject-georeferencing", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errJson = await response.json();
          throw new Error(`모델 '${originalName}' 주입 실패: ${errJson.details || errJson.error || "알 수 없는 에러"}`);
        }

        // 3. 가공된 새 IFC 바이너리 획득
        const arrayBuffer = await response.arrayBuffer();
        const modifiedBuffer = new Uint8Array(arrayBuffer);

        // 4. 뷰어 리로딩 처리
        let currentInstance: any = null;
        for (const [, m] of fragments.list) {
          if ((m as any).dbId === dbId || (m as any).uuid === target.uuid) {
            currentInstance = m;
            break;
          }
        }
        if (currentInstance) {
          currentInstance.dispose();
        }

        // 워커 정리/메모리 해제 데드락 예방을 위한 딜레이
        await new Promise(resolve => setTimeout(resolve, 300));

        const modelName = `${geoName}.ifc`;
        const reloadedModel = await ifcLoader.load(modifiedBuffer, false, modelName, {
          instanceCallback: (importer: any) => {
            importer.includeUniqueAttributes = true;
            importer.includeRelationNames = true;
          },
        });

        (reloadedModel as any).name = geoName;
        await fragments.core.update(true);

        // 🗺️ Detect georeferencing from raw IFC buffer
        gisMap.detectGeorefFromBuffer(modifiedBuffer);

        const newModelId = (reloadedModel as any).uuid;
        if (newModelId) {
          clashService.addIfcBuffer(newModelId, modifiedBuffer);
        }

        if ((window as any).refreshLoadedModelList) {
          (window as any).refreshLoadedModelList();
        }

        // 5. Oracle 데이터베이스에 새 파일들 저장 (현재 프로젝트 ID 바인딩)
        const ifcFile = new File([modifiedBuffer as any], `${geoName}.ifc`, { type: "application/octet-stream" });
        const fragData = await (reloadedModel as any).getBuffer(false);
        const fragFile = new File([fragData as any], `${geoName}.frag`, { type: "application/octet-stream" });

        const newIfcId = await sharedIFC.saveIFC(ifcFile, activeProjectId);
        if (newIfcId) {
          const newFragId = await sharedFRAG.saveFRAG(fragFile, activeProjectId);
          if (newFragId) {
            (reloadedModel as any).dbId = newIfcId;
            sharedIFC.addModelUUID(newIfcId, newModelId);
            sharedFRAG.addModelUUID(newFragId, newModelId);
            successCount++;
          } else {
            console.error(`[GISMap] 가공된 FRAG 파일 저장 실패. Model: ${geoName}`);
          }
        } else {
          console.error(`[GISMap] 가공된 IFC 파일 저장 실패. Model: ${geoName}`);
        }
      }

      await fragments.core.update(true);

      if ((window as any).refreshSharedModelLists) {
        await (window as any).refreshSharedModelLists();
      }
      if ((window as any).refreshLoadedModelList) {
        (window as any).refreshLoadedModelList();
      }
      alert(`성공적으로 총 ${modelTargets.length}개 중 ${successCount}개 모델에 Georeferencing 정보가 주입되어 데이터베이스에 새로운 모델로 저장 및 리로드되었습니다!`);
      
      if ((window as any).refreshGISMapSettingsSection) {
        (window as any).refreshGISMapSettingsSection();
      }

    } catch (err: any) {
      console.error("[GISMap] Error injecting georeferencing to all models:", err);
      alert(`Georeferencing 주입 실패: ${err.message}`);
    } finally {
      injectBtn.loading = false;
    }
  };

  return BUI.html`
    <bim-panel-section label="GIS Map Settings" icon=${appIcons.MAP} style="gap: 1rem;" class="bim-scroll">
      
      <!-- General controls -->
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; color: var(--bim-ui_gray-10, #ccc);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Elevation Offset (m)</span>
          <input id="gis-height-input-field" type="number" step="0.5" value="${gisMap.heightOffset}" @change=${onHeightChange} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Zoom Level</span>
          <select id="gis-zoom-select" @change=${onZoomChange} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 4px; font-size: 0.8rem; cursor: pointer; box-sizing: border-box;">
            ${[14, 15, 16].map(z => BUI.html`
              <option value="${z}" ?selected=${z === gisMap.zoom}>${z}</option>
            `)}
          </select>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Grid Size</span>
          <select id="gis-grid-select" @change=${onGridChange} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 4px; font-size: 0.8rem; cursor: pointer; box-sizing: border-box;">
            ${[3, 5, 7].map(g => BUI.html`
              <option value="${g}" ?selected=${g === gisMap.gridSize}>${g}x${g}</option>
            `)}
          </select>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Map Source</span>
          <select id="gis-source-select" @change=${onSourceChange} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 4px; font-size: 0.8rem; cursor: pointer; box-sizing: border-box;">
            <option value="offline" ?selected=${gisMap.mapSource === "offline"}>Offline Map</option>
            <option value="osm" ?selected=${gisMap.mapSource === "osm"}>OpenStreetMap</option>
            <option value="carto-light" ?selected=${gisMap.mapSource === "carto-light"}>CartoDB Light</option>
          </select>
        </div>
      </div>

      <!-- Georeferencing Info & Manual Override -->
      <div style="border-top: 1px solid var(--bim-ui_bg-contrast-20, rgba(255, 255, 255, 0.1)); padding-top: 12px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; color: var(--bim-ui_gray-10, #ccc);">
        <span style="font-weight: bold; color: var(--bim-ui_gray-10, #aaa); margin-bottom: 4px;">
          Georeferencing: ${isDetected ? BUI.html`<span style="color: #8fbc0c;">Detected</span>` : BUI.html`<span style="color: #e59c00;">Manual Override</span>`}
        </span>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>CRS Name</span>
          <input type="text" value="${data.crsName}" disabled style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: var(--bim-ui_gray-10, #888); border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${data.crsName}">
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Eastings</span>
          <input id="gis-easting-input" type="number" step="1" value="${data.eastings}" @input=${checkValuesModified} ${BUI.ref(el => eastingInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Northings</span>
          <input id="gis-northing-input" type="number" step="1" value="${data.northings}" @input=${checkValuesModified} ${BUI.ref(el => northingInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Height (H)</span>
          <input id="gis-height-input" type="number" step="0.5" value="${data.orthogonalHeight}" @input=${checkValuesModified} ${BUI.ref(el => heightInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>
 
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Rotation (deg)</span>
          <input id="gis-rotation-input" type="number" min="0" max="360" step="any" value="${currentAngleDeg}" @input=${() => { onRotationInput(); checkValuesModified(); }} ${BUI.ref(el => rotationInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>
 
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Rot Vector</span>
          <input id="gis-rot-vector-val" type="text" value="${data.xAxisAbscissa.toFixed(4)}, ${data.xAxisOrdinate.toFixed(4)}" disabled ${BUI.ref(el => rotVectorVal = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: var(--bim-ui_gray-10, #888); border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>
 
        <div style="display: flex; gap: 8px;">
          <button id="gis-manual-apply-btn" 
            @click=${onApplyManual}
            style="flex: 1; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 6px; cursor: pointer; margin-top: 4px; font-size: 0.75rem;">
            Preview
          </button>
          <bim-button id="gis-manual-inject-btn"
            @click=${onInjectGeoreferencing}
            label="Apply to IFC & Save"
            ?disabled=${isDetected}
            style="flex: 1; margin-top: 4px; font-size: 0.75rem; background-color: var(--bim-ui_main-base); color: var(--bim-ui_main-contrast); font-weight: bold;">
          </bim-button>
        </div>
      </div>
    </bim-panel-section>
  `;
};

export const gisSettingsPanel = (state: GISSettingsPanelState) => {
  const component = BUI.Component.create<
    BUI.PanelSection,
    GISSettingsPanelState
  >(gisSettingsPanelTemplate, state);

  return component;
};

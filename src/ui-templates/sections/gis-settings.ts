import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../globals";
import { GISMapComponent } from "../../bim-components/GISMap";

export interface GISSettingsPanelState {
  components: OBC.Components;
}

export const gisSettingsPanelTemplate: BUI.StatefullComponent<
  GISSettingsPanelState
> = (state, update) => {
  const { components } = state;
  const gisMap = components.get(GISMapComponent);

  const data = gisMap.mapData || gisMap.manualData;
  const isDetected = gisMap.mapData !== null;

  // Convert current rotation vector to degrees
  const currentAngleRad = Math.atan2(data.xAxisOrdinate, data.xAxisAbscissa);
  let currentAngleDeg = Number(((currentAngleRad * 180) / Math.PI).toFixed(4));
  if (currentAngleDeg < 0) currentAngleDeg += 360;
  currentAngleDeg = Number(currentAngleDeg.toFixed(4));

  // Re-run this check when model detectGeoreferencing event fires if needed.
  (window as any).refreshGISMapSettingsSection = () => {
    update();
  };

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
      console.log(`[GISMap] Triggering backend download for: East=${east}, North=${north}, Zoom=${gisMap.zoom}, GridSize=${gisMap.gridSize}`);
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
        console.log("[GISMap] Backend tiles downloaded successfully:", result.message);
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
            ${[12, 13, 14, 15, 16, 17, 18, 19].map(z => BUI.html`
              <option value="${z}" ?selected=${z === gisMap.zoom}>${z}</option>
            `)}
          </select>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Grid Size</span>
          <select id="gis-grid-select" @change=${onGridChange} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 4px; font-size: 0.8rem; cursor: pointer; box-sizing: border-box;">
            ${[1, 3, 5].map(g => BUI.html`
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
          <input id="gis-easting-input" type="number" step="1" value="${data.eastings}" ${isDetected ? "disabled" : ""} ${BUI.ref(el => eastingInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Northings</span>
          <input id="gis-northing-input" type="number" step="1" value="${data.northings}" ${isDetected ? "disabled" : ""} ${BUI.ref(el => northingInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Height (H)</span>
          <input id="gis-height-input" type="number" step="0.5" value="${data.orthogonalHeight}" ${isDetected ? "disabled" : ""} ${BUI.ref(el => heightInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Rotation (deg)</span>
          <input id="gis-rotation-input" type="number" min="0" max="360" step="any" value="${currentAngleDeg}" ${isDetected ? "disabled" : ""} @input=${onRotationInput} ${BUI.ref(el => rotationInput = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: white; border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>Rot Vector</span>
          <input id="gis-rot-vector-val" type="text" value="${data.xAxisAbscissa.toFixed(4)}, ${data.xAxisOrdinate.toFixed(4)}" disabled ${BUI.ref(el => rotVectorVal = el as HTMLInputElement)} style="width: 150px; background: var(--bim-ui_bg-contrast-20, #333); color: var(--bim-ui_gray-10, #888); border: 1px solid var(--bim-ui_bg-contrast-40, #555); border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; box-sizing: border-box;">
        </div>

        ${!isDetected ? BUI.html`
          <button id="gis-manual-apply-btn" 
            @click=${onApplyManual}
            style="background: var(--bim-ui_main-base, #8fbc0c); color: var(--bim-ui_bg-base, #000); border: none; border-radius: 4px; padding: 6px; font-weight: bold; cursor: pointer; margin-top: 4px; font-size: 0.75rem;">
            Apply
          </button>
        ` : BUI.html``}
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

import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import { ViewerToolbarState, viewerToolbarTemplate } from "..";
import { appIcons } from "../../globals";
import { Highlighter } from "../../bim-components/Highlighter";
import { Measurer } from "../../bim-components/Measurer";
import { ClipperBox } from "../../bim-components/ClipperBox";

type BottomToolbar = { name: "bottomToolbar"; state: ViewerToolbarState };
type LeftToolbar = { name: "leftToolbar"; state: {} };

type ViewportGridElements = [BottomToolbar, LeftToolbar];

type ViewportGridLayouts = ["main"];

interface ViewportGridState {
  components: OBC.Components;
  world: OBC.World;
}

export const viewportGridTemplate: BUI.StatefullComponent<ViewportGridState> = (
  state,
) => {
  const { components, world } = state;

  const leftToolbarTemplate: BUI.StatefullComponent = (_: {}, update) => {
    const highlighter = components.get(Highlighter);
    const lengthMeasurer = components.get(OBF.LengthMeasurement);
    const areaMeasurer = components.get(OBF.AreaMeasurement);
    const clipper = components.get(OBC.Clipper);
    const measurer = components.get(Measurer);
    const clipperBox = components.get(ClipperBox);

    const updateHighlighter = () => {
      highlighter.enabled = !lengthMeasurer.enabled && !areaMeasurer.enabled;
      update();
    };

    lengthMeasurer.list.onItemAdded.add(updateHighlighter);
    lengthMeasurer.list.onItemDeleted.add(updateHighlighter);
    areaMeasurer.list.onItemAdded.add(updateHighlighter);
    areaMeasurer.list.onItemDeleted.add(updateHighlighter);

    const areMeasurementsEnabled =
      lengthMeasurer.enabled || areaMeasurer.enabled;

    const disableAll = (exceptions?: ("clipper" | "length" | "area")[]) => {
      BUI.ContextMenu.removeMenus();
      if (!exceptions?.includes("clipper")) {
        highlighter.clear("select");
      }
      highlighter.enabled = false;
      if (!exceptions?.includes("length")) lengthMeasurer.enabled = false;
      if (!exceptions?.includes("area")) areaMeasurer.enabled = false;
      if (!exceptions?.includes("clipper")) {
        clipper.enabled = false;
        clipperBox.disable();
      }
    };

    const onLengthMeasurement = () => {
      disableAll(["length"]);
      lengthMeasurer.enabled = !lengthMeasurer.enabled;
      highlighter.enabled = !lengthMeasurer.enabled;
      update();
    };

    const onAreaMeasurement = () => {
      disableAll(["area"]);
      areaMeasurer.enabled = !areaMeasurer.enabled;
      highlighter.enabled = !areaMeasurer.enabled;
      update();
    };

    const onModelSection = () => {
      disableAll(["clipper"]);
      clipper.enabled = !clipper.enabled;
      if (clipper.enabled) {
        clipperBox.disable();
      }
      highlighter.enabled = true; // Clipper 활성화 시에도 객체 선택 가능하도록 변경
      update();
    };

    const onClipperBox = () => {
      disableAll(["clipper"]);
      if (clipperBox.enabled) {
        clipperBox.disable();
        if (clipper.list.size === 0) {
          clipper.enabled = false;
        }
      } else {
        clipper.enabled = true;
        clipperBox.enable();
      }
      highlighter.enabled = true;
      update();
    };

    const onClipperClearAll = () => {
      if (clipper.deleteAll) clipper.deleteAll();
      else if ((clipper as any).clear) (clipper as any).clear();
      clipper.enabled = false;
      clipperBox.disable();
      BUI.ContextMenu.removeMenus();
      update();
    };

    const onMeasurementsClick = () => {
      lengthMeasurer.enabled = false;
      areaMeasurer.enabled = false;
      highlighter.enabled = true;
      update();
    };

    const onMeasure = async (e: Event) => {
      const target = e.target as BUI.Button;
      target.loading = true;
      await measurer.getMeasure();
      target.loading = false;
      BUI.ContextMenu.removeMenus();
    };

    const onClearAllMeasurements = () => {
      lengthMeasurer.list.clear();
      areaMeasurer.list.clear();
      BUI.ContextMenu.removeMenus();
      update();
    };

    return BUI.html`
      <bim-toolbar style="align-self: start;" vertical>
        <bim-toolbar-section>
          <bim-button ?active=${areMeasurementsEnabled} label="Measurements" title="Measurements" icon=${appIcons.RULER} @click=${onMeasurementsClick}>
            <bim-context-menu>
              <div style="display: flex; gap: 0.25rem; overflow: hidden; width: max-content;">
                <bim-button ?active=${lengthMeasurer.enabled} title="Measure Length" icon=${appIcons.LENGTH} @click=${onLengthMeasurement}></bim-button>
                <bim-button ?active=${areaMeasurer.enabled} title="Measure Area" icon=${appIcons.AREA} @click=${onAreaMeasurement}></bim-button>
                <bim-button icon=${appIcons.CLEARANCE} title="Measure Clearance" @click=${onMeasure}></bim-button>
                <bim-button icon=${appIcons.CLEAR} title="All Clear" @click=${onClearAllMeasurements}></bim-button>
              </div>
            </bim-context-menu>
          </bim-button>
          <bim-button ?active=${clipper.enabled || clipperBox.enabled} label="Section" title="Model Section" icon=${appIcons.CLIPPING}>
            <bim-context-menu>
              <div style="display: flex; gap: 0.25rem; overflow: hidden; width: max-content;">
                <bim-button ?active=${clipper.enabled} title="Clipper Face" icon=${appIcons.CLIPPER_FACE} @click=${onModelSection}></bim-button>
                <bim-button ?active=${clipperBox.enabled} title="Clipper Box" icon=${appIcons.CLIPPER_BOX} @click=${onClipperBox}></bim-button>
                <bim-button icon=${appIcons.CLEAR} title=" All Clear" @click=${onClipperClearAll}></bim-button>
              </div>
            </bim-context-menu>
          </bim-button> 
        </bim-toolbar-section>
      </bim-toolbar>
    `;
  };

  const elements: BUI.GridComponents<ViewportGridElements> = {
    leftToolbar: {
      template: leftToolbarTemplate,
      initialState: {},
    },
    bottomToolbar: {
      template: viewerToolbarTemplate,
      initialState: { components, world },
    },
  };

  const onCreated = (e?: Element) => {
    if (!e) return;
    const grid = e as BUI.Grid<ViewportGridLayouts, ViewportGridElements>;
    grid.elements = elements;

    grid.layouts = {
      main: {
        template: `
          "leftToolbar messages rightToolbar" auto
          "leftToolbar empty rightToolbar" 1fr
          "bottomToolbar bottomToolbar bottomToolbar" auto
          /auto 1fr auto
        `,
      },
    };
  };

  return BUI.html`<bim-grid ${BUI.ref(onCreated)} layout="main" floating></bim-grid>`;
};

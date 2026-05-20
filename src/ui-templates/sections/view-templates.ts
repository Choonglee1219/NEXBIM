import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../globals";
import { viewTemplatesList } from "../../ui-components";

export interface ViewTemplatesPanelState {
  components: OBC.Components;
}

export const viewTemplatesPanelTemplate: BUI.StatefullComponent<
  ViewTemplatesPanelState
> = (state) => {
  const { components } = state;

  const [templates] = viewTemplatesList({ components });

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.CAMERA} label="View Templates">
      ${templates}
    </bim-panel-section>
  `;
};

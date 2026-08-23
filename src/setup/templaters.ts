import * as OBC from "@thatopen/components";
import { ViewTemplater } from "../bim-components";

export const setupViewTemplates = (components: OBC.Components) => {
  const templater = components.get(ViewTemplater);

  templater.list.set("KEPCO E&C", {
    defaultVisibility: true,
    visibilityExceptions: {
      queries: new Set(["Base Slab", "Wall", "Slab", "Ramp", "Beam", "Plate", "Rail", "Stair", "Concrete Column", "Steel Member", "Member", "Proxy", "Space", "Opening Element", "Spatial Zone"]),
    },
    colors: {
      queries: {
        "#939393": new Set(["Base Slab"]),
        "#C0C0C0": new Set(["Wall", "Slab", "Ramp"]),
        "#A3A083": new Set(["Beam"]),
        "#B7604F": new Set(["Plate"]),
        "#8FB7EB": new Set(["Rail", "Stair", "Steel Member"]),
        "#3871C1": new Set(["Concrete Column"]),
        "#FFFF00": new Set(["Member"]),
        "#E2B96D": new Set(["Proxy"]),
        "#00FFFF": new Set(["Space"]),
        "#FFA500": new Set(["Opening Element"]),
        "#800080": new Set(["Spatial Zone"]),
      },
    },
  });
};

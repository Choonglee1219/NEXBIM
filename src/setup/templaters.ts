import * as OBC from "@thatopen/components";
import { ViewTemplater } from "../bim-components";

export const setupViewTemplates = (components: OBC.Components) => {
  const templater = components.get(ViewTemplater);

  templater.list.set("Slab", {
    defaultVisibility: false,
    visibilityExceptions: {
      queries: new Set(["Slab"]),
    },
    colors: {
      queries: {
        "#C0C0C0": new Set(["Slab"]),
      },
    },
  });

  templater.list.set("Structure & Duct", {
    defaultVisibility: false,
    visibilityExceptions: {
      queries: new Set(["Structure Elements", "Duct"]),
    },
    colors: {
      queries: {
        "#C0C0C0": new Set(["Structure Elements"]),
        "#92DEAD": new Set(["Duct"]),
      },
    },
  });

  templater.list.set("KEPCO E&C", {
    defaultVisibility: true,
    visibilityExceptions: {
      queries: new Set(["Plate", "Space"]),
    },
    colors: {
      queries: {
        "#939393": new Set(["Base Slab"]),
        "#C0C0C0": new Set(["Wall", "Slab", "Ramp"]),
        "#A3A083": new Set(["Beam"]),
        "#B7604F": new Set(["Plate"]),
        "#8FB7EB": new Set(["Rail", "Stair", "Steel Member"]),
        "#9DA599": new Set(["Concrete Column"]),
        "#8F9099": new Set(["Member"]),
        "#FFBD96": new Set(["Tray"]),
        "#92DEAD": new Set(["Duct"]),
        "#64C8B4": new Set(["Equipment"]),
        "#008040": new Set(["Pipe"]),
        "#FF0000": new Set(["Proxy"]),
      }
    }
  });
};

import { SymbolIfcBinding } from "./diagram-types";

/**
 * Dedicated mapping file for Diagram Symbol ID -> 3D IFC Element ({ project, model, guid, name }).
 * Easily add or update mappings here for application maintenance.
 */
export const DIAGRAM_SYMBOL_MAPPINGS: Record<string, SymbolIfcBinding> = {
  "9yy9wyBOmmR_GRx79itf-1": {
    project: "e3d",
    model: "M5323-250808_spatial",
    guid: "07Ap_ZcoXAvey0p$VsDXCM",
    name: "Chilled Water Pump (P-101)",
  },

  "iKIjoGveKjWyw1LTXGks-1": {
    project: "e3d",
    model: "M5323-250808_spatial",
    guid: "2jF$vyQgTANxSCip7Rh$4X",
    name: "Storage Tank (T-101)",
  },

  "iKIjoGveKjWyw1LTXGks-6": {
    project: "e3d",
    model: "M5323-250808_spatial",
    guid: "25wmV3R2nAHfJlmSRGe8X$",
    name: "Pipe Line",
  },
};

import { DIAGRAM_SYMBOL_MAPPINGS } from "./diagram-mapping";

export interface SymbolIfcBinding {
  /** Optional project identifier (e.g. "revit") */
  project?: string;
  /** Target IFC model name (e.g. "rme") */
  model: string;
  /** Target IFC element GUID (e.g. "39q4vWPDPE3QeBugdA37EY") */
  guid: string;
  /** Human readable description */
  name?: string;
}

export interface DiagramConfig {
  /** Path or URL to the SVG diagram file */
  svgUrl: string;
  /** Dictionary of symbol bindings mapped by symbol cell ID */
  bindings: Record<string, SymbolIfcBinding>;
}

export const DEFAULT_DIAGRAM_CONFIG: DiagramConfig = {
  svgUrl: "/test-diagram.drawio.svg",
  bindings: DIAGRAM_SYMBOL_MAPPINGS,
};


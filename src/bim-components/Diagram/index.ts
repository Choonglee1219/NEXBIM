import * as OBC from "@thatopen/components";
import {
  DiagramConfig,
  DEFAULT_DIAGRAM_CONFIG,
  SymbolIfcBinding,
} from "./src/diagram-types";
import { DiagramViewer } from "./src/diagram-viewer";
import { DiagramBinder } from "./src/diagram-binder";

export * from "./src/diagram-types";
export * from "./src/diagram-viewer";
export * from "./src/diagram-binder";
export * from "./src/diagram-mapping";


export class DiagramComponent extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "e89c3a1b-42f1-4b68-879e-31518f830a44" as const;
  readonly onDisposed = new OBC.Event();

  config: DiagramConfig = { ...DEFAULT_DIAGRAM_CONFIG };
  binder: DiagramBinder;
  viewer: DiagramViewer | null = null;
  enabled = true;

  constructor(components: OBC.Components) {
    super(components);
    this.components.add(DiagramComponent.uuid, this);
    this.binder = new DiagramBinder(components);
  }

  /**
   * Initializes and renders the Diagram Viewer inside the target container.
   */
  async mount(
    container: HTMLElement,
    config?: Partial<DiagramConfig>
  ): Promise<void> {
    if (config) {
      this.config = {
        ...this.config,
        ...config,
        bindings: { ...this.config.bindings, ...(config.bindings || {}) },
      };
    }

    this.viewer = new DiagramViewer({
      container,
      svgUrl: this.config.svgUrl,
      onSymbolClick: async (cellId: string) => {
        if (!cellId) {
          await this.binder.clearSelection();
          return;
        }
        const binding = this.config.bindings[cellId];
        if (binding) {
          await this.binder.navigateToBinding(binding);
        } else {
          await this.binder.clearSelection();
        }
      },


    });

    await this.viewer.loadAndRender();
  }

  /**
   * Dynamically add or update a symbol-to-IFC binding.
   */
  setBinding(cellId: string, binding: SymbolIfcBinding): void {
    this.config.bindings[cellId] = binding;
  }

  dispose(): void {
    this.viewer = null;
    this.onDisposed.trigger();
  }
}

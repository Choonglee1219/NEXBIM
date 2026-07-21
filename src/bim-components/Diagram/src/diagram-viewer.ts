export interface DiagramViewerOptions {
  container: HTMLElement;
  svgUrl: string;
  onSymbolClick: (cellId: string, element: Element) => void;
}

export class DiagramViewer {
  private container: HTMLElement;
  private svgUrl: string;
  private onSymbolClick: (cellId: string, element: Element) => void;
  private activeElement: Element | null = null;

  // Pan & Zoom transform state
  private scale = 1;
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private startPointerX = 0;
  private startPointerY = 0;
  private startPanX = 0;
  private startPanY = 0;
  private hasDragged = false;

  constructor(options: DiagramViewerOptions) {
    this.container = options.container;
    this.svgUrl = options.svgUrl;
    this.onSymbolClick = options.onSymbolClick;
  }

  async loadAndRender(): Promise<void> {
    try {
      const response = await fetch(this.svgUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch SVG from ${this.svgUrl}: ${response.statusText}`
        );
      }
      const svgText = await response.text();

      // Inject inline SVG into container with styling and pan/zoom wrapper
      this.container.innerHTML = `
        <style>
          .diagram-svg-wrapper {
            position: relative;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--bim-ui_bg-contrast-10, #18191c);
            cursor: grab;
            user-select: none;
            touch-action: none;
          }
          .diagram-svg-wrapper:active {
            cursor: grabbing;
          }
          .diagram-svg-stage {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            transform-origin: 0 0;
            will-change: transform;
          }
          .diagram-svg-stage svg {
            max-width: 90%;
            max-height: 90%;
            height: auto;
            width: auto;
            display: block;
          }
          .diagram-svg-stage [data-cell-id]:not([data-cell-id="0"]):not([data-cell-id="1"]) {
            cursor: pointer;
          }
          /* Hover effect: change only the stroke (outline) color of the specific hovered shape cell */
          .diagram-svg-stage [data-cell-id]:not([data-cell-id="0"]):not([data-cell-id="1"]):hover path,
          .diagram-svg-stage [data-cell-id]:not([data-cell-id="0"]):not([data-cell-id="1"]):hover rect[stroke]:not([stroke="none"]),
          .diagram-svg-stage [data-cell-id]:not([data-cell-id="0"]):not([data-cell-id="1"]):hover circle,
          .diagram-svg-stage [data-cell-id]:not([data-cell-id="0"]):not([data-cell-id="1"]):hover ellipse,
          .diagram-svg-stage [data-cell-id]:not([data-cell-id="0"]):not([data-cell-id="1"]):hover polygon,
          .diagram-svg-stage [data-cell-id]:not([data-cell-id="0"]):not([data-cell-id="1"]):hover polyline {
            stroke: #8fbc0c !important;
            transition: stroke 0.15s ease;
          }
          /* Active selected symbol styling: change stroke color only */
          .diagram-svg-symbol-active path,
          .diagram-svg-symbol-active rect[stroke]:not([stroke="none"]),
          .diagram-svg-symbol-active circle,
          .diagram-svg-symbol-active ellipse,
          .diagram-svg-symbol-active polygon,
          .diagram-svg-symbol-active polyline {
            stroke: #8fbc0c !important;
          }

          .diagram-controls-toolbar {
            position: absolute;
            bottom: 12px;
            right: 12px;
            z-index: 10;
            display: flex;
            gap: 4px;
            background: rgba(24, 25, 28, 0.85);
            backdrop-filter: blur(4px);
            padding: 4px 6px;
            border-radius: 6px;
            border: 1px solid var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.2));
          }
          .diagram-controls-toolbar button {
            background: transparent;
            border: none;
            color: var(--bim-ui_gray-10, #fff);
            cursor: pointer;
            padding: 4px 8px;
            font-size: 13px;
            border-radius: 4px;
            transition: background 0.15s ease;
          }
          .diagram-controls-toolbar button:hover {
            background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
          }
        </style>
        <div class="diagram-svg-wrapper">
          <div class="diagram-controls-toolbar">
            <button class="diagram-btn-zoom-in" title="Zoom In">+</button>
            <button class="diagram-btn-zoom-out" title="Zoom Out">-</button>
            <button class="diagram-btn-reset" title="Reset View">Reset</button>
          </div>
          <div class="diagram-svg-stage">
            ${svgText}
          </div>
        </div>
      `;

      this.setupPanAndZoom();
      this.setupEventListeners();
    } catch (err) {
      console.error("[DiagramViewer] Error rendering SVG:", err);
      this.container.innerHTML = `<div style="padding: 1rem; color: #ff5555;">Failed to load diagram: ${err}</div>`;
    }
  }

  private updateTransform(): void {
    const stage = this.container.querySelector(
      ".diagram-svg-stage"
    ) as HTMLElement;
    if (stage) {
      stage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    }
  }

  private setupPanAndZoom(): void {
    const wrapper = this.container.querySelector(
      ".diagram-svg-wrapper"
    ) as HTMLElement;
    if (!wrapper) return;

    // Mouse Wheel Zoom centered on cursor
    wrapper.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = wrapper.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const newScale = Math.min(Math.max(this.scale * zoomFactor, 0.2), 15);

        this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
        this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
        this.scale = newScale;

        this.updateTransform();
      },
      { passive: false }
    );

    // Mouse Panning listeners using window for reliable drag & click separation
    wrapper.addEventListener("mousedown", (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".diagram-controls-toolbar"))
        return;

      this.isPanning = true;
      this.hasDragged = false;
      this.startPointerX = e.clientX;
      this.startPointerY = e.clientY;
      this.startPanX = this.panX;
      this.startPanY = this.panY;
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isPanning) return;
      const dx = e.clientX - this.startPointerX;
      const dy = e.clientY - this.startPointerY;

      if (Math.hypot(dx, dy) > 8) {
        this.hasDragged = true;
      }

      this.panX = this.startPanX + dx;
      this.panY = this.startPanY + dy;
      this.updateTransform();
    };

    const onMouseUp = () => {
      this.isPanning = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // Toolbar Buttons
    const btnZoomIn = this.container.querySelector(".diagram-btn-zoom-in");
    const btnZoomOut = this.container.querySelector(".diagram-btn-zoom-out");
    const btnReset = this.container.querySelector(".diagram-btn-reset");

    btnZoomIn?.addEventListener("click", () => {
      const rect = wrapper.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const newScale = Math.min(this.scale * 1.25, 15);
      this.panX = centerX - (centerX - this.panX) * (newScale / this.scale);
      this.panY = centerY - (centerY - this.panY) * (newScale / this.scale);
      this.scale = newScale;
      this.updateTransform();
    });

    btnZoomOut?.addEventListener("click", () => {
      const rect = wrapper.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const newScale = Math.max(this.scale * 0.8, 0.2);
      this.panX = centerX - (centerX - this.panX) * (newScale / this.scale);
      this.panY = centerY - (centerY - this.panY) * (newScale / this.scale);
      this.scale = newScale;
      this.updateTransform();
    });

    btnReset?.addEventListener("click", () => {
      this.scale = 1;
      this.panX = 0;
      this.panY = 0;
      this.updateTransform();
    });
  }

  private setupEventListeners(): void {
    const stage = this.container.querySelector(".diagram-svg-stage");
    if (!stage) return;

    stage.addEventListener("click", (e: Event) => {
      // Prevent triggering click handler if user was panning/dragging
      if (this.hasDragged) return;

      let target = e.target as Element | null;
      let matchedCellId: string | null = null;
      let matchedElement: Element | null = null;

      while (target && target !== stage) {
        const cellIdAttr = target.getAttribute("data-cell-id");
        if (cellIdAttr && cellIdAttr !== "0" && cellIdAttr !== "1") {
          matchedCellId = cellIdAttr;
          matchedElement = target;
          break;
        }
        target = target.parentElement;
      }

      if (matchedCellId && matchedElement) {
        this.highlightSymbol(matchedElement);
        this.onSymbolClick(matchedCellId, matchedElement);
      } else {
        this.clearSelection();
        this.onSymbolClick("", null as any);
      }
    });

  }

  highlightSymbol(element: Element): void {
    if (this.activeElement) {
      this.activeElement.classList.remove("diagram-svg-symbol-active");
    }
    this.activeElement = element;
    this.activeElement.classList.add("diagram-svg-symbol-active");
  }

  clearSelection(): void {
    if (this.activeElement) {
      this.activeElement.classList.remove("diagram-svg-symbol-active");
      this.activeElement = null;
    }
  }
}


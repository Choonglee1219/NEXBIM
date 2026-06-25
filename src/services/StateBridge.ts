import fs from "fs";
import path from "path";

// Bridge Abstraction for LLM Context Sources
export interface IStateBridge {
  getName(): string;
  getContext(payload?: any): string | Promise<string>;
}

// 1. ManualStateBridge: Bridges the user-manual.md content to the LLM
export class ManualStateBridge implements IStateBridge {
  private static cachedManual: string | null = null;

  getName(): string {
    return "UserManual";
  }

  getContext(): string {
    if (ManualStateBridge.cachedManual === null) {
      try {
        const filePath = path.resolve(process.cwd(), "user-manual.md");
        if (fs.existsSync(filePath)) {
          ManualStateBridge.cachedManual = fs.readFileSync(filePath, "utf-8");
          console.log("📚 ManualStateBridge: Successfully loaded user-manual.md");
        } else {
          console.warn("⚠️ ManualStateBridge: user-manual.md not found at " + filePath);
          ManualStateBridge.cachedManual = "";
        }
      } catch (err) {
        console.error("❌ ManualStateBridge: Failed to read user-manual.md:", err);
        ManualStateBridge.cachedManual = "";
      }
    }
    return ManualStateBridge.cachedManual;
  }
}

// 2. ViewerStateBridge: Bridges the active 3D viewer context to the LLM
export class ViewerStateBridge implements IStateBridge {
  getName(): string {
    return "ViewerContext";
  }

  getContext(payload: any): string {
    if (!payload) return "No active viewer context.";
    try {
      return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    } catch (err) {
      console.error("❌ ViewerStateBridge: Failed to format viewer context:", err);
      return "Failed to parse viewer context.";
    }
  }
}

// The Coordinator/Bridge Orchestrator
export class StateBridgeCoordinator {
  private bridges: IStateBridge[] = [];

  constructor() {
    this.bridges.push(new ManualStateBridge());
    this.bridges.push(new ViewerStateBridge());
  }

  public async compileContext(viewerPayload?: any): Promise<string> {
    let combinedContext = "";
    for (const bridge of this.bridges) {
      if (bridge instanceof ManualStateBridge) {
        const manual = await bridge.getContext();
        if (manual) {
          combinedContext += `### ${bridge.getName()} ###\n`;
          combinedContext += `${manual}\n\n`;
        }
      } else if (bridge instanceof ViewerStateBridge && viewerPayload) {
        const viewerCtx = await bridge.getContext(viewerPayload);
        if (viewerCtx) {
          combinedContext += `### ${bridge.getName()} ###\n`;
          combinedContext += `${viewerCtx}\n\n`;
        }
      }
    }
    return combinedContext;
  }
}

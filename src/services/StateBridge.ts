import fs from "fs";
import path from "path";

// Bridge Abstraction for LLM Context Sources
export interface IStateBridge {
  getName(): string;
  getContext(payload?: any): string | Promise<string>;
}

// 1. ManualStateBridge: Bridges the user-manual.md content to the LLM
export class ManualStateBridge implements IStateBridge {
  getName(): string {
    return "UserManual";
  }

  getContext(): string {
    try {
      const filePath = path.resolve(process.cwd(), "user-manual.md");
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      } else {
        console.warn("⚠️ ManualStateBridge: user-manual.md not found at " + filePath);
        return "";
      }
    } catch (err) {
      console.error("❌ ManualStateBridge: Failed to read user-manual.md:", err);
      return "";
    }
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

// 3. KnowledgeStateBridge: Bridges the engineering markdown files to the LLM
export class KnowledgeStateBridge implements IStateBridge {
  getName(): string {
    return "EngineeringKnowledgeBase";
  }

  getContext(): string {
    try {
      const dirPath = path.resolve(process.cwd(), "src", "markdown");
      if (fs.existsSync(dirPath)) {
        let combined = "";

        const walk = (dir: string) => {
          const list = fs.readdirSync(dir);
          for (const file of list) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
              walk(filePath);
            } else if (file.endsWith(".md")) {
              const relativePath = path.relative(dirPath, filePath).replace(/\\/g, "/");
              const content = fs.readFileSync(filePath, "utf-8");
              combined += `--- File: ${relativePath} ---\n${content}\n\n`;
            }
          }
        };

        walk(dirPath);
        return combined;
      } else {
        console.warn("⚠️ KnowledgeStateBridge: src/markdown directory not found at " + dirPath);
        return "";
      }
    } catch (err) {
      console.error("❌ KnowledgeStateBridge: Failed to read src/markdown directory:", err);
      return "";
    }
  }
}

// The Coordinator/Bridge Orchestrator
export class StateBridgeCoordinator {
  private bridges: IStateBridge[] = [];

  constructor() {
    this.bridges.push(new ManualStateBridge());
    this.bridges.push(new ViewerStateBridge());
    this.bridges.push(new KnowledgeStateBridge());
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
      } else if (bridge instanceof KnowledgeStateBridge) {
        const knowledge = await bridge.getContext();
        if (knowledge) {
          combinedContext += `### ${bridge.getName()} ###\n`;
          combinedContext += `${knowledge}\n\n`;
        }
      }
    }
    return combinedContext;
  }
}

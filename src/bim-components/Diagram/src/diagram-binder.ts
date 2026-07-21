import * as OBC from "@thatopen/components";
import { SharedFRAG } from "../../SharedFRAG";
import { Highlighter } from "../../Highlighter";
import { SymbolIfcBinding } from "./diagram-types";

export class DiagramBinder {
  private components: OBC.Components;
  private sharedFRAG = new SharedFRAG();

  constructor(components: OBC.Components) {
    this.components = components;
  }

  /**
   * Navigates to a diagram symbol binding using a 3-step async pipeline:
   * Step 1: Model Loading Complete -> Step 2: Model Zoom-in Complete -> Step 3: Object Zoom-in Complete
   */
  async navigateToBinding(binding: SymbolIfcBinding): Promise<boolean> {
    const targetModelName = binding.model;
    const targetGuid = binding.guid;
    const targetProject = binding.project || "revit";

    if (!targetGuid) {
      console.warn("[DiagramBinder] No GUID provided in binding:", binding);
      return false;
    }

    // 0. Update URL Search Parameters in browser address bar
    try {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set("project", targetProject);
      currentUrl.searchParams.set("model", targetModelName);
      currentUrl.searchParams.set("guid", targetGuid);
      window.history.pushState({}, "", currentUrl.toString());
    } catch (e) {
      console.error("[DiagramBinder] Failed to update URL search params:", e);
    }

    const fragments = this.components.get(OBC.FragmentsManager);
    const highlighter = this.components.get(Highlighter);
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const cam = world?.camera as any;

    try {
      let loadedModel = Array.from(fragments.list.values()).find(
        (m: any) =>
          m.name?.replace(/\.(frag|ifc)$/i, "") ===
          targetModelName.replace(/\.(frag|ifc)$/i, "")
      );

      if (!loadedModel) {
        if (this.sharedFRAG.list.length === 0) {
          await this.sharedFRAG.loadFRAGFiles();
        }

        const targetFrag = this.sharedFRAG.list.find(
          (f) =>
            f.name.replace(/\.frag$/i, "") ===
            targetModelName.replace(/\.frag$/i, "")
        );

        if (targetFrag) {
          const fragData = await this.sharedFRAG.loadFRAG(targetFrag.id);
          if (fragData && fragData.content) {
            loadedModel = await fragments.core.load(fragData.content, {
              modelId: fragData.name,
            });
            (loadedModel as any).name = fragData.name;
            (loadedModel as any).dbId = targetFrag.id;

            if (typeof (window as any).refreshLoadedModelList === "function") {
              (window as any).refreshLoadedModelList();
            }
            // Short delay to allow spatial indexing to settle
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        } else {
          console.warn(
            `[DiagramBinder] Model "${targetModelName}" not found in DB list.`
          );
        }
      }

      let modelIdMap: any = null;
      let hasValidItems = false;

      // Async retry mechanism in case spatial index builds asynchronously
      for (let attempt = 1; attempt <= 4; attempt++) {
        modelIdMap = await fragments.guidsToModelIdMap([targetGuid]);
        hasValidItems = false;
        for (const key in modelIdMap) {
          if (modelIdMap[key] && modelIdMap[key].size > 0) {
            hasValidItems = true;
            break;
          }
        }
        if (hasValidItems) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (hasValidItems && modelIdMap) {
        // Expand spatial/assembly container elements (e.g. IfcElementAssembly) to include all child elements
        const expandedModelIdMap: OBC.ModelIdMap = {};
        for (const modelId in modelIdMap) {
          const localIds = Array.from(modelIdMap[modelId]);
          if (localIds.length === 0) continue;

          const model = fragments.list.get(modelId);
          const expandedSet = new Set<number>();

          for (const id of localIds) {
            const numId = Number(id);
            if (!isNaN(numId)) expandedSet.add(numId);
            if (model && typeof (model as any).getItemsChildren === "function") {
              try {
                const childIds = await (model as any).getItemsChildren([numId]);
                if (childIds && childIds.length > 0) {
                  childIds.forEach((childId: any) => expandedSet.add(Number(childId)));
                }
              } catch (e) {
                // Ignore child lookup errors
              }
            }
          }


          if (expandedSet.size > 0) {
            expandedModelIdMap[modelId] = expandedSet;
          }
        }

        const targetMap =
          Object.keys(expandedModelIdMap).length > 0
            ? expandedModelIdMap
            : modelIdMap;

        await highlighter.highlightByID("select", targetMap, true, false);

        if (cam && typeof cam.fitToItems === "function") {
          await cam.fitToItems(targetMap);
        }

        // Clean up URL Search Parameters after zoom-in completes
        try {
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState({}, document.title, cleanUrl);
        } catch (e) {
          console.error("[DiagramBinder] Failed to clean URL params:", e);
        }

        return true;

      } else {
        console.warn(
          `[DiagramBinder] GUID "${targetGuid}" not found after retries.`
        );
        return false;
      }
    } catch (err) {
      console.error("[DiagramBinder] Navigation pipeline error:", err);
      return false;
    }
  }

  /**
   * Clears current 3D selection highlight.
   */
  async clearSelection(): Promise<void> {
    try {
      const highlighter = this.components.get(Highlighter);
      await highlighter.clear("select");
    } catch (err) {
      console.error("[DiagramBinder] Clear selection error:", err);
    }
  }
}


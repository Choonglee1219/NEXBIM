import MarkdownIt from "markdown-it";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { BimChatState, ChatMessage, BimChatMode } from "./types";
import { appIcons } from "../../../globals";
import { Highlighter } from "../../../bim-components/Highlighter";
import { clashUIState } from "../../../ui-templates/sections/clash-list";
import { queriesUIState, sanitizeRegexString } from "../../../ui-templates/sections/queries";
import { ruleUIState } from "../../../ui-templates/sections/rule-spec";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
});

interface ModeChatStore {
  history: ChatMessage[];
  isGenerating: boolean;
}

const chatStores: Record<BimChatMode, ModeChatStore> = {
  viewport: {
    history: [
      {
        role: "model",
        parts: [{ text: "*이 모델의 Wall, Slab, Covering 요소들을 숨겨줘.\n*벽체(Wall) 객체를 뷰어에서 하이라이트해줘.\n*간섭 검사를 실행해줘." }]
      }
    ],
    isGenerating: false,
  },
  query: {
    history: [
      {
        role: "model",
        parts: [{ text: "*Wall 중 IsExternal 속성이 true인 객체를 찾는 쿼리 작성해줘.\n*Slab 중 PredefinedType 속성이 BASESLAB인 객체를 찾는 쿼리 작성해줘." }]
      }
    ],
    isGenerating: false,
  },
  rule: {
    history: [
      {
        role: "model",
        parts: [{ text: "*모든 Door에 FireRating 속성이 존재하는지 검사하는 규칙 작성해줘.\n*모든 Column의 Length 수량이 존재하는지 검사하는 규칙 생성해줘." }]
      }
    ],
    isGenerating: false,
  },
};

// ==========================================
// 🛠️ Context & Selection Parser Helpers
// ==========================================

const extractRawValue = (val: any): any => {
  if (val === null || val === undefined) return null;
  if (typeof val === "object" && "value" in val) {
    return extractRawValue(val.value);
  }
  return val;
};

const processPropSet = (set: any, result: any) => {
  const setName = extractRawValue(set.Name) || extractRawValue(set._category) || "UnnamedSet";
  const setCategory = extractRawValue(set._category);
  const properties: any = {};

  const items = [];
  if (set.HasProperties) {
    const p = Array.isArray(set.HasProperties) ? set.HasProperties : [set.HasProperties];
    items.push(...p);
  }
  if (set.Quantities) {
    const q = Array.isArray(set.Quantities) ? set.Quantities : [set.Quantities];
    items.push(...q);
  }

  for (const prop of items) {
    const propName = extractRawValue(prop.Name);
    if (!propName) continue;

    let propValue = null;
    if (prop.NominalValue !== undefined) {
      propValue = extractRawValue(prop.NominalValue);
    } else {
      for (const k in prop) {
        if (k.endsWith("Value") && k !== "NominalValue") {
          propValue = extractRawValue(prop[k]);
          break;
        }
      }
    }
    properties[propName] = propValue;
  }

  if (setCategory === "IFCELEMENTQUANTITY") {
    result.quantities[setName] = properties;
  } else {
    result.propertySets[setName] = properties;
  }
};

const parseElementItem = (item: any) => {
  if (!item) return null;
  const result: any = {
    expressId: extractRawValue(item._localId),
    category: extractRawValue(item._category),
    name: extractRawValue(item.Name),
    attributes: {},
    propertySets: {},
    quantities: {}
  };

  for (const key in item) {
    if (key.startsWith("_") || key === "Name") continue;
    const val = item[key];
    if (val === null || val === undefined) continue;

    const isRelation = Array.isArray(val) || (typeof val === "object" && !("value" in val));
    if (!isRelation) {
      result.attributes[key] = extractRawValue(val);
    } else {
      if (key === "IsDefinedBy") {
        const defines = Array.isArray(val) ? val : [val];
        for (const def of defines) {
          if (def.RelatingPropertyDefinition) {
            const relDefs = Array.isArray(def.RelatingPropertyDefinition)
              ? def.RelatingPropertyDefinition
              : [def.RelatingPropertyDefinition];
            for (const relDef of relDefs) {
              processPropSet(relDef, result);
            }
          }
        }
      } else if (key === "ContainedInStructure") {
        const cont = Array.isArray(val) ? val[0] : val;
        if (cont) {
          result.attributes["ContainedIn"] = extractRawValue(cont.Name) || extractRawValue(cont._category);
        }
      }
    }
  }

  if (Object.keys(result.attributes).length === 0) delete result.attributes;
  if (Object.keys(result.propertySets).length === 0) delete result.propertySets;
  if (Object.keys(result.quantities).length === 0) delete result.quantities;

  return result;
};

const getModelContext = async (components: OBC.Components) => {
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(Highlighter);
  const classifier = components.get(OBC.Classifier);

  // 1. Get loaded models info
  const modelInfos: any[] = [];
  for (const [id, model] of fragments.list) {
    modelInfos.push({
      modelId: id,
      name: (model as any).name || "Unnamed Model",
      dbId: (model as any).dbId || null
    });
  }

  // 2. Classify by category and get counts
  const categoryCounts: Record<string, number> = {};
  try {
    await classifier.byCategory({ classificationName: "entities" });
    const entities = classifier.list.get("entities");
    if (entities) {
      for (const [catName, groupData] of entities.entries()) {
        const modelMap = await groupData.get();
        let totalCount = 0;
        for (const modelId in modelMap) {
          totalCount += modelMap[modelId].size;
        }
        if (totalCount > 0) {
          categoryCounts[catName] = totalCount;
        }
      }
    }
  } catch (e) {
    console.error("Failed to extract category counts:", e);
  }

  // 3. Get selection info
  let selectedElementProps: any = null;
  const currentSelection = highlighter.selection.select;
  const modelIds = Object.keys(currentSelection);
  if (modelIds.length > 0) {
    const modelId = modelIds[0];
    const selectIds = currentSelection[modelId];
    const model = fragments.list.get(modelId);
    if (model && selectIds && selectIds.size > 0) {
      const idArr = Array.from(selectIds) as number[];
      try {
        const itemsData = await model.getItemsData(idArr, {
          attributesDefault: true,
          relationsDefault: { attributes: false, relations: false },
          relations: {
            IsDefinedBy: { attributes: true, relations: true },
            DefinesOcurrence: { attributes: false, relations: false },
            ContainedInStructure: { attributes: true, relations: true },
            ContainsElements: { attributes: false, relations: false },
            Decomposes: { attributes: false, relations: false },
            RelatingPropertyDefinition: { attributes: true, relations: true },
            HasProperties: { attributes: true, relations: true },
            Quantities: { attributes: true, relations: true },
            HasAssociations: { attributes: true, relations: true },
            HasPropertySets: { attributes: true, relations: true },
          }
        });
        if (itemsData && itemsData.length > 0) {
          selectedElementProps = parseElementItem(itemsData[0]);
        }
      } catch (err) {
        console.error("Failed to get selected items data:", err);
      }
    }
  }

  const clashCount = clashUIState.rawValidResults ? clashUIState.rawValidResults.length : 0;
  const filteredClashCount = clashUIState.cachedFlatData ? clashUIState.cachedFlatData.length : 0;

  return JSON.stringify({
    loadedModels: modelInfos,
    categoryCounts: categoryCounts,
    clashCount: clashCount,
    filteredClashCount: filteredClashCount,
    currentSelection: selectedElementProps
  });
};

// ==========================================
// 🕹️ Layout & Action Processors
// ==========================================

const switchLayoutAndTab = async (layoutName: string, switchTabFn?: ((tab: "list" | "builder") => void) | null) => {
  const contentGrid = document.getElementById("app-content") as any;
  if (contentGrid && contentGrid.layout !== layoutName) {
    contentGrid.layout = layoutName;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (switchTabFn) switchTabFn("builder");
};

const processQueryBuilderAction = async (action: any) => {
  if (queriesUIState.nameInput) queriesUIState.nameInput.value = action.name || "AI_Query";
  if (queriesUIState.entityInput) queriesUIState.entityInput.value = sanitizeRegexString(action.entity || "");
  if (queriesUIState.attrNameInput) queriesUIState.attrNameInput.value = sanitizeRegexString(action.attrName || "");
  if (queriesUIState.attrValInput) queriesUIState.attrValInput.value = sanitizeRegexString(action.attrVal || "");
  if (queriesUIState.psetNameInput) queriesUIState.psetNameInput.value = sanitizeRegexString(action.psetName || "");
  if (queriesUIState.propNameInput) queriesUIState.propNameInput.value = sanitizeRegexString(action.propName || "");
  if (queriesUIState.propValInput) queriesUIState.propValInput.value = sanitizeRegexString(action.propVal || "");
  if (queriesUIState.containedInInput) queriesUIState.containedInInput.value = sanitizeRegexString(action.containedIn || "");
  if (queriesUIState.structureNameInput) queriesUIState.structureNameInput.value = sanitizeRegexString(action.structureName || "");

  await switchLayoutAndTab("Queries", queriesUIState.switchTab);

  if (action.autoExecute && queriesUIState.onCreateQuery) {
    await queriesUIState.onCreateQuery();
  }
};

const processRuleBuilderAction = async (action: any) => {
  if (ruleUIState.entityInput) ruleUIState.entityInput.value = action.entity || "";
  if (ruleUIState.reqTypeDropdown) ruleUIState.reqTypeDropdown.value = [action.reqType || "property"];
  if (ruleUIState.psetInput) {
    ruleUIState.psetInput.value = action.pset || "";
    ruleUIState.psetInput.disabled = action.reqType === "attribute";
  }
  if (ruleUIState.propInput) ruleUIState.propInput.value = action.name || "";
  if (ruleUIState.conditionDropdown) ruleUIState.conditionDropdown.value = [action.condition || "exists"];
  if (ruleUIState.propValInput) {
    ruleUIState.propValInput.value = action.value || "";
    ruleUIState.propValInput.disabled = action.condition === "exists";
  }

  await switchLayoutAndTab("RuleCheck", ruleUIState.switchTab);

  if (action.autoExecute && ruleUIState.onReviewModel) {
    await ruleUIState.onReviewModel();
  }
};

const executeViewerAction = async (components: OBC.Components, world: OBC.World, action: any) => {
  const highlighter = components.get(Highlighter);
  const hider = components.get(OBC.Hider);
  const fragments = components.get(OBC.FragmentsManager);

  try {
    const { type, target, value } = action;
    console.log("Executing action:", type, target, value);

    if (type === "showAll") {
      const { showAllItems } = await import("../../../ui-templates/toolbars/viewer-toolbar");
      await showAllItems(components);
      return "All elements shown in 3D viewer.";
    }

    if (type === "ghostMode") {
      const { toggleGhostMode } = await import("../../../ui-templates/toolbars/viewer-toolbar");
      toggleGhostMode(components);
      return "Ghost mode toggled.";
    }

    if (type === "clipperBox") {
      const { toggleClipperBox } = await import("../../../ui-templates/toolbars/viewer-toolbar");
      toggleClipperBox(components);
      return "Clipper box toggled.";
    }

    if (type === "runClash") {
      await switchLayoutAndTab("ClashDetection");
      if (clashUIState.runClash) {
        await clashUIState.runClash();
        return "Clash detection ran via UI.";
      }
      return "Clash detection UI is not available.";
    }

    if (type === "filterClash") {
      await switchLayoutAndTab("ClashDetection");
      if (typeof value === "string") {
        clashUIState.searchQuery = value;
        return `Filtered clash list by: ${value}`;
      }
    }

    if (type === "switchTab") {
      if (typeof value === "string") {
        await switchLayoutAndTab(value);
        return `Switched tab to: ${value}`;
      }
    }

    if (type === "queryModel" && value && typeof value === "object") {
      await switchLayoutAndTab("Queries");

      if (queriesUIState.onClear) {
        queriesUIState.onClear();
      }

      const queryName = value.queryName || "AI_Chat_Query";
      if (queriesUIState.nameInput) queriesUIState.nameInput.value = queryName;
      if (queriesUIState.entityInput) queriesUIState.entityInput.value = value.entity || "";
      if (queriesUIState.attrNameInput) queriesUIState.attrNameInput.value = value.attributeName || "";
      if (queriesUIState.attrValInput) queriesUIState.attrValInput.value = value.attributeValue || "";
      if (queriesUIState.psetNameInput) queriesUIState.psetNameInput.value = value.propertySetName || "";
      if (queriesUIState.propNameInput) queriesUIState.propNameInput.value = value.propertyName || "";
      if (queriesUIState.propValInput) queriesUIState.propValInput.value = value.propertyValue || "";
      if (queriesUIState.containedInInput) queriesUIState.containedInInput.value = value.containerEntity || "";
      if (queriesUIState.structureNameInput) queriesUIState.structureNameInput.value = value.containerName || "";

      let count = 0;
      if (queriesUIState.onCreateQuery) {
        await queriesUIState.onCreateQuery();
        const finder = components.get(OBC.ItemsFinder);
        const createdQuery = finder.list.get(queryName);
        if (createdQuery) {
          const items = await createdQuery.test({ modelIds: [/.*/] });
          for (const modelId in items) {
            count += items[modelId].size;
          }
        }
      }

      if (value.layout) {
        await switchLayoutAndTab(value.layout);
      }

      return String(count);
    }

    if (type === "showAll") {
      await hider.set(true);
      return "Showed all elements.";
    }

    // Category, specific ID, or selection highlight/isolate/hide
    let modelIdMap: OBC.ModelIdMap = {};

    if (target === "category" && typeof value === "string") {
      const cleanCat = sanitizeRegexString(value);
      for (const [modelId, model] of fragments.list) {
        const items = await model.getItemsOfCategories([new RegExp(`^${cleanCat}$`, "i")]);
        const localIds = Object.values(items).flat();
        if (localIds.length > 0) {
          modelIdMap[modelId] = new Set(localIds);
        }
      }
    } else if (target === "id" && value) {
      const ids = Array.isArray(value) ? value : [parseInt(value, 10)];
      const firstModelId = fragments.list.keys().next().value;
      if (firstModelId) {
        modelIdMap[firstModelId] = new Set(ids);
      }
    } else {
      // Default to current selection if target is "selection", empty, or unspecified
      modelIdMap = highlighter.selection.select;
    }

    if (OBC.ModelIdMapUtils.isEmpty(modelIdMap)) {
      return "No matching elements or selected elements found to execute action.";
    }

    if (type === "highlight") {
      await highlighter.highlightByID("select", modelIdMap);
      return `Highlighted elements.`;
    } else if (type === "isolate") {
      await hider.isolate(modelIdMap);
      return `Isolated elements.`;
    } else if (type === "hide") {
      await hider.set(false, modelIdMap);
      highlighter.clear("select");
      return `Hidden elements.`;
    } else if (type === "focus") {
      if (world.camera instanceof OBC.SimpleCamera) {
        await world.camera.fitToItems(modelIdMap);
        return "Camera focused on elements.";
      }
    }
  } catch (err) {
    console.error("Failed to execute viewer action:", err);
    return `Error executing action: ${err}`;
  }
};

// ==========================================
// 🎨 Rendering & Main Component Template
// ==========================================

const renderMessages = (messages: ChatMessage[]) => {
  return messages.map((msg) => {
    const isUser = msg.role === "user";
    const text = msg.parts[0].text;

    let displayText = text.replace(/```json([\s\S]*?)```/g, "").trim();

    if (!displayText) {
      displayText = "*[Viewer action executed]*";
    }

    const renderedHtml = md.render(displayText);

    const align = isUser ? "flex-end" : "flex-start";
    const bg = isUser ? "var(--bim-ui_main-base)" : "var(--bim-ui_bg-contrast-20)";
    const color = isUser ? "var(--bim-ui_main-contrast)" : "var(--bim-ui_bg-contrast-100)";
    const radius = isUser ? "12px 12px 0 12px" : "12px 12px 12px 0";

    return BUI.html`
      <div style="align-self: ${align}; max-width: 85%; margin-bottom: 0.75rem; display: flex; flex-direction: column;">
        <div style="
          background: ${bg};
          color: ${color};
          padding: 0.5rem 0.75rem;
          border-radius: ${radius};
          font-size: 0.85rem;
          line-height: 1.4;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        ">
          <div ${BUI.ref((el) => { if (el) el.innerHTML = renderedHtml; })} class="markdown-body" style="word-break: break-word;"></div>
        </div>
        <span style="font-size: 0.65rem; color: var(--bim-ui_gray-8); align-self: ${isUser ? "flex-end" : "flex-start"}; margin-top: 0.15rem; margin-right: 0.25rem;">
          ${isUser ? "You" : "AI Assistant"}
        </span>
      </div>
    `;
  });
};

export const bimChatTemplate: BUI.StatefullComponent<BimChatState> = (
  state,
  update,
) => {
  const { components, world, embedded = false } = state;
  const currentMode: BimChatMode = state.mode || "viewport";
  const store = chatStores[currentMode] || chatStores.viewport;

  let textInput: HTMLTextAreaElement | undefined;
  let messageListContainer: HTMLDivElement | undefined;

  (window as any).setBimChatMode = (mode: BimChatMode) => {
    if (chatStores[mode]) {
      update();
    }
  };

  const getHeaderTitle = () => {
    if (currentMode === "query") return "AI Assistant (Query Builder)";
    if (currentMode === "rule") return "AI Assistant (Rule Builder)";
    return "AI Assistant (Viewer)";
  };

  const getPlaceholder = () => {
    if (currentMode === "query") return "자연어로 쿼리 조건 작성 요청";
    if (currentMode === "rule") return "자연어로 규칙 조건 작성 요청";
    return "3D 뷰어 조작 및 모델 탐색 요청";
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      if (messageListContainer) messageListContainer.scrollTop = messageListContainer.scrollHeight;
    }, 50);
  };

  const onSend = async () => {
    if (!textInput || store.isGenerating) return;
    const text = textInput.value.trim();
    if (!text) return;

    textInput.value = "";
    store.history.push({ role: "user", parts: [{ text }] });
    store.isGenerating = true;
    update();
    scrollToBottom();

    try {
      const context = await getModelContext(components);

      const response = await fetch("/api/chat/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: store.history.slice(0, -1),
          context,
          mode: currentMode,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to call Chat Assistant API");
      }

      const data = await response.json();
      const reply = data.reply || "";

      store.history.push({ role: "model", parts: [{ text: reply }] });

      const jsonMatch = reply.match(/```json([\s\S]*?)```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const actionObj = JSON.parse(jsonMatch[1].trim());

          if (currentMode === "query" && actionObj.queryBuilderAction) {
            await processQueryBuilderAction(actionObj.queryBuilderAction);
          } else if (currentMode === "rule" && actionObj.ruleBuilderAction) {
            await processRuleBuilderAction(actionObj.ruleBuilderAction);
          } else if (currentMode === "viewport" && actionObj.viewerAction) {
            const actionResult = await executeViewerAction(components, world, actionObj.viewerAction);
            if (actionObj.viewerAction.type === "queryModel" && actionResult !== undefined) {
              store.history.push({
                role: "model",
                parts: [{ text: `🔍 **조회 결과**: 총 **${actionResult}개**의 객체가 검색되었으며, 뷰어에 하이라이트 표시되었습니다.` }]
              });
            }
          }
        } catch (jsonErr) {
          console.error("Failed to parse action JSON:", jsonErr);
        }
      }
    } catch (err: any) {
      console.error(err);
      store.history.push({
        role: "model",
        parts: [{ text: `⚠️ **오류 발생**: ${err.message || "서버와 통신하는 중 오류가 발생했습니다."}` }]
      });
    } finally {
      store.isGenerating = false;
      update();
      scrollToBottom();
    }
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.keyCode === 13) {
      if (e.isComposing) {
        e.preventDefault();
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    }
  };

  const onStartDragHeader = (e: MouseEvent) => {
    if (embedded) return;
    const target = e.target as HTMLElement;
    if (target.tagName.toLowerCase() === "bim-button" || target.closest("bim-button")) return;

    const panel = document.getElementById("bim-chat-panel");
    if (!panel) return;

    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const onMouseMove = (moveEvent: MouseEvent) => {
      let newLeft = moveEvent.clientX - offsetX;
      let newTop = moveEvent.clientY - offsetY;

      newLeft = Math.max(10, Math.min(window.innerWidth - rect.width - 10, newLeft));
      newTop = Math.max(10, Math.min(window.innerHeight - rect.height - 10, newTop));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return BUI.html`
    <div style="
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      max-height: 100%;
      background: var(--bim-ui_bg-base);
      overflow: hidden;
      border-radius: ${embedded ? "8px" : "12px"};
    ">
      <style>
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: var(--bim-ui_bg-contrast-20);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: var(--bim-ui_bg-contrast-40);
        }
      </style>

      <!-- Header -->
      <div
        @mousedown=${onStartDragHeader}
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.6rem 0.85rem;
          background: var(--bim-ui_bg-contrast-10);
          border-bottom: 1px solid var(--bim-ui_bg-contrast-20);
          cursor: ${embedded ? "default" : "move"};
          user-select: none;
          flex-shrink: 0;
        "
        title=${embedded ? "" : "Drag header to move floating window"}
      >
        <div style="display: flex; align-items: center; gap: 0.5rem; pointer-events: none;">
          <div style="width: 8px; height: 8px; background: #00ffaa; border-radius: 50%; box-shadow: 0 0 8px #00ffaa;"></div>
          <span style="font-weight: bold; font-size: 0.85rem; color: var(--bim-ui_bg-contrast-100);">${getHeaderTitle()}</span>
        </div>
        ${!embedded ? BUI.html`
          <bim-button @click=${() => {
        if ((window as any).toggleBimChat) {
          (window as any).toggleBimChat(false);
        } else {
          const chatPanel = document.getElementById("bim-chat-panel");
          if (chatPanel) {
            chatPanel.style.display = "none";
            const chatBtn = document.getElementById("bim-chat-toggle-btn") as any;
            if (chatBtn) chatBtn.active = false;
          }
        }
      }} icon=${appIcons.CLEAR} style="flex: 0; --bim-button--bgc: transparent;"></bim-button>
        ` : ""}
      </div>

      <!-- Message Area -->
      <div ${BUI.ref((el) => (messageListContainer = el as HTMLDivElement))} class="custom-scrollbar" style="
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
      ">
        ${renderMessages(store.history)}
        
        <!-- Generating Loader -->
        ${store.isGenerating ? BUI.html`
          <div style="align-self: flex-start; display: flex; align-items: center; gap: 0.5rem; background: var(--bim-ui_bg-contrast-20); padding: 0.5rem 0.75rem; border-radius: 12px 12px 12px 0; margin-bottom: 0.75rem;">
            <div style="display: flex; gap: 4px;">
              <div style="width: 6px; height: 6px; background: var(--bim-ui_accent-base); border-radius: 50%; animation: pulse 1.2s infinite ease-in-out;"></div>
              <div style="width: 6px; height: 6px; background: var(--bim-ui_accent-base); border-radius: 50%; animation: pulse 1.2s infinite ease-in-out 0.2s;"></div>
              <div style="width: 6px; height: 6px; background: var(--bim-ui_accent-base); border-radius: 50%; animation: pulse 1.2s infinite ease-in-out 0.4s;"></div>
            </div>
            <style>
              @keyframes pulse {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-4px); }
              }
            </style>
          </div>
        ` : ""}
      </div>

      <!-- Input Area -->
      <div style="
        padding: 0.75rem;
        background: var(--bim-ui_bg-contrast-5);
        border-top: 1px solid var(--bim-ui_bg-contrast-20);
        display: flex;
        gap: 0.5rem;
        align-items: center;
      ">
        <textarea 
          ${BUI.ref((el) => (textInput = el as HTMLTextAreaElement))}
          @keydown=${onKeydown}
          class="custom-scrollbar"
          placeholder=${getPlaceholder()}
          rows="1"
          style="
            flex: 1;
            background: var(--bim-ui_bg-contrast-10);
            border: 1px solid var(--bim-ui_bg-contrast-20);
            border-radius: 8px;
            padding: 0.5rem 0.75rem;
            color: var(--bim-ui_bg-contrast-100);
            font-size: 0.85rem;
            outline: none;
            transition: border-color 0.2s;
            resize: none;
            font-family: inherit;
            height: 2.2rem;
            line-height: 1.2rem;
            box-sizing: border-box;
            overflow-y: auto;
          "
          onfocus="this.style.borderColor='var(--bim-ui_accent-base)'"
          onblur="this.style.borderColor='var(--bim-ui_bg-contrast-20)'"
        ></textarea>
        <bim-button @click=${onSend} icon=${appIcons.CHATBOT} style="flex: 0; --bim-button--bgc: var(--bim-ui_main-base);" title="Send"></bim-button>
      </div>
    </div>
  `;
};

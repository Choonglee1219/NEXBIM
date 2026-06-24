import MarkdownIt from "markdown-it";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { BimChatState, ChatMessage } from "./types";
import { appIcons } from "../../../globals";
import { Highlighter } from "../../../bim-components/Highlighter";
import { clashUIState } from "../../../ui-templates/sections/clash-list";
import { queriesUIState } from "../../../ui-templates/sections/queries";


const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
});

// Chat history store (persists across redraws of this StatefullComponent)
const chatHistory: ChatMessage[] = [
  {
    role: "model",
    parts: [{ text: "안녕하세요! 저는 BIM AI Assistant입니다. 무엇을 도와드릴까요? 로드되어 있는 모델에 대해서만 질의할 수 있습니다.\n\n* 이 모델의 Wall 요소는 몇 개야?\n* 이 객체의 모든 속성을 알려줘.\n* 이 객체를 숨겨줘. " }]
  }
];

let isGenerating = false;

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
          relationsDefault: { attributes: true, relations: false }
        });
        if (itemsData && itemsData.length > 0) {
          selectedElementProps = itemsData[0];
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
      const contentGrid = document.getElementById("app-content") as any;
      if (contentGrid && contentGrid.layout !== "ClashDetection") {
        contentGrid.layout = "ClashDetection";
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (clashUIState.runClash) {
        await clashUIState.runClash();
        return "Clash detection ran via UI.";
      }
      return "Clash detection UI is not available.";
    }

    if (type === "filterClash") {
      const contentGrid = document.getElementById("app-content") as any;
      if (contentGrid && contentGrid.layout !== "ClashDetection") {
        contentGrid.layout = "ClashDetection";
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (typeof value === "string") {
        clashUIState.searchQuery = value;
        return `Filtered clash list by: ${value}`;
      }
    }

    if (type === "switchTab") {
      const contentGrid = document.getElementById("app-content") as any;
      if (contentGrid && typeof value === "string") {
        contentGrid.layout = value;
        return `Switched tab to: ${value}`;
      }
    }

    if (type === "queryModel" && value && typeof value === "object") {
      const contentGrid = document.getElementById("app-content") as any;
      if (contentGrid && contentGrid.layout !== "Queries") {
        contentGrid.layout = "Queries";
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

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
      return String(count);
    }

    // Category or specific ID highlight/isolate/hide
    let modelIdMap: OBC.ModelIdMap = {};

    if (target === "category" && typeof value === "string") {
      for (const [modelId, model] of fragments.list) {
        const items = await model.getItemsOfCategories([new RegExp(`^${value}$`, "i")]);
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
    } else if (target === "selection") {
      modelIdMap = highlighter.selection.select;
    }

    if (OBC.ModelIdMapUtils.isEmpty(modelIdMap)) {
      return "No matching elements found to execute action.";
    }

    if (type === "highlight") {
      await highlighter.highlightByID("select", modelIdMap);
      return `Highlighted elements.`;
    } else if (type === "isolate") {
      await hider.isolate(modelIdMap);
      return `Isolated elements.`;
    } else if (type === "hide") {
      await hider.set(false, modelIdMap);
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

const renderMessages = () => {
  return chatHistory.map(msg => {
    const isUser = msg.role === "user";
    const text = msg.parts[0].text;

    // strip the JSON block from text when rendering
    let displayText = text;
    const jsonBlockRegex = /```json([\s\S]*?)```/g;
    displayText = text.replace(jsonBlockRegex, "").trim();

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
          <div ${BUI.ref(el => { if (el) el.innerHTML = renderedHtml; })} class="markdown-body" style="word-break: break-word;"></div>
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
  const { components, world } = state;
  let textInput: HTMLTextAreaElement | undefined;
  let messageListContainer: HTMLDivElement | undefined;

  const onSend = async () => {
    if (!textInput || isGenerating) return;
    const text = textInput.value.trim();
    if (!text) return;

    textInput.value = "";
    chatHistory.push({ role: "user", parts: [{ text }] });
    isGenerating = true;
    update();

    setTimeout(() => {
      if (messageListContainer) messageListContainer.scrollTop = messageListContainer.scrollHeight;
    }, 50);

    try {
      const context = await getModelContext(components);

      const response = await fetch("/api/chat/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          history: chatHistory.slice(0, -1),
          context,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to call Chat Assistant API");
      }

      const data = await response.json();
      const reply = data.reply || "";

      chatHistory.push({ role: "model", parts: [{ text: reply }] });

      const jsonBlockRegex = /```json([\s\S]*?)```/;
      const match = reply.match(jsonBlockRegex);
      if (match && match[1]) {
        try {
          const actionObj = JSON.parse(match[1].trim());
          if (actionObj.viewerAction) {
            const actionResult = await executeViewerAction(components, world, actionObj.viewerAction);
            if (actionObj.viewerAction.type === "queryModel" && actionResult !== undefined) {
              chatHistory.push({
                role: "model",
                parts: [{ text: `🔍 **조회 결과**: 총 **${actionResult}개**의 객체가 검색되었으며, 뷰어에 하이라이트 표시되었습니다.` }]
              });
            }
          }
        } catch (jsonErr) {
          console.error("Failed to parse viewer action JSON:", jsonErr);
        }
      }
    } catch (err: any) {
      console.error(err);
      chatHistory.push({
        role: "model",
        parts: [{ text: `⚠️ **오류 발생**: ${err.message || "서버와 통신하는 중 오류가 발생했습니다."}` }]
      });
    } finally {
      isGenerating = false;
      update();
      setTimeout(() => {
        if (messageListContainer) messageListContainer.scrollTop = messageListContainer.scrollHeight;
      }, 50);
    }
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.keyCode === 13) {
      if (e.isComposing) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        // Shift+Enter allows standard newline behavior
      } else {
        e.preventDefault();
        onSend();
      }
    }
  };

  setTimeout(() => {
    if (messageListContainer) messageListContainer.scrollTop = messageListContainer.scrollHeight;
  }, 100);

  return BUI.html`
    <div style="
      display: flex;
      flex-direction: column;
      height: 100%;
      background: rgba(20, 22, 26, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
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
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1rem;
        background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      ">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <div style="width: 8px; height: 8px; background: #00ffaa; border-radius: 50%; box-shadow: 0 0 8px #00ffaa;"></div>
          <span style="font-weight: bold; font-size: 0.9rem; color: var(--bim-ui_bg-contrast-100);">AI Assistant</span>
        </div>
        <bim-button @click=${() => {
      const chatPanel = document.getElementById("bim-chat-panel");
      if (chatPanel) {
        chatPanel.style.display = "none";
        const chatBtn = document.getElementById("bim-chat-toggle-btn") as any;
        if (chatBtn) chatBtn.active = false;
      }
    }} icon=${appIcons.CLEAR} style="flex: 0; --bim-button--bgc: transparent;"></bim-button>
      </div>

      <!-- Message Area -->
      <div ${BUI.ref(el => messageListContainer = el as HTMLDivElement)} class="custom-scrollbar" style="
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
      ">
        ${renderMessages()}
        
        <!-- Generating Loader -->
        ${isGenerating ? BUI.html`
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
        background: rgba(0, 0, 0, 0.2);
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        display: flex;
        gap: 0.5rem;
        align-items: center;
      ">
        <textarea 
          ${BUI.ref(el => textInput = el as HTMLTextAreaElement)}
          @keydown=${onKeydown}
          class="custom-scrollbar"
          placeholder="Ask something about the BIM model..."
          rows="1"
          style="
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
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
          onblur="this.style.borderColor='rgba(255, 255, 255, 0.1)'"
        ></textarea>
        <bim-button @click=${onSend} icon=${appIcons.CHATBOT} style="flex: 0; --bim-button--bgc: var(--bim-ui_main-base);" title="Send"></bim-button>
      </div>
    </div>
  `;
};

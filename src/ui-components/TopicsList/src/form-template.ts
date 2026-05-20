import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { createRef } from "lit/directives/ref.js";
import { TopicStyles } from "./types";
import { defaultTopicStyles } from "./styles";
import { appState, showLightbox, appIcons } from "../../../globals";
import { BCFTopics as EngineBCFTopics } from "../../../engine-components/BCFTopics";
import { Topic as EngineTopic } from "../../../engine-components/BCFTopics";

interface FormValue {
  title: string;
  status: string;
  type: string;
  priority: string;
  assignedTo: string;
  labels: Iterable<string>;
  stage: string;
  description: string;
  creationAuthor: string;
  dueDate?: string | null;
}

/**
 * Represents the UI elements and configuration for a topic form in the OBC system.
 *
 * @interface TopicFormUI
 */
export interface TopicFormUI {
  /**
   * The main components entry point of your app.
   */
  components: OBC.Components;

  /**
   * The topic data to be used in the form. This can be undefined if no topic is being edited.
   */
  topic?: EngineTopic;

  /**
   * The initial values for the form fields. Can be a partial raw topic object.
   */
  value?: Partial<FormValue>;

  /**
   * Callback function triggered when the form is submitted.
   *
   * @param {EngineTopic} topic - The topic created/updated from the form.
   * @returns {void | Promise<void>} - A void or a promise that resolves to void.
   */
  onSubmit?: (topic: EngineTopic) => void | Promise<void>;

  /**
   * Callback function triggered when the form is canceled.
   *
   * @returns {void | Promise<void>} - A void or a promise that resolves to void.
   */
  onCancel?: () => void | Promise<void>;

  /**
   * Callback function triggered when restoring the 3D Viewpoint.
   */
  onRestoreViewpoint?: () => void | Promise<void>;

  /**
   * Callback function triggered when capturing the 3D Viewpoint manually.
   */
  onCapture?: () => Promise<void>;

  /**
   * The captured viewpoint data (if any) before submitting.
   */
  capturedViewpoint?: any;

  /**
   * The captured snapshot image data (if any) before submitting.
   */
  capturedSnapshot?: string | null;

  /**
   * Custom styles for the form components.
   */
  styles?: Partial<TopicStyles>;

  /**
   * (Optional) The UI component for the comments section to be displayed on the right half.
   */
  commentsUI?: any;
}

const valueTransform: Record<string, (value: any) => any> = {
  dueDate: (value) => {
    if (!(typeof value === "string" && value.trim() !== "")) return undefined;
    return new Date(value);
  },
  type: (value) => {
    if (Array.isArray(value) && value.length !== 0) return value[0];
    return undefined;
  },
  status: (value) => {
    if (Array.isArray(value) && value.length !== 0) return value[0];
    return undefined;
  },
  creationAuthor: (value) => {
    if (Array.isArray(value) && value.length !== 0) return value[0];
    return undefined;
  },
  priority: (value) => {
    if (Array.isArray(value) && value.length !== 0) return value[0];
    return undefined;
  },
  stage: (value) => {
    if (Array.isArray(value) && value.length !== 0) return value[0];
    return undefined;
  },
  assignedTo: (value) => {
    if (Array.isArray(value) && value.length !== 0) return value[0];
    return undefined;
  },
  labels: (value) => {
    if (Array.isArray(value)) return new Set(value);
    return undefined;
  },
};

export const topicFormTemplate = (state: TopicFormUI) => {
  const {
    components,
    topic,
    value,
    onCancel,
    onRestoreViewpoint,
    onSubmit: _onSubmit,
    styles,
  } = state;
  const onSubmit = _onSubmit ?? (() => {});
  const bcfTopics = components.get(EngineBCFTopics);

  const title = value?.title ?? topic?.title ?? EngineTopic.default.title;
  const status = value?.status ?? topic?.status ?? EngineTopic.default.status;
  const creationAuthor = value?.creationAuthor ?? topic?.creationAuthor ?? bcfTopics.config.author;
  const type = value?.type ?? topic?.type ?? EngineTopic.default.type;
  const priority =
    value?.priority ?? topic?.priority ?? EngineTopic.default.priority;
  const assignedTo =
    value?.assignedTo ?? topic?.assignedTo ?? EngineTopic.default.assignedTo;
  const labels = value?.labels ?? topic?.labels ?? EngineTopic.default.labels;
  const stage = value?.stage ?? topic?.stage ?? EngineTopic.default.stage;
  const description =
    value?.description ?? topic?.description ?? EngineTopic.default.description;
  const dueDate =
    value?.dueDate ?? (topic?.dueDate ? topic.dueDate.toISOString().split("T")[0] : null);

  const snapshot = state.capturedSnapshot ?? ((topic as any)?.snapshot ?? "");
  
  const statuses = new Set([
    ...bcfTopics.config.statuses,
    ...Object.keys(styles?.statuses ?? defaultTopicStyles.statuses),
  ]);
  if (status) statuses.add(status);

  const types = new Set([
    ...bcfTopics.config.types,
    ...Object.keys(styles?.types ?? defaultTopicStyles.types),
  ]);
  if (type) types.add(type);

  const priorities = new Set([
    ...bcfTopics.config.priorities,
    ...Object.keys(styles?.priorities ?? defaultTopicStyles.priorities),
  ]);
  if (priority) priorities.add(priority);

  const users = new Set([
    ...bcfTopics.config.users,
    ...Object.keys(styles?.users ?? defaultTopicStyles.users),
  ]);
  if (assignedTo) users.add(assignedTo);

  const labelsList = new Set([
    ...bcfTopics.config.labels,
    ...Object.keys(styles?.labels ?? defaultTopicStyles.labels),
  ]);
  if (labels) {
    for (const label of labels) labelsList.add(label);
  }

  const stagesList = new Set([
    ...bcfTopics.config.stages,
    ...Object.keys(styles?.stages ?? defaultTopicStyles.stages),
  ]);
  if (stage) stagesList.add(stage);

  const topicForm = createRef<HTMLDivElement>();

  const onAddTopic = async () => {
    const { value: form } = topicForm;
    if (!form) return;

    if (!topic && !state.capturedViewpoint) {
      alert("새로운 토픽을 생성하려면 먼저 [Capture] 버튼을 눌러 3D 뷰를 캡처해야 합니다.");
      return;
    }

    const topicData = BUI.getElementValue(
      form,
      valueTransform,
    ) as Partial<OBC.BCFTopic>;

    if (!appState.isAdmin) {
      delete topicData.creationAuthor;
    }

    if (topic) {
      topic.set(topicData);
      await onSubmit(topic);
    } else {
      const newTopic = bcfTopics.create(topicData);
      await onSubmit(newTopic);
    }
  };

  const submitButton = createRef<BUI.Button>();
  const updateSubmitButton = (e: Event) => {
    const { value: button } = submitButton;
    if (!button) return;
    const input = e.target as BUI.TextInput;
    button.disabled = input.value.trim() === "";
  };

  const acceptBtnID = `btn-${BUI.Manager.newRandomId()}`;
  const cancelBtnID = `btn-${BUI.Manager.newRandomId()}`;

  // Lit과 Custom Element의 DOM 렌더링 충돌을 피해 옵션을 확실하게 마운트하는 헬퍼 함수
  const setupDropdown = (
    options: { label: string; value: string; img?: string }[],
    selectedValues: string | Iterable<string> | undefined | null
  ) => (e: Element | undefined) => {
    if (!e) return;
    const dropdown = e as BUI.Dropdown;
    
    // 강제로 내부 옵션을 갱신하여 드롭다운이 렌더링되게 함
    if ((dropdown as any).elements) (dropdown as any).elements.clear();
    dropdown.replaceChildren();

    let selectedArray: string[] = [];
    if (selectedValues) {
      selectedArray = typeof selectedValues === "string" ? [selectedValues] : Array.from(selectedValues);
    }

    for (const opt of options) {
      const optionEl = document.createElement("bim-option") as any;
      optionEl.label = opt.label;
      optionEl.value = opt.value;
      if (opt.img) optionEl.img = opt.img;
      if (selectedArray.includes(opt.value)) optionEl.checked = true;
      dropdown.append(optionEl);
    }

    setTimeout(() => {
      dropdown.value = selectedArray;
    }, 10);
  };

  return BUI.html`
    <div style="display: flex; flex-direction: column; height: 100%; width: 100%; gap: 0.5rem;">
      <!-- Main Split Content -->
      <div style="display: flex; gap: 0.5rem; flex: 1; min-height: 0;">
        <!-- Left Half: Topic Details -->
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; padding-right: 0.5rem; box-sizing: border-box;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; flex-shrink: 0;">
            <bim-label style="font-weight: bold;">Topic Details</bim-label>
          </div>
          <div ${BUI.ref(topicForm)} class="custom-scrollbar" style="display: flex; flex-direction: column; gap: 0.75rem; overflow-y: auto; overflow-x: hidden; padding-right: 0.25rem; flex: 1; min-height: 0;">
            <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
              <div style="width: 12rem; flex-shrink: 0; display: flex; flex-direction: column; gap: 0.5rem;">
                ${snapshot ? BUI.html`
                  <img src="${snapshot}" style="width: 100%; aspect-ratio: 4 / 3; flex: none; box-sizing: border-box; object-fit: contain; border-radius: 0.25rem; border: 1px solid var(--bim-ui_bg-contrast-20); background-color: var(--bim-ui_bg-base, transparent); cursor: zoom-in; transition: filter 0.2s;" onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter='none'" @click=${() => showLightbox(snapshot)}>
                ` : BUI.html`
                  <div style="width: 100%; aspect-ratio: 4 / 3; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed var(--bim-ui_bg-contrast-40); border-radius: 0.25rem; background-color: var(--bim-ui_bg-base, transparent); color: var(--bim-ui_gray-10);">
                    <bim-label icon=${appIcons.CAMERA} style="--bim-icon--fz: 2rem;"></bim-label>
                    <bim-label style="font-size: 0.75rem; font-style: italic; text-align: center; white-space: pre-wrap;">Manual Capture Required\n(Click Capture)</bim-label>
                  </div>
                `}
                <div style="display: flex; gap: 0.25rem; width: 100%;">
                  <bim-button label="Restore" icon=${appIcons.FOCUS} style="margin: 0; flex: 1; box-sizing: border-box;" @click=${onRestoreViewpoint} ?disabled=${!topic}></bim-button>
                  <bim-button label="Capture" icon=${appIcons.CAMERA} style="margin: 0; flex: 1; box-sizing: border-box;" @click=${async (e: Event) => {
                    const btn = e.target as BUI.Button;
                    btn.loading = true;
                    if (state.onCapture) await state.onCapture();
                    btn.loading = false;
                  }}></bim-button>
                </div>
              </div>
              <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem;">
                <bim-text-input @input=${updateSubmitButton} vertical label="Title" name="title" .value=${title}></bim-text-input>
                <bim-text-input vertical label="Description" name="description" type="area" rows="4" .value=${description}></bim-text-input>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.375rem; flex-shrink: 0;">
            <bim-dropdown vertical label="Type" name="type" required ${BUI.ref(setupDropdown([...types].map(t => ({label: t, value: t})), type))}></bim-dropdown>
            <bim-dropdown vertical label="Status" name="status" required ${BUI.ref(setupDropdown([...statuses].map(s => ({label: s, value: s})), status))}></bim-dropdown>
            <bim-dropdown vertical label="Author" name="creationAuthor" ?disabled=${!appState.isAdmin} style=${!appState.isAdmin ? "pointer-events: none; opacity: 0.5;" : ""} ${BUI.ref(setupDropdown([...users].map(u => ({ label: styles?.users?.[u]?.name || u, value: u, img: styles?.users?.[u]?.picture })), creationAuthor))}></bim-dropdown>
            <bim-dropdown vertical label="Assignee" name="assignedTo" ${BUI.ref(setupDropdown([...users].map(u => ({ label: styles?.users?.[u]?.name || u, value: u, img: styles?.users?.[u]?.picture })), assignedTo))}></bim-dropdown>
            <bim-dropdown vertical label="Priority" name="priority" ${BUI.ref(setupDropdown([...priorities].map(p => ({label: p, value: p})), priority))}></bim-dropdown>
            <bim-dropdown vertical label="Labels" name="labels" multiple ${BUI.ref(setupDropdown([...labelsList].map(l => ({label: l, value: l})), labels))}></bim-dropdown>
            <bim-text-input vertical type="date" label="Due Date" name="dueDate" .value=${dueDate}></bim-text-input> 
            <bim-dropdown vertical label="Stage" name="stage" ${BUI.ref(setupDropdown([...stagesList].map(s => ({label: s, value: s})), stage))}></bim-dropdown>
          </div>
        </div>
      </div>

        <!-- Right Half: Comments -->
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; border-left: 1px solid var(--bim-ui_bg-contrast-20); padding-left: 0.5rem;">
          ${state.commentsUI ? state.commentsUI : (!topic ? BUI.html`
            <div style="display: flex; flex-direction: column; height: 100%; justify-content: center; align-items: center; opacity: 0.5; gap: 0.5rem;">
              <bim-label icon=${appIcons.COMMENT} style="--bim-icon--fz: 3rem;"></bim-label>
              <bim-label style="font-style: italic;">You can add comments after creating the topic.</bim-label>
            </div>
          ` : "")}
        </div>
      </div>

      <!-- Bottom Actions -->
      <div style="justify-content: flex-end; display: flex; gap: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--bim-ui_bg-contrast-20); flex-shrink: 0;">
        <style>
          #${cancelBtnID} { background-color: transparent; }
          #${cancelBtnID}:hover { --bim-label--c: #FF5252; }
          #${acceptBtnID}:hover { background-color: #329936; }

          .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background-color: var(--bim-ui_bg-contrast-20); border-radius: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: var(--bim-ui_bg-contrast-40); }
        </style>
        <bim-button id=${cancelBtnID} style="flex: 0" @click=${onCancel} label="Cancel"></bim-button>
        <bim-button id=${acceptBtnID} style="flex: 0" @click=${onAddTopic} ${BUI.ref(submitButton)} label=${topic ? "Update Topic" : "Add Topic"} icon=${topic ? appIcons.REFRESH : appIcons.ADD}></bim-button>
      </div>
    </div>
  `;
};
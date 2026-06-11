import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { users } from "../../../setup/users";
import { BCFTopics as EngineBCFTopics } from "./engine";
import { Topic as EngineTopic } from "./engine";
import { topicFormTemplate, TopicFormUI } from "../../../ui-components/TopicsList/src/form-template";
import { createCommentsUI } from "./comments-ui";

export const updateTopic = (bcfTopics: any) => {
  const components = bcfTopics.components as OBC.Components;
  const bcf = components.get(EngineBCFTopics);

  let currentTopic: EngineTopic | null = null;
  let onCancelHandler = () => {};
  let onUpdateHandler = () => {};

  const commentsUI = createCommentsUI(components, bcfTopics);


  // 공통 폼 템플릿 컴포넌트 생성
  const [topicForm, updateTopicForm] = BUI.Component.create<HTMLDivElement, TopicFormUI>(
    topicFormTemplate,
    { components, styles: { users } }
  );

  const panel = BUI.Component.create<HTMLDivElement>(() => {
    return BUI.html`
       <div style="flex: 1; display: flex; flex-direction: column; padding: 0; box-sizing: border-box; min-height: 0;">
          ${topicForm}
       </div>
    `;
  });

  const show = (selection: Set<any>, callbacks: { onCancel: () => void, onUpdate: () => void }) => {
    onCancelHandler = callbacks.onCancel;
    onUpdateHandler = callbacks.onUpdate;
    commentsUI.resetState();

    let currentCapturedViewpoint: any = null;
    let currentCapturedSnapshot: string | null = null;

    const selectedTopics = bcfTopics.getSelectedTopics(selection);
    if (selectedTopics.length > 0) {
      currentTopic = selectedTopics[0];
      
      const updateForm = () => {
        updateTopicForm({
          topic: currentTopic ?? undefined,
          components,
          styles: { users },
          commentsUI: commentsUI.ui,
          capturedViewpoint: currentCapturedViewpoint,
          capturedSnapshot: currentCapturedSnapshot,
          onCancel: onCancelHandler,
          onRestoreViewpoint: async () => {
            if (currentTopic) {
              await bcfTopics.restoreViewpoint(currentTopic);
            }
          },
          onCapture: async () => {
            const { viewpoint, snapshot } = await bcfTopics.captureViewpoint();
            currentCapturedViewpoint = viewpoint;
            currentCapturedSnapshot = snapshot;
            updateForm();
          },
          onImportImage: async (base64Snapshot: string) => {
            const { viewpoint } = await bcfTopics.captureViewpoint();
            currentCapturedViewpoint = viewpoint;
            currentCapturedSnapshot = base64Snapshot;
            updateForm();
          },
          onSubmit: async (topic) => {
            if (currentCapturedViewpoint) {
              if (currentCapturedSnapshot) {
                (topic as any).snapshot = currentCapturedSnapshot;
                const viewpoints = components.get(OBC.Viewpoints);
                const base64Data = currentCapturedSnapshot.replace(/^data:image\/\w+;base64,/, "");
                const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                viewpoints.snapshots.set(currentCapturedViewpoint.guid, bytes);
                currentCapturedViewpoint.snapshot = currentCapturedViewpoint.guid;
              }
              topic.viewpoints.clear();
              topic.viewpoints.add(currentCapturedViewpoint.guid);
            }
            await bcf.list.set(topic.guid, topic);
            onUpdateHandler();
            alert("변경사항을 공유하려면 Save BCF 버튼을 눌러 데이터베이스에 저장하십시오.");
          }
        });
      };

      updateForm();
      commentsUI.render(currentTopic!, true);
    }
  };

  return { panel, show };
};
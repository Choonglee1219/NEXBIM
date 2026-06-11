import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { users } from "../../../setup/users";
import { BCFTopics as EngineBCFTopics } from "./engine";
import { Topic as EngineTopic } from "./engine";
import { topicFormTemplate, TopicFormUI } from "../../../ui-components/TopicsList/src/form-template";
import { createCommentsUI } from "./comments-ui";

const copyViewpoint = (src: any, dest: any) => {
  if (!src || !dest) return;
  if (src.camera && dest.camera) {
    dest.camera.camera_view_point.x = src.camera.camera_view_point.x;
    dest.camera.camera_view_point.y = src.camera.camera_view_point.y;
    dest.camera.camera_view_point.z = src.camera.camera_view_point.z;
    if (dest.camera.camera_direction && src.camera.camera_direction) {
      dest.camera.camera_direction.x = src.camera.camera_direction.x;
      dest.camera.camera_direction.y = src.camera.camera_direction.y;
      dest.camera.camera_direction.z = src.camera.camera_direction.z;
    }
    if (dest.camera.camera_up_vector && src.camera.camera_up_vector) {
      dest.camera.camera_up_vector.x = src.camera.camera_up_vector.x;
      dest.camera.camera_up_vector.y = src.camera.camera_up_vector.y;
      dest.camera.camera_up_vector.z = src.camera.camera_up_vector.z;
    }
  }
  if (src.selectionComponents && dest.selectionComponents) {
    dest.selectionComponents.clear();
    for (const guid of src.selectionComponents) {
      dest.selectionComponents.add(guid);
    }
  }
  if (src.exceptionComponents && dest.exceptionComponents) {
    dest.exceptionComponents.clear();
    for (const guid of src.exceptionComponents) {
      dest.exceptionComponents.add(guid);
    }
  }
  if (src.componentColors && dest.componentColors) {
    dest.componentColors.clear();
    for (const [color, guids] of src.componentColors.entries()) {
      dest.componentColors.set(color, [...guids]);
    }
  }
  dest.defaultVisibility = src.defaultVisibility;
  if (src.clipping_planes) {
    dest.clipping_planes = [...src.clipping_planes];
  } else {
    delete dest.clipping_planes;
  }
};

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
      const topic = selectedTopics[0] as any;
      currentTopic = topic;
      
      // 🎯 진입 시점의 토픽 상태(댓글 목록, viewpoints 목록, 뷰포인트 카메라 좌표) 백업
      const originalComments = Array.from(topic.comments.values()).map((c: any) => ({
        guid: c.guid,
        comment: c.comment,
        date: c.date,
        author: c.author,
        modifiedAuthor: c.modifiedAuthor,
        modifiedDate: c.modifiedDate,
        viewpoint: c.viewpoint,
        snapshot: (c as any).snapshot
      })) as any[];

      const originalViewpoints = Array.from(topic.viewpoints) as string[];

      const viewpoints = components.get(OBC.Viewpoints);
      const originalVpCoords = new Map<string, any>();
      for (const vpGuid of topic.viewpoints) {
        const vp = viewpoints.list.get(vpGuid);
        if (vp && vp.camera && vp.camera.camera_view_point) {
          originalVpCoords.set(vpGuid, {
            x: vp.camera.camera_view_point.x,
            y: vp.camera.camera_view_point.y,
            z: vp.camera.camera_view_point.z,
            dirX: vp.camera.camera_direction?.x ?? 0,
            dirY: vp.camera.camera_direction?.y ?? 0,
            dirZ: vp.camera.camera_direction?.z ?? -1,
          });
        }
      }
      
      const updateForm = () => {
        updateTopicForm({
          topic: currentTopic ?? undefined,
          components,
          styles: { users },
          commentsUI: commentsUI.ui,
          capturedViewpoint: currentCapturedViewpoint,
          capturedSnapshot: currentCapturedSnapshot,
          onCancel: () => {
            // 🎯 Cancel 클릭 시 백업 데이터로 롤백 수행
            if (currentTopic) {
              currentTopic.viewpoints.clear();
              for (const vp of originalViewpoints) {
                currentTopic.viewpoints.add(vp);
              }
              
              currentTopic.comments.clear();
              for (const c of originalComments) {
                currentTopic.comments.set(c.guid, {
                  guid: c.guid,
                  comment: c.comment,
                  date: c.date,
                  author: c.author,
                  modifiedAuthor: c.modifiedAuthor,
                  modifiedDate: c.modifiedDate,
                  viewpoint: c.viewpoint,
                  snapshot: c.snapshot
                } as any);
              }

              for (const [vpGuid, coord] of originalVpCoords.entries()) {
                const vp = viewpoints.list.get(vpGuid);
                if (vp && vp.camera && vp.camera.camera_view_point) {
                  vp.camera.camera_view_point.x = coord.x;
                  vp.camera.camera_view_point.y = coord.y;
                  vp.camera.camera_view_point.z = coord.z;
                  if (vp.camera.camera_direction) {
                    vp.camera.camera_direction.x = coord.dirX;
                    vp.camera.camera_direction.y = coord.dirY;
                    vp.camera.camera_direction.z = coord.dirZ;
                  }
                }
              }
            }
            onCancelHandler();
          },
          onRestoreViewpoint: async () => {
            if (currentTopic) {
              await bcfTopics.restoreViewpoint(currentTopic);
            }
          },
          onCapture: async () => {
            const { viewpoint, snapshot } = await bcfTopics.captureViewpoint();
            const viewpoints = components.get(OBC.Viewpoints);
            let vp: any = null;
            if (currentTopic && currentTopic.viewpoints.size > 0) {
              const firstVpGuid = Array.from(currentTopic.viewpoints)[0] as string;
              vp = viewpoints.list.get(firstVpGuid);
            }

            if (vp) {
              copyViewpoint(viewpoint, vp);
              
              if (snapshot) {
                (currentTopic as any).snapshot = snapshot;
                const base64Data = snapshot.replace(/^data:image\/\w+;base64,/, "");
                const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                viewpoints.snapshots.set(vp.guid, bytes);
                vp.snapshot = vp.guid;
              }
            } else {
              currentCapturedViewpoint = viewpoint;
              currentCapturedSnapshot = snapshot;
            }
            updateForm();
          },
          onImportImage: async (base64Snapshot: string) => {
            const { viewpoint } = await bcfTopics.captureViewpoint();
            const viewpoints = components.get(OBC.Viewpoints);
            let vp: any = null;
            if (currentTopic && currentTopic.viewpoints.size > 0) {
              const firstVpGuid = Array.from(currentTopic.viewpoints)[0] as string;
              vp = viewpoints.list.get(firstVpGuid);
            }

            if (vp) {
              copyViewpoint(viewpoint, vp);
              
              if (base64Snapshot) {
                (currentTopic as any).snapshot = base64Snapshot;
                const base64Data = base64Snapshot.replace(/^data:image\/\w+;base64,/, "");
                const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                viewpoints.snapshots.set(vp.guid, bytes);
                vp.snapshot = vp.guid;
              }
            } else {
              currentCapturedViewpoint = viewpoint;
              currentCapturedSnapshot = base64Snapshot;
            }
            updateForm();
          },
          onSubmit: async (topic) => {
            if (currentCapturedViewpoint) {
              const viewpoints = components.get(OBC.Viewpoints);
              if (currentCapturedSnapshot) {
                (topic as any).snapshot = currentCapturedSnapshot;
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
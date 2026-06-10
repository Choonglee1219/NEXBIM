import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { users } from "../../setup/users";
import { BCFFileOperations } from "./src/bcf-file-operations";
import { TopicViewpointManager } from "./src/topic-viewpoint";

// 새로 주입한 엔진 컴포넌트를 Import 합니다. (이름 충돌 방지를 위해 Alias 사용)
import { BCFTopics as EngineBCFTopics } from "./src/engine";
import { Topic as EngineTopic } from "./src/engine";

export * from "./src/new-topic";
export * from "./src/update-topic";

export class BCFTopics extends OBC.Component {
  static uuid = "e7526972-853c-4392-b6c6-33435e123456" as const;
  enabled = true;
  readonly onRefresh = new OBC.Event<void>();
  public _bcf: EngineBCFTopics; // 커스텀 엔진 컴포넌트 타입으로 변경
  private _loading = false;

  get loading() {
    return this._loading;
  }

  set loading(value: boolean) {
    this._loading = value;
  }

  private bcfFileOperations: BCFFileOperations;
  private topicViewpointManager: TopicViewpointManager;

  get list() {
    return this._bcf.list;
  }

  // Setting up BCFTopics
  constructor(components: OBC.Components) {
    super(components);
    
    // 참고: 위 PATCH 코드는 새로 복사한 engine-components 내부의 BCF Parser 구현체 자체를
    // 수정하여 원천 해결하고 여기서는 삭제하는 것을 권장합니다.

    this._bcf = components.get(EngineBCFTopics); // 커스텀 엔진 인스턴스를 가져옵니다.
    this._bcf.setup({
      author: "Admin",
      types: new Set(["Error", "Info", "Unknown", "Warning"]),
      priorities: new Set(["On hold", "Minor", "Normal", "Major", "Critical"]),
      statuses: new Set(["Open", "Assigned", "Closed", "Resolved"]),
      labels: new Set(["A", "C", "E", "J", "M", "P", "R"]),
      stages: new Set(["Concept Design", "Basic Design", "Detailed Design", "Construction", "As-Build"]),
      users: new Set(Object.keys(users)),
      version: "2.1",
    });

    OBC.Topic.default = {
      title: "",
      type: "Info",
      status: "Open",
      priority: "Normal",
      labels: new Set(["R"])
    };

    // Initialize helper classes
    // The clashMapDisplay is part of the old clash detection system and is being removed.
    // We'll pass a mock object to TopicViewpointManager to prevent it from breaking.
    const mockClashMapDisplay = { isClashMapActive: false };
    this.topicViewpointManager = new TopicViewpointManager(this.components, mockClashMapDisplay as any);
    this.bcfFileOperations = new BCFFileOperations(this);

    this._bcf.list.onItemSet.add(async ({ value: topic }) => {
      if (this._loading) return;
      await this.topicViewpointManager.createViewpointForTopic(topic);
    });
  }

  getSelectedTopics(selection: Set<any>) {
    const topics: EngineTopic[] = [];
    for (const item of selection) {
      const guid = (item as any).Guid;
      if (guid) {
        const topic = this.list.get(guid);
        if (topic) topics.push(topic);
      }
    }
    return topics;
  }

  async restoreViewpoint(topic: EngineTopic, options?: { viewpointGuid?: string }): Promise<void> {
    await this.topicViewpointManager.restoreViewpoint(topic, options);
  }

  async captureViewpoint() {
    return await this.topicViewpointManager.captureViewpoint();
  }

  setupTable(table: BUI.Table<any>) {
    table.dataTransform.Title = (value: any, row: any) => {
      return BUI.html`
        <bim-label data-topic-guid=${row.Guid} style="cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" @click=${async () => {
          const topic = this.list.get(row.Guid);
          if (topic) await this.restoreViewpoint(topic);
        }}>${value}</bim-label>
      `;
    };
  }

  addComment(topicGuid: string, text: string) {
    const topic = this.list.get(topicGuid);
    if (!topic) {
      console.warn(`Topic with GUID ${topicGuid} not found.`);
      return null;
    }
    const comment = topic.createComment(text);
    this.onRefresh.trigger();
    return comment;
  }

  updateComment(topicGuid: string, commentGuid: string, text: string) {
    const topic = this.list.get(topicGuid);
    if (!topic) {
      console.warn(`Topic with GUID ${topicGuid} not found.`);
      return false;
    }
    const comment = topic.comments.get(commentGuid);
    if (!comment) {
      console.warn(`Comment with GUID ${commentGuid} not found in topic ${topicGuid}.`);
      return false;
    }
    comment.comment = text;
    this.onRefresh.trigger();
    return true;
  }

  deleteComment(topicGuid: string, commentGuid: string) {
    const topic = this.list.get(topicGuid);
    if (!topic) return false;
    if (topic.comments.has(commentGuid)) {
      topic.comments.delete(commentGuid);
      this.onRefresh.trigger();
      return true;
    }
    return false;
  }

  delete(selection: Set<any>) {
    if (selection.size === 0) return;
    const topics = this.getSelectedTopics(selection);
    if (topics.length === 0) return;
    const confirmation = confirm(`Delete ${topics.length} topic(s)?`);
    if (confirmation) {
      for (const topic of topics) {
        this._bcf.list.delete(topic.guid);
      }
      selection.clear();
      alert("변경사항을 공유하려면 Save BCF 버튼을 눌러 데이터베이스에 저장하십시오.");
    }
  }

  deleteAll() {
    if (this.list.size === 0) return;
    const confirmation = confirm(`현재 토픽 목록(Topic List)에 있는 ${this.list.size}개의 토픽을 삭제하시겠습니까?`);
    if (confirmation) {
      const guids = Array.from(this.list.keys());
      for (const guid of guids) {
        this._bcf.list.delete(guid);
      }
    }
  }

  importBCF() {
    this.bcfFileOperations.importBCF();
  }

  exportBCF(name?: string) {
    this.bcfFileOperations.exportBCF(name);
  }

  saveBCF() {
    this.bcfFileOperations.saveBCF();
  }

  exportJSON() {
    this.bcfFileOperations.exportJSON();
  }

  saveBCFToDB() {
    this.bcfFileOperations.saveBCFToDB();
  }

  async loadBCFContent(buffer: ArrayBuffer | Uint8Array) {
    this._loading = true;
    try {
      await this.bcfFileOperations.loadBCFContent(buffer);
    } finally {
      this._loading = false;
      this.onRefresh.trigger();
    }
  }
}

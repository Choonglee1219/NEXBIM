import * as OBC from "@thatopen/components";
import JSZip from "jszip";
import { SharedBCF } from "../../SharedBCF";
import { SharedIFC } from "../../SharedIFC";
import { BCFTopics } from "../index";
import { BCFTopics as EngineBCFTopics } from "./engine";

export class BCFFileOperations {
  private components: OBC.Components;
  private _bcf: EngineBCFTopics; // 커스텀 엔진 컴포넌트 타입으로 변경
  private onRefresh: OBC.Event<void>;
  private sharedIFC: SharedIFC;
  private sharedBCF: SharedBCF;

  constructor(bcfTopicsInstance: BCFTopics) {
    this.components = bcfTopicsInstance.components;
    this._bcf = bcfTopicsInstance._bcf;
    this.onRefresh = bcfTopicsInstance.onRefresh;
    this.sharedIFC = new SharedIFC();
    this.sharedBCF = new SharedBCF();
  }

  private downloadFile(blob: Blob, name: string) {
    const bcfFile = new File([blob], name);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(bcfFile);
    a.download = bcfFile.name;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  private createFileInput(callback: (file: File) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bcf";
    input.multiple = false;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) callback(file);
    });
    input.click();
  }

  async loadBCFContent(buffer: ArrayBuffer | Uint8Array) {
    try {
      const bcf = new Uint8Array(buffer);
      const { topics, viewpoints } = await this._bcf.load(bcf);

      const zip = new JSZip();
      await zip.loadAsync(buffer);

      for (const topic of topics) {
        const folder = zip.folder(topic.guid);
        if (!folder) continue;
        
        // --- 새로 추가된 로직: 원본 파일에서 진짜 대표 뷰포인트의 GUID를 찾아 메모리에 기억해둡니다 ---
        const markupFile = folder.file("markup.bcf");
        if (markupFile) {
          const xmlStr = await markupFile.async("string");
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlStr, "application/xml");
          const vps = xmlDoc.getElementsByTagName("Viewpoints");
          for (let i = 0; i < vps.length; i++) {
            const vpNode = vps[i].getElementsByTagName("Viewpoint")[0];
            const snapNode = vps[i].getElementsByTagName("Snapshot")[0];
            if ((vpNode && vpNode.textContent === "viewpoint.bcfv") || (snapNode && snapNode.textContent === "snapshot.png")) {
              const guid = vps[i].getAttribute("Guid");
              if (guid) (topic as any).representativeViewpointGuid = guid;
              break;
            }
          }
        }

        const snapshotFile = folder.file("snapshot.png");
        if (snapshotFile) {
          const base64 = await snapshotFile.async("base64");
          (topic as any).snapshot = `data:image/png;base64,${base64}`;
        }
      }

      const worlds = this.components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;
      if (world) {
        for (const viewpoint of viewpoints) {
          viewpoint.world = world;
          const cam = viewpoint.camera;
          const pos = cam.camera_view_point;
          const dir = cam.camera_direction;
          if ((cam as any).view_to_world_scale) {
            const offset = 80;
            pos.x -= dir.x * offset;
            pos.y -= dir.y * offset;
            pos.z -= dir.z * offset;
            (cam as any).view_to_world_scale = 1;
            (cam as any).aspect_ratio = 3;
            (cam as any).field_of_view = 60;
          }
        }
      }
    } finally {
      // Loading state managed by BCFTopics
    }
  }

  importBCF() {
    this.createFileInput(async (file) => {
      const buffer = await file.arrayBuffer();
      await this.loadBCFContent(buffer);
    });
  }

  private async createBCFBlob(name?: string) {
    if (!name) {
      name = "topics.bcf";
      const fragments = this.components.get(OBC.FragmentsManager);
      if (fragments.list.size > 0) {
        const model = fragments.list.values().next().value;
        if (model && (model as any).name) {
          name = `${(model as any).name}.bcf`;
        }
      }
    }
    const blob = await this._bcf.export();

    // Post-process the blob to standardize the representative viewpoint filename.
    try {
      const zip = new JSZip();
      await zip.loadAsync(blob);

      const topicFolders = new Set<string>();
      zip.forEach((relativePath) => {
        if (relativePath.endsWith("markup.bcf")) {
          const folder = relativePath.substring(0, relativePath.lastIndexOf("/") + 1);
          topicFolders.add(folder);
        }
      });

      // --- 새로 추가된 로직: 저장하기 전, 모든 토픽의 대표 뷰포인트 GUID 매핑 테이블을 생성합니다 ---
      const repMap = new Map<string, string>();
      for (const topic of this._bcf.list.values()) {
        if ((topic as any).representativeViewpointGuid) {
          repMap.set(topic.guid, (topic as any).representativeViewpointGuid);
        } else if (topic.viewpoints.size > 0) {
          // 새로 생성된 토픽이라 지정된 대표 GUID가 없다면 캡처된 첫 번째 뷰포인트를 대표로 지정
          repMap.set(topic.guid, topic.viewpoints.values().next().value!);
        }
      }

      for (const folder of topicFolders) {
        const markupPath = folder + "markup.bcf";
        const markupFile = zip.file(markupPath);
        const topicGuid = folder.replace(/\/$/, ""); // 폴더 경로에서 토픽 GUID만 추출

        if (markupFile) {
          const xmlStr = await markupFile.async("string");
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlStr, "application/xml");

          const viewpointsBlocks = Array.from(xmlDoc.getElementsByTagName("Viewpoints"));
          let markupModified = false;
          
          // 이 토픽의 진짜 대표 뷰포인트 GUID
          const repGuid = repMap.get(topicGuid);

          // BCF 2.1 spec doesn't strictly enforce order, so we sort by the <Index> tag to be safe.
          viewpointsBlocks.sort((a, b) => {
            const guidA = a.getAttribute("Guid");
            const guidB = b.getAttribute("Guid");
            
            // 메모리에 기억해둔 진짜 대표 뷰포인트의 GUID와 일치하는 블록을 무조건 1순위로 정렬
            if (repGuid) {
              if (guidA === repGuid && guidB !== repGuid) return -1;
              if (guidB === repGuid && guidA !== repGuid) return 1;
            }

            const indexAEl = a.getElementsByTagName("Index")[0];
            const indexBEl = b.getElementsByTagName("Index")[0];
            const indexA = indexAEl ? parseInt(indexAEl.textContent || '999', 10) : 999;
            const indexB = indexBEl ? parseInt(indexBEl.textContent || '999', 10) : 999;
            return indexA - indexB;
          });

          if (viewpointsBlocks.length > 0) {
            // 모든 뷰포인트 블록에 순서대로 <Index> 0, 1, 2... 명시적 주입 (오염 완벽 방지)
            for (let i = 0; i < viewpointsBlocks.length; i++) {
              const block = viewpointsBlocks[i];
              let indexNode = block.getElementsByTagName("Index")[0];
              if (!indexNode) {
                indexNode = xmlDoc.createElement("Index");
                indexNode.textContent = i.toString();
                block.appendChild(indexNode);
                markupModified = true;
              } else if (indexNode.textContent !== i.toString()) {
                indexNode.textContent = i.toString();
                markupModified = true;
              }
            }

            const firstBlock = viewpointsBlocks[0];

            const vpNode = firstBlock.getElementsByTagName("Viewpoint")[0];
            const snapNode = firstBlock.getElementsByTagName("Snapshot")[0];

            const originalVpName = vpNode?.textContent;
            const originalSnapName = snapNode?.textContent;

            if (originalVpName && originalVpName !== "viewpoint.bcfv") {
              const originalVpFile = zip.file(folder + originalVpName);
              if (originalVpFile) {
                const content = await originalVpFile.async("arraybuffer");
                zip.file(folder + "viewpoint.bcfv", content);
                zip.remove(originalVpFile.name);
                vpNode.textContent = "viewpoint.bcfv";
                markupModified = true;
              }
            }

            if (originalSnapName && originalSnapName !== "snapshot.png") {
              const originalSnapFile = zip.file(folder + originalSnapName);
              if (originalSnapFile) {
                const content = await originalSnapFile.async("blob");
                zip.file(folder + "snapshot.png", content);
                zip.remove(originalSnapFile.name);
                snapNode.textContent = "snapshot.png";
                markupModified = true;
              }
            }
            
            if (markupModified) {
              const serializer = new XMLSerializer();
              const newXmlStr = serializer.serializeToString(xmlDoc);
              zip.file(markupPath, newXmlStr);
            }
          }
        }
      }

      const newBlob = await zip.generateAsync({ type: "blob" });
      return { blob: newBlob, name };

    } catch (e) {
      console.error("Error post-processing BCF for viewpoint standardization:", e);
      return { blob, name }; // Return original blob on failure
    }
  }

  async exportBCF(name?: string) {
    const { blob, name: fileName } = await this.createBCFBlob(name);
    this.downloadFile(blob, fileName);
  }

  async saveBCF() {
    const fragments = this.components.get(OBC.FragmentsManager);
    const loadedModels: { id: number; name: string }[] = [];
    
    for (const [uuid, model] of fragments.list) {
      const m = model as any;
      const dbId = m.dbId || this.sharedIFC.getIfcIdByModelUUID(uuid);
      if (dbId) {
        loadedModels.push({ id: dbId, name: m.name || "Untitled" });
      }
    }

    if (loadedModels.length === 0) {
      alert("데이터베이스에 저장된 IFC 모델이 로드되어 있지 않습니다. BCF를 저장할 수 없습니다.");
      return;
    }

    const ifcIds = this.selectTargetModels(loadedModels);
    if (!ifcIds) return;

    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');

    const selectedModels = loadedModels.filter(m => ifcIds.includes(m.id));
    const modelNames = selectedModels.map(m => m.name).join("-");
    const defaultName = `Topics(${year}${month}${day}): ${modelNames}`;
    const fileName = prompt("BCF 파일 이름을 입력하세요:", defaultName);
    if (!fileName) return;

    const { blob } = await this.createBCFBlob(fileName);
    const file = new File([blob], fileName);

    const newBcfId = await this.sharedBCF.saveBCF(file, JSON.stringify(ifcIds) as any);
    if (newBcfId) {
       alert("BCF 파일이 데이터베이스에 성공적으로 저장되었습니다.");
       this.onRefresh.trigger();
    }
  }

  exportJSON() {
    const fragments = this.components.get(OBC.FragmentsManager);
    const modelNamesArray: string[] = [];
    for (const [, model] of fragments.list) {
      const m = model as any;
      if (m.name) modelNamesArray.push(m.name);
    }
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const modelNames = modelNamesArray.join("-");
    const defaultName = `Topics(${year}${month}${day}): ${modelNames}`;
    const fileName = prompt("JSON 파일 이름을 입력하세요:", defaultName);
    if (!fileName) return;

    const data = [];
    for (const topic of this._bcf.list.values()) {
      data.push({
        GUID: topic.guid,
        Title: topic.title,
        Type: topic.type,
        Status: topic.status,
        Author: topic.creationAuthor,
        Assignee: topic.assignedTo,
        Priority: topic.priority,
        Labels: Array.from(topic.labels),
        "Due Date": topic.dueDate,
        "Created Date": topic.creationDate,
        Stage: topic.stage,
        Description: topic.description,
      });
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const finalName = fileName.endsWith(".json") ? fileName : `${fileName}.json`;
    this.downloadFile(blob, finalName);
  }

  async saveBCFToDB() {
    this.createFileInput(async (file) => {
      const fragments = this.components.get(OBC.FragmentsManager);
      const loadedModels: { id: number; name: string }[] = [];
      
      for (const [uuid, model] of fragments.list) {
        const m = model as any;
        const dbId = m.dbId || this.sharedIFC.getIfcIdByModelUUID(uuid);
        if (dbId) {
          loadedModels.push({ id: dbId, name: m.name || "Untitled" });
        }
      }

      if (loadedModels.length === 0) {
        alert("데이터베이스에 저장된 IFC 모델이 로드되어 있지 않습니다. BCF를 저장할 수 없습니다.");
        return;
      }

      const ifcIds = this.selectTargetModels(loadedModels);
      if (!ifcIds) return;

      const newBcfId = await this.sharedBCF.saveBCF(file, JSON.stringify(ifcIds) as any);
      if (newBcfId) {
         alert("BCF 파일이 데이터베이스에 성공적으로 저장되었습니다.");
         const buffer = await file.arrayBuffer();
         await this.loadBCFContent(buffer);
         this.onRefresh.trigger();
      }
    });
  }

  private selectTargetModels(loadedModels: { id: number; name: string }[]): number[] | null {
    if (loadedModels.length === 1) return [loadedModels[0].id];

    const options = loadedModels.map((m, i) => `${i + 1}. ${m.name}`).join("\n");
    const defaultSelection = loadedModels.map((_, i) => i + 1).join(", ");
    const userInput = prompt(`BCF를 연결할 IFC 모델을 선택하세요 (번호 입력, 쉼표로 구분):\n${options}`, defaultSelection);
    
    if (!userInput) return null;

    const indices = userInput.split(",").map(s => parseInt(s.trim()) - 1);
    const validIndices = indices.filter(i => !isNaN(i) && i >= 0 && i < loadedModels.length);

    if (validIndices.length === 0) {
      alert("잘못된 선택입니다.");
      return null;
    }
    
    return Array.from(new Set(validIndices)).map(i => loadedModels[i].id);
  }
}
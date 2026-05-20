interface FragRow {
  id: number;
  name: string;
  content: Uint8Array | string;
}

interface FragBasicInfo {
  id: number;
  name: string;
}

export class SharedFRAG {

  list: FragBasicInfo[] = [];
  static modelUUIDMap: Map<number, string> = new Map();

  constructor() {}

  async loadFRAGFiles() {
    try {
      const fragResponse = await fetch('/api/frags/name', {
        credentials: "include",
        method: "GET",
      });
      if (!fragResponse.ok) {
        throw new Error("Failed to fetch frags");
      }

      const fragRows: FragBasicInfo[] = await fragResponse.json();
      for (const row of fragRows) {
        const fragInfo: FragBasicInfo = {
          id: row.id,
          name: row.name,
        };
        this.list.push(fragInfo);
      }
    } catch (err) {
      console.error("Error loading projects from API:", err);
      alert("FRAG 로딩에 실패했습니다. 개발자에게 문의하세요.")
    }
  }

  async loadFRAG(fragid: number) {
    try{
      const fragResponse = await fetch(`/api/frag/${fragid}`, {
        credentials: "include",
        method: "GET",
      });
      if (!fragResponse.ok) {
        console.warn(`Not found FRAG data for frag ID ${fragid}`);
        alert("해당 ID의 FRAG 데이터를 찾을 수 없습니다.")
        return null;
      }
      const fragRow: FragRow = await fragResponse.json();

      if (!fragRow.content || fragRow.content.length === 0) {
        console.error("Not found FRAG data found.");
        alert("FRAG 데이터를 찹을 수 없습니다.")
        return null;
      }

      if (typeof fragRow.content === 'string') {
        const decodedContent = atob(fragRow.content);
        const frag_data = new Uint8Array(decodedContent.length);
        for (let i = 0; i < decodedContent.length; i++) {
          frag_data[i] = decodedContent.charCodeAt(i);
        }
        
        return {
          name: fragRow.name,
          content: frag_data, 
        };
      }
      return null;
    }
    catch (error) {
      console.error("Error loading FRAG data:", error);
      alert("FRAG 로딩에 실패했습니다. 개발자에게 문의하세요.");
      return null;
    }
  }

  async saveFRAG(file: File) {
    try {
      const newName = file.name.replace(/\.frag$/i, "");
      const newFile = new File([file], newName, { type: file.type });
      const formData = new FormData();
      formData.append("file", newFile);

      const fragResponse = await fetch("/api/frag", {
        credentials: "include",
        method: "POST",
        body: formData,
      });
      if (!fragResponse.ok) {
        const errorText = await fragResponse.text();
        console.error("Error saving FRAG to DB:", errorText);
        alert("FRAG 저장에 실패했습니다. 다시 시도해 주세요.");
        return null;
      }
      const response = await fragResponse.json();
      console.log("SharedFRAG save response:", response);
      return response.id;
    } catch (error) {
      console.error("Error saving FRAG to DB:", error);
      alert("FRAG 저장에 실패했습니다. 개발자에게 문의하세요.");
      return null;
    }
  };
  
  async deleteFRAG(fragid: number) {
    try {
      const fragResponse = await fetch(`/api/frag/${fragid}`, {
        credentials: "include",
        method: "DELETE",
      });
      if (!fragResponse.ok) {
        const errorText = await fragResponse.text();
        console.error("Error deleting FRAG from DB:", errorText);
        alert("FRAG 삭제에 실패했습니다. 다시 시도해 주세요.");
      }
      return fragResponse.ok;
    } catch (err) {
      console.error("Error deleting FRAG from DB:", err);
      alert("FRAG 삭제에 실패했습니다. 개발자에게 문의하세요.");
      return false;
    }
  }

  addModelUUID(fragid: number, modelUUID: string) {
    SharedFRAG.modelUUIDMap.set(fragid, modelUUID);
  }

  getModelUUID(fragid: number): string | undefined {
    return SharedFRAG.modelUUIDMap.get(fragid);
  }

  getFragIdByModelUUID(modelUUID: string): number | undefined {
    for (const [fragid, uuid] of SharedFRAG.modelUUIDMap.entries()) {
      if (uuid === modelUUID) {
        return fragid;
      }
    }
    return undefined;
  }

  removeModelUUID(fragid: number) {
    SharedFRAG.modelUUIDMap.delete(fragid);
  }
}

interface IfcRow {
  id: number;
  name: string;
  content: Uint8Array | string;
}

interface IfcBasicInfo {
  id: number;
  name: string;
}

export class SharedIFC {

  list: IfcBasicInfo[] = [];
  static modelUUIDMap: Map<number, string> = new Map();

  constructor() {}

  async loadIFCFiles() {
    try {
      const ifcResponse = await fetch('/api/ifcs/name', {
        credentials: "include",
        method: "GET",
      });
      if (!ifcResponse.ok) {
        throw new Error("Failed to fetch ifcs");
      }

      const ifcRows: IfcBasicInfo[] = await ifcResponse.json();
      for (const row of ifcRows) {
        const ifcInfo: IfcBasicInfo = {
          id: row.id,
          name: row.name,
        };
        this.list.push(ifcInfo);
      }
    } catch (err) {
      console.error("Error loading projects from API:", err);
      alert("IFC 로딩에 실패했습니다. 개발자에게 문의하세요.")
    }
  }

  async loadIFC(ifcid: number) {
    try{
      const ifcResponse = await fetch(`/api/ifc/${ifcid}`, {
        credentials: "include",
        method: "GET",
      });
      if (!ifcResponse.ok) {
        console.warn(`Not found IFC data for ifc ID ${ifcid}`);
        alert("해당 ID의 IFC 데이터를 찾을 수 없습니다.")
        return null;
      }
      const ifcRow: IfcRow = await ifcResponse.json();

      if (!ifcRow.content || ifcRow.content.length === 0) {
        console.error("Not found IFC data found.");
        alert("IFC 데이터를 찹을 수 없습니다.")
        return null;
      }

      if (typeof ifcRow.content === 'string') {
        const decodedContent = atob(ifcRow.content);
        const ifc_data = new Uint8Array(decodedContent.length);
        for (let i = 0; i < decodedContent.length; i++) {
          ifc_data[i] = decodedContent.charCodeAt(i);
        }
        
        return {
          name: ifcRow.name,
          content: ifc_data, 
        };
      }
      return null;
    }
    catch (error) {
      console.error("Error loading IFC data:", error);
      alert("IFC 로딩에 실패했습니다. 개발자에게 문의하세요.");
      return null;
    }
  }

  async saveIFC(file: File) {
    try {
      const newName = file.name.replace(/\.ifc$/i, "");
      const newFile = new File([file], newName, { type: file.type });
      const formData = new FormData();
      formData.append("file", newFile);

      const ifcResponse = await fetch("/api/ifc", {
        credentials: "include",
        method: "POST",
        body: formData,
      });
      if (!ifcResponse.ok) {
        const errorText = await ifcResponse.text();
        console.error("Error saving IFC to DB:", errorText);
        alert("IFC 저장에 실패했습니다. 다시 시도해 주세요.");
        return null;
      }
      const response = await ifcResponse.json();
      console.log("SharedIFC save response:", response);
      return response.id;
    } catch (error) {
      console.error("Error saving IFC to DB:", error);
      alert("IFC 저장에 실패했습니다. 개발자에게 문의하세요.");
      return null;
    }
  };
  
  async deleteIFC(ifcid: number) {
    try {
      const ifcResponse = await fetch(`/api/ifc/${ifcid}`, {
        credentials: "include",
        method: "DELETE",
      });
      if (!ifcResponse.ok) {
        const errorText = await ifcResponse.text();
        console.error("Error deleting IFC from DB:", errorText);
        alert("IFC 삭제에 실패했습니다. 다시 시도해 주세요.");
      }
      return ifcResponse.ok;
    } catch (err) {
      console.error("Error deleting IFC from DB:", err);
      alert("IFC 삭제에 실패했습니다. 개발자에게 문의하세요.");
      return false;
    }
  }

  addModelUUID(ifcid: number, modelUUID: string) {
    SharedIFC.modelUUIDMap.set(ifcid, modelUUID);
  }

  getModelUUID(ifcid: number): string | undefined {
    return SharedIFC.modelUUIDMap.get(ifcid);
  }

  getIfcIdByModelUUID(modelUUID: string): number | undefined {
    for (const [ifcid, uuid] of SharedIFC.modelUUIDMap.entries()) {
      if (uuid === modelUUID) {
        return ifcid;
      }
    }
    return undefined;
  }

  removeModelUUID(ifcid: number) {
    SharedIFC.modelUUIDMap.delete(ifcid);
  }
}
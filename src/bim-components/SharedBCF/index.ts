interface BcfRow {
  id: number;
  name: string;
  content: Uint8Array | string;
}

interface BcfBasicInfo {
  id: number;
  name: string;
  ifcid: number;
}

interface BcfDatabaseEntry {
  id: number;
  name: string;
  ifcid: number;
}

export class SharedBCF {
  list: BcfBasicInfo[] = [];
  constructor() {}

  async loadBCFFiles() {
    try {
      const bcfResponse = await fetch('/api/bcfs/name', {
        credentials: "include",
        method: "GET",
      });
      if (!bcfResponse.ok) {
        throw new Error("Failed to fetch bcfs");
      }

      const bcfRows: BcfDatabaseEntry[] = await bcfResponse.json();
      for (const row of bcfRows) {
        const bcfInfo: BcfBasicInfo = {
          id: row.id,
          name: row.name,
          ifcid: row.ifcid,
        };
        this.list.push(bcfInfo);
      }
    } catch (err) {
      console.error("Error loading projects from API:", err);
      alert("BCF 로딩에 실패했습니다. 개발자에게 문의하세요.")
    }
  }

  async loadBCF(bcfId: number) {
    try{
      const bcfResponse = await fetch(`/api/bcf/${bcfId}`, {
        credentials: "include",
        method: "GET",
      });
      if (!bcfResponse.ok) {
        console.warn(`Not found BCF data for bcf ID ${bcfId}`);
        alert("해당 ID의 BCF 데이터를 찾을 수 없습니다.")
        return null;
      }
      const bcfRow: BcfRow = await bcfResponse.json();
      if (!bcfRow.content || bcfRow.content.length === 0) {
        console.error("Not found BCF data found.");
        alert("BCF 데이터를 찾을 수 없습니다.")
        return null;
      }
      if (typeof bcfRow.content === 'string') {
        const decodedContent = atob(bcfRow.content);
        const bcf_data = new Uint8Array(decodedContent.length);
        for (let i = 0; i < decodedContent.length; i++) {
          bcf_data[i] = decodedContent.charCodeAt(i);
        }
        return {
          name: bcfRow.name,
          content: bcf_data, 
        };
      }
      return null;
    }
    catch (error) {
      console.error("Error loading BCF data:", error);
      alert("BCF 로딩에 실패했습니다. 개발자에게 문의하세요.");
      return null;
    }
  }

  async saveBCF(file: File | { name: string, content: Uint8Array }, ifcid: number) {
    try {
      const newName = file.name.replace(/\.bcf$/i, "");
      console.log(`[SharedBCF] Uploading BCF: ${newName}, ifcid: ${ifcid}`);
      
      let newFile: File;
      if (file instanceof File) {
        newFile = new File([file], newName, { type: file.type });
      } else {
        const blob = new Blob([file.content as any], { type: "application/octet-stream" });
        newFile = new File([blob], newName, { type: "application/octet-stream" });
      }

      const formData = new FormData();
      formData.append("ifcid", ifcid.toString());
      formData.append("file", newFile);

      const bcfResponse = await fetch("/api/bcf", {
        credentials: "include",
        method: "POST",
        body: formData,
      });
      if (!bcfResponse.ok) {
        const errorText = await bcfResponse.text();
        console.error("Error saving BCF to DB:", errorText);
        alert("BCF 저장에 실패했습니다. 다시 시도해 주세요.");
      }
      const response = await bcfResponse.json();
      return response.id;
    } catch (error) {
      console.error("Error saving BCF to DB:", error);
      alert("BCF 저장에 실패했습니다. 개발자에게 문의하세요.");
      return null;
    }
  };
  
  async deleteBCF(bcfId: number) {
    try {
      const bcfResponse = await fetch(`/api/bcf/${bcfId}`, {
        credentials: "include",
        method: "DELETE",
      });
      if (!bcfResponse.ok) {
        const errorText = await bcfResponse.text();
        console.error("Error deleting BCF from DB:", errorText);
        alert("BCF 삭제에 실패했습니다. 다시 시도해 주세요.");
      }
      return bcfResponse.ok;
    } catch (err) {
      console.error("Error deleting BCF from DB:", err);
      alert("BCF 삭제에 실패했습니다. 개발자에게 문의하세요.");
      return false;
    }
  }
};
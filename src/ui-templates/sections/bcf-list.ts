import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { SharedBCF } from "../../bim-components/SharedBCF";
import { SharedIFC } from "../../bim-components/SharedIFC";
import { BCFTopics } from "../../bim-components/BCFTopics";
import { appIcons, setupBIMTable, tableButtonStyle } from "../../globals";

export interface BCFListPanelState {
  components: OBC.Components;
}

export const bcfListPanelTemplate: BUI.StatefullComponent<BCFListPanelState> = (state) => {
  const { components } = state;
  const sharedBCF = new SharedBCF();
  const sharedIFC = new SharedIFC();
  const fragments = components.get(OBC.FragmentsManager);
  const bcfTopics = components.get(BCFTopics);

  const loadBCF = async (bcfId: number) => {
    const bcf = await sharedBCF.loadBCF(bcfId);
    if (bcf && bcf.content) {
      bcfTopics.deleteAll(); // 이전 토픽 목록을 지웁니다.
      await bcfTopics.loadBCFContent(bcf.content as Uint8Array);

    }
  };

  const downloadBCF = async (bcfId: number) => {
    const bcf = await sharedBCF.loadBCF(bcfId);
    if (bcf && bcf.content) {
      const blob = new Blob([bcf.content], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bcf.name}.bcf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const deleteBCF = async (bcfId: number) => {
    if (!confirm("데이터베이스에서 삭제하시겠습니까?")) return;
    const success = await sharedBCF.deleteBCF(bcfId);
    if (success) {
      alert("데이터베이스에서 삭제되었습니다.");
      await refreshSharedBCFList();
    } else {
      alert("BCF 파일 삭제에 실패하였습니다.");
    }
  };

  type BCFTableData = {
    id: number;
    Name: string;
    models: string[];
    [key: string]: any;
  };

  const bcfTable = document.createElement("bim-table") as BUI.Table<BCFTableData>;
  bcfTable.hiddenColumns = ["id", "models"];
  bcfTable.headersHidden = true;
  bcfTable.noIndentation = true;
  bcfTable.noCarets = true;

  setupBIMTable(bcfTable);

  bcfTable.dataTransform = {
    Name: (value, rowData) => {
      const name = value as string;
      const { id, models } = rowData as BCFTableData;
      return BUI.html`
        <div style="display: flex; align-items: center; width: 100%; gap: 0.25rem; overflow: hidden; margin: 0; padding: 0; height: 1.5rem;">
          <bim-label style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; padding: 0;" title=${name}>
            ${name}
          </bim-label>
          <div style="display: flex; gap: 0.25rem; flex-shrink: 0; margin: 0; padding: 0;">
            <bim-button style=${tableButtonStyle} icon=${appIcons.MODEL} title=${models.join(", ")}></bim-button>
            <bim-button style=${tableButtonStyle} @click=${async (e: Event) => {
              if ((bcfTopics as any).isEditingTopic) {
                alert("Topic List에서 토픽을 작성하거나 수정 중일 때에는 BCF를 불러올 수 없습니다. 작업을 완료하거나 취소한 후 다시 시도해주세요.");
                return;
              }
              const btn = (e.target as HTMLElement).closest("bim-button") as BUI.Button;
              if (btn) btn.loading = true;
              try { await loadBCF(id); } finally { if (btn) btn.loading = false; }
            }} icon=${appIcons.IMPORT} title="Load Topics"></bim-button>
            <bim-button style=${tableButtonStyle} @click=${() => downloadBCF(id)} icon=${appIcons.DOWNLOAD} title="Download BCF"></bim-button>
            <bim-button style=${tableButtonStyle} @click=${() => deleteBCF(id)} icon=${appIcons.DELETE} title="Delete BCF"></bim-button>
          </div>
        </div>
      `;
    }
  };

  const missingDataLabel = document.createElement("bim-label");
  missingDataLabel.textContent = "⚠️ No related BCF files found";
  missingDataLabel.setAttribute("slot", "missing-data");
  bcfTable.append(missingDataLabel);

  let allRelevantBCFs: { id: number; name: string; models: string[] }[] = [];

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    bcfTable.queryString = input.value;
  };

  const updateBCFTableData = () => {
    bcfTable.data = allRelevantBCFs.map(file => ({
      data: {
        id: file.id,
        Name: file.name,
        models: file.models,
      }
    }));
  };

  const refreshSharedBCFList = async () => {
    sharedBCF.list = [];
    await sharedBCF.loadBCFFiles();
    await sharedIFC.loadIFCFiles();
    
    // 현재 로드된 모델들의 DB ID 수집
    const loadedDbIds = new Set<number>();
    for (const [, model] of fragments.list) {
      const dbId = (model as any).dbId;
      if (dbId) loadedDbIds.add(dbId);
    }

    const bcfMap = new Map<number, { name: string, ifcIds: Set<number> }>();
    for (const bcf of sharedBCF.list) {
      if (!bcfMap.has(bcf.id)) {
        bcfMap.set(bcf.id, { name: bcf.name, ifcIds: new Set() });
      }
      bcfMap.get(bcf.id)!.ifcIds.add(bcf.ifcid);
    }

    allRelevantBCFs = [];
    for (const [id, data] of bcfMap) {
      let isRelevant = false;
      for (const ifcId of data.ifcIds) {
        if (loadedDbIds.has(ifcId)) {
          isRelevant = true;
          break;
        }
      }

      if (isRelevant) {
        const modelNames = Array.from(data.ifcIds).map(ifcId => sharedIFC.list.find(f => f.id === ifcId)?.name || `Model ${ifcId}`);
        allRelevantBCFs.push({ id, name: data.name, models: modelNames });
      }
    }

    allRelevantBCFs.sort((a, b) => a.name.localeCompare(b.name));
    updateBCFTableData();
  };

  // 모델이 로드되거나 삭제될 때 목록 갱신
  fragments.list.onItemSet.add(refreshSharedBCFList);
  fragments.list.onItemUpdated.add(refreshSharedBCFList);
  fragments.list.onItemDeleted.add(refreshSharedBCFList);
  bcfTopics.onRefresh.add(refreshSharedBCFList);
  
  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TASK} label="BCF List">
      <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
        <bim-text-input @input=${onSearch} vertical placeholder="Search..." debounce="200" style="flex: 1;"></bim-text-input>
        <bim-button style="flex: 0;" @click=${() => {
          if ((bcfTopics as any).isEditingTopic) {
            alert("Topic List에서 토픽을 작성하거나 수정 중일 때에는 BCF를 불러올 수 없습니다. 작업을 완료하거나 취소한 후 다시 시도해주세요.");
            return;
          }
          bcfTopics.saveBCFToDB();
        }} icon=${appIcons.ADD} title="Import BCF"></bim-button>
        <bim-button style="flex: 0;" @click=${refreshSharedBCFList} icon=${appIcons.REFRESH} title="Refresh"></bim-button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; flex: 1; min-height: 0; overflow-y: auto;">
        ${bcfTable}
      </div>
    </bim-panel-section>
  `;
};

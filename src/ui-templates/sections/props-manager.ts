import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, onToggleSection } from "../../globals";
import { Highlighter } from "../../bim-components/Highlighter";
import { SharedIFC } from "../../bim-components/SharedIFC";
import { SharedFRAG } from "../../bim-components/SharedFRAG";

export interface GlobalPropsSectionState {
  components: OBC.Components;
}

// Pset과 Property의 데이터 구조 정의
type PropertyDef = { name: string; value: string };
type PsetDef = { name: string; props: PropertyDef[] };

// 수정된 IFC 버퍼를 임시 보관하기 위한 로컬 캐시
const modifiedBufferCache = new Map<string, Uint8Array>();
let isCacheSyncRegistered = false;

export const globalPropsPanelTemplate: BUI.StatefullComponent<
  GlobalPropsSectionState
> = (state) => {
  const { components } = state;
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(Highlighter);
  const sharedIFC = new SharedIFC();
  const finder = components.get(OBC.ItemsFinder);
  const ifcLoader = components.get(OBC.IfcLoader);

  // --- HELPER FUNCTIONS ---
  const getActiveModel = () => {
    const currentSelection = highlighter.selection.select;
    const modelIds = Object.keys(currentSelection);
    if (modelIds.length > 0) {
      const model = fragments.list.get(modelIds[0]);
      if (model) return { id: modelIds[0], model };
    }
    const firstKey = fragments.list.keys().next().value;
    if (firstKey) {
      const model = fragments.list.get(firstKey);
      if (model) return { id: firstKey, model };
    }
    return null;
  };

  const executeCategoryQuery = async (queryPrefix: string, category: string) => {
    const queryName = `${queryPrefix}_${category}`;
    finder.create(queryName, [{ categories: [new RegExp(`^${category}$`, "i")] }]);
    const fQuery = finder.list.get(queryName);
    let results: OBC.ModelIdMap = {};
    if (fQuery) {
        results = await fQuery.test({ modelIds: [/.*/] });
    }
    finder.list.delete(queryName);
    return results;
  };

  const extractValue = (attr: any): any => {
    if (attr === null || attr === undefined) return null;
    if (Array.isArray(attr)) return attr.length > 0 ? extractValue(attr[0]) : null;
    if (typeof attr === "object" && "value" in attr) return attr.value;
    return attr;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  // ------------------------

  // 모델 Dispose 시 로컬 캐시 메모리 청소 및 동기화 (앱 멈춤 및 메모리 누수 방지)
  if (!isCacheSyncRegistered) {
    fragments.list.onItemDeleted.add(() => {
      for (const key of modifiedBufferCache.keys()) {
        if (!fragments.list.has(key)) {
          modifiedBufferCache.delete(key);
        }
      }
    });
    isCacheSyncRegistered = true;
  }

  // 다중 Pset & Property 폼 상태
  const initialPsets: PsetDef[] = [{ name: "Custom_Pset", props: [{ name: "", value: "" }] }];
  
  // Express ID 수동 입력을 위한 참조
  let manualInput: BUI.TextInput;

  // --- NEW ID FINDER LOGIC ---
  let categoryDropdown: BUI.Dropdown;
  let objectDropdown: BUI.Dropdown;

  const targetCategories = ["IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE", "IFCSPATIALZONE", "IFCZONE", "IFCGROUP", "IFCELEMENTASSEMBLY"];

  const onObjectSelectionChange = ({ target }: { target: BUI.Dropdown }) => {
    const selectedIds = target.value;
    if (manualInput) {
        manualInput.value = selectedIds.join(", ");
    }
  };

  const onCategoryChange = async ({ target }: { target: BUI.Dropdown }) => {
    const selectedCategory = target.value[0];
    if (objectDropdown) {
        objectDropdown.value = [];
        if ((objectDropdown as any).elements) (objectDropdown as any).elements.clear();
        objectDropdown.replaceChildren();
    }
    if (manualInput) manualInput.value = "";

    if (!selectedCategory) {
        return;
    }

    const modelIdMap = await executeCategoryQuery("get", selectedCategory);
    const options: HTMLElement[] = [];

    for (const modelId in modelIdMap) {
        const model = fragments.list.get(modelId);
        if (!model) continue;
        const ids = Array.from(modelIdMap[modelId]);
        const itemsData = await model.getItemsData(ids, { 
            attributesDefault: true,
            relationsDefault: { attributes: false, relations: false }
        });
        
        for (let i = 0; i < itemsData.length; i++) {
            const item = itemsData[i];
            const expressId = extractValue((item as any).expressID ?? (item as any).id ?? (item as any)._localId) ?? ids[i];
            const nameVal = extractValue((item as any).Name);
            const name = nameVal ? String(nameVal) : "Unnamed";
            const option = document.createElement("bim-option") as BUI.Option;
            option.value = String(expressId);
            option.label = `${expressId}: ${name}`;
            options.push(option);
        }
    }
    if (objectDropdown) objectDropdown.replaceChildren(...options);
  };

  const updateCategories = async () => {
    const availableCategories = new Set<string>();

    for (const cat of targetCategories) {
        const results = await executeCategoryQuery("check", cat);
        for (const modelId in results) {
            if (results[modelId].size > 0) {
                availableCategories.add(cat);
                break;
            }
        }
    }

    if (!categoryDropdown) return;

    if ((categoryDropdown as any).elements) (categoryDropdown as any).elements.clear();
    const options: HTMLElement[] = [];
    const sortedCategories = Array.from(availableCategories).sort();
    for (const category of sortedCategories) {
        const option = document.createElement("bim-option") as BUI.Option;
        option.value = category;
        option.label = category.replace(/^IFC/i, "");
        options.push(option);
    }
    categoryDropdown.replaceChildren(...options);
  };

  // 내부 UI 상태 관리를 위한 커스텀 컴포넌트 생성
  const [propsForm, updatePropsForm] = BUI.Component.create<BUI.PanelSection, { psets: PsetDef[] }>(
    (formState) => {
      const { psets } = formState;

      const onAddPset = () => {
        psets.push({ name: "", props: [{ name: "", value: "" }] });
        updatePropsForm({ psets });
      };

      const onRemovePset = (index: number) => {
        psets.splice(index, 1);
        updatePropsForm({ psets });
      };

      const onAddProp = (psetIndex: number) => {
        psets[psetIndex].props.push({ name: "", value: "" });
        updatePropsForm({ psets });
      };

      const onRemoveProp = (psetIndex: number, propIndex: number) => {
        psets[psetIndex].props.splice(propIndex, 1);
        updatePropsForm({ psets });
      };

      return BUI.html`
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <bim-label style="font-weight: bold;">Property Sets</bim-label>
            <bim-button @click=${onAddPset} label="+ Add Pset" style="flex: 0;"></bim-button>
          </div>
          
          <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 400px; overflow-y: auto; padding-right: 0.5rem;">
            ${psets.map((pset, pIndex) => BUI.html`
              <div style="border: 1px solid var(--bim-ui_bg-contrast-20); padding: 0.5rem; border-radius: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
                
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <bim-text-input 
                    value=${pset.name} 
                    @input=${(e: Event) => { pset.name = (e.target as BUI.TextInput).value; }} 
                    placeholder="Pset Name (e.g. Pset_WallCommon)" 
                    style="flex: 1;" vertical>
                  </bim-text-input>
                  <bim-button @click=${() => onRemovePset(pIndex)} icon=${appIcons.DELETE} tooltip-title="Remove Pset" style="flex: 0;"></bim-button>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.25rem; padding-left: 1rem; border-left: 2px solid var(--bim-ui_bg-contrast-20);">
                  ${pset.props.map((prop, propIndex) => BUI.html`
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                      <bim-text-input 
                        value=${prop.name} 
                        @input=${(e: Event) => { prop.name = (e.target as BUI.TextInput).value; }} 
                        placeholder="Property Name" 
                        style="flex: 1;" vertical>
                      </bim-text-input>
                      <bim-text-input 
                        value=${prop.value} 
                        @input=${(e: Event) => { prop.value = (e.target as BUI.TextInput).value; }} 
                        placeholder="Value" 
                        style="flex: 1;" vertical>
                      </bim-text-input>
                      <bim-button @click=${() => onRemoveProp(pIndex, propIndex)} icon=${appIcons.CLEAR} tooltip-title="Remove Property" style="flex: 0;"></bim-button>
                    </div>
                  `)}
                  <bim-button @click=${() => onAddProp(pIndex)} label="+ Add Property" style="margin-top: 0.25rem;"></bim-button>
                </div>
              </div>
            `)}
            ${psets.length === 0 ? BUI.html`<bim-label style="color: var(--bim-ui_gray-5);">No Property Sets added. Click '+ Add Pset' to begin.</bim-label>` : ""}
          </div>
        </div>
      `;
    },
    { psets: initialPsets }
  );

  // 모델 로드/언로드 시 카테고리 목록 갱신
  setTimeout(updateCategories, 500);
  fragments.list.onItemSet.add(updateCategories);
  fragments.list.onItemDeleted.add(updateCategories);

  const processProperties = async (target: BUI.Button, action: string, successMsg: string) => {
    const activeModel = getActiveModel();
    if (!activeModel) {
      alert("현재 로드된 모델이 없습니다.");
      return;
    }

    const targetModelId = activeModel.id;
    const targetModel = activeModel.model;
    let expressIds: number[] = [];

    const manualIdsStr = manualInput?.value.trim();
    if (manualIdsStr) {
      expressIds = manualIdsStr.split(",").map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      if (expressIds.length === 0) {
        alert("유효한 Express ID를 입력해주세요 (숫자와 쉼표만 허용).");
        return;
      }
    } else {
      const currentSelection = highlighter.selection.select;
      if (Object.keys(currentSelection).length === 0 || !currentSelection[targetModelId]) {
        alert("3D 뷰어에서 객체를 선택하거나 적용할 Express ID를 직접 입력해주세요.");
        return;
      }
      expressIds = Array.from(currentSelection[targetModelId]) as number[];
    }

    const dbId = (targetModel as any)?.dbId;

    if (!targetModel || !dbId) {
      alert("선택된 객체의 원본 IFC 모델을 데이터베이스에서 찾을 수 없습니다.");
      return;
    }

    // 빈 데이터 필터링
    const validPsets = initialPsets.map(pset => ({
      name: pset.name.trim(),
      props: pset.props.filter(p => p.name.trim() !== "").map(p => ({ name: p.name.trim(), value: p.value.trim() }))
    })).filter(pset => pset.name !== "" && pset.props.length > 0);

    if (validPsets.length === 0) {
      alert("유효한 Property Set과 Property를 입력해주세요.");
      return;
    }

    target.loading = true;
    
    try {
      // 로컬 캐시된 수정 버퍼가 있는지 확인하고, 없으면 DB에서 원본 IFC 다운로드
      let ifcBuffer = modifiedBufferCache.get(targetModelId);
      if (!ifcBuffer) {
        const ifcData = await sharedIFC.loadIFC(dbId);
        if (ifcData && ifcData.content) ifcBuffer = ifcData.content as Uint8Array;
      }
      if (!ifcBuffer) throw new Error("원본 IFC 버퍼를 로드하지 못했습니다.");

      const formData = new FormData();
      const blob = new Blob([ifcBuffer as any], { type: "application/octet-stream" });
      formData.append("file", blob, `${(targetModel as any).name}.ifc`);
      formData.append("action", action);
      formData.append("expressIds", JSON.stringify(expressIds));
      formData.append("propertiesData", JSON.stringify(validPsets));

      // 지정된 백엔드 엔드포인트 호출
      const response = await fetch("/api/process-properties", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Error: ${errText}`);
      }

      // 수정된 파일 수신 및 리로드
      const arrayBuffer = await response.arrayBuffer();
      const modifiedBuffer = new Uint8Array(arrayBuffer);

      // 뷰어 및 선택 초기화
      await highlighter.clear("select");
      highlighter.events.select.onClear.trigger();
      
      // 모델을 지우기 전에 선택 해제 상태를 워커에 확실히 동기화하여 참조 에러(Not found) 방지
      await fragments.core.update(true);
      
      const modelName = (targetModel as any).name;
      targetModel.dispose();
      
      // main.ts의 전역 onItemDeleted 비동기 이벤트가 워커를 정리할 시간을 충분히 확보 (데드락 방지)
      await new Promise(resolve => setTimeout(resolve, 300));

      // 새 IFC 로드 (IFC -> FRAG 변환 및 로딩)
      console.log("Loading modified IFC into viewer...");
      const reloadedModel = await ifcLoader.load(modifiedBuffer, false, modelName);
      (reloadedModel as any).name = modelName;
      (reloadedModel as any).dbId = dbId; // DB ID 유지
      
      // 새 모델 로드 후 최종 렌더러/워커 상태 동기화
      await fragments.core.update(true);

      // 새 모델의 정확한 ID를 찾아 로컬 캐시에 버퍼 저장 (Save to DB 연동을 위함)
      let reloadedModelId = (reloadedModel as any).modelId;
      if (!reloadedModelId) {
        for (const [id, m] of fragments.list) {
          if (m === reloadedModel) {
            reloadedModelId = id;
            break;
          }
        }
      }
      if (reloadedModelId) {
        modifiedBufferCache.set(reloadedModelId, modifiedBuffer);

        // 리로드된 모델에 이전 선택 요소 복원
        const selectionMap: OBC.ModelIdMap = {};
        selectionMap[reloadedModelId] = new Set(expressIds as number[]);
        await highlighter.highlightByID("select", selectionMap);
      }

      alert(`${successMsg}\n(적용된 객체 수: ${expressIds.length}개)`);

    } catch (err) {
      console.error(`Error processing properties (${action}):`, err);
      alert("프로퍼티 처리 중 오류가 발생했습니다. 콘솔을 확인해주세요.");
    } finally {
      target.loading = false;
    }
  };

  const onApply = async ({ target }: { target: BUI.Button }) => {
    await processProperties(target, "add", "성공적으로 프로퍼티가 추가되고 모델이 리로드되었습니다.");
  };

  const onDelete = async ({ target }: { target: BUI.Button }) => {
    if (!confirm("선택한 객체에서 입력된 프로퍼티들을 삭제하시겠습니까?")) return;
    await processProperties(target, "delete", "성공적으로 프로퍼티가 삭제되고 모델이 리로드되었습니다.");
  };

  const getTargetAndFileName = (actionName: string) => {
    const activeModel = getActiveModel();

    if (!activeModel) {
      alert(`3D 뷰어에서 ${actionName}할 모델의 객체를 선택하거나 로드해주세요.`);
      return null;
    }

    const { id: targetModelId, model: targetModel } = activeModel;
    
    if (!targetModel) {
      alert("선택된 객체의 모델을 찾을 수 없습니다.");
      return null;
    }

    const modifiedBuffer = modifiedBufferCache.get(targetModelId);
    if (!modifiedBuffer) {
      alert("적용된 프로퍼티 변경 사항이 없습니다. 먼저 'Apply Properties'를 실행해주세요.");
      return null;
    }

    let defaultName = (targetModel as any).name || "model";
    if (defaultName.toLowerCase().endsWith(".ifc")) defaultName = defaultName.substring(0, defaultName.length - 4);
    if (!defaultName.endsWith("_prop")) {
      defaultName += "_prop";
    }

    const userInput = prompt(`${actionName}할 파일 이름을 입력하세요 (확장자 제외):`, defaultName);
    if (userInput === null || userInput.trim() === "") {
      return null;
    }
    const baseName = userInput.trim();

    return { targetModel, modifiedBuffer, baseName };
  };

  const onDownload = async ({ target }: { target: BUI.Button }) => {
    const data = getTargetAndFileName("다운로드");
    if (!data) return;
    const { targetModel, modifiedBuffer, baseName } = data;

    target.loading = true;

    try {
      const ifcBlob = new Blob([modifiedBuffer as any], { type: "application/octet-stream" });
      downloadBlob(ifcBlob, `${baseName}.ifc`);

      const fragData = await (targetModel as any).getBuffer(false);
      const fragBlob = new Blob([fragData as any], { type: "application/octet-stream" });
      downloadBlob(fragBlob, `${baseName}.frag`);
    } catch (err) {
      console.error("Error downloading files:", err);
      alert("다운로드 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  const onSaveToDB = async ({ target }: { target: BUI.Button }) => {
    const data = getTargetAndFileName("저장");
    if (!data) return;
    const { targetModel, modifiedBuffer, baseName } = data;

    target.loading = true;

    try {
      const sharedFRAG = new SharedFRAG();
      
      const ifcFile = new File([modifiedBuffer as any], `${baseName}.ifc`, { type: "application/octet-stream" });
      const fragData = await (targetModel as any).getBuffer(false);
      const fragFile = new File([fragData as any], `${baseName}.frag`, { type: "application/octet-stream" });

      const ifcid = await sharedIFC.saveIFC(ifcFile);
      if (ifcid) {
        const fragid = await sharedFRAG.saveFRAG(fragFile);
        if (fragid) {
          alert(`성공적으로 데이터베이스에 저장되었습니다!\n- 모델명: ${baseName}\n- IFC ID: ${ifcid}\n- FRAG ID: ${fragid}`);
          (targetModel as any).dbId = ifcid; 
          (targetModel as any).name = baseName;
        } else alert("FRAG 파일 저장에 실패했습니다.");
      } else alert("IFC 파일 저장에 실패했습니다.");
    } catch (err) {
      console.error("Error saving to DB:", err);
      alert("저장 중 오류가 발생했습니다.");
    } finally {
      target.loading = false;
    }
  };

  return BUI.html`
    <bim-panel-section label="Properties Manager" icon=${appIcons.EDIT} style="gap: 1rem;">
      
      <!-- Property Sets Block -->
      ${propsForm}
      
      <!-- Buttons Block -->
      <div style="display: flex; gap: 0.5rem;">
      <bim-button label="Apply Properties" @click=${onApply} icon=${appIcons.ADD} style="flex: 1;"></bim-button>
      <bim-button label="Delete Properties" @click=${onDelete} icon=${appIcons.DELETE} style="flex: 1;"></bim-button>
      <bim-button label="Download" @click=${onDownload} icon=${appIcons.DOWNLOAD} style="flex: 1;"></bim-button>
      <bim-button label="Save to DB" @click=${onSaveToDB} icon=${appIcons.SAVE} style="flex: 1;"></bim-button>
      </div>
      
      <!-- Invisible Category Finder Block -->
      <div style="display: flex; flex-direction: column; gap: 0.5rem; flex-shrink: 0;">
        <div @click=${onToggleSection} style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
          <bim-label style="font-weight: bold; pointer-events: none;">Invisible Category Finder</bim-label>
          <bim-label class="toggle-icon" icon=${appIcons.RIGHT} style="pointer-events: none; --bim-icon--fz: 1.25rem;"></bim-label>
        </div>
        <div style="display: none; flex-direction: column; gap: 0.5rem;">
          <div style="display: flex; gap: 0.5rem;">
            <bim-dropdown
              ${BUI.ref(el => categoryDropdown = el as BUI.Dropdown)}
              @change=${onCategoryChange}
              label="Select Invisible Category"
              vertical
              style="flex: 1;"
            ></bim-dropdown>
            <bim-dropdown
              ${BUI.ref(el => objectDropdown = el as BUI.Dropdown)}
              @change=${onObjectSelectionChange}
              label="Select Objects"
              multiple
              vertical
              style="flex: 1;"
            ></bim-dropdown>
          </div>
          <bim-text-input 
            ${BUI.ref((e) => { manualInput = e as BUI.TextInput; })}
            placeholder="Selected IDs appear here. Or enter manually. (e.g. 123, 456)" 
            vertical>
          </bim-text-input>
        </div>
      </div>
    </bim-panel-section>
  `;
};

export const globalPropsSection = (state: GlobalPropsSectionState) => {
  const component = BUI.Component.create<
    BUI.PanelSection,
    GlobalPropsSectionState
  >(globalPropsPanelTemplate, state);

  return component;
};

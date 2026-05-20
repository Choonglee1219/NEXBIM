import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { appIcons, setupBIMTable } from "../../globals";

export interface ViewpointsPanelState {
  components: OBC.Components;
}

type ViewpointTableData = {
  id: string;
  Name: string;
  Position: string;
  Direction: string;
  Aspect: string;
  FOV: string;
};

// 레이아웃 변경 시에도 유지될 수 있도록 상태 변수들을 템플릿 외부로 분리합니다.
let vpCount = 1;
let selectedViewpointId: string | null = null;

export const viewpointsPanelTemplate: BUI.StatefullComponent<ViewpointsPanelState> = (state) => {
  const { components } = state;
  const viewpoints = components.get(OBC.Viewpoints);
  
  const table = document.createElement("bim-table") as BUI.Table<ViewpointTableData>;
  table.hiddenColumns = ["id"];

  // 공통 테이블 스타일 및 이벤트 적용
  setupBIMTable(table);
  
  const updateTableData = () => {
    const data: { data: ViewpointTableData }[] = [];
    for (const [guid, vp] of viewpoints.list) {
      if (!vp.camera) continue;
      const pos = vp.camera.camera_view_point;
      const dir = vp.camera.camera_direction;
      
      let fov = "-";
      if ((vp.camera as any).field_of_view !== undefined) {
        fov = (vp.camera as any).field_of_view.toFixed(1);
      } else if ((vp.camera as any).view_to_world_scale !== undefined) {
        fov = (vp.camera as any).view_to_world_scale.toFixed(2) + " (Scale)";
      }

      data.push({
        data: {
          id: guid,
          Name: vp.title || `Viewpoint-${vpCount}`,
          Position: `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`,
          Direction: `${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)}`,
          Aspect: vp.camera.aspect_ratio.toFixed(2),
          FOV: fov,
        }
      });
    }
    table.data = data;

    // 새로 그려진 row 객체들에 대해 기존 선택 상태를 복원합니다.
    table.selection.clear();
    if (selectedViewpointId) {
      const selectedRow = table.data.find(row => row.data && row.data.id === selectedViewpointId);
      if (selectedRow) {
        table.selection.add(selectedRow.data);
      }
    }
  };

  table.dataTransform = {
    Name: (value, rowData) => {
      const isChecked = rowData.id === selectedViewpointId;
      return BUI.html`
        <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden; height: 1.5rem;">
          <bim-checkbox style="flex: 0 0 auto; margin: 0;" .checked=${isChecked} @change=${(e: Event) => {
            const cb = e.target as BUI.Checkbox;
            if (cb.checked) {
              selectedViewpointId = rowData.id as string;
              table.selection.clear(); // 단일 선택 강제
              table.selection.add(rowData);
            } else {
              selectedViewpointId = null;
              table.selection.delete(rowData);
            }
            updateTableData(); // UI 상태 즉시 갱신
          }}></bim-checkbox>
          <bim-label style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;" title=${value}>${value}</bim-label>
        </div>
      `;
    }
  };

  const onCreateViewpoint = async () => {
    const worlds = components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (!world) return;

    const currentViewpoint = viewpoints.create();
    currentViewpoint.title = `Viewpoint-${vpCount++}`;
    currentViewpoint.world = world;
    
    // 현재 카메라 상태를 뷰포인트에 저장
    await currentViewpoint.updateCamera();
    updateTableData();
  };

  const onUpdateViewpointCamera = async () => {
    if (table.selection.size === 0) {
      alert("먼저 업데이트할 뷰포인트를 하나 이상 체크(선택)하세요.");
      return;
    }
    
    for (const row of table.selection) {
      const vp = viewpoints.list.get(row.id as string);
      if (vp) await vp.updateCamera();
    }
    
    updateTableData();
    alert("뷰포인트 카메라가 현재 뷰 화면으로 업데이트되었습니다.");
  };

  const onSetWorldCamera = async () => {
    if (table.selection.size === 0) {
      alert("이동(Fly-To)할 뷰포인트를 하나 체크(선택)하세요.");
      return;
    }

    const selectedRow = Array.from(table.selection)[0];
    const vp = viewpoints.list.get(selectedRow.id as string);

    if (!vp || !vp.camera) {
      alert("적용할 뷰포인트 카메라 정보가 없습니다.");
      return;
    }

    const worlds = components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (!world) return;

    const camera = world.camera as OBC.OrthoPerspectiveCamera;
    const bcfCamera = vp.camera;

    const pos = bcfCamera.camera_view_point;
    const dir = bcfCamera.camera_direction;

    const targetDistance = 10;
    const targetX = pos.x + (dir.x * targetDistance);
    const targetY = pos.y + (dir.y * targetDistance);
    const targetZ = pos.z + (dir.z * targetDistance);

    await camera.controls.setLookAt(pos.x, pos.y, pos.z, targetX, targetY, targetZ, true);
  };

  const onDeleteViewpoint = () => {
    if (table.selection.size === 0) {
      alert("삭제할 뷰포인트를 체크(선택)하세요.");
      return;
    }
    for (const row of table.selection) {
      viewpoints.list.delete(row.id as string);
    }
    selectedViewpointId = null;
    table.selection.clear();
    updateTableData();
  };

  // 컴포넌트 마운트 또는 레이아웃 변경 시 내부 데이터를 기반으로 테이블을 복원합니다.
  updateTableData();

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.CAMERA} label="Viewpoints">
      <bim-label>뷰포인트를 여러 개 생성하고 카메라를 복원하는 테이블 패널입니다.</bim-label>
      <div style="display: flex; gap: 0.25rem; margin-top: 0.5rem; margin-bottom: 0.5rem;">
        <bim-button style="flex: 1;" @click=${onCreateViewpoint} label="Create" icon=${appIcons.ADD}></bim-button>
        <bim-button style="flex: 1;" @click=${onUpdateViewpointCamera} label="Update" icon=${appIcons.REFRESH}></bim-button>
        <bim-button style="flex: 1;" @click=${onSetWorldCamera} label="Fly-To" icon=${appIcons.PLAY}></bim-button>
        <bim-button style="flex: 1;" @click=${onDeleteViewpoint} label="Delete" icon=${appIcons.DELETE}></bim-button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.25rem; color: var(--bim-ui_gray-10); border: 1px solid var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 0rem; overflow-y: auto; height: 15rem; flex-shrink: 0;">
        ${table}
      </div>
    </bim-panel-section>
  `;
};
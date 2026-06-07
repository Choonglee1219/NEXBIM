import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { setModelTransparent, restoreModelMaterials } from "../../../ui-templates/toolbars/viewer-toolbar";
import { Highlighter } from "../../Highlighter";
import { Topic as EngineTopic } from "./engine";

export class TopicViewpointManager {
  private components: OBC.Components;
  private clashMapDisplay: any;

  constructor(components: OBC.Components, clashMapDisplay?: any) {
    this.components = components;
    this.clashMapDisplay = clashMapDisplay;
  }

  async captureViewpoint() {
    const viewpoints = this.components.get(OBC.Viewpoints);
    const viewpoint = viewpoints.create();
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    
    let snapshot = "";

    if (world) {
      viewpoint.world = world;
      await viewpoint.updateCamera();

      if (world.renderer) {
        world.renderer.three.render(world.scene.three, world.camera.three);
        snapshot = world.renderer.three.domElement.toDataURL("image/png");
      }
    }

    const highlighter = this.components.get(Highlighter);
    const selection = highlighter.selection.select;
    if (Object.keys(selection).length > 0) {
      const fragments = this.components.get(OBC.FragmentsManager);
      const guids = await fragments.modelIdMapToGuids(selection);
      for (const guid of guids) {
        viewpoint.selectionComponents.add(guid);
      }
    }

    // 단면 박스(Clipping Planes) 정보 저장 (Three.js -> BCF 역변환)
    let clipper: any = null;
    try {
      clipper = this.components.get(OBC.Clipper);
    } catch (e) {
      // 무시 (Clipper가 없으면 수집하지 않음)
    }

    if (clipper) {
      const bcfPlanes: any[] = [];
      let planes: any[] = [];
      
      // @thatopen/components 버전에 따라 단면 목록이 저장되는 위치가 다를 수 있으므로 모두 검사
      if (clipper.list) {
        planes = typeof clipper.list.values === "function" ? Array.from(clipper.list.values()) : Array.from(clipper.list);
      } else if (clipper.planes) {
        planes = typeof clipper.planes.values === "function" ? Array.from(clipper.planes.values()) : Array.from(clipper.planes);
      } else if (clipper.elements) {
        planes = Array.from(clipper.elements);
      }

      for (const item of planes) {
        const planeObj = item.plane || item; // THREE.Plane 추출
        const normal = planeObj.normal || item.normal;
        if (!normal) continue;

        const point = new THREE.Vector3();
        if (typeof planeObj.coplanarPoint === "function") planeObj.coplanarPoint(point);
        else if (item.origin) point.copy(item.origin);
        else if (planeObj.constant !== undefined) point.copy(normal).multiplyScalar(-planeObj.constant);

        bcfPlanes.push({
          location: { x: point.x, y: -point.z, z: point.y },
          direction: { x: -normal.x, y: normal.z, z: -normal.y }
        });
      }
      if (bcfPlanes.length > 0) {
        (viewpoint as any).clipping_planes = bcfPlanes;
      }
    }

    return { viewpoint, snapshot };
  }

  async createViewpointForTopic(topic: EngineTopic) {
    const { viewpoint, snapshot } = await this.captureViewpoint();
    if (snapshot) (topic as any).snapshot = snapshot;

    topic.viewpoints.add(viewpoint.guid);

    topic.comments.onItemSet.add(({ value: comment }) => {
      comment.viewpoint = viewpoint.guid;
    });
  }

  async restoreViewpoint(topic: EngineTopic, options?: { viewpointGuid?: string }): Promise<void> {
    // 지정된 뷰포인트가 없으면 토픽 자체 뷰포인트나 코멘트의 뷰포인트를 수집합니다.

    let viewpointGuid = options?.viewpointGuid;

    if (!viewpointGuid) {
      const allViewpointGuids = new Set<string>();
      for (const vp of topic.viewpoints) allViewpointGuids.add(vp);
      for (const [_, comment] of topic.comments) {
        if (comment.viewpoint) allViewpointGuids.add(comment.viewpoint);
      }
      if (allViewpointGuids.size > 0) {
        viewpointGuid = allViewpointGuids.values().next().value;
      }
    }

    if (viewpointGuid) {
      const viewpoints = this.components.get(OBC.Viewpoints);
      const viewpoint = viewpoints.list.get(viewpointGuid);
      if (viewpoint?.world) {
        // 1. 모든 이전 상태(하이라이트, 투명도, 클리핑)를 초기화합니다.
        const highlighter = this.components.get(Highlighter);
        await highlighter.clear();
        restoreModelMaterials(this.components);
        const clipper = this.components.get(OBC.Clipper);
        if (clipper) {
          if (clipper.deleteAll) clipper.deleteAll();
          else if ((clipper as any).clear) (clipper as any).clear();
          clipper.enabled = true;
        }

        // [안전장치] BCF 작성 도구의 버그나 의도치 않은 설정으로 인해 DefaultVisibility가 false인데
        // 표시할 예외 객체가 하나도 없는 경우, 전체 모델이 사라지는 현상을 방지합니다.
        if (viewpoint.defaultVisibility === false && viewpoint.exceptionComponents.size === 0) {
          console.warn("Viewpoint visibility fallback applied: Forced DefaultVisibility to true.");
          viewpoint.defaultVisibility = true;
        }

        // 2. 새로운 뷰포인트 상태를 적용합니다.
        await viewpoint.go();
        const fragments = this.components.get(OBC.FragmentsManager);

        // Clash Map이 활성화되어 있다면 종료하여 Highlighter를 켤 수 있게 합니다.
        if (this.clashMapDisplay?.isClashMapActive) {
          this.clashMapDisplay.clearClashMap();
        }

        // Restore Selection
        let guids = Array.from(viewpoint.selectionComponents);
        
        // 인스턴스에 없으면 JSON에서 직접 추출하는 안전장치
        if (guids.length === 0) {
          const vpJson = viewpoint.toJSON();
          if (vpJson.components?.selection) {
            guids = vpJson.components.selection
              .map(s => s.ifc_guid)
              .filter((guid): guid is string => guid !== null);
          }
        }
        
        if (guids.length > 0) {
          const modelIdMap = await fragments.guidsToModelIdMap(guids);
          
          // 현재 로드된 모델에 유효한(일치하는) 객체가 하나라도 존재하는지 확인
          let hasValidItems = false;
          for (const key in modelIdMap) {
            if (modelIdMap[key].size > 0) {
              hasValidItems = true;
              break;
            }
          }
          
          // 일치하는 객체가 있을 때만 전체 모델을 투명화하고 선택 객체를 하이라이트
          if (hasValidItems) {
            setModelTransparent(this.components);
            await highlighter.highlightByID("select", modelIdMap);
          }
        }

        // Restore Colors
        for (const [colorHex, guids] of viewpoint.componentColors) {
          if (!guids || guids.length === 0) continue;
          const styleName = `#${colorHex}`;
          highlighter.styles.set(styleName, {
            color: new THREE.Color(styleName),
            renderedFaces: FRAGS.RenderedFaces.ONE,
            opacity: 0.8,
            transparent: true,
            depthTest: false,
          });
          const colorModelIdMap = await fragments.guidsToModelIdMap(guids);
          await highlighter.highlightByID(styleName, colorModelIdMap, false, false);
        }

        // Restore Clipping Planes
        const vpJson = viewpoint.toJSON();
        const clippingPlanes = (viewpoint as any).clipping_planes || vpJson.clipping_planes || [];

        if (clippingPlanes && clippingPlanes.length > 0) {
          for (const cp of clippingPlanes) {
            const loc = cp.location || cp.Location;
            const dir = cp.direction || cp.Direction;
            if (!loc || !dir) continue;

            const bcfNx = Number(dir.x ?? dir.X ?? 0);
            const bcfNy = Number(dir.y ?? dir.Y ?? 0);
            const bcfNz = Number(dir.z ?? dir.Z ?? 0);
            const bcfPx = Number(loc.x ?? loc.X ?? 0);
            const bcfPy = Number(loc.y ?? loc.Y ?? 0);
            const bcfPz = Number(loc.z ?? loc.Z ?? 0);

            if (!isNaN(bcfNx) && !isNaN(bcfPx)) {
              // BCF (Z-up) -> Three.js (Y-up) 좌표계 변환 및 Normal 방향 반전
              // BCF의 Direction은 잘려나가는(보이지 않는) 방향이므로 Three.js의 Plane Normal(남는 방향)을 구하려면 역벡터를 취합니다.
              const normal = new THREE.Vector3(-bcfNx, -bcfNz, bcfNy).normalize();
              const point = new THREE.Vector3(bcfPx, bcfPz, -bcfPy);

              if (clipper.createFromNormalAndCoplanarPoint) {
                clipper.createFromNormalAndCoplanarPoint(viewpoint.world, normal, point);
              } else if ((clipper as any).create) {
                (clipper as any).create({ normal, point });
              }
            }
          }
        }
      }
    }
  }
}
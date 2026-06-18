import * as THREE from "three";
import * as OBC from "@thatopen/components";

export class ClipperBox extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "8bc7e5c9-95e3-4d64-9dfc-2c8c4de9bf56" as const;

  readonly onDisposed = new OBC.Event<string>();
  enabled = false;

  private world: OBC.World | null = null;
  private planeIds: string[] = [];
  private boxHelper: THREE.Box3Helper | null = null;
  private box = new THREE.Box3();

  public margin = 1.0;

  constructor(components: OBC.Components) {
    super(components);
    this.components.add(ClipperBox.uuid, this);
  }

  init(world: OBC.World) {
    this.world = world;
  }

  async dispose() {
    this.disable();
    this.onDisposed.trigger(ClipperBox.uuid);
  }

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  private getPlane(id: string) {
    const clipper = this.components.get(OBC.Clipper) as any;
    const list = clipper.list || clipper.planes || clipper.elements;
    if (!list) return null;
    return typeof list.get === "function" ? list.get(id) : list[id];
  }

  enable() {
    if (this.enabled || !this.world) return;
    this.enabled = true;

    const clipper = this.components.get(OBC.Clipper);
    const fragments = this.components.get(OBC.FragmentsManager);

    // Calculate bounding box of all loaded models
    const boxer = this.components.get(OBC.BoundingBoxer);
    boxer.list.clear();
    const modelIds = Array.from(fragments.list.keys());
    if (modelIds.length === 0) {
      this.enabled = false;
      return;
    }

    if (typeof (boxer as any).addFromModels === "function") {
      const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const modelRegexes = modelIds.map((id) => new RegExp(`^${escapeRegExp(id)}$`));
      (boxer as any).addFromModels(modelRegexes);
    } else {
      // 3.3.x fallback: add models individually
      for (const id of modelIds) {
        const model = fragments.list.get(id);
        if (model) {
          (boxer as any).add(model);
        }
      }
    }
    const box = boxer.get();
    boxer.list.clear();

    if (box.isEmpty()) {
      this.enabled = false;
      return;
    }

    this.box.copy(box);
    this.box.expandByScalar(this.margin);

    const center = new THREE.Vector3();
    this.box.getCenter(center);

    // Create 6 planes using clipper
    // Right (X max), Left (X min)
    const idXMax = clipper.createFromNormalAndCoplanarPoint(
      this.world,
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(this.box.max.x, center.y, center.z),
    );
    const idXMin = clipper.createFromNormalAndCoplanarPoint(
      this.world,
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(this.box.min.x, center.y, center.z),
    );

    // Top (Y max), Bottom (Y min)
    const idYMax = clipper.createFromNormalAndCoplanarPoint(
      this.world,
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(center.x, this.box.max.y, center.z),
    );
    const idYMin = clipper.createFromNormalAndCoplanarPoint(
      this.world,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(center.x, this.box.min.y, center.z),
    );

    // Front (Z max), Back (Z min)
    const idZMax = clipper.createFromNormalAndCoplanarPoint(
      this.world,
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(center.x, center.y, this.box.max.z),
    );
    const idZMin = clipper.createFromNormalAndCoplanarPoint(
      this.world,
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(center.x, center.y, this.box.min.z),
    );

    this.planeIds = [idXMax, idXMin, idYMax, idYMin, idZMax, idZMin];

    // Customize plane styling (transparency) and control handle sizes
    for (const id of this.planeIds) {
      const plane = this.getPlane(id);
      if (plane) {
        // Explicitly enable and make visible
        plane.enabled = true;
        plane.visible = true;

        const mat = clipper.material.clone();
        mat.transparent = true;
        mat.opacity = 0.01;
        
        // 3.4.x: planeMaterial, 3.3.x: material
        if ("planeMaterial" in plane) {
          plane.planeMaterial = mat;
        } else if ("material" in plane) {
          (plane as any).material = mat;
        }

        if (plane.controls) {
          plane.controls.size = 0.7;
        }
      }
    }

    // Create Box Helper
    this.boxHelper = new THREE.Box3Helper(this.box, new THREE.Color(0x00ffff));
    this.world.scene.three.add(this.boxHelper);

    // Register frame update to sync the wireframe helper
    if (this.world.renderer) {
      this.world.renderer.onBeforeUpdate.add(this.updateBoxHelper);
    }
  }

  disable() {
    if (!this.enabled || !this.world) return;
    this.enabled = false;

    const clipper = this.components.get(OBC.Clipper);
    for (const id of this.planeIds) {
      clipper.delete(this.world, id);
    }
    this.planeIds = [];

    if (this.boxHelper) {
      this.world.scene.three.remove(this.boxHelper);
      this.boxHelper.geometry.dispose();
      if (Array.isArray(this.boxHelper.material)) {
        this.boxHelper.material.forEach((m) => m.dispose());
      } else {
        this.boxHelper.material.dispose();
      }
      this.boxHelper = null;
    }

    if (this.world.renderer) {
      this.world.renderer.onBeforeUpdate.remove(this.updateBoxHelper);
    }
  }

  private updateBoxHelper = () => {
    if (!this.enabled || this.planeIds.length === 0) return;

    const pXMax = this.getPlane(this.planeIds[0]);
    const pXMin = this.getPlane(this.planeIds[1]);
    const pYMax = this.getPlane(this.planeIds[2]);
    const pYMin = this.getPlane(this.planeIds[3]);
    const pZMax = this.getPlane(this.planeIds[4]);
    const pZMin = this.getPlane(this.planeIds[5]);

    if (pXMax && pXMin && pYMax && pYMin && pZMax && pZMin) {
      const maxX = pXMax.three.constant;
      const minX = -pXMin.three.constant;
      const maxY = pYMax.three.constant;
      const minY = -pYMin.three.constant;
      const maxZ = pZMax.three.constant;
      const minZ = -pZMin.three.constant;

      this.box.min.set(minX, minY, minZ);
      this.box.max.set(maxX, maxY, maxZ);
    }
  };
}

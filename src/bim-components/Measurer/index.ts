import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as THREE from "three";
import { Highlighter } from "../Highlighter";

export class Measurer extends OBC.Component {
  static uuid = "939bb2bc-7d31-4a44-811d-68e4dd286c35" as const;
  enabled = true;

  constructor(components: OBC.Components) {
    super(components);
    components.list.set(Measurer.uuid, this);
  }

  init(world: OBC.World, viewport: HTMLElement) {
    // 📐 Length Measurement Setup
    const lengthMeasurer = this.components.get(OBF.LengthMeasurement);
    lengthMeasurer.world = world;
    lengthMeasurer.color = new THREE.Color("#6528d7");
    lengthMeasurer.enabled = false; // 기본 활성화 방지 (단축키/버튼으로 제어)

    lengthMeasurer.list.onItemAdded.add((line) => {
      const center = new THREE.Vector3();
      line.getCenter(center);
      const radius = line.distance() / 3;
      const sphere = new THREE.Sphere(center, radius);
      (world.camera as any).controls?.fitToSphere(sphere, true);
    });

    // 📐 Area Measurement Setup
    const areaMeasurer = this.components.get(OBF.AreaMeasurement);
    areaMeasurer.world = world;
    areaMeasurer.color = new THREE.Color("#6528d7");
    areaMeasurer.enabled = false; // 기본 활성화 방지 (단축키/버튼으로 제어)

    areaMeasurer.list.onItemAdded.add((area) => {
      if (!area.boundingBox) return;
      const sphere = new THREE.Sphere();
      area.boundingBox.getBoundingSphere(sphere);
      (world.camera as any).controls?.fitToSphere(sphere, true);
    });

    viewport.addEventListener("dblclick", () => {
      if (lengthMeasurer.enabled) lengthMeasurer.create();
      if (areaMeasurer.enabled) areaMeasurer.create();
    });

    window.addEventListener("keydown", (event) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      if ((event.code === "Enter" || event.code === "NumpadEnter") && areaMeasurer.enabled) {
        areaMeasurer.endCreation();
      }
      if (event.code === "Delete" || event.code === "Backspace") {
        if (lengthMeasurer.enabled) lengthMeasurer.delete();
        if (areaMeasurer.enabled) areaMeasurer.delete();
      }
    });
  }

  async getMeasure() {
    const highlighter = this.components.get(Highlighter);
    const modelIdMap = highlighter.selection.select;
    if (OBC.ModelIdMapUtils.isEmpty(modelIdMap)) return;

    const measurer = this.components.get(OBF.LengthMeasurement);
    measurer.list.clear();

    const fragments = this.components.get(OBC.FragmentsManager);
    for (const [modelId, localIds] of Object.entries(modelIdMap)) {
      if (localIds.size !== 2) continue;
      const model = fragments.list.get(modelId);
      if (!model) continue;

      const [boxA, boxB] = await model.getBoxes([...localIds]);

      const closestPoints = this.getClosestPoints(boxA, boxB);
      if (closestPoints) {
        const [pointA, pointB] = closestPoints;

        const line = new THREE.Line3(pointA, pointB);
        const direction = new THREE.Vector3();
        line.delta(direction);
        direction.normalize();

        direction.set(
          Math.abs(direction.x) >= Math.abs(direction.y) &&
            Math.abs(direction.x) >= Math.abs(direction.z)
            ? 1
            : 0,
          Math.abs(direction.y) >= Math.abs(direction.x) &&
            Math.abs(direction.y) >= Math.abs(direction.z)
            ? 1
            : 0,
          Math.abs(direction.z) >= Math.abs(direction.x) &&
            Math.abs(direction.z) >= Math.abs(direction.y)
            ? 1
            : 0,
        );

        const planeA = new THREE.Plane().setFromNormalAndCoplanarPoint(
          direction,
          boxA.min,
        );

        const targetA = new THREE.Vector3();
        planeA.projectPoint(boxB.min, targetA);
        const lineA = new THREE.Line3(boxB.min, targetA);

        const targetB = new THREE.Vector3();
        planeA.projectPoint(boxB.max, targetB);
        const lineB = new THREE.Line3(boxB.max, targetB);

        const closestBoundaryA =
          lineA.distance() < lineB.distance() ? lineA : lineB;

        const planeB = new THREE.Plane().setFromNormalAndCoplanarPoint(
          direction,
          boxA.max,
        );

        const targetC = new THREE.Vector3();
        planeB.projectPoint(boxB.min, targetC);
        const lineC = new THREE.Line3(boxB.min, targetC);

        const targetD = new THREE.Vector3();
        planeB.projectPoint(boxB.max, targetD);
        const lineD = new THREE.Line3(boxB.max, targetD);

        const closestBoundaryB =
          lineC.distance() < lineD.distance() ? lineC : lineD;

        const closestBoundary =
          closestBoundaryA.distance() < closestBoundaryB.distance()
            ? closestBoundaryA
            : closestBoundaryB;

        measurer.list.add(
          new OBF.Line(closestBoundary.start, closestBoundary.end),
        );
      }
    }
  }

  getClosestPoints = (boxA: THREE.Box3, boxB: THREE.Box3) => {
    const pointsA = [boxA.min, boxA.max];
    const pointsB = [boxB.min, boxB.max];

    let minDistance = Infinity;
    let closestPair: [THREE.Vector3, THREE.Vector3] | null = null;

    for (const pointA of pointsA) {
      for (const pointB of pointsB) {
        const distance = pointA.distanceTo(pointB);
        if (distance < minDistance) {
          minDistance = distance;
          closestPair = [pointA, pointB];
        }
      }
    }

    return closestPair;
  };
}

import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { Highlighter } from "../../Highlighter";

export class CameraControl {
    private controls: any;
    private isFlyMode = false;

    // 타겟과 가까워질수록 이동/줌 속도가 0에 수렴하는 것을 방지하기 위한 동적 속도 보정
    private baseDollySpeed = 1.0;
    private baseTruckSpeed = 3.0;
    private minEffectiveDistance = 10.0;

    constructor(components: OBC.Components, world: OBC.World, viewport: HTMLElement, highlighter: Highlighter) {
        this.controls = (world.camera as any).controls;
        this.setupCustomControls();
        this.bindShiftEvents();
        this.setupDoubleClick(components, world, viewport, highlighter);
    }

    private setupCustomControls() {
        // --- 카메라 마우스 조작법 변경 ---
        this.controls.mouseButtons.left = 0; // NONE
        this.controls.mouseButtons.middle = 2; // TRUCK (Pan)
        this.controls.mouseButtons.right = 0; // NONE

        // 마우스 휠(줌) 동작 개선: 화면 중앙이 아닌 마우스 포인터를 향해 줌 인/아웃 활성화
        this.controls.dollyToCursor = true;

        this.controls.addEventListener("update", () => {
            const dist = this.controls.distance;
            if (dist < this.minEffectiveDistance && dist > 0) {
                const boost = this.minEffectiveDistance / dist;
                this.controls.dollySpeed = this.baseDollySpeed * boost * 1.5;
                this.controls.truckSpeed = this.baseTruckSpeed * boost;
            } else {
                this.controls.dollySpeed = this.baseDollySpeed;
                this.controls.truckSpeed = this.baseTruckSpeed;
            }
        });
    }

    public setMode(mode: 'orbit' | 'fly') {
        this.isFlyMode = mode === 'fly';
        if (this.isFlyMode) {
            this.controls.mouseButtons.left = 1; // ROTATE
            this.controls.mouseButtons.wheel = 0; // NONE
            this.controls.mouseButtons.middle = 0; // NONE
        } else {
            this.controls.mouseButtons.left = 0; // NONE
            this.controls.mouseButtons.wheel = 16; // DOLLY
            this.controls.mouseButtons.middle = 2; // TRUCK
        }
    }

    private bindShiftEvents() {
        window.addEventListener("keydown", (event) => {
            if (event.key === "Shift") {
                if (!this.isFlyMode) this.controls.mouseButtons.middle = 1; // ROTATE
            }
        });

        window.addEventListener("keyup", (event) => {
            if (event.key === "Shift") {
                if (!this.isFlyMode) this.controls.mouseButtons.middle = 2; // TRUCK
            }
        });
    }

    private setupDoubleClick(components: OBC.Components, world: OBC.World, viewport: HTMLElement, highlighter: Highlighter) {
        const clipper = components.get(OBC.Clipper);
        const lengthMeasurer = components.get(OBF.LengthMeasurement);
        const areaMeasurer = components.get(OBF.AreaMeasurement);

        // 🎯 Double Click: Fit To Item
        viewport.addEventListener("dblclick", async () => {
            if (clipper.enabled || lengthMeasurer.enabled || areaMeasurer.enabled) return;
            
            const selection = highlighter.selection.select;
            if (!OBC.ModelIdMapUtils.isEmpty(selection)) {
                if (world.camera && "fitToItems" in world.camera) {
                    await (world.camera as any).fitToItems(selection);
                }
            }
        });
    }
}
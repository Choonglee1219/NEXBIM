import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { CameraControl } from "./cameraControl";

export class flyMode {
    private world: OBC.World;
    private cameraControl: CameraControl;
    private flyKeys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
    private flySpeed = 10.0;
    private flyLastTime = performance.now();
    
    public isFlyMode = false;
    public isCameraFocusing = false;
    public readonly onToggle = new OBC.Event<boolean>();
    private previousTargetDistance = 20;

    constructor(world: OBC.World, cameraControl: CameraControl) {
        this.world = world;
        this.cameraControl = cameraControl;
        this.overrideFitToItems();
        this.bindEvents();
        this.update();
    }

    private get cameraComponent(): any {
        return this.world.camera as any;
    }

    private overrideFitToItems() {
        const cameraComp = this.cameraComponent;
        
        let originalFitToItems = cameraComp.fitToItems;

        const patchedFitToItems = async (...args: any[]) => {
          this.isCameraFocusing = true;
          try {
            if (originalFitToItems) {
              await originalFitToItems.apply(cameraComp, args);
            }
          } finally {
            this.isCameraFocusing = false;
            if (this.isFlyMode) {
              const camera = cameraComp.three as THREE.Camera;
              const forward = new THREE.Vector3();
              camera.getWorldDirection(forward);
              if (forward.lengthSq() > 0) forward.normalize();
              const newTarget = camera.position.clone().add(forward.multiplyScalar(0.1));
              cameraComp.controls.setTarget(newTarget.x, newTarget.y, newTarget.z, false);
            }
          }
        };

        Object.defineProperty(cameraComp, "fitToItems", {
          get: () => patchedFitToItems,
          set: (val: any) => {
            // 무한 루프(콜스택 폭주로 인한 느려짐) 방지 방어 코드
            if (val && val !== patchedFitToItems) {
              originalFitToItems = val;
            }
          },
          configurable: true,
          enumerable: true
        });
    }

    private bindEvents() {
        window.addEventListener("keydown", (event) => {
            const key = event.key;

            if (key === "w" || key === "W") this.flyKeys.w = true;
            if (key === "a" || key === "A") this.flyKeys.a = true;
            if (key === "s" || key === "S") this.flyKeys.s = true;
            if (key === "d" || key === "D") this.flyKeys.d = true;
            if (key === "ArrowUp") this.flyKeys.ArrowUp = true;
            if (key === "ArrowDown") this.flyKeys.ArrowDown = true;
            if (key === "ArrowLeft") this.flyKeys.ArrowLeft = true;
            if (key === "ArrowRight") this.flyKeys.ArrowRight = true;

            if (key === "l" || key === "L") {
                if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
                this.toggle();
            }
        });

        window.addEventListener("keyup", (event) => {
            const key = event.key;
            if (key === "w" || key === "W") this.flyKeys.w = false;
            if (key === "a" || key === "A") this.flyKeys.a = false;
            if (key === "s" || key === "S") this.flyKeys.s = false;
            if (key === "d" || key === "D") this.flyKeys.d = false;
            if (key === "ArrowUp") this.flyKeys.ArrowUp = false;
            if (key === "ArrowDown") this.flyKeys.ArrowDown = false;
            if (key === "ArrowLeft") this.flyKeys.ArrowLeft = false;
            if (key === "ArrowRight") this.flyKeys.ArrowRight = false;
        });
    }

    public toggle() {
        this.isFlyMode = !this.isFlyMode;
        const controls = this.cameraComponent.controls;
        const camera = this.cameraComponent.three as THREE.Camera;

        if (this.isFlyMode) {
            this.cameraControl.setMode('fly');
            const target = new THREE.Vector3();
            controls.getTarget(target);
            const position = new THREE.Vector3();
            controls.getPosition(position);
            
            // 1인칭 돌입 전 원래 Orbit 모드의 타겟 거리를 기억 (최소 10m 보장)
            this.previousTargetDistance = position.distanceTo(target);
            if (this.previousTargetDistance < 10) this.previousTargetDistance = 10;

            const dir = new THREE.Vector3().subVectors(target, position).normalize();
            const newTarget = position.clone().add(dir.multiplyScalar(0.1));
            controls.setLookAt(position.x, position.y, position.z, newTarget.x, newTarget.y, newTarget.z, false);
            console.log("Fly Mode ON: 방향키/WASD로 이동");
        } else {
            this.cameraControl.setMode('orbit');

            // fly Mode 해제 시 타겟을 기억해둔 거리만큼 앞쪽으로 밀어내어 Orbit 회전축을 복원
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            if (forward.lengthSq() > 0) forward.normalize();
            const newTarget = camera.position.clone().add(forward.multiplyScalar(this.previousTargetDistance));
            controls.setTarget(newTarget.x, newTarget.y, newTarget.z, false);

            console.log("Fly Mode OFF");
        }
        this.onToggle.trigger(this.isFlyMode);
    }

    private update = () => {
        requestAnimationFrame(this.update);
        const currentTime = performance.now();
        const dt = Math.min((currentTime - this.flyLastTime) / 1000, 0.1);
        this.flyLastTime = currentTime;

        if (!this.isFlyMode || this.isCameraFocusing) return;

        const cameraComp = this.cameraComponent;
        const camera = cameraComp.three as THREE.Camera;
        const controls = cameraComp.controls;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        if (forward.lengthSq() > 0) forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, camera.up).normalize();

        const moveDir = new THREE.Vector3();
        if (this.flyKeys.w || this.flyKeys.ArrowUp) moveDir.add(forward);
        if (this.flyKeys.s || this.flyKeys.ArrowDown) moveDir.sub(forward);
        if (this.flyKeys.d || this.flyKeys.ArrowRight) moveDir.add(right);
        if (this.flyKeys.a || this.flyKeys.ArrowLeft) moveDir.sub(right);
        
        if (moveDir.lengthSq() > 0) moveDir.normalize();

        const pos = new THREE.Vector3();
        controls.getPosition(pos);

        if (moveDir.lengthSq() > 0) {
          pos.add(moveDir.multiplyScalar(this.flySpeed * dt));
        }

        const target = new THREE.Vector3();
        controls.getTarget(target);
        const currentDir = new THREE.Vector3().subVectors(target, camera.position);
        
        if (currentDir.lengthSq() > 0) currentDir.normalize().multiplyScalar(0.1);

        controls.setPosition(pos.x, pos.y, pos.z, false);
        controls.setTarget(pos.x + currentDir.x, pos.y + currentDir.y, pos.z + currentDir.z, false);
    };
}
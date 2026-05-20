import * as OBC from "@thatopen/components";
import { CameraControl } from "./src/cameraControl";
import { flyMode } from "./src/flyMode";
import { Highlighter } from "../Highlighter";

export class CustomCameraControl extends OBC.Component {
    static readonly uuid = "CustomCameraControl" as const;
    enabled = true;
    public flyMode: flyMode;

    constructor(components: OBC.Components, world: OBC.World, viewport: HTMLElement, highlighter: Highlighter) {
        super(components);
        // That Open Components 내부 목록에 인스턴스 수동 등록 (components.get() 에러 방지)
        components.list.set(CustomCameraControl.uuid, this);
        const cameraControl = new CameraControl(components, world, viewport, highlighter);
        this.flyMode = new flyMode(world, cameraControl);
    }
}
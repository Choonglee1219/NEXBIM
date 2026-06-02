import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { Timeline, TimelineUI } from "../../bim-components/Timeline";
import { appIcons } from "../../globals";

export interface TimelinePanelState {
  components: OBC.Components;
}

// TimelineUI 결과를 저장해둘 캐시 변수 (리렌더링 시 재생성 방지)
let diagram: any = null;

let isPlaying = false;
let isRepeating = false;
let animationFrame: number;
let currentProgress = 0;
let lastTime = 0;
let isEventsRegistered = false;

export const timelinePanelTemplate: BUI.StatefullComponent<
  TimelinePanelState
> = (state) => {
  const { components } = state;

  // Timeline 컴포넌트가 등록되지 않았을 경우를 대비한 안전한 지연 초기화(Lazy Init)
  let timeline: Timeline;
  try {
    timeline = components.get(Timeline);
  } catch {
    timeline = new Timeline(components);
  }

  // 단 한 번만 UI를 생성하여 상태와 이벤트를 유지합니다
  if (!diagram) {
    diagram = TimelineUI(components);
  }

  if (!isEventsRegistered) {
    // 스크러빙(드래그) 시 진행률 동기화
    timeline.onProgress.add((val) => {
      currentProgress = val;
    });
    
    // 모델 전체 삭제 시 안전장치 (재생 중지 및 초기화)
    const fragments = components.get(OBC.FragmentsManager);
    fragments.list.onItemDeleted.add(() => {
      if (fragments.list.size === 0) {
        if (isPlaying) onPause();
        currentProgress = 0;
      }
    });
    isEventsRegistered = true;
  }

  let playBtn: BUI.Button | undefined;
  let pauseBtn: BUI.Button | undefined;
  let repeatBtn: BUI.Button | undefined;

  const updateButtons = () => {
    if (playBtn) playBtn.disabled = isPlaying;
    if (pauseBtn) pauseBtn.disabled = !isPlaying;
    if (repeatBtn) repeatBtn.active = isRepeating;
  };

  const onPlay = () => {
    const phases = timeline.phases || [];
    if (phases.length === 0) {
      alert("No phase data available. Please apply phase rules from the Phase Manager first.");
      return;
    }

    if (isPlaying) return;
    isPlaying = true;
    updateButtons();

    const minVal = timeline.minProgress;
    const maxVal = timeline.maxProgress;
    
    if (currentProgress < minVal || currentProgress >= maxVal) {
      currentProgress = minVal;
    }
    
    lastTime = performance.now();
    
    const repeat = (time: number) => {
      if (!isPlaying) return;
      const delta = (time - lastTime) / 1000;
      lastTime = time;
      
      const totalDuration = (maxVal - minVal) || 1;
      const speed = totalDuration / 10.0; // 전체 프로젝트를 10초 동안 재생
      currentProgress += speed * delta;
      
      if (currentProgress >= maxVal) {
        if (isRepeating) {
          currentProgress = minVal; // 끝까지 도달하면 처음부터 무한 반복
        } else {
          currentProgress = maxVal;
          isPlaying = false;
          updateButtons();
        }
      }
      
      timeline.onProgress.trigger(currentProgress);
      timeline.showElements(timeline.getPhaseAtProgress(currentProgress));
      
      if (isPlaying) {
        animationFrame = requestAnimationFrame(repeat);
      }
    };
    animationFrame = requestAnimationFrame(repeat);
  };

  const onPause = () => {
    if (!isPlaying) return;
    isPlaying = false;
    updateButtons();
    cancelAnimationFrame(animationFrame);
  };

  const onRepeatToggle = () => {
    isRepeating = !isRepeating;
    updateButtons();
  };

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.GANTT} label="Timeline">
      <div style="display: flex; gap: 0.25rem; margin-bottom: 0.5rem;">
        <bim-button style="flex: 0 0 auto; width: 100px;" ${BUI.ref(e => playBtn = e as BUI.Button)} icon=${appIcons.PLAY} label="Play" @click=${onPlay} ?disabled=${isPlaying}></bim-button>
        <bim-button style="flex: 0 0 auto; width: 100px;" ${BUI.ref(e => pauseBtn = e as BUI.Button)} icon=${appIcons.PAUSE} label="Pause" @click=${onPause} ?disabled=${!isPlaying}></bim-button>
        <bim-button style="flex: 0 0 auto; width: 100px;" ${BUI.ref(e => repeatBtn = e as BUI.Button)} icon=${appIcons.REPEAT} label="Repeat" @click=${onRepeatToggle} ?active=${isRepeating}></bim-button>
      </div>
      <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
        ${diagram}
      </div>
    </bim-panel-section>
  `;
};

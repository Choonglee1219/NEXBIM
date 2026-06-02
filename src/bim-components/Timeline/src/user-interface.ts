import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import Chart from "chart.js/auto";
import { Timeline } from "..";

export function TimelineUI(components: OBC.Components) {
  let timeline: Timeline;
  try {
    timeline = components.get(Timeline);
  } catch {
    timeline = new Timeline(components);
  }

  let chartInstance: Chart | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let isDragging = false;
  let scrubValue: number = 0;

  timeline.onProgress.add((val) => {
    scrubValue = val;
    if (chartInstance) chartInstance.update("none");
  });

  const renderChart = () => {
    const phases = timeline.phases || [];
    if (!canvas || phases.length === 0) return;

    // 차트 X축의 시작과 끝 범위 설정
    const minPhase = timeline.minProgress;
    const maxPhase = timeline.maxProgress;
    const isDateMode = timeline.isDateMode;

    // 초기 렌더링 시 현재 페이즈 기준으로 점선 위치 세팅
    if (scrubValue < minPhase || scrubValue > maxPhase) {
      if (isDateMode && timeline.currentPhase !== null && timeline.phaseDates[timeline.currentPhase]) {
        scrubValue = timeline.phaseDates[timeline.currentPhase].start;
      } else {
        scrubValue = isDateMode ? minPhase : (timeline.currentPhase ?? minPhase);
      }
    }

    const labels = phases.map((p) => `Phase_${p}`);
    const data = phases.map((p) => {
      if (isDateMode && timeline.phaseDates[p]) return [timeline.phaseDates[p].start, timeline.phaseDates[p].end] as [number, number];
      return [p, p + 1] as [number, number];
    });

    if (chartInstance) {
      chartInstance.destroy();
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 현재 재생 시점을 나타내는 세로 점선을 그리는 커스텀 플러그인
    const verticalLinePlugin = {
      id: "verticalLine",
      afterDraw: (chart: any) => {
        const val = scrubValue;
        const xAxis = chart.scales.x;
        const yAxis = chart.scales.y;

        if (val >= xAxis.min && val <= xAxis.max) {
          const xPos = xAxis.getPixelForValue(val);
          const { ctx } = chart;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(xPos, yAxis.top);
          ctx.lineTo(xPos, yAxis.bottom);
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#bcf124"; // NEXBIM 테마 하이라이트 색상
          ctx.setLineDash([5, 5]);
          ctx.stroke();

          // 드래그를 유도하는 작은 손잡이(Handle) 추가
          ctx.beginPath();
          ctx.moveTo(xPos - 5, yAxis.bottom + 5);
          ctx.lineTo(xPos + 5, yAxis.bottom + 5);
          ctx.lineTo(xPos, yAxis.bottom - 5);
          ctx.fillStyle = "#bcf124";
          ctx.fill();

          ctx.restore();
        }
      },
    };

    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Phase Duration",
            data,
            backgroundColor: "#6528d7",
            borderColor: "#bcf124",
            borderWidth: { left: 2, right: 0, top: 0, bottom: 0 },
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: "y", // 가로형 막대 차트로 변경 (간트 차트 스타일)
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            min: minPhase,
            max: maxPhase,
            grid: { color: "rgba(255, 255, 255, 0.1)" },
            ticks: { 
              color: "#d4d4d4",
              maxTicksLimit: 10,
              callback: function(value: any) {
                if (isDateMode) return new Date(value).toLocaleDateString();
                return value;
              }
            },
          },
          y: {
            grid: { display: false },
            ticks: { color: "#d4d4d4" },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
            title: (context: any) => {
              const p = phases[context[0].dataIndex];
              const desc = timeline.phaseDescriptions[p];
              return desc ? `Phase ${p}: ${desc}` : `Phase ${p}`;
            },
              label: (context: any) => {
                if (isDateMode) {
                  return `Duration: ${new Date(context.raw[0]).toLocaleDateString()} ~ ${new Date(context.raw[1]).toLocaleDateString()}`;
                }
                return `Duration: ${context.raw[0]} to ${context.raw[1]}`;
              },
            },
          },
        },
        animation: {
          duration: 0, // 슬라이더 스크러빙 시 부드러운 반응을 위해 애니메이션 비활성화
        },
      },
      plugins: [verticalLinePlugin],
    });
  };

  const handleScrub = async (e: PointerEvent) => {
    if (!chartInstance || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const xAxis = chartInstance.scales.x;

    let val = xAxis.getValueForPixel(x);
    if (val === undefined) return;

    if (val < xAxis.min) val = xAxis.min;
    if (val > xAxis.max) val = xAxis.max;

    scrubValue = val;
    chartInstance.update("none"); // 부드러운 스크러빙을 위해 애니메이션 끄기
    timeline.onProgress.trigger(val); // 동기화 이벤트 트리거
    await timeline.showElements(timeline.getPhaseAtProgress(val));
  };

  const onPointerDown = (e: PointerEvent) => {
    isDragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleScrub(e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    handleScrub(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    isDragging = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const [ganttDiagram, updateDiagram] = BUI.Component.create<
    HTMLDivElement,
    {} // state placeholder to get the updating function returned
  >((_state) => {
    const phases = timeline.phases || [];
    return BUI.html`
      <div style="width: 100%; height: 100%; display: flex; flex-direction: column; gap: 0.5rem; box-sizing: border-box;">
        ${
          phases.length > 0
            ? BUI.html`
                <div style="flex: 1; min-height: 0; position: relative; background: var(--bim-ui_bg-contrast-20); border-radius: 4px; padding: 1rem;">
                  <canvas 
                    style="cursor: ew-resize; touch-action: none;"
                    @pointerdown=${onPointerDown}
                    @pointermove=${onPointerMove}
                    @pointerup=${onPointerUp}
                    @pointercancel=${onPointerUp}
                    ${BUI.ref((e) => {
                    const newCanvas = e as HTMLCanvasElement;
                    if (newCanvas !== canvas) {
                      canvas = newCanvas;
                      renderChart();
                    }
                  })}></canvas>
                </div>
              `
            : BUI.html`
                <div style="display: flex; color: var(--bim-ui_gray-10); background: var(--bim-ui_bg-contrast-20); border-radius: 4px;">
                  <bim-label>⚠️ No phase data available. Please apply phase rules from the Phase Manager.</bim-label>
                </div>
              `
        }
      </div>
    `;
  }, {});

  timeline.onPhasesProcessed.add(() => updateDiagram());

  return ganttDiagram;
}

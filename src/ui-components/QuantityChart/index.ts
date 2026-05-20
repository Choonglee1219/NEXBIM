import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import Chart from "chart.js/auto";

export interface QuantityChartState {
  components: OBC.Components;
  data: any[];
  categoryKey: string;
  numericKey: string;
  onBarClick?: (numericKey: string, min: number, max: number) => void;
  onQuantityTypeChange?: (numericKey: string) => void;
}

// 사용자가 수동으로 설정한 슬라이더 값을 유지하기 위한 로컬 상태
let userMin: number | null = null;
let userMax: number | null = null;
let userStep: number | null = null;
let localNumericKey: string | null = null;
let lastPropNumericKey: string | null = null;

// lit-html의 렌더링 사이클(클로저)과 무관하게 DOM 요소를 안전하게 유지하기 위해 모듈 스코프로 분리
let canvas: HTMLCanvasElement | null = null;
let minLabelEl: HTMLElement | null = null;
let maxLabelEl: HTMLElement | null = null;
let minInputEl: HTMLInputElement | null = null;
let maxInputEl: HTMLInputElement | null = null;
let stepInputEl: any | null = null;
let renderTimeout: ReturnType<typeof setTimeout> | null = null;

// 성능 최적화를 위한 데이터 캐싱 및 차트 인스턴스 재사용
let chartInstance: Chart | null = null;
let cachedData: any[] | null = null;
let cachedNumericKeys: string[] = [];

export const quantityChartTemplate: BUI.StatefullComponent<QuantityChartState> = (state) => {
  const { data } = state;
  
  // 성능 최적화: 데이터가 변경되었을 때만 숫자형 Key를 추출 (반복적인 무거운 연산 방지)
  if (data !== cachedData) {
    const keysSet = new Set<string>();
    if (state.numericKey) keysSet.add(state.numericKey);
    const len = data?.length || 0;
    for (let i = 0; i < len; i++) {
      const row = data[i];
      for (const k in row) {
        if (typeof row[k] === "number") keysSet.add(k);
      }
    }
    cachedNumericKeys = Array.from(keysSet).sort();
    cachedData = data;
  }
  const numericKeys = cachedNumericKeys;

  // 부모로부터 전달된 numericKey가 변경되었을 경우 로컬 상태 동기화
  if (state.numericKey !== lastPropNumericKey) {
    localNumericKey = state.numericKey;
    lastPropNumericKey = state.numericKey;
    userMin = null;
    userMax = null;
    userStep = null;
  }

  // 선택된 키가 없거나 데이터에 존재하지 않으면 초기화
  if (!localNumericKey || !numericKeys.includes(localNumericKey)) {
    localNumericKey = numericKeys.length > 0 ? numericKeys[0] : null;
    userMin = null;
    userMax = null;
    userStep = null;
  }

  const updateChartAndUI = () => {
    // 성능 및 메모리 최적화: map, filter, spread(...) 대신 단일 루프로 값과 Min/Max 추출
    // (Math.min(...values)는 데이터가 10만 개를 넘어가면 Call Stack 초과 에러를 유발합니다)
    const values: number[] = [];
    let actualMin = Infinity;
    let actualMax = -Infinity;

    if (localNumericKey && data) {
      const len = data.length;
      for (let i = 0; i < len; i++) {
        const val = data[i][localNumericKey];
        if (typeof val === "number") {
          values.push(val);
          if (val < actualMin) actualMin = val;
          if (val > actualMax) actualMax = val;
        }
      }
    }

    if (actualMin === Infinity) actualMin = 0;
    if (actualMax === -Infinity) actualMax = 100;
    if (actualMin === actualMax) actualMax = actualMin + 10;

    const defaultMin = Math.floor(actualMin / 10) * 10;
    const defaultMax = Math.ceil(actualMax / 10) * 10;
    const defaultStep = 10;

    const dynMin = userMin !== null ? userMin : defaultMin;
    const dynMax = userMax !== null ? userMax : defaultMax;
    const dynStep = userStep !== null ? userStep : defaultStep;

    const sliderAbsMin = Math.min(0, Math.floor(actualMin / 10) * 10 - 50);
    const sliderAbsMax = Math.ceil(actualMax / 10) * 10 + 50;
    const maxStep = Math.max(10, Math.ceil((actualMax - actualMin) / 10) * 10);

    // DOM 엘리먼트 업데이트
    if (minLabelEl) minLabelEl.textContent = dynMin.toString();
    if (maxLabelEl) maxLabelEl.textContent = dynMax.toString();

    if (minInputEl) {
      minInputEl.min = sliderAbsMin.toString();
      minInputEl.max = Math.max(sliderAbsMin, dynMax - 10).toString();
      minInputEl.value = dynMin.toString();
    }
    if (maxInputEl) {
      maxInputEl.min = Math.min(sliderAbsMax, dynMin + 10).toString();
      maxInputEl.max = sliderAbsMax.toString();
      maxInputEl.value = dynMax.toString();
    }
    if (stepInputEl) {
      stepInputEl.value = dynStep.toString();
      stepInputEl.max = maxStep.toString();
    }

    // 버그 수정: 리렌더링으로 인해 새로운 캔버스가 마운트되었을 때, 기존 차트 인스턴스가 옛날 캔버스를 참조하고 있다면 파괴 후 재생성
    if (chartInstance && canvas && chartInstance.canvas !== canvas) {
      chartInstance.destroy();
      chartInstance = null;
    }

    if (values.length === 0 || !localNumericKey) {
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      return;
    }

    const safeStep = dynStep > 0 ? dynStep : 10;

    // 레이블 포맷팅 (불필요한 소수점 .0 제거)
    const fmt = (n: number) => n.toFixed(1).replace(/\.0$/, '');
    const bins: { label: string; count: number; min: number; max: number }[] = [];
    let currentBinStart = dynMin;
    
    while (currentBinStart < dynMax) {
      const binEnd = currentBinStart + safeStep;
      bins.push({ label: `${fmt(currentBinStart)} ~ ${fmt(binEnd)}`, count: 0, min: currentBinStart, max: binEnd });
      currentBinStart = binEnd;
    }
    if (bins.length === 0) bins.push({ label: `${fmt(dynMin)} ~ ${fmt(dynMin + safeStep)}`, count: 0, min: dynMin, max: dynMin + safeStep });

    // 구간 도수 계산
    for (const val of values) {
      if (val >= dynMin && val <= dynMax) {
        let binIndex = Math.floor((val - dynMin) / safeStep);
        if (binIndex >= bins.length) binIndex = bins.length - 1;
        if (binIndex < 0) binIndex = 0;
        bins[binIndex].count++;
      }
    }

    // 성능 최적화: 매번 new Chart()를 생성하지 않고, 데이터만 업데이트하여 렌더링 속도 대폭 향상
    if (chartInstance) {
      chartInstance.data.labels = bins.map(b => b.label);
      chartInstance.data.datasets[0].data = bins.map(b => b.count);
      
      const xScale = chartInstance.options.scales?.x as any;
      if (xScale?.title) {
        xScale.title.text = localNumericKey ?? '';
      }
      
      // 'none'을 전달하여 슬라이더 조작 시 버벅이는 애니메이션 끄기
      chartInstance.update('none'); 
      return;
    }

    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: bins.map(b => b.label),
        datasets: [{
          label: `Frequency`,
          data: bins.map(b => b.count),
          backgroundColor: 'rgba(54, 162, 235, 0.8)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
          borderRadius: 0,
          barPercentage: 1.0,
          categoryPercentage: 1.0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { 
            type: 'category',
            title: { display: true, text: localNumericKey ?? '', color: '#a0a0a0' } 
          } as any,
          y: { 
            type: 'linear',
            beginAtZero: true, 
            title: { display: true, text: 'Frequency (Count)', color: '#a0a0a0' }
          } as any
        },
      onClick: (_, elements) => {
        if (elements.length > 0 && state.onBarClick && localNumericKey) {
          const index = elements[0].index;
          const bin = bins[index];
          state.onBarClick(localNumericKey, bin.min, bin.max);
        }
      },
      onHover: (event, elements) => {
        if (event.native?.target) {
          (event.native.target as HTMLElement).style.cursor = elements.length > 0 ? 'pointer' : 'default';
        }
      },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (context) => `Count: ${context.parsed.y}` } }
        }
      },
      plugins: [{
        id: 'barDataLabels',
        afterDatasetsDraw: (chart: any) => {
          const ctx = chart.ctx;
          chart.data.datasets.forEach((dataset: any, i: number) => {
            const meta = chart.getDatasetMeta(i);
            meta.data.forEach((bar: any, index: number) => {
              const dataVal = dataset.data[index];
              if (dataVal > 0) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(dataVal.toString(), bar.x, bar.y + 6);
              }
            });
          });
        }
      }]
    });
  };

  const scheduleChartUpdate = () => {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(updateChartAndUI, 16); // ~60fps 디바운스 적용
  };

  const onMinChange = (e: Event) => {
    const val = Number((e.target as any).value);
    if (val > 0) {
      userStep = val;
      scheduleChartUpdate();
    }
  };
  const onMaxChange = (e: Event) => {
    userMax = Number((e.target as HTMLInputElement).value);
    scheduleChartUpdate();
  };
  const onStepChange = (e: Event) => {
    const val = Number((e.target as BUI.TextInput).value);
    if (!isNaN(val) && val > 0) {
      userStep = val;
      scheduleChartUpdate();
    }
  };
  const onQuantityTypeChange = (e: Event) => {
    const dropdown = e.target as BUI.Dropdown;
    dropdown.visible = false;
    const val = dropdown.value[0];
    if (typeof val === "string" && val !== localNumericKey) {
      localNumericKey = val;
      lastPropNumericKey = val; // 부모 컴포넌트의 중복 동기화 방지
      userMin = null;
      userMax = null;
      userStep = null;
      scheduleChartUpdate(); // 즉각적으로 차트 새로고침 (디바운스 적용)

      if (state.onQuantityTypeChange) {
        state.onQuantityTypeChange(val);
      }
    }
  };

  scheduleChartUpdate();

  // 초기 슬라이더 값 설정을 위한 연산 (최초 렌더링 시 레이아웃 점프 방지)
  let actualMin = Infinity;
  let actualMax = -Infinity;
  if (localNumericKey && data) {
    const len = data.length;
    for (let i = 0; i < len; i++) {
      const val = data[i][localNumericKey];
      if (typeof val === "number") {
        if (val < actualMin) actualMin = val;
        if (val > actualMax) actualMax = val;
      }
    }
  }
  if (actualMin === Infinity) actualMin = 0;
  if (actualMax === -Infinity) actualMax = 100;
  if (actualMin === actualMax) actualMax = actualMin + 10;
  
  const defaultMin = Math.floor(actualMin / 10) * 10;
  const defaultMax = Math.ceil(actualMax / 10) * 10;
  const currentMin = userMin !== null ? userMin : defaultMin;
  const currentMax = userMax !== null ? userMax : defaultMax;
  const currentStep = userStep !== null ? userStep : 10;
  const sliderAbsMin = Math.min(0, Math.floor(actualMin / 10) * 10 - 50);
  const sliderAbsMax = Math.ceil(actualMax / 10) * 10 + 50;
  const maxStep = Math.max(10, Math.ceil((actualMax - actualMin) / 10) * 10);

  return BUI.html`
    <div style="width: 100%; height: 100%; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; box-sizing: border-box; background: var(--bim-ui_bg-contrast-20); border-radius: 4px;">
      ${numericKeys.length > 0 ? BUI.html`
        
        <div style="display: flex; gap: 1rem; flex-wrap: wrap; flex-shrink: 0; align-items: center; border: 1px solid var(--bim-ui_bg-contrast-10); background: var(--bim-ui_bg-base); padding: 0.5rem; border-radius: 4px;">
          
          <div style="display: flex; flex-direction: column; min-width: 150px; gap: 0.25rem;">
            <div style="font-size: 0.75rem; color: var(--bim-ui_gray-10);">Quantity Type</div>
            <bim-dropdown required 
              ${BUI.ref(e => {
                const dropdown = e as BUI.Dropdown;
                if (dropdown && localNumericKey && dropdown.value[0] !== localNumericKey) {
                  setTimeout(() => {
                    dropdown.value = [localNumericKey!];
                  }, 0);
                }
              })}
              @change=${onQuantityTypeChange}>
              ${numericKeys.map(key => BUI.html`<bim-option label=${key} value=${key} ?checked=${localNumericKey === key}></bim-option>`)}
            </bim-dropdown>
          </div>

          <div style="display: flex; flex-direction: column; flex: 1; min-width: 120px; gap: 0.25rem;">
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--bim-ui_gray-10);">
              <span>Min Value</span><span ${BUI.ref(e => { minLabelEl = (e as HTMLElement) || null; })}>${currentMin}</span>
            </div>
            <input ${BUI.ref(e => { minInputEl = (e as HTMLInputElement) || null; })} type="range" min="${sliderAbsMin}" max="${Math.max(sliderAbsMin, currentMax - 10)}" step="10" .value="${currentMin}" @input=${onMinChange} @change=${onMinChange} style="width: 100%; cursor: pointer;">
          </div>

          <div style="display: flex; flex-direction: column; flex: 1; min-width: 120px; gap: 0.25rem;">
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--bim-ui_gray-10);">
              <span>Max Value</span><span ${BUI.ref(e => { maxLabelEl = (e as HTMLElement) || null; })}>${currentMax}</span>
            </div>
            <input ${BUI.ref(e => { maxInputEl = (e as HTMLInputElement) || null; })} type="range" min="${Math.min(sliderAbsMax, currentMin + 10)}" max="${sliderAbsMax}" step="10" .value="${currentMax}" @input=${onMaxChange} @change=${onMaxChange} style="width: 100%; cursor: pointer;">
          </div>

          <div style="display: flex; flex-direction: column; flex: 1; min-width: 80px; gap: 0.25rem;">
            <div style="font-size: 0.75rem; color: var(--bim-ui_gray-10);">Bin Size</div>
            <bim-text-input 
              ${BUI.ref(e => { stepInputEl = e || null; })} 
              type="number" 
              min="1" 
              max="${maxStep}"
              .value="${currentStep.toString()}" 
              debounce="200"
              @input=${onStepChange} 
              style="width: 100%;">
            </bim-text-input>
          </div>
        </div>

        <div style="flex: 1; min-height: 0; position: relative;">
          <canvas ${BUI.ref((e) => { 
            const newCanvas = (e as HTMLCanvasElement) || null;
            if (canvas !== newCanvas) {
              canvas = newCanvas;
              scheduleChartUpdate(); // 캔버스가 새로 마운트되는 즉시 차트 렌더링 스케줄링
            }
          })}></canvas>
        </div>

      ` : BUI.html`
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--bim-ui_gray-10);">
          No numeric data available for chart
        </div>
      `}
    </div>
  `;
};

export const quantityChart = (state: QuantityChartState) => {
  return BUI.Component.create<HTMLElement, QuantityChartState>(quantityChartTemplate, state);
};

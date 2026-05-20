import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import Chart from "chart.js/auto";
import { appIcons } from "../../globals";
import { setModelTransparent, restoreModelMaterials } from "../toolbars/viewer-toolbar";
import { Highlighter } from "../../bim-components/Highlighter";

export interface DashboardPanelState {
  components: OBC.Components;
}

export const dashboardPanelTemplate: BUI.StatefullComponent<DashboardPanelState> = (state) => {
  const { components } = state;
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(Highlighter);
  
  let categoryChart: Chart | null = null;
  let typeCharts: Chart[] = [];

  let catCanvas: HTMLCanvasElement | null = null;
  let chartsContainer: HTMLDivElement | null = null;

  const categoryElementMap = new Map<string, Record<string, Set<number>>>();

  const applyFocusAndGhost = async (modelIdMap: OBC.ModelIdMap | null) => {
    // 항상 이전 재질 상태와 선택을 초기화하여 모델 교체 시 Ghost 버그 방지
    restoreModelMaterials(components);
    highlighter.clear("select");
    
    if (modelIdMap && !OBC.ModelIdMapUtils.isEmpty(modelIdMap)) {
      highlighter.highlightByID("select", modelIdMap);
      setModelTransparent(components);
      const worlds = components.get(OBC.Worlds);
      const world = worlds.list.values().next().value;
      if (world && world.camera instanceof OBC.SimpleCamera) {
        await world.camera.fitToItems(modelIdMap);
      }
    }
  };

  const updateDashboard = async (target?: BUI.Button) => {
    if (!catCanvas || !chartsContainer) return;
    if (target) target.loading = true;

    // UI 스레드 블로킹 방지를 위한 미세 딜레이
    await new Promise(resolve => setTimeout(resolve, 50));

    // 0. 준비: Classifier (튜토리얼 방식 적용)
    const classifier = components.get(OBC.Classifier);
    
    try {
      await classifier.byCategory({ classificationName: "entities" });
    } catch (e) {
      console.warn("Classifier grouping error:", e);
    }

    const entitiesClass = classifier.list.get("entities");

    // 1. 카테고리별 데이터 수집
    const categoryCounts: Record<string, number> = {};
    const categoryDetailedData = new Map<string, Record<string, { total: number, oTypes: Record<string, number> }>>();
    categoryElementMap.clear();

    if (entitiesClass) {
      for (const [catName, group] of entitiesClass.entries()) {
        const upperCat = catName.toUpperCase();
        
        // 형상이 없는 관계, 속성 객체 및 불필요한 시스템 컨테이너 제외
        if (upperCat.includes("REL") || upperCat.includes("TYPE") || upperCat.includes("PROPERTY") ||
            ["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCOPENINGELEMENT", "IFCGRID", "IFCANNOTATION"].includes(upperCat)) {
          continue;
        }

        const displayCat = upperCat.replace(/^IFC/i, "");
        const modelIdMap = await group.get();
        const validModelIdMap: OBC.ModelIdMap = {};
        let count = 0;
        for (const [modelId, ids] of Object.entries(modelIdMap)) {
          if (ids.size === 0 || !fragments.list.has(modelId)) continue;
          validModelIdMap[modelId] = ids;
          count += ids.size;
        }
        if (count === 0) continue;
        
        categoryCounts[displayCat] = count;
        categoryElementMap.set(displayCat, validModelIdMap);
        categoryDetailedData.set(displayCat, {});

        for (const [modelId, ids] of Object.entries(validModelIdMap)) {
          const model = fragments.list.get(modelId);
          if (!model) continue;

          try {
            const itemsData = await model.getItemsData(Array.from(ids), { 
              attributesDefault: true,
              relationsDefault: { attributes: false, relations: false },
              relations: { IsTypedBy: { attributes: true, relations: false } }
            });

            for (const item of itemsData) {
              const extractValue = (attr: any): any => {
                if (attr === null || attr === undefined) return null;
                if (Array.isArray(attr)) return attr.length > 0 ? extractValue(attr[0]) : null;
                if (typeof attr === "object" && "value" in attr) return attr.value;
                return attr;
              };

              let pType = extractValue((item as any).PredefinedType);
              let oType = extractValue((item as any).ObjectType);

              if (!pType || !oType) {
                const relatedTypes = [ ...((item as any).IsTypedBy || []) ];
                for (const typeObj of relatedTypes) {
                  if (!pType && typeObj.PredefinedType) pType = extractValue(typeObj.PredefinedType);
                  if (!oType && typeObj.ObjectType) oType = extractValue(typeObj.ObjectType);
                }
              }

              const oTypeStr = oType ? String(oType).toUpperCase() : "UNSPECIFIED";
              // 값이 아예 없는 경우에만 UNSPECIFIED, NOTDEFINED 등의 실제 값이 있으면 그대로 사용
              const pTypeStr = pType ? String(pType).toUpperCase() : "UNSPECIFIED";

              const catData = categoryDetailedData.get(displayCat)!;
              if (!catData[pTypeStr]) catData[pTypeStr] = { total: 0, oTypes: {} };
              catData[pTypeStr].total++;
              if (!catData[pTypeStr].oTypes[oTypeStr]) catData[pTypeStr].oTypes[oTypeStr] = 0;
              catData[pTypeStr].oTypes[oTypeStr]++;
            }
          } catch (error) {
            console.warn(`Error extracting detailed types for ${displayCat}:`, error);
          }
        }
      }
    }

    // 3. 차트 렌더링 함수
    // Colorhunt Gradient 테마에서 영감을 받은 다채로운 네온/파스텔 팔레트
    const basePalettes = [
      { h: 280, s: 85 }, // Vivid Purple
      { h: 340, s: 85 }, // Hot Pink
      { h: 16,  s: 90 }, // Coral/Orange
      { h: 195, s: 90 }, // Bright Cyan
      { h: 145, s: 80 }, // Emerald Green
      { h: 45,  s: 95 }, // Golden Yellow
      { h: 220, s: 85 }, // Deep Blue
      { h: 350, s: 85 }  // Crimson
    ];

    // Category Chart용 상위 6개 필터링
    const topCategoryCounts: Record<string, number> = {};
    Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .forEach(([cat, count]) => { topCategoryCounts[cat] = count; });

    // 공통 툴팁 스타일 (BIM UI 다크 테마 반영)
    const commonTooltipOptions: any = {
      backgroundColor: 'rgba(30, 32, 38, 0.95)',
      titleColor: '#ffffff',
      bodyColor: '#d4d4d4',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      borderWidth: 1,
      padding: 10,
      cornerRadius: 6,
      titleFont: { family: 'sans-serif', size: 13, weight: 'bold' },
      bodyFont: { family: 'sans-serif', size: 12 }
    };

    const renderChart = (
      canvas: HTMLCanvasElement, 
      instance: Chart | null, 
      labelMap: Record<string, number>, 
      dataMap: Map<string, Record<string, Set<number>>>, 
      labelTitle: string
    ) => {
      const labels = Object.keys(labelMap);
      const data = Object.values(labelMap);
      const ctx = canvas.getContext("2d");
      if (!ctx) return instance;

      if (instance) instance.destroy();

      const bgColors = labels.map((_, i) => {
        const p = basePalettes[i % basePalettes.length];
        return `hsla(${p.h}, ${p.s}%, 55%, 0.8)`;
      });
      const bdColors = labels.map((_, i) => {
        const p = basePalettes[i % basePalettes.length];
        return `hsla(${p.h}, ${p.s}%, 55%, 1)`;
      });
      const hbColors = labels.map((_, i) => {
        const p = basePalettes[i % basePalettes.length];
        return `hsla(${p.h}, ${p.s}%, 65%, 0.9)`;
      });

      return new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: labelTitle,
            data: data,
            backgroundColor: bgColors,
            borderColor: bdColors,
            borderWidth: 1,
            borderRadius: 4,
            hoverBackgroundColor: hbColors
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: { top: 25 } // 막대 위 숫자가 잘리지 않도록 상단 여백 추가
          },
          onClick: (_event, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              const selectedLabel = labels[index];
              const modelIdMap = dataMap.get(selectedLabel);
              applyFocusAndGhost(modelIdMap || null);
            } else {
              applyFocusAndGhost(null);
            }
          },
          plugins: {
            legend: { display: false }, // 막대마다 색상이 다르므로 범례는 숨기는 것이 깔끔합니다.
            tooltip: commonTooltipOptions
          },
          scales: {
            x: { ticks: { color: '#a0a0a0' } },
            y: { ticks: { color: '#a0a0a0', stepSize: 1 } }
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
                  ctx.fillStyle = '#d4d4d4';
                  ctx.font = 'bold 12px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'bottom';
                  ctx.fillText(dataVal.toString(), bar.x, bar.y - 4);
                }
              });
            });
          }
        }]
      });
    };

    categoryChart = renderChart(catCanvas, categoryChart, topCategoryCounts, categoryElementMap, 'Category Count');

    // 4. 카테고리별 타입 중첩 파이(Doughnut) 차트 동적 렌더링
    for (const chart of typeCharts) {
      chart.destroy();
    }
    typeCharts = [];
    chartsContainer.innerHTML = "";

    let catColorIdx = 0;
    
    // 상위 6개 카테고리(topCategoryCounts)에 대해서만 파이 차트 생성 제한
    for (const cat of Object.keys(topCategoryCounts)) {
      const catData = categoryDetailedData.get(cat);
      if (!catData || Object.keys(catData).length === 0) continue;

      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      wrapper.style.alignItems = "center";
      wrapper.style.background = "var(--bim-ui_bg-contrast-20)";
      wrapper.style.padding = "1rem";
      wrapper.style.borderRadius = "0.5rem";
      wrapper.style.minHeight = "280px";

      const title = document.createElement("div");
      title.style.fontWeight = "bold";
      title.style.marginBottom = "0.5rem";
      title.style.color = "var(--bim-ui_main-contrast)";
      title.textContent = cat;
      wrapper.appendChild(title);

      const canvasContainer = document.createElement("div");
      canvasContainer.style.position = "relative";
      canvasContainer.style.width = "100%";
      canvasContainer.style.flex = "1";

      const canvas = document.createElement("canvas");
      canvasContainer.appendChild(canvas);
      wrapper.appendChild(canvasContainer);
      chartsContainer.appendChild(wrapper);

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const innerLabels: string[] = [];
      const innerData: number[] = [];
      const innerColors: string[] = [];
      const innerKeys: string[] = [];

      const outerLabels: string[] = [];
      const outerData: number[] = [];
      const outerColors: string[] = [];
      const outerKeys: string[] = [];

      // 현재 카테고리(차트)의 메인 테마 색상 설정
      const palette = basePalettes[catColorIdx % basePalettes.length];
      const ptCount = Object.keys(catData).length;

      let ptIdx = 0;
      for (const [pType, ptData] of Object.entries(catData)) {
        // 안쪽 링: 항목 수에 따라 명도(Lightness)를 75%에서 35% 사이로 점진적 변화
        const lightness = ptCount > 1 ? 75 - (ptIdx * (40 / (ptCount - 1))) : 60;
        const innerColor = `hsla(${palette.h}, ${palette.s}%, ${lightness}%, 0.9)`;

        innerLabels.push(pType);
        innerData.push(ptData.total);
        innerKeys.push(pType);
        innerColors.push(innerColor);
        
        const otCount = Object.keys(ptData.oTypes).length;
        let otIdx = 0;
        for (const [oType, count] of Object.entries(ptData.oTypes)) {
          outerLabels.push(`${pType} - ${oType}`);
          outerData.push(count);
          outerKeys.push(oType);
          
          // 바깥쪽 링: 세부 항목 수에 따라 투명도(Alpha)를 0.9에서 0.3 사이로 점진적 변화
          const alpha = otCount > 1 ? 0.9 - (otIdx * (0.6 / (otCount - 1))) : 0.8;
          const outerColor = `hsla(${palette.h}, ${palette.s}%, ${lightness}%, ${alpha})`;
          outerColors.push(outerColor);
          otIdx++;
        }
        ptIdx++;
      }
      catColorIdx++;

      const totalCount = innerData.reduce((a, b) => a + b, 0);

      const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          datasets: [
            { data: outerData, backgroundColor: outerColors, weight: 2, borderWidth: 1 },
            { data: innerData, backgroundColor: innerColors, weight: 1, borderWidth: 1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...commonTooltipOptions,
              callbacks: {
                label: (context: any) => {
                  const isOuter = context.datasetIndex === 0;
                  const label = isOuter ? outerLabels[context.dataIndex] : innerLabels[context.dataIndex];
                  return `${label}: ${context.raw}`;
                }
              }
            }
          },
          onClick: async (_event, elements) => {
            if (elements.length > 0) {
              const el = elements[0];
              const isOuter = el.datasetIndex === 0;
              const typeVal = isOuter ? outerKeys[el.index] : innerKeys[el.index];
              const attrName = isOuter ? "ObjectType" : "PredefinedType";
              
              // 타입이 없는(UNSPECIFIED) 빈 데이터 클릭 시 선택 해제
              if (typeVal === "UNSPECIFIED") {
                applyFocusAndGhost(null);
                return;
              }

              const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

              // Queries 패널의 동작과 동일하게 ItemsFinder 사용
              const finder = components.get(OBC.ItemsFinder);
              const qName = "dash_doughnut_query";
              const queryVal = new RegExp(`^${escapeRegExp(typeVal)}$`, "i");
              const queryCat = new RegExp(`^IFC${cat}$`, "i");

              finder.create(qName, [{
                categories: [queryCat],
                attributes: {
                  queries: [{ name: new RegExp(`^${attrName}$`, "i"), value: queryVal }]
                }
              }]);

              const fQuery = finder.list.get(qName);
              if (fQuery) {
                const items = await fQuery.test({ modelIds: [/.*/] });
                applyFocusAndGhost(items);
              } else {
                applyFocusAndGhost(null);
              }
              finder.list.delete(qName);
            } else {
              applyFocusAndGhost(null);
            }
          }
        },
        plugins: [{
          id: 'centerText',
          beforeDraw: (chart: any) => {
            const { width, height, ctx } = chart;
            ctx.restore();
            ctx.font = "bold 26px sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#ffffff";
            const text = totalCount.toString();
            const textX = Math.round((width - ctx.measureText(text).width) / 2);
            const textY = height / 2;
            ctx.fillText(text, textX, textY);
            ctx.save();
          }
        }]
      });
      
      typeCharts.push(chart);
    }

    if (target) target.loading = false;
  };

  // 모델이 업로드/삭제 될 때 차트 업데이트 예약
  fragments.list.onItemSet.add(() => setTimeout(updateDashboard, 500));
  fragments.list.onItemDeleted.add(() => {
    restoreModelMaterials(components);
    highlighter.clear("select");
    setTimeout(updateDashboard, 500);
  });

  // 초기 로드시 실행
  setTimeout(updateDashboard, 500);

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.CHART} label="Dashboard">
      <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
        <bim-button style="flex: 0;" @click=${(e: Event) => updateDashboard(e.target as BUI.Button)} icon=${appIcons.REFRESH} tooltip-title="Refresh Charts"></bim-button>
      </div>
      
      <bim-label>By Category</bim-label>
      <div style="width: 100%; height: 250px; padding: 0.5rem; margin-bottom: 1rem; background: var(--bim-ui_bg-contrast-20); border-radius: 0.5rem; display: flex; align-items: center; justify-content: center;">
        <canvas ${BUI.ref((e) => { if (e) catCanvas = e as HTMLCanvasElement; })}></canvas>
      </div>

      <bim-label style="margin-top: 1rem;">By Category & Type (Nested Doughnut)</bim-label>
      <div ${BUI.ref((e) => { if (e) chartsContainer = e as HTMLDivElement; })} style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; width: 100%; margin-top: 0.5rem;">
      </div>
    </bim-panel-section>
  `;
};
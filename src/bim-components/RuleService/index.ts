import * as OBC from "@thatopen/components";
import { RuleSpecDefinition } from "../../setup/specs";
import { appState } from "../../globals";
import { setModelTransparent, restoreModelMaterials } from "../../ui-templates/toolbars/viewer-toolbar";
import { Highlighter } from "../Highlighter";
import { BCFTopics } from "../BCFTopics";
import { RuleTableData, RuleGroupByOption } from "./src/types";
import { groupResultsBy, getFlatData } from "./src/data-extractor";
import { checkCrossModelAnomalies, checkPropertyCompletionRate } from "./src/anomaly-checker";
import { checkDuplicateGUIDs } from "./src/duplicate-checker";
import { checkIFCSchemaRules } from "./src/schema-validator";
import { testStandardSpec } from "./src/spec-tester";

export * from "./src/types";

export class RuleService extends OBC.Component implements OBC.Disposable {
  static readonly uuid = "87d12f34-1b9a-4c28-98e3-0d5b9c1d2e3f" as const;

  enabled = true;
  readonly onDisposed = new OBC.Event<string>();
  readonly onResultsChanged = new OBC.Event<void>();

  allResultsData: any[] = [];
  rawFlatItems: RuleTableData[] = [];
  activeGroupBy: RuleGroupByOption = "None";
  latestResultsMap: OBC.ModelIdMap | null = null;

  constructor(components: OBC.Components) {
    super(components);
    components.add(RuleService.uuid, this);
  }

  async dispose() {
    this.allResultsData = [];
    this.rawFlatItems = [];
    this.latestResultsMap = null;
    this.onResultsChanged.reset();
    this.onDisposed.trigger(RuleService.uuid);
    this.onDisposed.reset();
  }

  setGroupBy(option: RuleGroupByOption) {
    this.activeGroupBy = option;
    this.allResultsData = groupResultsBy(this.rawFlatItems, this.activeGroupBy);
    this.onResultsChanged.trigger();
  }

  async testSpec(specDef: RuleSpecDefinition): Promise<void> {
    const fragments = this.components.get(OBC.FragmentsManager);

    restoreModelMaterials(this.components);
    await fragments.resetHighlight();

    // 1. Cross-Model Property Anomaly Check
    if (specDef.name === "프로퍼티 값 불일치 검사" || specDef.name === "Cross-Model Property Anomaly Check" || specDef.requirement.type === "cross-anomaly") {
      try {
        const { rawFlatItems, failMap, message } = await checkCrossModelAnomalies(this.components);
        this.rawFlatItems = rawFlatItems;
        this.allResultsData = groupResultsBy(this.rawFlatItems, this.activeGroupBy);
        this.latestResultsMap = failMap;
        this.onResultsChanged.trigger();
        alert(message);
      } catch (err: any) {
        alert(err.message || "오류가 발생했습니다.");
      }
      return;
    }

    // 2. Model Property Completion Rate Check
    if (specDef.name === "표준 프로퍼티 완성도 검사" || specDef.name === "Model Property Completion Rate" || specDef.requirement.type === "completion-rate") {
      try {
        const { rawFlatItems, failMap, message } = await checkPropertyCompletionRate(this.components);
        this.rawFlatItems = rawFlatItems;
        this.allResultsData = groupResultsBy(this.rawFlatItems, this.activeGroupBy);
        this.latestResultsMap = failMap;
        this.onResultsChanged.trigger();
        alert(message);
      } catch (err: any) {
        alert(err.message || "오류가 발생했습니다.");
      }
      return;
    }

    // 3. Duplicate GUIDs Check
    if (specDef.name.includes("중복 GUID") || specDef.name.includes("Duplicate GUID") || specDef.requirement.type === "duplicate-guid") {
      try {
        const { rawFlatItems, failMap, message } = await checkDuplicateGUIDs(this.components);
        this.rawFlatItems = rawFlatItems;
        this.allResultsData = groupResultsBy(this.rawFlatItems, this.activeGroupBy);
        this.latestResultsMap = failMap;
        this.onResultsChanged.trigger();
        alert(message);
      } catch (err: any) {
        alert(err.message || "오류가 발생했습니다.");
      }
      return;
    }

    // 4. IFC Schema & Rule Validation Check
    if (specDef.name === "IFC 스키마 및 규격 검사" || specDef.requirement.type === "schema-check") {
      try {
        const { rawFlatItems, failMap, message } = await checkIFCSchemaRules(this.components);
        this.rawFlatItems = rawFlatItems;
        this.allResultsData = groupResultsBy(this.rawFlatItems, this.activeGroupBy);
        this.latestResultsMap = failMap;
        this.onResultsChanged.trigger();
        alert(message);
      } catch (err: any) {
        alert(err.message || "IFC 스키마 검사 중 오류가 발생했습니다.");
      }
      return;
    }

    // 5. Standard Rule Specification Test
    try {
      const { rawFlatItems, allIds } = await testStandardSpec(this.components, specDef);
      this.rawFlatItems = rawFlatItems;
      this.allResultsData = groupResultsBy(this.rawFlatItems, this.activeGroupBy);
      this.latestResultsMap = allIds;
      this.onResultsChanged.trigger();
    } catch (err: any) {
      alert(err.message || "표준 Rule 점검 중 오류가 발생했습니다.");
    }
  }

  async selectObjects(): Promise<void> {
    if (!this.latestResultsMap || OBC.ModelIdMapUtils.isEmpty(this.latestResultsMap)) {
      alert("검사 결과가 없습니다. 먼저 Spec 점검을 실행하세요.");
      return;
    }
    const highlighter = this.components.get(Highlighter);
    await highlighter.clear("select");
    await highlighter.highlightByID("select", this.latestResultsMap);
  }

  async failToTopic(): Promise<void> {
    const flatResults = getFlatData(this.allResultsData);
    if (flatResults.length === 0) {
      alert("검사 결과가 없습니다.");
      return;
    }

    const failData = flatResults.filter(r => r.Status === "Fail" || String(r.Status).startsWith("Fail"));
    if (failData.length === 0) {
      alert("Fail 항목이 없습니다.");
      return;
    }

    const highlighter = this.components.get(Highlighter);
    const fragments = this.components.get(OBC.FragmentsManager);
    const bcfTopics = this.components.get(BCFTopics);
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    const viewpoints = this.components.get(OBC.Viewpoints);

    const failMap: OBC.ModelIdMap = {};
    for (const d of failData) {
      if (d.ModelID && d.ExpressID) {
        if (!failMap[d.ModelID]) failMap[d.ModelID] = new Set();
        failMap[d.ModelID].add(d.ExpressID);
      }
    }

    await highlighter.clear("select");
    await highlighter.highlightByID("select", failMap);

    if (world && world.camera instanceof OBC.SimpleCamera) {
      await world.camera.fitToItems(failMap);
      if (world.camera.hasCameraControls()) {
        world.camera.controls.update(0);
      }
    }

    setModelTransparent(this.components);
    await new Promise((resolve) => setTimeout(resolve, 50));

    let capturedViewpoint: any = null;
    let capturedSnapshot: string | null = null;

    if (world && world.renderer) {
      world.renderer.three.render(world.scene.three, world.camera.three);
      capturedSnapshot = world.renderer.three.domElement.toDataURL("image/jpeg", 0.4);
    }

    capturedViewpoint = viewpoints.create();
    capturedViewpoint.title = `Rule Check Fail`;
    capturedViewpoint.world = world;
    await capturedViewpoint.updateCamera();

    if (capturedViewpoint) {
      const guids = await fragments.modelIdMapToGuids(failMap);
      if (!capturedViewpoint.selectionComponents) capturedViewpoint.selectionComponents = new Set();
      for (const guid of guids) capturedViewpoint.selectionComponents.add(guid);

      if (!capturedViewpoint.componentColors) capturedViewpoint.componentColors = new Map();
      capturedViewpoint.componentColors.set("C00000", guids);
    }

    try {
      const title = `Rule Check Fail (${failData.length} items)`;
      const description = `The following items failed the Rule specification check.`;
      const topicId = `ids-${Date.now()}`;

      let newTopic: any = null;
      if ((bcfTopics as any)._bcf && typeof (bcfTopics as any)._bcf.create === "function") {
        newTopic = (bcfTopics as any)._bcf.create();
      } else if (typeof (bcfTopics as any).create === "function") {
        newTopic = (bcfTopics as any).create();
      }

      if (newTopic) {
        newTopic.title = title;
        newTopic.description = description;
        newTopic.creationAuthor = appState.currentUser || "System";
        newTopic.topicType = "Issue";
        newTopic.topicStatus = "Open";
        if (capturedViewpoint) {
          if (!newTopic.viewpoints) newTopic.viewpoints = new Set();
          newTopic.viewpoints.add(capturedViewpoint.guid);
        }
        if (capturedSnapshot) newTopic.snapshot = capturedSnapshot;
        if (!bcfTopics.list.has(newTopic.guid)) bcfTopics.list.set(newTopic.guid, newTopic);
      } else {
        newTopic = {
          guid: topicId,
          title,
          description,
          creationAuthor: appState.currentUser || "System",
          creationDate: new Date().toISOString(),
          topicType: "Issue",
          topicStatus: "Open",
          viewpoints: new Set(),
          labels: new Set(),
          comments: [],
          snapshot: capturedSnapshot,
        };
        if (capturedViewpoint) newTopic.viewpoints.add(capturedViewpoint.guid);
        bcfTopics.list.set(topicId, newTopic);
      }

      bcfTopics.onRefresh.trigger();
      alert(`Fail 항목들이 BCF 토픽으로 성공적으로 생성되었습니다!\n제목: ${title}`);
    } catch (e) {
      console.error(e);
      alert("BCF 토픽 생성 중 오류가 발생했습니다.");
    }
  }

  exportCSV(): void {
    const flatResults = getFlatData(this.allResultsData);
    if (flatResults.length === 0) {
      alert("내보낼 데이터가 없습니다.");
      return;
    }
    const headers = ["Model", "ExpressID", "GUID", "Name", "Entity", "Value", "Count", "Status"];
    const csvRows = [headers.join(",")];

    for (const d of flatResults) {
      const escapeCSV = (val: any) => `"${String(val ?? "").replace(/"/g, '""')}"`;
      csvRows.push([
        escapeCSV(d.Model),
        escapeCSV(d.ExpressID),
        escapeCSV(d.GUID),
        escapeCSV(d.Name),
        escapeCSV(d.Entity),
        escapeCSV(d.Value),
        escapeCSV(d.Count),
        escapeCSV(d.Status)
      ].join(","));
    }

    const csvString = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ids_check_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
}

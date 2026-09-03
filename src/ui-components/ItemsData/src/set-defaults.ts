import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import { ItemsDataState, ItemsDataTableData } from "./types";
import { getCategoryBadgeStyle } from "../../../globals";

const modelUnitsCache = new Map<string, FRAGS.ItemData[]>();
const boundDeletedModels = new Set<string>();

const extractValue = (attr: any): any => {
  if (attr === null || attr === undefined) return null;
  if (Array.isArray(attr)) return attr.length > 0 ? extractValue(attr[0]) : null;
  if (typeof attr === "object" && "value" in attr) return attr.value;
  return attr;
};

const mapDataTypeToUnitType = (dataType: string | number): string | null => {
  if (typeof dataType !== "string") return null;
  const upper = dataType.toUpperCase();

  if (upper.includes("LENGTH")) return "LENGTHUNIT";
  if (upper.includes("AREA")) return "AREAUNIT";
  if (upper.includes("VOLUME")) return "VOLUMEUNIT";
  if (upper.includes("MASS") || upper.includes("WEIGHT")) return "MASSUNIT";
  if (upper.includes("TIME")) return "TIMEUNIT";
  if (upper.includes("PLANEANGLE")) return "PLANEANGLEUNIT";
  if (upper.includes("PRESSURE")) return "PRESSUREUNIT";
  if (upper.includes("THERMALTRANSMITTANCE")) return "THERMALTRANSMITTANCEUNIT";
  if (upper.includes("TEMPERATURE")) return "THERMODYTEMPERATUREUNIT";
  if (upper.includes("POWER")) return "POWERUNIT";

  return null;
};

const prefixSymbols: Record<string, string> = {
  MILLI: "m",
  CENTI: "c",
  DECI: "d",
  KILO: "k",
  MEGA: "M",
  GIGA: "G",
  MICRO: "µ",
  NANO: "n",
};

const baseUnitSymbols: Record<string, string> = {
  METRE: "m",
  METER: "m",
  SQUARE_METRE: "m²",
  SQUARE_METER: "m²",
  CUBIC_METRE: "m³",
  CUBIC_METER: "m³",
  GRAM: "g",
  SECOND: "s",
  RADIAN: "rad",
  DEGREE: "°",
  DEGREE_CELSIUS: "°C",
  CELSIUS: "°C",
  PASCAL: "Pa",
  WATT: "W",
  JOULE: "J",
  NEWTON: "N",
  INCH: "in",
  FOOT: "ft",
  FEET: "ft",
};

const fallbackUnitSymbols: Record<string, string> = {
  LENGTHUNIT: "mm",
  AREAUNIT: "m²",
  VOLUMEUNIT: "m³",
  MASSUNIT: "kg",
  TIMEUNIT: "s",
  PLANEANGLEUNIT: "°",
};

const getUnitSymbol = (unit: any, targetUnitType?: string | null): string => {
  if (!unit) {
    return (targetUnitType && fallbackUnitSymbols[targetUnitType]) || "";
  }

  const name = String(extractValue(unit.Name) || "").toUpperCase();
  const prefix = String(extractValue(unit.Prefix) || "").toUpperCase();
  const unitType = String(extractValue(unit.UnitType) || "").toUpperCase();

  const pSym = prefixSymbols[prefix] || (prefix ? prefix.toLowerCase() : "");
  const baseSym = baseUnitSymbols[name];

  if (baseSym) {
    if (pSym) {
      if (baseSym === "m²") return `${pSym}m²`;
      if (baseSym === "m³") return `${pSym}m³`;
      return `${pSym}${baseSym}`;
    }
    return baseSym;
  }

  if (name) return name;
  return fallbackUnitSymbols[unitType] || (targetUnitType && fallbackUnitSymbols[targetUnitType]) || "";
};

const getModelUnits = async (components: OBC.Components, modelId: string) => {
  const fragments = components.get(OBC.FragmentsManager);
  const model = fragments.list.get(modelId);
  if (!model) return [];

  const cacheKey = model.modelId || modelId;
  let units = modelUnitsCache.get(cacheKey);
  if (!units) {
    try {
      const categories = await model.getItemsOfCategories([/UNITASSIGNMENT/]);
      const [unitAssignment] = Object.values(categories).flat();
      if (unitAssignment !== undefined) {
        const [unitAssignmentsData] = await model.getItemsData([unitAssignment], {
          relations: { Units: { relations: false, attributes: true } },
        });
        if (unitAssignmentsData && Array.isArray(unitAssignmentsData.Units)) {
          units = unitAssignmentsData.Units;
          modelUnitsCache.set(cacheKey, units);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch model units:", e);
    }
  }

  return units || [];
};

export const setDefaults = (
  state: ItemsDataState,
  table: BUI.Table<ItemsDataTableData>,
) => {
  const { components } = state;
  const fragments = components.get(OBC.FragmentsManager);

  // 메모리 누수 방지: 1회만 안전하게 등록
  const fragmentsKey = "GLOBAL_SET_DEFAULTS_LISTENER";
  if (!boundDeletedModels.has(fragmentsKey)) {
    boundDeletedModels.add(fragmentsKey);
    fragments.list.onItemDeleted.add((modelId) => {
      modelUnitsCache.delete(modelId);
    });
  }

  table.columns = [{ name: "Name", width: "12rem" }, { name: "Value", width: "auto" }];
  table.hiddenColumns = ["modelId", "localId", "type", "dataType", "category"];
  table.headersHidden = true;
  table.dataTransform = {
    Name: (value, rowData) => {
      const text = value !== null && value !== undefined ? String(value) : "";
      const category = (rowData as ItemsDataTableData)?.category;

      if (!category) {
        return BUI.html`<bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; width: 100%;" title=${text}>${text}</bim-label>`;
      }

      const badgeStyle = getCategoryBadgeStyle(category);
      const badgeLabel = category.replace(/^IFC/i, "");

      return BUI.html`
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; min-width: 0; gap: 0.5rem;">
          <bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;" title=${text}>
            ${text}
          </bim-label>
          <span style="
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0.1rem 0.45rem;
            font-size: 0.675rem;
            font-weight: 500;
            letter-spacing: 0.02em;
            border-radius: 999px;
            white-space: nowrap;
            flex-shrink: 0;
            line-height: 1.2;
            user-select: none;
            ${badgeStyle}
          ">${badgeLabel}</span>
        </div>
      `;
    },
    Value: (value, rowData) => {
      const { dataType, modelId } = rowData;
      const rawName = (rowData as ItemsDataTableData)?.Name;

      // RefLatitude, RefLongitude, RefElevation, Global X/Y/Z 등 정밀 포맷된 지리/좌표 속성은 그대로 표시
      if (
        rawName === "RefLatitude" ||
        rawName === "RefLongitude" ||
        rawName === "RefElevation" ||
        rawName === "Global X" ||
        rawName === "Global Y" ||
        rawName === "Global Z" ||
        String(rawName).toLowerCase().includes("elevation")
      ) {
        const text = value !== null && value !== undefined ? String(value) : "";
        return BUI.html`<bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; width: 100%;" title=${text}>${text}</bim-label>`;
      }

      if (!dataType) return value;

      const onCreated = async (e?: Element) => {
        if (!(e && modelId)) return;
        const targetUnitType = mapDataTypeToUnitType(dataType);
        if (!targetUnitType) return;

        const units = await getModelUnits(components, modelId);
        const modelUnit = units.find((unit) => {
          const uType = String(extractValue(unit.UnitType) || "").toUpperCase();
          return uType === targetUnitType;
        });

        const symbol = getUnitSymbol(modelUnit, targetUnitType);
        if (!symbol) return;

        const numVal = Number(value);
        let formattedValStr: string;
        if (!isNaN(numVal) && typeof value !== "boolean") {
          formattedValStr = numVal.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
        } else {
          formattedValStr = String(value);
        }

        const formattedValue = `${formattedValStr} ${symbol}`.trim();
        e.textContent = formattedValue;
        e.setAttribute("title", formattedValue);
      };

      const text = value !== null && value !== undefined ? String(value) : "";
      return BUI.html`<bim-label style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; width: 100%;" title=${text} ${BUI.ref(onCreated)}>${text}</bim-label>`;
    },
  };
};

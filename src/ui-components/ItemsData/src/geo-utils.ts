/**
 * IFCSITE 및 지리/표고/전역좌표 파싱 및 포맷 유틸리티
 */

export interface SitePlacementCoords {
  x: number;
  y: number;
  z: number;
}

export interface SiteGeoMetadata {
  unitScale: number;
  elevations: Map<number, number>;
  placements: Map<number, SitePlacementCoords>;
}

/**
 * STEP 파일 인자 파싱 헬퍼 (따옴표 및 중첩 괄호 보존)
 */
export const parseStepArguments = (argsStr: string): string[] => {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    if (char === "'" && (i === 0 || argsStr[i - 1] !== "\\")) {
      inString = !inString;
      current += char;
    } else if (!inString && (char === "(" || char === "[")) {
      depth++;
      current += char;
    } else if (!inString && (char === ")" || char === "]")) {
      depth--;
      current += char;
    } else if (!inString && depth === 0 && char === ",") {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
};

/**
 * IfcCompoundPlaneAngleMeasure (도, 분, 초, 마이크로초)를 DMS 표기법으로 포맷팅
 * 예: (49, 5, 30, 324859) -> 49°5'30.324859"
 */
export const formatCompoundPlaneAngle = (raw: any): string | null => {
  if (raw === null || raw === undefined) return null;
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.value)
      ? raw.value
      : Array.isArray(raw._representationValue)
        ? raw._representationValue
        : null;
  if (!arr || arr.length === 0) return null;

  const toNum = (v: any): number => {
    if (typeof v === "number") return v;
    if (v && typeof v.value === "number") return v.value;
    const n = parseFloat(String(v));
    return isNaN(n) ? 0 : n;
  };

  const deg = toNum(arr[0]);
  const min = arr.length > 1 ? toNum(arr[1]) : 0;
  const sec = arr.length > 2 ? toNum(arr[2]) : 0;

  if (arr.length > 3) {
    const micro = toNum(arr[3]);
    let microStr = String(micro);
    if (microStr.length < 6) {
      microStr = microStr.padStart(6, "0");
    }
    microStr = microStr.replace(/0+$/, "");
    const secStr = microStr ? `${sec}.${microStr}` : `${sec}`;
    return `${deg}°${min}'${secStr}"`;
  }

  return `${deg}°${min}'${sec}"`;
};

/**
 * IFC 모델의 길이 단위 스케일 감지 (기본 mm: 0.001, m: 1.0)
 */
export const getProjectLengthUnitScaleFromBuffer = (text: string): number => {
  try {
    const siUnitRegex = /#\d+\s*=\s*IFCSIUNIT\s*\(\s*\*\s*,\s*\.LENGTHUNIT\.\s*,\s*(\.[A-Z0-9_]+\.|\$)\s*,\s*\.METRE\.\s*\)/i;
    const siMatch = text.match(siUnitRegex);
    if (siMatch) {
      const prefix = siMatch[1].toUpperCase();
      if (prefix === ".MILLI.") return 0.001;
      if (prefix === ".CENTI.") return 0.01;
      if (prefix === ".DECI.") return 0.1;
      if (prefix === "$" || prefix === ".METRE.") return 1.0;
    }

    const convUnitRegex = /#\d+\s*=\s*IFCCONVERSIONBASEDUNIT\s*\([^,]+,\s*\.LENGTHUNIT\.\s*,\s*'([^']+)'/i;
    const convMatch = text.match(convUnitRegex);
    if (convMatch) {
      const unitName = convMatch[1].toUpperCase();
      if (unitName.includes("FOOT") || unitName.includes("FEET")) return 0.3048;
      if (unitName.includes("INCH")) return 0.0254;
    }

    if (text.includes(".LENGTHUNIT.") && text.includes(".MILLI.")) return 0.001;
    if (text.includes(".LENGTHUNIT.") && text.includes(".CENTI.")) return 0.01;
    if (text.includes(".LENGTHUNIT.") && text.includes(".METRE.")) return 1.0;
  } catch (err) {
    console.warn("[geo-utils] Failed to parse length unit scale:", err);
  }
  return 0.001;
};

/**
 * 프로젝트 단위를 고려하여 최종적으로 m 단위, 소수점 3자리로 포맷
 * 예: (389000, 0.001) -> "389.000m"
 */
export const formatToMetersWith3Decimals = (
  val: number | string | null | undefined,
  scale: number = 0.001
): string => {
  if (val === null || val === undefined || val === "") return "0.000m";
  const num = typeof val === "number" ? val : parseFloat(String(val).replace(/mm|m$/i, ""));
  if (isNaN(num)) return "0.000m";
  const valInMeters = num * scale;
  return `${valInMeters.toFixed(3)}m`;
};

/**
 * 단 1번의 텍스트 스캔으로 IFC 버퍼에서 모든 IfcSite의 표고 및 전역배치 좌표를 일괄 파싱
 */
export const parseAllSiteGeoDataFromBuffer = (buffer: Uint8Array): SiteGeoMetadata => {
  const result: SiteGeoMetadata = {
    unitScale: 0.001,
    elevations: new Map(),
    placements: new Map(),
  };

  try {
    const text = new TextDecoder().decode(buffer);
    result.unitScale = getProjectLengthUnitScaleFromBuffer(text);

    const siteRegex = /#(\d+)\s*=\s*IFCSITE\s*\(([^;]+)\)\s*;/gi;
    let siteMatch: RegExpExecArray | null;

    while ((siteMatch = siteRegex.exec(text)) !== null) {
      const siteId = Number(siteMatch[1]);
      const siteArgs = parseStepArguments(siteMatch[2]);

      // 1. RefElevation 파싱 (12번째 인자, index 11)
      if (siteArgs.length >= 12) {
        const rawElev = siteArgs[11].trim();
        if (rawElev && rawElev !== "$") {
          const elev = parseFloat(rawElev);
          if (!isNaN(elev)) {
            result.elevations.set(siteId, elev);
          }
        }
      }

      // 2. ObjectPlacement 파싱 (6번째 인자, index 5)
      if (siteArgs.length >= 6) {
        const lpRef = siteArgs[5].trim();
        const lpId = lpRef.match(/#(\d+)/)?.[1];
        if (lpId) {
          const lpMatch = text.match(new RegExp(`#${lpId}\\s*=\\s*IFCLOCALPLACEMENT\\s*\\(([^;]+)\\)\\s*;`, "i"));
          if (lpMatch) {
            const lpArgs = parseStepArguments(lpMatch[1]);
            const axisId = lpArgs[1]?.trim().match(/#(\d+)/)?.[1];
            if (axisId) {
              const axisMatch = text.match(new RegExp(`#${axisId}\\s*=\\s*IFCAXIS2PLACEMENT3D\\s*\\(([^;]+)\\)\\s*;`, "i"));
              if (axisMatch) {
                const axisArgs = parseStepArguments(axisMatch[1]);
                const pointId = axisArgs[0]?.trim().match(/#(\d+)/)?.[1];
                if (pointId) {
                  const pointMatch = text.match(new RegExp(`#${pointId}\\s*=\\s*IFCCARTESIANPOINT\\s*\\(\\s*\\(\\s*([^)]+)\\s*\\)\\s*\\)\\s*;`, "i"));
                  if (pointMatch) {
                    const rawTokens = pointMatch[1].split(",").map((s) => parseFloat(s.trim()));
                    result.placements.set(siteId, {
                      x: isNaN(rawTokens[0]) ? 0 : rawTokens[0],
                      y: isNaN(rawTokens[1]) ? 0 : rawTokens[1],
                      z: isNaN(rawTokens[2]) ? 0 : rawTokens[2],
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[geo-utils] Error parsing site geo data from buffer:", err);
  }

  return result;
};

/**
 * 속성 객체에서 RefElevation 숫자 추출
 */
export const extractRefElevationValue = (raw: any): number | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "object") {
    if (typeof raw._representationValue === "number") return raw._representationValue;
    if (typeof raw.value === "number") return raw.value;
    if (raw._internalValue !== undefined && raw._internalValue !== null) {
      const n = parseFloat(String(raw._internalValue));
      if (!isNaN(n)) return n;
    }
    if (raw.value !== undefined && raw.value !== null) {
      const n = parseFloat(String(raw.value));
      if (!isNaN(n)) return n;
    }
  }
  const n = parseFloat(String(raw));
  return isNaN(n) ? null : n;
};

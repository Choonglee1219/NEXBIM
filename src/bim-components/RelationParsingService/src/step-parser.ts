import { IfcOpeningElementData, IfcSpatialZoneData, ModelRelationData } from "./types";

/**
 * STEP 파라미터 문자열을 안전하고 신속하게 분할 파싱합니다.
 * 작은따옴표 문자열 이스케이프('') 및 중첩 괄호를 완벽하게 지원합니다.
 */
export const parseStepArgs = (argsStr: string): string[] => {
  const args: string[] = [];
  let current = "";
  let inString = false;
  let parenDepth = 0;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];

    if (char === "'") {
      if (inString && i + 1 < argsStr.length && argsStr[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
      current += char;
    } else if (!inString && char === "(") {
      parenDepth++;
      current += char;
    } else if (!inString && char === ")") {
      parenDepth--;
      current += char;
    } else if (!inString && parenDepth === 0 && char === ",") {
      args.push(cleanStepArg(current));
      current = "";
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    args.push(cleanStepArg(current));
  }

  return args;
};

export const cleanStepArg = (val: string): string => {
  val = val.trim();
  if (val === "$" || val === "*") return "";
  if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
    return val.substring(1, val.length - 1).replace(/''/g, "'");
  }
  if (val.startsWith(".") && val.endsWith(".") && val.length >= 2) {
    return val.substring(1, val.length - 1);
  }
  return val;
};

const extractExpressId = (ref: string | undefined): number | null => {
  if (!ref) return null;
  const cleaned = ref.trim();
  const num = parseInt(cleaned.startsWith("#") ? cleaned.substring(1) : cleaned, 10);
  return isNaN(num) ? null : num;
};

const extractExpressIdList = (listStr: string | undefined): number[] => {
  if (!listStr) return [];
  const ids: number[] = [];
  const matches = listStr.matchAll(/#?(\d+)/g);
  for (const m of matches) {
    const id = parseInt(m[1], 10);
    if (!isNaN(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
};

// 헬퍼: 1:N Map 관계 추가 (중복 방지)
const appendToMapList = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  if (!list.includes(value)) {
    list.push(value);
  }
};

/**
 * IFC STEP 텍스트를 단일 패스로 고속 분석하여 비계층 관계망(Openings, Voids, Fills, SpatialZones)을 추출합니다.
 */
export const parseIfcStepRelations = (ifcText: string, modelKey: string): ModelRelationData => {
  const relationData: ModelRelationData = {
    modelKey,
    openings: new Map<number, IfcOpeningElementData>(),
    elementToOpenings: new Map<number, number[]>(),
    openingToParent: new Map<number, number>(),
    openingToFillings: new Map<number, number[]>(),
    fillingToOpening: new Map<number, number>(),
    spatialZones: new Map<number, IfcSpatialZoneData>(),
    elementToZones: new Map<number, number[]>(),
    zoneToElements: new Map<number, number[]>(),
  };

  const statementRegex = /#(\d+)\s*=\s*(IFCOPENINGELEMENT|IFCOPENINGSTANDARDCASE|IFCSPATIALZONE|IFCRELVOIDSELEMENT|IFCRELFILLSELEMENT|IFCRELREFERENCEDINSPATIALSTRUCTURE)\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;

  while ((match = statementRegex.exec(ifcText)) !== null) {
    const id = parseInt(match[1], 10);
    const entityType = match[2].toUpperCase();
    const args = parseStepArgs(match[3]);

    switch (entityType) {
      case "IFCOPENINGELEMENT":
      case "IFCOPENINGSTANDARDCASE": {
        const existing = relationData.openings.get(id);
        relationData.openings.set(id, {
          expressId: id,
          globalId: args[0] || null,
          name: args[2] || null,
          description: args[3] || null,
          objectType: args[4] || null,
          predefinedType: args[8] || null,
          parentExpressId: existing?.parentExpressId ?? null,
          fillingExpressIds: existing?.fillingExpressIds ?? [],
        });
        break;
      }

      case "IFCSPATIALZONE": {
        const existing = relationData.spatialZones.get(id);
        relationData.spatialZones.set(id, {
          expressId: id,
          globalId: args[0] || null,
          name: args[2] || null,
          description: args[3] || null,
          objectType: args[4] || null,
          longName: args[7] || null,
          predefinedType: args[8] || null,
          referencedElementIds: existing?.referencedElementIds ?? [],
        });
        break;
      }

      case "IFCRELVOIDSELEMENT": {
        let parentId = extractExpressId(args[4]);
        let openingId = extractExpressId(args[5]);

        if (parentId === null || openingId === null) {
          const ids = args.map(extractExpressId).filter((n): n is number => n !== null);
          if (ids.length >= 2) {
            parentId = ids[ids.length - 2];
            openingId = ids[ids.length - 1];
          }
        }

        if (parentId !== null && openingId !== null) {
          appendToMapList(relationData.elementToOpenings, parentId, openingId);
          relationData.openingToParent.set(openingId, parentId);

          const opData = relationData.openings.get(openingId);
          if (opData) {
            opData.parentExpressId = parentId;
          } else {
            relationData.openings.set(openingId, {
              expressId: openingId,
              parentExpressId: parentId,
              fillingExpressIds: [],
            });
          }
        }
        break;
      }

      case "IFCRELFILLSELEMENT": {
        let openingId = extractExpressId(args[4]);
        let fillingId = extractExpressId(args[5]);

        if (openingId === null || fillingId === null) {
          const ids = args.map(extractExpressId).filter((n): n is number => n !== null);
          if (ids.length >= 2) {
            openingId = ids[ids.length - 2];
            fillingId = ids[ids.length - 1];
          }
        }

        if (openingId !== null && fillingId !== null) {
          appendToMapList(relationData.openingToFillings, openingId, fillingId);
          relationData.fillingToOpening.set(fillingId, openingId);

          const opData = relationData.openings.get(openingId);
          if (opData) {
            if (!opData.fillingExpressIds.includes(fillingId)) {
              opData.fillingExpressIds.push(fillingId);
            }
          } else {
            relationData.openings.set(openingId, {
              expressId: openingId,
              parentExpressId: null,
              fillingExpressIds: [fillingId],
            });
          }
        }
        break;
      }

      case "IFCRELREFERENCEDINSPATIALSTRUCTURE": {
        const relatingStructureId = extractExpressId(args[5]);
        if (relatingStructureId !== null) {
          const elementIds = extractExpressIdList(args[4]);

          for (const elId of elementIds) {
            appendToMapList(relationData.zoneToElements, relatingStructureId, elId);
            appendToMapList(relationData.elementToZones, elId, relatingStructureId);
          }

          const zoneData = relationData.spatialZones.get(relatingStructureId);
          if (zoneData) {
            for (const elId of elementIds) {
              if (!zoneData.referencedElementIds.includes(elId)) {
                zoneData.referencedElementIds.push(elId);
              }
            }
          }
        }
        break;
      }
    }
  }

  return relationData;
};

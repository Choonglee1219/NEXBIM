import { IfcOpeningElementData, IfcSpatialZoneData, ModelRelationData } from "./types";

export const parseStepArgs = (argsStr: string): string[] => {
  const args: string[] = [];
  let current = "";
  let inString = false;
  let parenDepth = 0;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];

    if (char === "'") {
      // STEP 규격: '' 는 문자열 내부의 작은따옴표 이스케이프
      if (inString && i + 1 < argsStr.length && argsStr[i + 1] === "'") {
        current += "''";
        i++; // 다음 작은따옴표 건너뛰기
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

const extractExpressId = (ref: string): number | null => {
  if (!ref) return null;
  const cleaned = ref.trim();
  if (cleaned.startsWith("#")) {
    const num = parseInt(cleaned.substring(1), 10);
    return isNaN(num) ? null : num;
  }
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
};

const extractExpressIdList = (listStr: string): number[] => {
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

  // High-performance single-pass unified statement parser
  const statementRegex = /#(\d+)\s*=\s*(IFCOPENINGELEMENT|IFCOPENINGSTANDARDCASE|IFCSPATIALZONE|IFCRELVOIDSELEMENT|IFCRELFILLSELEMENT|IFCRELREFERENCEDINSPATIALSTRUCTURE)\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;

  while ((match = statementRegex.exec(ifcText)) !== null) {
    const id = parseInt(match[1], 10);
    const entityType = match[2].toUpperCase();
    const argsStr = match[3];

    switch (entityType) {
      case "IFCOPENINGELEMENT":
      case "IFCOPENINGSTANDARDCASE": {
        const args = parseStepArgs(argsStr);
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
        const args = parseStepArgs(argsStr);
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
        const args = parseStepArgs(argsStr);
        let parentId = extractExpressId(args[4]);
        let openingId = extractExpressId(args[5]);

        if (parentId === null || openingId === null) {
          const ids = args.map(extractExpressId).filter((num): num is number => num !== null);
          if (ids.length >= 2) {
            parentId = ids[ids.length - 2];
            openingId = ids[ids.length - 1];
          }
        }

        if (parentId !== null && openingId !== null) {
          let openingsList = relationData.elementToOpenings.get(parentId);
          if (!openingsList) {
            openingsList = [];
            relationData.elementToOpenings.set(parentId, openingsList);
          }
          if (!openingsList.includes(openingId)) {
            openingsList.push(openingId);
          }

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
        const args = parseStepArgs(argsStr);
        let openingId = extractExpressId(args[4]);
        let fillingId = extractExpressId(args[5]);

        if (openingId === null || fillingId === null) {
          const ids = args.map(extractExpressId).filter((num): num is number => num !== null);
          if (ids.length >= 2) {
            openingId = ids[ids.length - 2];
            fillingId = ids[ids.length - 1];
          }
        }

        if (openingId !== null && fillingId !== null) {
          let fillingsList = relationData.openingToFillings.get(openingId);
          if (!fillingsList) {
            fillingsList = [];
            relationData.openingToFillings.set(openingId, fillingsList);
          }
          if (!fillingsList.includes(fillingId)) {
            fillingsList.push(fillingId);
          }

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
        const args = parseStepArgs(argsStr);
        const relatedElementsArg = args[4];
        const relatingStructureArg = args[5];

        const relatingStructureId = extractExpressId(relatingStructureArg);
        if (relatingStructureId !== null) {
          const elementIds = extractExpressIdList(relatedElementsArg);
          let zoneElements = relationData.zoneToElements.get(relatingStructureId);
          if (!zoneElements) {
            zoneElements = [];
            relationData.zoneToElements.set(relatingStructureId, zoneElements);
          }

          for (const elId of elementIds) {
            if (!zoneElements.includes(elId)) {
              zoneElements.push(elId);
            }

            let elZones = relationData.elementToZones.get(elId);
            if (!elZones) {
              elZones = [];
              relationData.elementToZones.set(elId, elZones);
            }
            if (!elZones.includes(relatingStructureId)) {
              elZones.push(relatingStructureId);
            }
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

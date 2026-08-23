import { IfcOpeningElementData, IfcSpatialZoneData, ModelRelationData } from "./types";

export const parseStepArgs = (argsStr: string): string[] => {
  const args: string[] = [];
  let current = "";
  let inString = false;
  let parenDepth = 0;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];

    if (char === "'" && (i === 0 || argsStr[i - 1] !== "\\")) {
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
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.substring(1, val.length - 1);
  }
  if (val.startsWith(".") && val.endsWith(".")) {
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
        const parentId = extractExpressId(args[4]);
        const openingId = extractExpressId(args[5]);

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
        const openingId = extractExpressId(args[4]);
        const fillingId = extractExpressId(args[5]);

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
        const relatingStructureId = extractExpressId(args[5]);

        if (relatingStructureId !== null) {
          const elementIds = extractExpressIdList(args[4] || "");

          let zoneList = relationData.zoneToElements.get(relatingStructureId);
          if (!zoneList) {
            zoneList = [];
            relationData.zoneToElements.set(relatingStructureId, zoneList);
          }

          for (const elemId of elementIds) {
            if (!zoneList.includes(elemId)) {
              zoneList.push(elemId);
            }

            let elemZoneList = relationData.elementToZones.get(elemId);
            if (!elemZoneList) {
              elemZoneList = [];
              relationData.elementToZones.set(elemId, elemZoneList);
            }
            if (!elemZoneList.includes(relatingStructureId)) {
              elemZoneList.push(relatingStructureId);
            }
          }

          const zoneData = relationData.spatialZones.get(relatingStructureId);
          if (zoneData) {
            for (const elemId of elementIds) {
              if (!zoneData.referencedElementIds.includes(elemId)) {
                zoneData.referencedElementIds.push(elemId);
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


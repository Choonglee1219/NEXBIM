import { SharedIFC } from "../../SharedIFC";
import { ModelRelationData } from "../../RelationParsingService";

export const getPattern = (val: string): string => {
  if (!val || val.toUpperCase() === "ALL" || val.toUpperCase() === "ANY" || val === ".*") return ".*";
  let pattern = val.replace(/[a-zA-Z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
  let prefix = ".*";
  let suffix = ".*";
  if (pattern.startsWith('^')) { prefix = ""; pattern = pattern.substring(1); }
  else if (pattern.startsWith('.*')) { prefix = ""; }
  if (pattern.endsWith('$')) { suffix = ""; pattern = pattern.substring(0, pattern.length - 1); }
  else if (pattern.endsWith('.*')) { suffix = ""; }
  return `${prefix}(?:${pattern})${suffix}`;
};

export const isNonGeometricEntity = (entity: string): boolean => {
  const e = entity.toUpperCase();
  return (
    e.includes("TYPE") ||
    e.includes("REL") ||
    e.includes("CLASSIFICATION") ||
    e.includes("GROUP") ||
    e.includes("PROPERTY") ||
    e.includes("QUANTITY") ||
    e.includes("MATERIAL") ||
    e.includes("PLACEMENT") ||
    e.includes("POINT") ||
    e.includes("DIRECTION") ||
    e.includes("UNIT") ||
    e.includes("GRID") ||
    e.includes("SHAPE") ||
    e.includes("SWEPT") ||
    e.includes("DIMENSION") ||
    e.includes("ADDRESS") ||
    e.includes("PRESENTATION") ||
    e.includes("ORGANIZATION") ||
    e.includes("APPLICATION") ||
    e.includes("PERSON") ||
    e.includes("ACTOR") ||
    e.includes("OWNER")
  );
};

export const extractMaterialValue = (itemAny: any): { matVal: string | null; hasMatRel: boolean } => {
  const assocs = itemAny.HasAssociations || [];
  let matNames: string[] = [];
  let hasMatRel = false;

  const extractNameFromObj = (obj: any): string | null => {
    if (!obj) return null;
    if (typeof obj === "string") {
      const s = obj.trim();
      return (s && s !== "Unnamed" && s !== "null" && s !== "undefined") ? s : null;
    }
    if (typeof obj === "object" && obj.value !== undefined) {
      return extractNameFromObj(obj.value);
    }

    // 1. Direct Name
    if (obj.Name) {
      const n = extractNameFromObj(obj.Name);
      if (n) return n;
    }

    // 2. LayerSet / ProfileSet / ConstituentSet Usage wrapper
    if (obj.ForLayerSet) {
      const n = extractNameFromObj(obj.ForLayerSet);
      if (n) return n;
    }
    if (obj.ForProfileSet) {
      const n = extractNameFromObj(obj.ForProfileSet);
      if (n) return n;
    }

    // 3. MaterialLayers (IfcMaterialLayerSet)
    if (Array.isArray(obj.MaterialLayers)) {
      const names: string[] = [];
      for (const layer of obj.MaterialLayers) {
        const n = extractNameFromObj(layer?.Material || layer);
        if (n && !names.includes(n)) names.push(n);
      }
      if (names.length > 0) return names.join(", ");
    }

    // 4. MaterialProfiles (IfcMaterialProfileSet)
    if (Array.isArray(obj.MaterialProfiles)) {
      const names: string[] = [];
      for (const prof of obj.MaterialProfiles) {
        const n = extractNameFromObj(prof?.Material || prof);
        if (n && !names.includes(n)) names.push(n);
      }
      if (names.length > 0) return names.join(", ");
    }

    // 5. MaterialConstituents (IfcMaterialConstituentSet)
    if (Array.isArray(obj.MaterialConstituents)) {
      const names: string[] = [];
      for (const consti of obj.MaterialConstituents) {
        const n = extractNameFromObj(consti?.Material || consti);
        if (n && !names.includes(n)) names.push(n);
      }
      if (names.length > 0) return names.join(", ");
    }

    // 6. Materials (IfcMaterialList)
    if (Array.isArray(obj.Materials)) {
      const names: string[] = [];
      for (const mat of obj.Materials) {
        const n = extractNameFromObj(mat);
        if (n && !names.includes(n)) names.push(n);
      }
      if (names.length > 0) return names.join(", ");
    }

    return null;
  };

  for (const rel of assocs) {
    let relCat = rel._category?.value ?? rel._category ?? "";
    if (relCat && typeof relCat === "string") relCat = relCat.toUpperCase();
    const matObj = rel.RelatingMaterial || (relCat.includes("MATERIAL") ? rel : null);

    if (matObj || relCat.includes("MATERIAL")) {
      hasMatRel = true;
      if (matObj) {
        const resolvedName = extractNameFromObj(matObj);
        if (resolvedName && !matNames.includes(resolvedName)) {
          matNames.push(resolvedName);
        }
      }
    }
  }

  const matVal = matNames.length > 0 ? matNames.join(" / ") : null;
  return { matVal, hasMatRel };
};

const extractStringVal = (val: any): string | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") {
    const s = val.trim();
    return (s && s !== "null" && s !== "undefined" && s !== "Unnamed") ? s : null;
  }
  if (typeof val === "number") return String(val);
  if (typeof val === "object" && val.value !== undefined) {
    return extractStringVal(val.value);
  }
  return null;
};

export const parseSingleClassification = (obj: any): { system: string | null; code: string | null; full: string | null } | null => {
  if (!obj || typeof obj !== "object") return null;

  let system: string | null = null;
  let code: string | null = null;

  // 1. Check Name or Description on relation object for "System:Code" pattern (e.g. "Uniformat:A1010130")
  const relName = extractStringVal(obj.Name) || extractStringVal(obj.Description);
  if (relName && relName.includes(":")) {
    const parts = relName.split(":");
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      system = parts[0].trim();
      code = parts[1].trim();
    }
  }

  // 2. Unwrap RelatingClassification if present
  let targetObj = obj.RelatingClassification && typeof obj.RelatingClassification === "object"
    ? obj.RelatingClassification
    : obj;

  let cat = extractStringVal(targetObj._category) || "";
  cat = cat.toUpperCase();

  // 3. Extract Code & System from classification reference / classification object
  if (cat.includes("CLASSIFICATIONREFERENCE") || targetObj.ReferencedSource || targetObj.ItemReference || targetObj.Identification) {
    const extractedCode = extractStringVal(targetObj.ItemReference) ||
                          extractStringVal(targetObj.Identification) ||
                          extractStringVal(targetObj.Location) ||
                          (targetObj.Name && (!relName || !relName.includes(":")) ? extractStringVal(targetObj.Name) : null);
    if (extractedCode) code = extractedCode;

    let source = targetObj.ReferencedSource || targetObj.Source;
    if (source) {
      if (typeof source === "object") {
        let sourceCat = extractStringVal(source._category) || "";
        if (sourceCat.toUpperCase().includes("CLASSIFICATIONREFERENCE")) {
          const parentParsed = parseSingleClassification(source);
          if (parentParsed?.system) system = parentParsed.system;
          if (parentParsed?.code && !code) code = parentParsed.code;
        } else {
          const extractedSys = extractStringVal(source.Name) || extractStringVal(source.Source) || extractStringVal(source.Edition);
          if (extractedSys) system = extractedSys;
        }
      } else if (typeof source === "string") {
        system = source;
      }
    }
  } else if (cat.includes("CLASSIFICATION") || targetObj.Edition || targetObj.Source) {
    const extractedSys = extractStringVal(targetObj.Name) || extractStringVal(targetObj.Source) || extractStringVal(targetObj.Edition);
    if (extractedSys) system = extractedSys;
    const extractedCode = extractStringVal(targetObj.ItemReference) || extractStringVal(targetObj.Identification);
    if (extractedCode) code = extractedCode;
  } else if (!code && !system) {
    const fallbackName = extractStringVal(targetObj.Name) || relName;
    if (fallbackName && fallbackName.includes(":")) {
      const parts = fallbackName.split(":");
      system = parts[0].trim();
      code = parts[1].trim();
    } else if (fallbackName) {
      code = fallbackName;
    }
  }

  if (!system && !code) return null;

  let full: string | null = null;
  if (system && code) full = `${system}: ${code}`;
  else if (code) full = code;
  else if (system) full = system;

  return { system, code, full };
};

const parseStepArgs = (str: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let inParen = 0;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "'" && (i === 0 || str[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
    } else if (c === "(" && !inQuotes) {
      inParen++;
    } else if (c === ")" && !inQuotes) {
      inParen--;
    } else if (c === "," && !inQuotes && inParen === 0) {
      result.push(cleanArg(current));
      current = "";
      continue;
    }
    current += c;
  }
  if (current.length > 0) {
    result.push(cleanArg(current));
  }
  return result;
};

const cleanArg = (val: string): string => {
  val = val.trim();
  if (val === "$") return "";
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.substring(1, val.length - 1);
  }
  return val;
};

export const parseIfcStepClassifications = (
  ifcText: string
): Map<number, { system: string | null; code: string | null; full: string | null }> => {
  const map = new Map<number, { system: string | null; code: string | null; full: string | null }>();
  const classRefMap = new Map<number, { system: string | null; code: string | null; name: string | null }>();
  const classMap = new Map<number, string>(); // id -> system name

  // 1. Parse IFCCLASSIFICATION
  const classRegex = /#(\d+)\s*=\s*IFCCLASSIFICATION\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(ifcText)) !== null) {
    const id = parseInt(match[1], 10);
    const argsStr = match[2];
    const args = parseStepArgs(argsStr);
    const systemName = args[3] || args[0] || args[4] || null;
    if (systemName) classMap.set(id, systemName);
  }

  // 2. Parse IFCCLASSIFICATIONREFERENCE
  const refRegex = /#(\d+)\s*=\s*IFCCLASSIFICATIONREFERENCE\s*\(([\s\S]*?)\);/gi;
  while ((match = refRegex.exec(ifcText)) !== null) {
    const id = parseInt(match[1], 10);
    const argsStr = match[2];
    const args = parseStepArgs(argsStr);
    const code = args[1] || null;
    let system = args[2] || null;
    const parentRef = args[3];
    if (!system && parentRef && parentRef.startsWith("#")) {
      const parentId = parseInt(parentRef.substring(1), 10);
      if (classMap.has(parentId)) system = classMap.get(parentId)!;
    }
    const name = args[4] || null;
    classRefMap.set(id, { system, code: code || name, name });
  }

  // 3. Parse IFCRELASSOCIATESCLASSIFICATION
  const relRegex = /#(\d+)\s*=\s*IFCRELASSOCIATESCLASSIFICATION\s*\(([\s\S]*?)\);/gi;
  while ((match = relRegex.exec(ifcText)) !== null) {
    const argsStr = match[2];
    const args = parseStepArgs(argsStr);
    const relName = args[2] || null; // 'Uniformat:A1010130'
    const relatedStr = args[4] || ""; // '(#35549,#35646,...)'
    const relatingClassStr = args[5] || ""; // '#35569'

    let system: string | null = null;
    let code: string | null = null;

    if (relatingClassStr && relatingClassStr.startsWith("#")) {
      const classId = parseInt(relatingClassStr.substring(1), 10);
      if (classRefMap.has(classId)) {
        const ref = classRefMap.get(classId)!;
        system = ref.system;
        code = ref.code || ref.name;
      } else if (classMap.has(classId)) {
        system = classMap.get(classId)!;
      }
    }

    if (relName && (!system || !code)) {
      if (relName.includes(":")) {
        const parts = relName.split(":");
        if (!system) system = parts[0].trim();
        if (!code) code = parts[1].trim();
      } else {
        if (!code) code = relName.trim();
      }
    }

    let full: string | null = null;
    if (system && code) full = `${system}: ${code}`;
    else if (code) full = code;
    else if (system) full = system;

    const parsed = { system, code, full };

    // Extract all related Express IDs
    const idMatches = relatedStr.matchAll(/#?(\d+)/g);
    for (const m of idMatches) {
      const expressId = parseInt(m[1], 10);
      if (!isNaN(expressId)) {
        map.set(expressId, parsed);
      }
    }
  }

  return map;
};

const stepClassificationCache = new Map<string, Map<number, { system: string | null; code: string | null; full: string | null }>>();

export const buildModelClassificationMap = async (
  _components: any,
  model: any
): Promise<Map<number, { system: string | null; code: string | null; full: string | null }>> => {
  const modelKey = (model as any).uuid || (model as any).name || String((model as any).dbId || "default");
  if (stepClassificationCache.has(modelKey)) {
    return stepClassificationCache.get(modelKey)!;
  }

  const map = new Map<number, { system: string | null; code: string | null; full: string | null }>();

  try {
    const sharedIFC = new SharedIFC();
    let ifcData: { name: string; content: Uint8Array } | null = null;

    const dbId = (model as any).dbId || sharedIFC.getIfcIdByModelUUID((model as any).uuid) || sharedIFC.getIfcIdByModelUUID((model as any).modelId);
    if (dbId) {
      ifcData = await sharedIFC.loadIFC(dbId);
    }

    if (!ifcData) {
      await sharedIFC.loadIFCFiles();
      const matched = sharedIFC.list.find(f => f.name === (model as any).name || (model as any).name?.includes(f.name));
      if (matched) {
        ifcData = await sharedIFC.loadIFC(matched.id);
      }
    }

    if (ifcData && ifcData.content) {
      const text = new TextDecoder().decode(ifcData.content);
      const parsedMap = parseIfcStepClassifications(text);
      for (const [k, v] of parsedMap.entries()) {
        map.set(k, v);
      }
      stepClassificationCache.set(modelKey, map);
      return map;
    }
  } catch (err) {
    console.warn("[RuleService] STEP Classification parser warning:", err);
  }

  return map;
};

export const extractClassificationValue = (
  itemAny: any,
  classificationMap?: Map<number, { system: string | null; code: string | null; full: string | null }>,
  expressId?: number
): { classVal: string | null; systemVal: string | null; codeVal: string | null; hasClassRel: boolean } => {
  // 1. Check forward classification map from IFCRELASSOCIATESCLASSIFICATION first
  if (classificationMap && expressId !== undefined && classificationMap.has(expressId)) {
    const mapped = classificationMap.get(expressId)!;
    return {
      classVal: mapped.full,
      systemVal: mapped.system,
      codeVal: mapped.code,
      hasClassRel: true,
    };
  }

  const assocs: any[] = [];

  // 2. Instance level associations
  if (Array.isArray(itemAny.HasAssociations)) {
    assocs.push(...itemAny.HasAssociations);
  } else if (itemAny.HasAssociations) {
    assocs.push(itemAny.HasAssociations);
  }

  // 3. Type level associations (inherited via IsTypedBy)
  if (itemAny.IsTypedBy) {
    const types = Array.isArray(itemAny.IsTypedBy) ? itemAny.IsTypedBy : [itemAny.IsTypedBy];
    for (const rel of types) {
      const typeObj = rel?.RelatingType || rel;
      if (typeObj && typeObj.HasAssociations) {
        const typeAssocs = Array.isArray(typeObj.HasAssociations) ? typeObj.HasAssociations : [typeObj.HasAssociations];
        assocs.push(...typeAssocs);
      }
    }
  }

  let classVal: string | null = null;
  let systemVal: string | null = null;
  let codeVal: string | null = null;
  let hasClassRel = false;
  const classList: string[] = [];

  for (const rel of assocs) {
    if (!rel) continue;
    let relCat = extractStringVal(rel._category) || "";
    relCat = relCat.toUpperCase();

    const isClassRel = relCat.includes("CLASSIFICATION") || rel.RelatingClassification || rel.ReferencedSource || rel.ItemReference || rel.Identification;
    if (isClassRel) {
      hasClassRel = true;
      const parsed = parseSingleClassification(rel);
      if (parsed) {
        if (!systemVal && parsed.system) systemVal = parsed.system;
        if (!codeVal && parsed.code) codeVal = parsed.code;
        if (parsed.full && !classList.includes(parsed.full)) {
          classList.push(parsed.full);
        }
      }
    }
  }

  if (classList.length > 0) {
    classVal = classList.join(" / ");
  }

  return { classVal, systemVal, codeVal, hasClassRel };
};

export const extractParentInfo = (
  itemAny: any,
  modelRelations?: ModelRelationData,
  expressId?: number
): { parentCategories: string[]; parentNames: string[] } => {
  const parentCategories: string[] = [];
  const parentNames: string[] = [];
  const rels = [
    ...(Array.isArray(itemAny.ContainedInStructure) ? itemAny.ContainedInStructure : itemAny.ContainedInStructure ? [itemAny.ContainedInStructure] : []),
    ...(Array.isArray(itemAny.Decomposes) ? itemAny.Decomposes : itemAny.Decomposes ? [itemAny.Decomposes] : []),
  ];

  for (const rel of rels) {
    if (!rel) continue;
    const parent = rel.RelatingStructure || rel.RelatingObject || rel.RelatingElement || rel;
    if (!parent) continue;

    let parentCategory = parent._category?.value ?? parent._category ?? rel._category?.value ?? rel._category ?? "";
    if (parentCategory && typeof parentCategory === "string") {
      parentCategory = parentCategory.replace(/^IFC/i, "").toUpperCase();
      if (parentCategory) parentCategories.push(parentCategory);
    }

    let parentName = parent.Name?.value ?? parent.Name ?? parent.LongName?.value ?? parent.LongName ?? parent.ObjectType?.value ?? parent.ObjectType ?? "";
    if (parentName && typeof parentName === "object" && parentName.value) {
      parentName = String(parentName.value);
    }
    parentName = String(parentName || "").trim();
    if (parentName) parentNames.push(parentName);
  }

  // 3. Extended relations from STEP (Voids, Fills, SpatialZone)
  if (modelRelations && expressId !== undefined) {
    // Check if item is a filling element (e.g. Door/Window) filling an Opening
    const openingId = modelRelations.fillingToOpening.get(expressId);
    if (openingId !== undefined) {
      if (!parentCategories.includes("OPENINGELEMENT")) {
        parentCategories.push("OPENINGELEMENT");
      }
      const opData = modelRelations.openings.get(openingId);
      if (opData?.name && !parentNames.includes(opData.name)) {
        parentNames.push(opData.name);
      }

      // Also get the Wall/Slab that owns the opening
      const parentBuildingElemId = modelRelations.openingToParent.get(openingId);
      if (parentBuildingElemId !== undefined) {
        if (!parentCategories.includes("BUILDINGELEMENT")) {
          parentCategories.push("BUILDINGELEMENT");
        }
      }
    }

    // Check if item is an OpeningElement voiding a Wall/Slab
    const parentElemId = modelRelations.openingToParent.get(expressId);
    if (parentElemId !== undefined) {
      if (!parentCategories.includes("BUILDINGELEMENT")) {
        parentCategories.push("BUILDINGELEMENT");
      }
    }

    // Check if item is referenced in any SpatialZone
    const zoneIds = modelRelations.elementToZones.get(expressId);
    if (zoneIds && zoneIds.length > 0) {
      if (!parentCategories.includes("SPATIALZONE")) {
        parentCategories.push("SPATIALZONE");
      }
      for (const zid of zoneIds) {
        const zoneData = modelRelations.spatialZones.get(zid);
        if (zoneData) {
          const zName = zoneData.name || zoneData.longName || zoneData.objectType;
          if (zName && !parentNames.includes(zName)) {
            parentNames.push(zName);
          }
        }
      }
    }
  }

  return { parentCategories, parentNames };
};

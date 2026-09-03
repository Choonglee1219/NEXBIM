/**
 * georef-defense.ts
 *
 * Provides defense logic against large global coordinates injected into IfcSite.ObjectPlacement
 * (e.g. legacy IFC2x3 Solibri-style world coordinates, or dual georeferencing where both
 * IfcMapConversion and IfcSite.ObjectPlacement contain CRS Eastings/Northings).
 *
 * When large coordinates are present in IfcSite.ObjectPlacement, WebGL 32-bit floating point precision
 * causes mesh jittering, camera FitToView failure, and misalignment with GIS map tiles.
 *
 * This module safely parses the raw IFC STEP buffer:
 * 1. If hierarchical placement (PlacementRelTo != $) is present:
 *    - Detaches parent PlacementRelTo (sets it to $) to strip the 634km global offset
 *    - Preserves child RelativePlacement (the original local coordinates & rotation) 100%!
 * 2. If flat placement (PlacementRelTo == $) has massive global coordinates (> 50km or matching IfcMapConversion):
 *    - Resets Location to (0,0,0) and Axis/RefDirection to $ (null)
 * 3. Extracts legacy georeferencing (IfcSite.ObjectPlacement, TrueNorth, RefLatitude/RefLongitude)
 *    when IfcMapConversion is absent, enabling GIS map basemap overlay for legacy IFC models!
 */

export interface LegacySiteGeoref {
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  latitude?: number;
  longitude?: number;
  hasDMS: boolean;
}

export interface NormalizedPlacementResult {
  buffer: Uint8Array;
  siteOffset: [number, number, number] | null;
  wasModified: boolean;
  hasMapConversion: boolean;
  legacySiteGeoref?: LegacySiteGeoref | null;
}

/**
 * Parses DMS (Degrees, Minutes, Seconds, Microseconds) format from IfcCompoundPlaneAngleMeasure
 * e.g. "(49, 5, 30, 324859)" into decimal degrees.
 */
export function parseDmsToDecimal(dmsStr: string | undefined): number | null {
  if (!dmsStr || dmsStr === "$") return null;
  const matches = dmsStr.match(/[-\d.]+/g);
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) {
    const val = parseFloat(matches[0]);
    return isNaN(val) ? null : val;
  }
  const d = parseFloat(matches[0]);
  const m = parseFloat(matches[1] || "0");
  const s = parseFloat(matches[2] || "0");
  const us = parseFloat(matches[3] || "0");

  const sign = d < 0 ? -1 : 1;
  const deg = Math.abs(d);
  const min = Math.abs(m);
  const sec = Math.abs(s) + Math.abs(us) / 1e6;
  return sign * (deg + min / 60 + sec / 3600);
}

/**
 * Tokenizes comma-separated STEP parameters while respecting single quotes and nested parentheses.
 */
export function parseStepArguments(paramStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let parenDepth = 0;

  for (let i = 0; i < paramStr.length; i++) {
    const ch = paramStr[i];
    if (ch === "'" && (i === 0 || paramStr[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
      current += ch;
    } else if (!inQuotes && (ch === "(" || ch === "[")) {
      parenDepth++;
      current += ch;
    } else if (!inQuotes && (ch === ")" || ch === "]")) {
      parenDepth--;
      current += ch;
    } else if (!inQuotes && parenDepth === 0 && ch === ",") {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    args.push(current.trim());
  }
  return args;
}

/**
 * Helper to extract 2D direction ratios (cos, sin) from an IFCDIRECTION entity ID
 */
function parseDirectionRatios(text: string, dirId: string): [number, number] | null {
  const dirRegex = new RegExp(`#${dirId}\\s*=\\s*IFCDIRECTION\\s*\\(\\s*\\(([^)]+)\\)\\s*\\)\\s*;`, "i");
  const dirMatch = text.match(dirRegex);
  if (!dirMatch) return null;
  const tokens = dirMatch[1].split(",").map((s) => parseFloat(s.trim()));
  if (tokens.length >= 2 && !isNaN(tokens[0]) && !isNaN(tokens[1])) {
    const len = Math.sqrt(tokens[0] * tokens[0] + tokens[1] * tokens[1]);
    if (len > 0) {
      return [tokens[0] / len, tokens[1] / len];
    }
    return [tokens[0], tokens[1]];
  }
  return null;
}

/**
 * Inspects the IFC buffer and normalizes IfcSite.ObjectPlacement for 3D viewer rendering,
 * while extracting legacy georeference data if IfcMapConversion is absent.
 */
export function normalizeIfcSitePlacement(buffer: Uint8Array): NormalizedPlacementResult {
  let text = new TextDecoder().decode(buffer);

  // Parse IfcMapConversion if present
  const mcMatch = text.match(/#\d+\s*=\s*IFCMAPCONVERSION\s*\(([^;]+)\)\s*;/i);
  let hasMapConversion = false;
  let mcEastings: number | null = null;
  let mcNorthings: number | null = null;

  if (mcMatch) {
    hasMapConversion = true;
    const mcArgs = parseStepArguments(mcMatch[1]);
    if (mcArgs.length >= 4) {
      mcEastings = parseFloat(mcArgs[2]);
      mcNorthings = parseFloat(mcArgs[3]);
    }
  }

  // Detect project length unit scale (e.g. MILLI METRE -> 0.001, CENTI METRE -> 0.01, METRE -> 1.0)
  let projectUnitScale = 1.0;
  if (text.includes(".MILLI.") && text.includes(".METRE.")) {
    projectUnitScale = 0.001;
  } else if (text.includes(".CENTI.") && text.includes(".METRE.")) {
    projectUnitScale = 0.01;
  }

  // Parse TrueNorth from IFCGEOMETRICREPRESENTATIONCONTEXT if present
  let trueNorthVector: [number, number] | null = null;
  const ctxRegex = /#\d+\s*=\s*IFCGEOMETRICREPRESENTATIONCONTEXT\s*\(([^;]+)\)\s*;/gi;
  let ctxMatch: RegExpExecArray | null;
  while ((ctxMatch = ctxRegex.exec(text)) !== null) {
    const ctxArgs = parseStepArguments(ctxMatch[1]);
    // Parameter 6 (0-indexed: 5) is TrueNorth
    if (ctxArgs.length >= 6 && ctxArgs[5] && ctxArgs[5] !== "$") {
      const tnIdMatch = ctxArgs[5].match(/#(\d+)/);
      if (tnIdMatch) {
        const tnRes = parseDirectionRatios(text, tnIdMatch[1]);
        if (tnRes) {
          trueNorthVector = tnRes;
          break;
        }
      }
    }
  }

  // Find all IFCSITE entities: #ID = IFCSITE(...)
  const siteRegex = /#(\d+)\s*=\s*IFCSITE\s*\(([^;]+)\)\s*;/gi;
  let siteMatch: RegExpExecArray | null;
  let wasModified = false;
  let primarySiteOffset: [number, number, number] | null = null;
  let detectedLegacyGeoref: LegacySiteGeoref | null = null;

  while ((siteMatch = siteRegex.exec(text)) !== null) {
    const siteId = siteMatch[1];
    const siteArgs = parseStepArguments(siteMatch[2]);
    if (siteArgs.length < 6) continue;

    // Check IfcSite WGS84 RefLatitude / RefLongitude / RefElevation
    // Parameter 10 (idx 9): RefLatitude, Parameter 11 (idx 10): RefLongitude, Parameter 12 (idx 11): RefElevation
    let siteLat: number | null = null;
    let siteLon: number | null = null;
    let siteRefElevation: number | null = null;

    if (siteArgs.length >= 11) {
      siteLat = parseDmsToDecimal(siteArgs[9]);
      siteLon = parseDmsToDecimal(siteArgs[10]);
    }
    if (siteArgs.length >= 12 && siteArgs[11] && siteArgs[11] !== "$") {
      siteRefElevation = parseFloat(siteArgs[11]) || 0;
    }

    const placementRef = siteArgs[5]; // Parameter 6: ObjectPlacement
    const placementIdMatch = placementRef.match(/#(\d+)/);
    if (!placementIdMatch) continue;
    const placementId = placementIdMatch[1];

    // Find IFCLOCALPLACEMENT: #ID = IFCLOCALPLACEMENT(...)
    const lpRegex = new RegExp(`(#${placementId}\\s*=\\s*IFCLOCALPLACEMENT\\s*\\()([^;]+)(\\)\\s*;)`, "i");
    const lpMatch = text.match(lpRegex);
    if (!lpMatch) continue;
    const lpArgs = parseStepArguments(lpMatch[2]);
    if (lpArgs.length < 2) continue;

    const parentRelRef = lpArgs[0].trim(); // Parameter 1: PlacementRelTo
    const axis2Ref = lpArgs[1].trim();     // Parameter 2: RelativePlacement

    // ── Case A: Hierarchical Placement (PlacementRelTo is not '$') ─────────
    // If PlacementRelTo exists and parent has georeference / large coordinates:
    // Detach parent by setting PlacementRelTo = $, preserving child RelativePlacement 100%!
    if (parentRelRef !== "$") {
      const parentIdMatch = parentRelRef.match(/#(\d+)/);
      if (parentIdMatch) {
        const parentId = parentIdMatch[1];
        let parentIsGeo = hasMapConversion;
        let parentCoords: [number, number, number] | null = null;
        let parentDir: [number, number] | null = null;

        const parentLpRegex = new RegExp(`#${parentId}\\s*=\\s*IFCLOCALPLACEMENT\\s*\\(([^;]+)\\)\\s*;`, "i");
        const parentLpMatch = text.match(parentLpRegex);
        if (parentLpMatch) {
          const parentArgs = parseStepArguments(parentLpMatch[1]);
          if (parentArgs.length >= 2) {
            const pAxisMatch = parentArgs[1].match(/#(\d+)/);
            if (pAxisMatch) {
              const pAxisRegex = new RegExp(`#${pAxisMatch[1]}\\s*=\\s*IFCAXIS2PLACEMENT3D\\s*\\(([^;]+)\\)\\s*;`, "i");
              const pAxisRes = text.match(pAxisRegex);
              if (pAxisRes) {
                const pAxisArgs = parseStepArguments(pAxisRes[1]);
                const pPointMatch = pAxisArgs[0]?.match(/#(\d+)/);
                if (pPointMatch) {
                  const pPointRegex = new RegExp(`#${pPointMatch[1]}\\s*=\\s*IFCCARTESIANPOINT\\s*\\(\\s*\\(([^)]+)\\)\\s*\\)\\s*;`, "i");
                  const pPointRes = text.match(pPointRegex);
                  if (pPointRes) {
                    const tokens = pPointRes[1].split(",").map((s) => parseFloat(s.trim()));
                    let pX_m = (tokens[0] || 0) * projectUnitScale;
                    let pY_m = (tokens[1] || 0) * projectUnitScale;
                    let pZ_m = (tokens[2] || 0) * projectUnitScale;
                    const isMm = Math.abs(pX_m) > 10_000_000 || Math.abs(pY_m) > 10_000_000 || Math.abs(pZ_m) > 10_000;
                    if (isMm) {
                      if (Math.abs(pX_m) > 10_000_000) pX_m /= 1000;
                      if (Math.abs(pY_m) > 10_000_000) pY_m /= 1000;
                      if (Math.abs(pZ_m) > 10_000) pZ_m /= 1000;
                    }
                    parentCoords = [pX_m, pY_m, pZ_m];

                    if (Math.abs(pX_m) > 100000 || Math.abs(pY_m) > 100000) {
                      parentIsGeo = true;
                    }
                  }
                }
                // Parameter 3: RefDirection
                if (pAxisArgs.length >= 3 && pAxisArgs[2] && pAxisArgs[2] !== "$") {
                  const pDirMatch = pAxisArgs[2].match(/#(\d+)/);
                  if (pDirMatch) {
                    parentDir = parseDirectionRatios(text, pDirMatch[1]);
                  }
                }
              }
            }
          }
        }

        if (parentIsGeo) {
          console.log(
            `[GeorefDefense] Hierarchical placement detected on IfcSite #${siteId}. Detaching parent georef #${parentId} -> setting PlacementRelTo to $. Preserving local RelativePlacement ${axis2Ref}!`
          );
          const newLpContent = `${lpMatch[1]}$,${axis2Ref}${lpMatch[3]}`;
          text = text.replace(lpRegex, newLpContent);
          wasModified = true;

          // Record parent as legacy georeference if large global coordinates (> 100km) exist
          if (parentCoords && !detectedLegacyGeoref && (Math.abs(parentCoords[0]) > 100000 || Math.abs(parentCoords[1]) > 100000)) {
            const rot = parentDir || trueNorthVector || [1.0, 0.0];
            detectedLegacyGeoref = {
              eastings: parentCoords[0],
              northings: parentCoords[1],
              orthogonalHeight: parentCoords[2] !== 0 ? parentCoords[2] : (siteRefElevation !== null ? siteRefElevation * projectUnitScale : 0),
              xAxisAbscissa: rot[0],
              xAxisOrdinate: rot[1],
              latitude: siteLat ?? undefined,
              longitude: siteLon ?? undefined,
              hasDMS: siteLat !== null && siteLon !== null,
            };
          }

          continue; // Done for this site! Local RelativePlacement is 100% preserved!
        }
      }
    }

    // ── Case B: Flat Placement (PlacementRelTo is '$') ──────────────────────
    const axis2IdMatch = axis2Ref.match(/#(\d+)/);
    if (!axis2IdMatch) continue;
    const axis2Id = axis2IdMatch[1];

    // Find IFCAXIS2PLACEMENT3D: #ID = IFCAXIS2PLACEMENT3D(...)
    const axisRegex = new RegExp(`#${axis2Id}\\s*=\\s*IFCAXIS2PLACEMENT3D\\s*\\(([^;]+)\\)\\s*;`, "i");
    const axisMatch = text.match(axisRegex);
    if (!axisMatch) continue;
    const axisArgs = parseStepArguments(axisMatch[1]);
    if (axisArgs.length < 1) continue;

    const pointRef = axisArgs[0]; // Parameter 1: Location
    const pointIdMatch = pointRef.match(/#(\d+)/);
    if (!pointIdMatch) continue;
    const pointId = pointIdMatch[1];

    // Find IFCCARTESIANPOINT: #ID = IFCCARTESIANPOINT(((x, y, z)))
    const pointRegex = new RegExp(`(#${pointId}\\s*=\\s*IFCCARTESIANPOINT\\s*\\(\\s*\\()([^)]+)(\\)\\s*\\)\\s*;)`, "i");
    const pointMatch = text.match(pointRegex);
    if (!pointMatch) continue;

    const coordTokens = pointMatch[2].split(",").map((s) => parseFloat(s.trim()));
    const siteOffset: [number, number, number] = [
      isNaN(coordTokens[0]) ? 0 : coordTokens[0],
      isNaN(coordTokens[1]) ? 0 : coordTokens[1],
      isNaN(coordTokens[2]) ? 0 : coordTokens[2],
    ];

    if (!primarySiteOffset) {
      primarySiteOffset = siteOffset;
    }

    // Convert coordinates to meters using project length scale
    let x_meters = siteOffset[0] * projectUnitScale;
    let y_meters = siteOffset[1] * projectUnitScale;
    let z_meters = siteOffset[2] * projectUnitScale;
    const isMm = Math.abs(x_meters) > 10_000_000 || Math.abs(y_meters) > 10_000_000 || Math.abs(z_meters) > 10_000;
    if (isMm) {
      if (Math.abs(x_meters) > 10_000_000) x_meters /= 1000;
      if (Math.abs(y_meters) > 10_000_000) y_meters /= 1000;
      if (Math.abs(z_meters) > 10_000) z_meters /= 1000;
    }

    // Extract RefDirection if present
    let refDir: [number, number] | null = null;
    if (axisArgs.length >= 3 && axisArgs[2] && axisArgs[2] !== "$") {
      const dirMatch = axisArgs[2].match(/#(\d+)/);
      if (dirMatch) {
        refDir = parseDirectionRatios(text, dirMatch[1]);
      }
    }
    const finalRot = refDir || trueNorthVector || [1.0, 0.0];

    // Check 1: Is this a giant global coordinate (> 100,000 meters / 100 km)?
    const isGiantGlobal = Math.abs(x_meters) > 100000 || Math.abs(y_meters) > 100000;

    // Check 2: Does this coordinate match IfcMapConversion Eastings/Northings within 5 meters?
    let isDuplicatedMapConversion = false;
    if (hasMapConversion && mcEastings !== null && mcNorthings !== null && projectUnitScale > 0) {
      const expectedX = mcEastings / projectUnitScale;
      const expectedY = mcNorthings / projectUnitScale;
      if (Math.abs(siteOffset[0] - expectedX) < 5000 && Math.abs(siteOffset[1] - expectedY) < 5000) {
        isDuplicatedMapConversion = true;
      }
    }

    const shouldNormalize = isGiantGlobal || isDuplicatedMapConversion;

    // Record this legacy IfcSite georeference if large global coordinates (> 100km) exist
    if (!detectedLegacyGeoref) {
      if (Math.abs(x_meters) > 100000 || Math.abs(y_meters) > 100000) {
        detectedLegacyGeoref = {
          eastings: x_meters,
          northings: y_meters,
          orthogonalHeight: z_meters !== 0 ? z_meters : (siteRefElevation !== null ? siteRefElevation * projectUnitScale : 0),
          xAxisAbscissa: finalRot[0],
          xAxisOrdinate: finalRot[1],
          latitude: siteLat ?? undefined,
          longitude: siteLon ?? undefined,
          hasDMS: siteLat !== null && siteLon !== null,
        };
      }
    }

    if (shouldNormalize) {
      console.log(
        `[GeorefDefense] Global coordinate detected on IfcSite #${siteId} [${siteOffset.join(
          ", "
        )}] (${x_meters.toFixed(1)}m, ${y_meters.toFixed(1)}m). Normalizing mesh origin -> (0,0,0) and preserving orientation.`
      );

      // 1. Reset Location to (0.,0.,0.) so raw mesh vertices have zero WebGL float32 jitter
      const pointReplacement = `${pointMatch[1]}0.,0.,0.${pointMatch[3]}`;
      text = text.replace(pointRegex, pointReplacement);

      // 2. Axis and RefDirection in IfcAxis2Placement3D are preserved 100% UNTOUCHED!
      wasModified = true;
    } else {
      console.log(
        `[GeorefDefense] IfcSite #${siteId} has valid local coordinates [${siteOffset.join(
          ", "
        )}] (${x_meters.toFixed(2)}m, ${y_meters.toFixed(2)}m). Keeping local placement and orientation 100% UNTOUCHED!`
      );
    }
  }

  return {
    buffer: wasModified ? new TextEncoder().encode(text) : buffer,
    siteOffset: primarySiteOffset,
    wasModified,
    hasMapConversion,
    legacySiteGeoref: detectedLegacyGeoref,
  };
}

import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { setModelTransparent } from "../../../ui-templates/toolbars/viewer-toolbar";
import { RuleTableData } from "./types";
import { groupResultsBy } from "./data-extractor";

// Standard IFC4 ADD2 TC1 Enum definitions for PredefinedType (buildingSMART Official)
const PREDEFINED_TYPES: Record<string, Set<string>> = {
  // Architectural & Building Elements
  WALL: new Set(["MOVABLE", "PARAPET", "PARTITIONING", "PLUMBINGWALL", "SHEAR", "SOLIDWALL", "STANDARD", "POLYGONAL", "ELEMENTEDWALL", "USERDEFINED", "NOTDEFINED"]),
  DOOR: new Set(["DOOR", "GATE", "TRAPDOOR", "USERDEFINED", "NOTDEFINED"]),
  WINDOW: new Set(["WINDOW", "SKYLIGHT", "LIGHTDOME", "USERDEFINED", "NOTDEFINED"]),
  SLAB: new Set(["FLOOR", "ROOF", "LANDING", "BASESLAB", "USERDEFINED", "NOTDEFINED"]),
  BEAM: new Set(["BEAM", "JOIST", "HOLLOWCORE", "LINTEL", "SPANDREL", "T_BEAM", "USERDEFINED", "NOTDEFINED"]),
  COLUMN: new Set(["COLUMN", "PILASTER", "USERDEFINED", "NOTDEFINED"]),
  COVERING: new Set(["CEILING", "FLOORING", "CLADDING", "ROOFING", "MOLDING", "SKIRTINGBOARD", "INSULATION", "MEMBRANE", "SLEEVING", "WRAPPING", "USERDEFINED", "NOTDEFINED"]),
  MEMBER: new Set(["BRACE", "CHORD", "COLLAR", "MEMBER", "MULLION", "PLATE", "POST", "PURLIN", "RAFTER", "STRINGER", "STRUT", "STUD", "USERDEFINED", "NOTDEFINED"]),
  CURTAINWALL: new Set(["USERDEFINED", "NOTDEFINED"]),
  RAMP: new Set(["STRAIGHT_RUN_RAMP", "TWO_STRAIGHT_RUN_RAMP", "QUARTER_TURN_RAMP", "TWO_QUARTER_TURN_RAMP", "HALF_TURN_RAMP", "SPIRAL_RAMP", "USERDEFINED", "NOTDEFINED"]),
  RAMPFLIGHT: new Set(["STRAIGHT", "SPIRAL", "USERDEFINED", "NOTDEFINED"]),
  STAIR: new Set(["STRAIGHT_RUN_STAIR", "TWO_STRAIGHT_RUN_STAIR", "QUARTER_WINDING_STAIR", "QUARTER_TURN_STAIR", "HALF_WINDING_STAIR", "HALF_TURN_STAIR", "TWO_QUARTER_WINDING_STAIR", "TWO_QUARTER_TURN_STAIR", "THREE_QUARTER_WINDING_STAIR", "THREE_QUARTER_TURN_STAIR", "SPIRAL_STAIR", "DOUBLE_RETURN_STAIR", "CURVED_RUN_STAIR", "TWO_CURVED_RUN_STAIR", "USERDEFINED", "NOTDEFINED"]),
  STAIRFLIGHT: new Set(["STRAIGHT", "WINDER", "SPIRAL", "CURVED", "FREEFORM", "USERDEFINED", "NOTDEFINED"]),
  ROOF: new Set(["FLAT_ROOF", "SHED_ROOF", "GABLE_ROOF", "HIP_ROOF", "HIPPED_GABLE_ROOF", "GAMBREL_ROOF", "MANSARD_ROOF", "BARREL_ROOF", "BUTTERFLY_ROOF", "PAVILION_ROOF", "DOME_ROOF", "FREEFORM", "USERDEFINED", "NOTDEFINED"]),
  RAILING: new Set(["HANDRAIL", "GUARDRAIL", "BALUSTRADE", "USERDEFINED", "NOTDEFINED"]),
  PLATE: new Set(["CURTAIN_PANEL", "SHEET", "USERDEFINED", "NOTDEFINED"]),
  CHIMNEY: new Set(["USERDEFINED", "NOTDEFINED"]),
  SHADINGDEVICE: new Set(["JALOUSIE", "SHUTTER", "AWNING", "USERDEFINED", "NOTDEFINED"]),
  OPENINGELEMENT: new Set(["OPENING", "RECESS", "USERDEFINED", "NOTDEFINED"]),
  VOIDINGFEATURE: new Set(["CUTOUT", "NOTCH", "HOLE", "MITRE", "CHAMFER", "EDGE", "USERDEFINED", "NOTDEFINED"]),

  // Structural Foundations & Piles
  FOOTING: new Set(["CAISSON_FOUNDATION", "FOOTING_BEAM", "PAD_FOOTING", "STRIP_FOOTING", "USERDEFINED", "NOTDEFINED"]),
  PILE: new Set(["BORED", "DRIVEN", "JETGROUTING", "COHESION", "FRICTION", "SUPPORT", "USERDEFINED", "NOTDEFINED"]),

  // Product Extension
  SPACE: new Set(["SPACE", "PARKING", "GFA", "INTERNAL", "EXTERNAL", "USERDEFINED", "NOTDEFINED"]),
  SPATIALZONE: new Set(["CONSTRUCTION", "FIRESAFETY", "LIGHTING", "OCCUPANCY", "SECURITY", "THERMAL", "TRANSPORT", "VENTILATION", "USERDEFINED", "NOTDEFINED"]),
  ZONE: new Set(["USERDEFINED", "NOTDEFINED"]),
  ELEMENTASSEMBLY: new Set(["ACCESSORY_ASSEMBLY", "ARCH", "BEAM_GRID", "BRACED_FRAME", "GIRDER", "REINFORCEMENT_UNIT", "RAGID_FRAME", "SLAB_FIELD", "TRUSS", "USERDEFINED", "NOTDEFINED"]),

  // Furnishing, Proxies & Element Components
  FURNISHINGELEMENT: new Set(["USERDEFINED", "NOTDEFINED"]),
  FURNITURE: new Set(["CHAIR", "TABLE", "DESK", "BED", "FILECABINET", "SHELF", "SOFA", "USERDEFINED", "NOTDEFINED"]),
  SYSTEMFURNITUREELEMENT: new Set(["PANEL", "WORKSURFACE", "USERDEFINED", "NOTDEFINED"]),
  BUILDINGELEMENTPROXY: new Set(["COMPLEX", "ELEMENT", "PARTIAL", "PROVISIONFORVOID", "PROVISIONFORSPACE", "USERDEFINED", "NOTDEFINED"]),
  DISCRETEACCESSORY: new Set(["ANCHORPLATE", "BRACKET", "SHOE", "USERDEFINED", "NOTDEFINED"]),
  FASTENER: new Set(["GLUE", "MORTAR", "WELD", "USERDEFINED", "NOTDEFINED"]),
  MECHANICALFASTENER: new Set(["ANCHORBOLT", "BOLT", "DOWEL", "RIVET", "SCREW", "SHEARCONNECTOR", "STAPLE", "STUD", "USERDEFINED", "NOTDEFINED"]),
  REINFORCINGBAR: new Set(["ANCHORAGE", "LIGATURE", "MAIN", "PUNCHING", "RING", "SHEAR", "STUD", "USERDEFINED", "NOTDEFINED"]),
  REINFORCINGMESH: new Set(["USERDEFINED", "NOTDEFINED"]),
  TENDON: new Set(["BAR", "STRAND", "WIRE", "USERDEFINED", "NOTDEFINED"]),
  TENDONANCHOR: new Set(["COUPLER", "FIXED_END", "TENSIONING_END", "USERDEFINED", "NOTDEFINED"]),

  // BUILDING CONTROLS DOMAIN
  ACTUATOR: new Set(["ELECTRICACTUATOR", "HANDOPERATEDACTUATOR", "HYDRAULICACTUATOR", "PNEUMATICACTUATOR", "THERMALACTUATOR", "USERDEFINED", "NOTDEFINED"]),
  ALARM: new Set(["BELL", "BREAKGLASSBUTTON", "LIGHT", "MANUALPULLBOX", "SIREN", "WHISTLE", "USERDEFINED", "NOTDEFINED"]),
  CONTROLLER: new Set(["FLOATING", "PROGRAMMABLE", "PROPORTIONAL", "MULTIPOSITION", "TOWPOSITION", "USERDEFINED", "NOTDEFINED"]),
  FLOWINSTRUMENT: new Set([
    "PRESSUREGAUGE", "THERMOMETER", "AMMETER", "FREQUENCYMETER", "POWERFACTORMETER", "PHASEANGLEMETER", "VOLTMETER_PEAK", "VOLTMETER_RMS", "USERDEFINED", "NOTDEFINED"
  ]),
  SENSOR: new Set([
    "COSENSOR", "CO2SENSOR", "CONDUCTIVITIESENSOR", "CONTACTSENSOR", "FIRESENSOR", "FLOWSENSOR", "FROSTSENSOR", "GASSENSOR", "HEATSENSOR", "HUMIDITYSENSOR", "IDENTIFYSENSOR", "IONCONCENTRATIONSENSOR", "LIGHTSENSOR", "MOISTURESENSOR", "MOVEMENTSENSOR", "OPERATIONSENSOR", "PETSENSOR", "PRESSURESENSOR", "RADIATIONSENSOR", "RADIOACTIVITYSENSOR", "SMOKESENSOR", "SOUNDSENSOR", "TEMPERATURESENSOR", "WINDSENSOR", "USERDEFINED", "NOTDEFINED"
  ]),

  // ELECTRICAL DOMAIN
  AUDIOVISUALAPPLIANCE: new Set(["AMPLIFIER", "CAMERA", "DISPLAY", "MICROPHONE", "PLAYER", "PROJECTOR", "RECEIVER", "SPEAKER", "SWITCHER", "TELEPHONE", "TUNER", "USERDEFINED", "NOTDEFINED"]),
  CABLECARRIERFITTING: new Set(["BEND", "CROSS", "REDUCER", "TEE", "USERDEFINED", "NOTDEFINED"]),
  CABLECARRIERSEGMENT: new Set(["CABLELADDERSEGMENT", "CABLETRAYSEGMENT", "CABLETRUNKINGSEGMENT", "CONDUITSEGMENT", "USERDEFINED", "NOTDEFINED"]),
  CABLEFITTING: new Set(["CONNECTOR", "ENTRY", "EXIT", "JUNCTION", "TRANSITION", "USERDEFINED", "NOTDEFINED"]),
  CABLESEGMENT: new Set(["BUSBARSEGMENT", "CABLESEGMENT", "CONDUCTORSEGMENT", "CORESEGMENT", "USERDEFINED", "NOTDEFINED"]),
  COMMUNICATIONSAPPLIANCE: new Set(["ANTENNA", "COMPUTER", "FAX", "GATEWAY", "MODEM", "NETWORKAPPLIANCE", "NETWORKBRIDGE", "NETWORKHUB", "PRINTER", "REPEATER", "ROUTER", "SCANNER", "USERDEFINED", "NOTDEFINED"]),
  ELECTRICAPPLIANCE: new Set(["DISHWASHER", "ELECTRICCOOKER", "FREEZER", "FRIDGE_FREEZER", "HANDDRYER", "KITCHENMACHINE", "MICROWAVE", "REFRIGERATOR", "TUMBLEDRYER", "WASHINGMACHINE", "USERDEFINED", "NOTDEFINED"]),
  ELECTRICFLOWSTORAGEDEVICE: new Set(["BATTERY", "CAPACITORBANK", "HARMONICFILTER", "INDUCTORBANK", "UPS", "USERDEFINED", "NOTDEFINED"]),
  ELECTRICGENERATOR: new Set(["CHIP", "ENGINEGENERATOR", "STANDALONE", "USERDEFINED", "NOTDEFINED"]),
  ELECTRICMOTOR: new Set(["DC", "INDUCTION", "POLYPHASE", "RELUCTANCESYNCHRONOUS", "SYNCHRONOUS", "USERDEFINED", "NOTDEFINED"]),
  JUNCTIONBOX: new Set(["DATA", "POWER", "USERDEFINED", "NOTDEFINED"]),
  LIGHTFIXTURE: new Set(["POINTSOURCE", "DIRECTIONALSOURCE", "SECURITYLIGHTING", "USERDEFINED", "NOTDEFINED"]),
  OUTLET: new Set(["AUDIOVISUALOUTLET", "COMMUNICATIONSOUTLET", "POWEROUTLET", "DATAOUTLET", "TELEPHONEOUTLET", "USERDEFINED", "NOTDEFINED"]),
  SOLARDEVICE: new Set(["SOLARCOLLECTOR", "SOLARPANEL", "USERDEFINED", "NOTDEFINED"]),
  SWITCHINGDEVICE: new Set(["CONTACTOR", "DIMMERSWITCH", "EMERGENCYSTOP", "KEYPAD", "MOMENTARYSWITCH", "SELECTORSWITCH", "STARTER", "SWITCHDISCONNECTOR", "TOGGLESWITCH", "USERDEFINED", "NOTDEFINED"]),
  TRANSFORMER: new Set(["CURRENT", "FREQUENCY", "INVERTER", "RECTIFIER", "VOLTAGE", "USERDEFINED", "NOTDEFINED"]),

  // HVAC DOMAIN
  AIRTERMINAL: new Set(["DIFFUSER", "GRILLE", "LOUVRE", "REGISTER", "USERDEFINED", "NOTDEFINED"]),
  AIRTERMINALBOX: new Set(["CONSTANTFLOW", "VARIABLEFLOWPRESSUREDEPENDANT", "VARIABLEFLOWPRESSUREINDEPENDANT", "USERDEFINED", "NOTDEFINED"]),
  BOILER: new Set(["WATER", "STEAM", "USERDEFINED", "NOTDEFINED"]),
  CHILLER: new Set(["AIRCOOLED", "WATERCOOLED", "HEATRECOVERY", "USERDEFINED", "NOTDEFINED"]),
  COIL: new Set(["DXCOOLINGCOIL", "ELECTRICHEATINGCOIL", "GASHEATINGCOIL", "HYDRONICCOIL", "STEAMHEATINGCOIL", "WATERCOOLINGCOIL", "WATERHEATINGCOIL", "USERDEFINED", "NOTDEFINED"]),
  COMPRESSOR: new Set(["DYNAMIC", "RECIPROCATING", "ROTARY", "SCROLL", "TROCHOIDAL", "SINGLESTAGE", "BOOSTER", "OPENTYPE", "HERMETRIC", "SEMIHERMITIC", "WELDEDSHELLHERMETIC", "ROLLINGPISTON", "ROTARYVANE", "SINGLESCREW", "TWINSCREW", "USERDEFINED", "NOTDEFINED"]),
  CONDENSER: new Set(["AIRCOOLED", "EVAPORATIVECOOLED", "WATERCOOLED", "USERDEFINED", "NOTDEFINED"]),
  COOLEDBEAM: new Set(["ACTIVE", "PASSIVE", "USERDEFINED", "NOTDEFINED"]),
  COOLINGTOWER: new Set(["NATURALDRAFT", "MECHANICALINDUCEDDRAFT", "MECHANICALFORCEDDRAFT", "USERDEFINED", "NOTDEFINED"]),
  DAMPER: new Set(["BACKDRAFTDAMPER", "BALANCINGDAMPER", "BLASTDAMPER", "CONTROLDAMPER", "FIREDAMPER", "FIRESMOKEDAMPER", "FUMEHOODEXHAUST", "GRAVITYDAMPER", "GRAVITYRELIEFDAMPER", "RELIEFDAMPER", "SMOKEDAMPER", "USERDEFINED", "NOTDEFINED"]),
  DUCTFITTING: new Set(["BEND", "CONNECTOR", "ENTRY", "EXIT", "JUNCTION", "OBSTRUCTION", "TRANSITION", "USERDEFINED", "NOTDEFINED"]),
  DUCTSEGMENT: new Set(["RIGIDSEGMENT", "FLEXIBLESEGMENT", "USERDEFINED", "NOTDEFINED"]),
  DUCTSILENCER: new Set(["FLATOVAL", "RECTANGULAR", "ROUND", "USERDEFINED", "NOTDEFINED"]),
  ENGINE: new Set(["EXTERNALCOMBUSTION", "INTERNALCOMBUSTION", "USERDEFINED", "NOTDEFINED"]),
  EVAPORATOR: new Set(["DIRECTEXPANSION", "FLOODEDSHELLANDTUBE", "SHELLANDCOIL", "USERDEFINED", "NOTDEFINED"]),
  FAN: new Set(["CENTRIFUGALFORWARDCURVED", "CENTRIFUGALRADIAL", "CENTRIFUGALBACKWARDINCLINEDCURVED", "CENTRIFUGALAIRFOIL", "TUBEAXIAL", "VANEAXIAL", "PROPELLORAXIAL", "USERDEFINED", "NOTDEFINED"]),
  FILTER: new Set(["AIRPARTICLEFILTER", "COMPRESSEDAIRFILTER", "ODORFILTER", "OILFILTER", "STRAINER", "WATERFILTER", "USERDEFINED", "NOTDEFINED"]),
  FLOWMETER: new Set(["ENERGYMETER", "GASMETER", "OILMETER", "WATERMETER", "USERDEFINED", "NOTDEFINED"]),
  HEATEXCHANGER: new Set(["PLATE", "SHELLANDTUBE", "USERDEFINED", "NOTDEFINED"]),
  HUMIDIFIER: new Set(["STEAMINJECTION", "ADIABATICAIRWASHER", "ADIABATICPAN", "ADIABATICWETTEDELEMENT", "ASSISTEDELECTRIC", "ASSISTEDNATURALGAS", "ASSISTEDPROPANE", "ASSISTEDBUTANE", "ASSISTEDSTEAM", "USERDEFINED", "NOTDEFINED"]),
  MEDICALDEVICE: new Set(["AIRSTATION", "FEEDAIRUNIT", "OXYGENGENERATOR", "OXYGENPLANT", "VACUUMSTATION", "USERDEFINED", "NOTDEFINED"]),
  PIPEFITTING: new Set(["BEND", "CONNECTOR", "ENTRY", "EXIT", "JUNCTION", "OBSTRUCTION", "TRANSITION", "USERDEFINED", "NOTDEFINED"]),
  PIPESEGMENT: new Set(["CULVERT", "FLEXIBLESEGMENT", "RIGIDSEGMENT", "GUTTER", "SPOOL", "USERDEFINED", "NOTDEFINED"]),
  PUMP: new Set(["CIRCULATOR", "ENDSUCTION", "SPLITCASE", "SUBMERSIBLEPUMP", "SUMPPUMP", "VERTICALINLINE", "VERTICALTURBINE", "USERDEFINED", "NOTDEFINED"]),
  SPACEHEATER: new Set(["CONVECTOR", "RADIATOR", "USERDEFINED", "NOTDEFINED"]),
  TANK: new Set(["BASIN", "BREAKPRESSURE", "EXPANSION", "FEEDANDEXPANSION", "PRESSUREVESSEL", "STORAGE", "VESSEL", "USERDEFINED", "NOTDEFINED"]),
  UNITARYEQUIPMENT: new Set(["AIRHANDLER", "AIRCONDITIONINGUNIT", "DEHUMIDIFIER", "SPLITSYSTEM", "ROOFTOPUNIT", "USERDEFINED", "NOTDEFINED"]),
  VALVE: new Set(["AIRRELEASE", "ANTIVACUUM", "CHANGEOVER", "CHECK", "COMMISSIONING", "DIVERTING", "DRAWOFFCOCK", "DOUBLECHECK", "FAUCET", "FLUSHING", "GASCOCK", "GASTAP", "ISOLATING", "MIXING", "PRESSUREREDUCING", "PRESSURERELIEF", "REGULATING", "SAFETYCUTOFF", "STEAMTRAP", "STOPCOCK", "USERDEFINED", "NOTDEFINED"]),
  VIBRATIONISOLATOR: new Set(["COMPRESSION", "SPRING", "USERDEFINED", "NOTDEFINED"]),

  // PLUMBING FIRE PROTECTION DOMAIN
  FIRESUPPRESSIONTERMINAL: new Set(["BREECHINGINLET", "FIREHYDRANT", "HOSEREEL", "SPRINKLER", "SPRINKLERDEFLECTOR", "USERDEFINED", "NOTDEFINED"]),
  INTERCEPTOR: new Set(["CYCLONIC", "GREASE", "OIL", "PETROL", "USERDEFINED", "NOTDEFINED"]),
  SANITARYTERMINAL: new Set(["BATH", "BIDET", "CISTERN", "SHOWER", "SINK", "SANITARYFOUNTAIN", "TOILETPAN", "URINAL", "WASHHANDBASIN", "WCSEAT", "USERDEFINED", "NOTDEFINED"]),
  WASTETERMINAL: new Set(["FLOORTRAP", "FLOORWASTE", "GULLYSUMP", "GULLYTRAP", "ROOFDRAIN", "WASTEDISPOSALUNIT", "WASTETRAP", "USERDEFINED", "NOTDEFINED"]),
};

// Check if an entity is a non-geometric metadata node
const isNonGeometricEntity = (entity: string): boolean => {
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
    e.includes("OPENING") ||
    e.includes("PRESENTATION") ||
    e.includes("ORGANIZATION") ||
    e.includes("APPLICATION") ||
    e.includes("PERSON") ||
    e.includes("ACTOR") ||
    e.includes("OWNER"));
};

export const checkIFCSchemaRules = async (components: OBC.Components): Promise<{ resultsData: any[]; rawFlatItems: RuleTableData[]; failMap: OBC.ModelIdMap; message: string }> => {
  const fragments = components.get(OBC.FragmentsManager);
  if (fragments.list.size === 0) {
    throw new Error("로드된 모델이 없습니다.");
  }

  const fail: OBC.ModelIdMap = {};
  const tableData: RuleTableData[] = [];
  let schemaIssueCount = 0;

  for (const [modelId, model] of fragments.list) {
    const modelName = (model as any).name || model.modelId;
    const localIds = await model.getLocalIds();

    const itemsData = await model.getItemsData(localIds, {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
      relations: {
        ContainedInStructure: { attributes: true, relations: true },
        Decomposes: { attributes: true, relations: true },
      },
    });

    for (const item of itemsData) {
      const itemAny = item as any;
      const expressId = (itemAny.expressID ?? itemAny.id ?? itemAny._localId?.value ?? itemAny._localId) as number;
      if (expressId === undefined) continue;

      let rawCategory = itemAny._category;
      if (rawCategory && typeof rawCategory === "object" && rawCategory.value !== undefined) rawCategory = rawCategory.value;
      const entity = String(rawCategory || "").replace(/^IFC/i, "").toUpperCase() || "UNKNOWN";

      // Skip non-geometric metadata nodes (PropertySet, Quantities, Materials, etc.)
      if (isNonGeometricEntity(entity)) {
        continue;
      }

      let name = itemAny.Name;
      if (name && typeof name === "object" && name.value !== undefined) name = name.value;
      name = String(name || "Unnamed").trim();

      let guid = itemAny._guid ?? itemAny.GlobalId;
      if (guid && typeof guid === "object" && guid.value !== undefined) guid = guid.value;
      guid = String(guid || "Unknown").trim();

      const issues: string[] = [];

      // 1. PredefinedType Enum validation
      let predefinedType = itemAny.PredefinedType;
      if (predefinedType && typeof predefinedType === "object" && predefinedType.value !== undefined) {
        predefinedType = predefinedType.value;
      }
      if (predefinedType !== undefined && predefinedType !== null) {
        const ptStr = String(predefinedType).trim().toUpperCase();
        const allowedSet = PREDEFINED_TYPES[entity];
        if (allowedSet && !allowedSet.has(ptStr)) {
          issues.push(`[SimpleType Rule] Invalid PredefinedType "${ptStr}" for IFC${entity}`);
        }
      }

      // 2. Spatial Containment Rule (Check if physical element is contained in spatial structure)
      const hasSpatialRelation =
        (Array.isArray(itemAny.ContainedInStructure) && itemAny.ContainedInStructure.length > 0) ||
        (Array.isArray(itemAny.Decomposes) && itemAny.Decomposes.length > 0) ||
        (itemAny.ContainedInStructure !== undefined && itemAny.ContainedInStructure !== null) ||
        (itemAny.Decomposes !== undefined && itemAny.Decomposes !== null);

      if (!hasSpatialRelation && entity !== "PROJECT" && entity !== "SITE" && entity !== "BUILDING" && entity !== "BUILDINGSTOREY") {
        issues.push(`[Global Rule] Element is orphaned (Not contained in Spatial Structure / Storey)`);
      }

      // 3. Name Attribute Validation
      if (!name || name === "Unnamed" || name === "Null" || name === "TBD") {
        issues.push(`[Schema Rule] Mandatory Name attribute is missing or unassigned`);
      }

      // If any schema issue found for this element
      if (issues.length > 0) {
        schemaIssueCount += issues.length;
        if (!fail[modelId]) fail[modelId] = new Set();
        fail[modelId].add(expressId);

        for (const issueDesc of issues) {
          tableData.push({
            id: `${modelId}-${expressId}-${tableData.length}`,
            ModelID: modelId,
            ExpressID: expressId,
            Model: modelName,
            Name: name,
            GUID: guid,
            Entity: entity,
            Value: issueDesc,
            Count: 1,
            Status: "Fail",
          });
        }
      }
    }
  }

  if (Object.keys(fail).length > 0) {
    await Promise.all([
      fragments.highlight({
        customId: "red",
        color: new THREE.Color("red"),
        renderedFaces: FRAGS.RenderedFaces.ONE,
        opacity: 1,
        transparent: false,
      }, fail),
      fragments.core.update(true),
    ]);

    setModelTransparent(components);

    const worlds = components.get(OBC.Worlds);
    const world = worlds.list.values().next().value;
    if (world && world.camera instanceof OBC.SimpleCamera) {
      await world.camera.fitToItems(fail);
    }
  }

  const resultsData = groupResultsBy(tableData, "None");
  const message = schemaIssueCount > 0
    ? `IFC 물리 부재 스키마 및 규격 오류가 ${schemaIssueCount}건 발견되었습니다.`
    : "모든 3D 물리 부재가 IFC 스키마 및 규격 조건을 통과하였습니다.";

  return { resultsData, rawFlatItems: tableData, failMap: fail, message };
};

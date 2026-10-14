export const clashDisciplineMap: Record<string, string[]> = {
  'ARCH': [
    'COVERING',
    'CURTAINWALL',
    'DOOR',
    'FURNITURE',
    'FURNISHINGELEMENT',
    'PLATE',
    'RAILING',
    'ROOF',
    'RAMP',
    'RAMPFLIGHT',
    'STAIR',
    'STAIRFLIGHT',
    'SHADINGDEVICE',
    'SYSTEMFURNITUREELEMENT',
    'WINDOW',
  ],
  'STRUC': [
    'BEAM',
    'CHIMNEY',
    'COLUMN',
    'FOOTING',
    'FOUNDATION',
    'MEMBER',
    'PILE',
    'REINFORCINGBAR',
    'SLAB',
    'WALL',
    'WALLSTANDARDCASE',
  ],
  'PIPE': [
    'FILTER',
    'FIRESUPPRESSIONTERMINAL',
    'FLOWCONTROLLER',
    'FLOWINSTRUMENT',
    'FLOWMETER',
    'INTERCEPTOR',
    'PIPEFITTING',
    'PIPESEGMENT',
    'SANITARYTERMINAL',
    'VALVE',
    'WASTETERMINAL',
  ],
  'HVAC': [
    'DUCTFITTING',
    'DUCTSEGMENT',
    'DUCTSILENCER',
    'DAMPER',
    'AIRTERMINAL',
    'AIRTERMINALBOX',
  ],
  'MECH': [
    'ACTUATOR',
    'AIRTOAIRHEATRECOVERY',
    'BOILER',
    'CHILLER',
    'COIL',
    'CONDENSER',
    'COOLEDBEAM',
    'COOLINGTOWER',
    'DISTRIBUTIONCHAMBERELEMENT',
    'DISTRIBUTIONELEMENT',
    'ENERGYCONVERSIONDEVICE',
    'ENGINE',
    'EVAPORATIVECOOLER',
    'EVAPORATOR',
    'FAN',
    'FLOWTERMINAL',
    'HEATEXCHANGER',
    'HUMIDIFIER',
    'PUMP',
    'SOLARDEVICE',
    'SPACEHEATER',
    'STACKTERMINAL',
    'TANK',
    'UNITARYEQUIPMENT',
  ],
  'ELEC': [
    'ALARM',
    'AUDIOVISUALAPPLIANCE',
    'CABLECARRIERFITTING',
    'CABLECARRIERSEGMENT',
    'CABLEFITTING',
    'CABLESEGMENT',
    'COMMUNICATIONSAPPLIANCE',
    'CONTROLLER',
    'ELECTRICAPPLIANCE',
    'ELECTRICDISTRIBUTIONBOARD',
    'ELECTRICFLOWSTORAGEDEVICE',
    'ELECTRICGENERATOR',
    'ELECTRICMOTOR',
    'ELECTRICTIMECONTROL',
    'FLOWINSTRUMENT',
    'JUNCTIONBOX',
    'LAMP',
    'LIGHTFIXTURE',
    'MOTORCONNECTION',
    'OUTLET',
    'PROTECTIVEDEVICE',
    'SENSOR',
    'SWITCHINGDEVICE',
    'TRANSFORMER',
    'UNITARYCONTROLELEMENT',
  ],
  'CIVIL': [
    'CIVILELEMENT',
    'GEOGRAPHICELEMENT',
  ],
};

/**
 * 주어진 카테고리가 속한 분야(Discipline)를 반환합니다.
 * @param category - IFC 카테고리 이름
 * @returns 매칭되는 분야 이름 또는 'ETC'
 */
export const getDiscipline = (category: string): string => {
  if (!category) return 'ETC';
  const upperCat = category.toUpperCase().replace(/^IFC/i, "");
  for (const discipline in clashDisciplineMap) {
    if (clashDisciplineMap[discipline].includes(upperCat)) {
      return discipline;
    }
  }
  return 'ETC';
};

/**
 * ThatOpen / IFC 속성 객체에서 실제 원시 값을 추출합니다.
 */
export const extractValue = (attr: any): any => {
  if (attr === null || attr === undefined) return null;
  if (Array.isArray(attr)) return attr.length > 0 ? extractValue(attr[0]) : null;
  if (typeof attr === "object" && "value" in attr) return attr.value;
  return attr;
};

/**
 * 객체의 PredefinedType 속성을 추출합니다.
 * Occurrence에 없으면 IsTypedBy 관계를 통해 Type Object에서 조회합니다.
 */
export const extractPredefinedType = (item: any): string => {
  if (!item) return "NOTDEFINED";

  let pType = extractValue(item.PredefinedType);

  if (!pType) {
    const relatedTypes = [...(item.IsTypedBy || [])];
    for (const t of relatedTypes) {
      const typeObj = t.RelatingType || t;
      if (typeObj && typeObj.PredefinedType) {
        pType = extractValue(typeObj.PredefinedType);
        if (pType) break;
      }
    }
  }

  if (!pType || pType === "$" || pType === "*") {
    return "NOTDEFINED";
  }

  return String(pType).trim().toUpperCase();
};
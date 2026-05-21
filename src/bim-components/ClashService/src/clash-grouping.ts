export const clashDisciplineMap: Record<string, string[]> = {
  'ARCH': [
    'CHIMNEY',
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
  'MECH': [
    'ACTUATOR', 
    'AIRTERMINAL', 
    'AIRTERMINALBOX', 
    'AIRTOAIRHEATRECOVERY', 
    'BOILER', 
    'CHILLER', 
    'COIL', 
    'CONDENSER', 
    'COOLEDBEAM', 
    'COOLINGTOWER', 
    'DAMPER', 
    'DISTRIBUTIONCHAMBERELEMENT', 
    'DISTRIBUTIONELEMENT', 
    'DUCTFITTING', 
    'DUCTSEGMENT', 
    'DUCTSILERCER', 
    'ENERGYCONVERSIONDEVICE', 
    'ENGINE', 
    'EVAPORATIVECOOLER', 
    'EVAPORATOR', 
    'FAN', 
    'FILTER', 
    'FIRESUPPRESSIONTERMINAL', 
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
    'COMMUNICATIONAPPLIANCE', 
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
  'PIPE': [
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
  const upperCat = category.toUpperCase();
  for (const discipline in clashDisciplineMap) {
    if (clashDisciplineMap[discipline].includes(upperCat)) {
      return discipline;
    }
  }
  return 'ETC';
};
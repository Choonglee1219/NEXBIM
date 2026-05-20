export const clashDisciplineMap: Record<string, string[]> = {
  'STRUC': [
    'WALL', 'WALLSTANDARDCASE', 'SLAB', 'COLUMN', 'BEAM', 'FOOTING', 
    'REINFORCINGBAR', 'MEMBER', 'PILE', 'FOUNDATION'
  ],
  'ARCH': [
    'DOOR', 'WINDOW', 'RAILING', 'STAIR', 'ROOF', 'FURNISHINGELEMENT', 'PLATE', 'COVERING'
  ],
  'MECH': [
    'DUCTSEGMENT', 'DUCTFITTING', 'FLOWTERMINAL', 'UNITARYEQUIPMENT', 'DISTRIBUTIONPORT', 'AIRTERMINAL', 'ENERGYCONVERSIONDEVICE'
  ],
  'ELEC': [
    'CABLECARRIERSEGMENT', 'CABLECARRIERFITTING', 'CABLESEGMENT', 'CABLEFITTING', 'JUNCTIONBOX'
  ],
  'PIPE': [
    'PIPESEGMENT', 'PIPEFITTING', 'FLOWCONTROLLER', 'FLOWMETER', 'FIRESUPPRESSIONTERMINAL', 'VALVE'
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
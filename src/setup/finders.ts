import * as OBC from "@thatopen/components";

// Query List 노출 여부(숨김 상태)를 관리하는 레지스트리
export const hiddenQueries = new Set<string>();

/**
 * ItemsFinder에 쿼리를 등록하고 hidden 여부에 따라 레지스트리에 관리하는 헬퍼 함수
 * @param finder OBC.ItemsFinder 인스턴스
 * @param name 쿼리 이름
 * @param rules 쿼리 규칙 배열
 * @param hidden Query List 노출 여부 (true: 숨김, false: 노출)
 */
export const createQuery = (
  finder: OBC.ItemsFinder,
  name: string,
  rules: any[],
  hidden: boolean,
) => {
  finder.create(name, rules);
  if (hidden) {
    hiddenQueries.add(name);
  } else {
    hiddenQueries.delete(name);
  }
};

export const setupFinders = (components: OBC.Components) => {
  const finder = components.get(OBC.ItemsFinder);

  // 1. Query List에 노출할 메인 단위 쿼리들 (hidden: false)
  // ItemsFinder by Categories(Entity Type)
  createQuery(finder, "Structure Elements", [
    { categories: [/COLUMN|SLAB|BEAM|WALL/] }
  ], false);

  createQuery(finder, "Duct", [
    { categories: [/DUCT/] }
  ], false);

  createQuery(finder, "Tray", [
    { categories: [/CABLECARRIER/] }
  ], false);

  createQuery(finder, "Equipment", [
    { categories: [/EQUIP/] }
  ], false);

  createQuery(finder, "Pipe", [
    { categories: [/PIPE/] }
  ], false);

  // ItemsFinder by Material (IfcRelAssociatesMaterial -> IfcMaterial)
  createQuery(finder, "Concrete Member", [
    {
      categories: [/COLUMN|BEAM|SLAB|WALL|MEMBER|RAMP|FOOTING/],
      relation: {
        name: "HasAssociations",
        query: {
          categories: [/MATERIAL/],
          attributes: {
            queries: [{ name: /^Name$/, value: /Concrete|콘크리트/i }],
          },
        },
      },
    },
  ], false);

  createQuery(finder, "Steel Member", [
    {
      categories: [/COLUMN|BEAM|MEMBER|WALL|SLAB|RAMP/],
      relation: {
        name: "HasAssociations",
        query: {
          categories: [/MATERIAL/],
          attributes: {
            queries: [{ name: /^Name$/, value: /Steel|강재|철골/i }],
          },
        },
      },
    },
  ], false);

  // 2. ViewTemplater 전용 세부 필터 재료 쿼리들 (Query List에서 숨김, hidden: true)
  createQuery(finder, "Base Slab", [
    { categories: [/SLAB/] }
  ], true);

  createQuery(finder, "Slab", [
    { categories: [/SLAB/] }
  ], true);

  createQuery(finder, "Wall", [
    { categories: [/WALL/] }
  ], true);

  createQuery(finder, "Ramp", [
    { categories: [/RAMP/] }
  ], true);

  createQuery(finder, "Beam", [
    { categories: [/BEAM/] }
  ], true);

  createQuery(finder, "Plate", [
    { categories: [/PLATE/] }
  ], true);

  createQuery(finder, "Rail", [
    { categories: [/RAILING/] }
  ], true);

  createQuery(finder, "Stair", [
    { categories: [/STAIR|STAIRFLIGHT/] }
  ], true);

  createQuery(finder, "Concrete Column", [
    { categories: [/COLUMN/] }
  ], true);

  createQuery(finder, "Member", [
    { categories: [/MEMBER/] }
  ], true);

  createQuery(finder, "Proxy", [
    { categories: [/BUILDINGELEMENTPROXY|PROXY/] }
  ], true);

  createQuery(finder, "Space", [
    { categories: [/SPACE/] }
  ], false);

  createQuery(finder, "Opening Element", [
    { categories: [/OPENING/] }
  ], false);

  createQuery(finder, "Spatial Zone", [
    { categories: [/SPATIALZONE/] }
  ], false);

  createQuery(finder, "DistributionElement", [
    { categories: [/FLOW|DISTRIBUTION|DUCT|PIPE|CABLECARRIER/] }
  ], false);
};
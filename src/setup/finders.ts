import * as OBC from "@thatopen/components";

export const setupFinders = (components: OBC.Components) => {
  const finder = components.get(OBC.ItemsFinder);

  // ItemsFinder by Categories(Entity Type)
  finder.create("Structure Elements", [
    { categories: [/COLUMN|SLAB|BEAM|WALL|MEMBER/] }
  ]);

  // ItemsFinder by Attributes
  finder.create("Concrete Member", [
    {
      categories: [/WALL|SLAB|RAMP/],
      attributes: {
        queries: [{ name: /^Name$/, value: /Concrete/ }],
      },
    },
  ]);
  finder.create("Steel Member", [
    {
      categories: [/COLUMN|BEAM|MEMBER/],
      attributes: {
        queries: [{ name: /^Name$/, value: /^(?!Concrete).*$/ }],
      },
    },
  ]);

//   // ItemsFinder by ContaineInStructure
//   finder.create("Columns (Level 1)", [
//     {
//       categories: [/COLUMN/],
//       relation: {
//         name: "ContainedInStructure",
//         query: {
//           categories: [/STOREY/],
//           attributes: { queries: [{ name: /Name/, value: /01/ }] },
//         },
//       },
//     },
//   ]);

//   // ItemsFinder by Properties
//   finder.create("Columns (Pset_ColumnCommon.Reference = 750mm)", [
//     {
//       categories: [/COLUMN/],
//       relation: {
//         name: "IsDefinedBy",
//         query: {
//           categories: [/PROPERTYSET/],
//           attributes: { queries: [{ name: /Name/, value: /ColumnCommon/ }] },
//           relation: {
//             name: "HasProperties",
//             query: {
//               categories: [/SINGLEVALUE/],
//               attributes: {
//                 queries: [
//                   { name: /Name/, value: /Reference/ },
//                   { name: /NominalValue/, value: /750/ },
//                 ],
//               },
//             },
//           },
//         },
//       },
//     },
//   ]);
};
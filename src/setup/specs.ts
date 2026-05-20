export interface IDSSpecDefinition {
  name: string;
  description: string;
  applicability: {
    entity: string;
  };
  requirement: {
    type: "property" | "attribute" | "quantity";
    propertySet?: string;
    name: string;
    condition: "exists" | "pattern";
    value?: string;
  };
}

export const predefinedSpecs: IDSSpecDefinition[] = [
  {
    name: "Door FireRating",
    description: "All doors must have FireRating specified in Pset_DoorCommon.",
    applicability: { entity: "IFCDOOR" },
    requirement: { type: "property", propertySet: "Pset_DoorCommon", name: "FireRating", condition: "exists" }
  },
  {
    name: "Wall PredefinedType",
    description: "All walls must have a PredefinedType attribute.",
    applicability: { entity: "IFCWALL" },
    requirement: { type: "attribute", name: "PredefinedType", condition: "exists" }
  },
  {
    name: "Slab IsExternal",
    description: "Slabs must define IsExternal property.",
    applicability: { entity: "IFCSLAB" },
    requirement: { type: "property", propertySet: "Pset_SlabCommon", name: "IsExternal", condition: "exists" }
  },
  {
    name: "Beam Length",
    description: "All Beams must have Length specified in Qto_BeamBaseQuantities.",
    applicability: { entity: "IFCBEAM" },
    requirement: { type: "quantity", propertySet: "Qto_BeamBaseQuantities", name: "Length", condition: "exists" }
  }
];
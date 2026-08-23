export interface IfcOpeningElementData {
  expressId: number;
  globalId?: string | null;
  name?: string | null;
  description?: string | null;
  objectType?: string | null;
  predefinedType?: string | null;
  parentExpressId?: number | null;
  fillingExpressIds: number[];
}

export interface IfcSpatialZoneData {
  expressId: number;
  globalId?: string | null;
  name?: string | null;
  longName?: string | null;
  description?: string | null;
  objectType?: string | null;
  predefinedType?: string | null;
  referencedElementIds: number[];
}

export interface ModelRelationData {
  modelKey: string;
  openings: Map<number, IfcOpeningElementData>;
  elementToOpenings: Map<number, number[]>; // RelatingBuildingElement (Wall/Slab) -> Opening IDs
  openingToParent: Map<number, number>; // Opening ID -> RelatingBuildingElement
  openingToFillings: Map<number, number[]>; // Opening ID -> RelatedBuildingElements (Door/Window)
  fillingToOpening: Map<number, number>; // Door/Window ID -> Opening ID
  spatialZones: Map<number, IfcSpatialZoneData>;
  elementToZones: Map<number, number[]>; // Element ID -> SpatialZone IDs
  zoneToElements: Map<number, number[]>; // SpatialZone ID -> Element IDs
}

export interface ViewTemplateVisibilityExceptions {
  queries?: Set<string>;
}

export interface ViewTemplateColors {
  queries?: Record<string, Set<string>>;
}

export interface ViewTemplate {
  defaultVisibility: boolean;
  visibilityExceptions: ViewTemplateVisibilityExceptions;
  colors: ViewTemplateColors;
}

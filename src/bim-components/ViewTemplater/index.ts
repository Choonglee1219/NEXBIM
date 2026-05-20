import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { ViewTemplate } from "./src";
import { Highlighter } from "../../bim-components/Highlighter";

export class ViewTemplater extends OBC.Component {
  static uuid = "226f2357-5e8c-43e5-a43a-594356e43b67" as const;
  enabled = true;

  readonly list = new FRAGS.DataMap<string, ViewTemplate>();

  async apply(name: string | ViewTemplate) {
    const template = typeof name === "string" ? this.list.get(name) : name;
    if (!template) throw new Error("View template doesn't exist");

    const fragments = this.components.get(OBC.FragmentsManager);
    if (fragments.list.size === 0) return;

    const { defaultVisibility, visibilityExceptions, colors } = template;

    const highlighter = this.components.get(Highlighter);
    const hider = this.components.get(OBC.Hider);
    const finder = this.components.get(OBC.ItemsFinder);

    const promises = [this.reset(), hider.set(defaultVisibility)];

    if (visibilityExceptions.queries) {
      const promises = [];

      for (const name of visibilityExceptions.queries) {
        const finderQuery = finder.list.get(name);
        if (!finderQuery) continue;
        promises.push(finderQuery.test());
      }
      const maps = await Promise.all(promises);
      const map = OBC.ModelIdMapUtils.join(maps);
      promises.push(hider.set(!defaultVisibility, map));
    }

    const colorsMap = new Map<string, OBC.ModelIdMap>();
    const addStyleMap = (style: string, map: OBC.ModelIdMap) => {
      if (!highlighter.styles.has(style)) {
        highlighter.styles.set(style, {
          color: new THREE.Color(style),
          renderedFaces: 1,
          opacity: 1,
          transparent: false,
        });
      }

      let colorMap = colorsMap.get(style);
      if (!colorMap) {
        colorMap = {};
        colorsMap.set(style, colorMap);
      }
      OBC.ModelIdMapUtils.add(colorMap, map);
    };

    if (colors.queries) {
      for (const [style, queryNames] of Object.entries(colors.queries)) {
        for (const name of queryNames) {
          const finderQuery = finder.list.get(name);
          if (!finderQuery) continue;
          const map = await finderQuery.test();
          addStyleMap(style, map);
        }
      }

      for (const [style, map] of colorsMap.entries()) {
        promises.push(highlighter.highlightByID(style, map));
      }

      await Promise.all(promises);
    }
  }

  async reset() {
    const highlighter = this.components.get(Highlighter);
    const hider = this.components.get(OBC.Hider);

    const promises = [highlighter.clear(), hider.set(true)];

    await Promise.all(promises);
  }
}

export * from "./src";

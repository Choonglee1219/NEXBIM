import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { QueriesListState } from "./types";
import { appIcons, tableButtonStyle } from "../../../globals";
import { Highlighter } from "../../../bim-components/Highlighter";
import { tableDefaultContentTemplate, onTableCellCreated, onTableRowCreated } from "../../../globals";

const getQueryBuilderFields = (q: any) => {
  const fields = {
    name: q.name || "",
    entity: "",
    attrName: "",
    attrVal: "",
    psetName: "",
    propName: "",
    propVal: "",
    containedIn: "",
    structureName: ""
  };

  const firstQuery = q.queries?.[0];
  if (firstQuery) {
    fields.entity = firstQuery.categories?.[0] ? String(firstQuery.categories[0]) : "";
    fields.attrName = firstQuery.attributes?.queries?.[0]?.name ? String(firstQuery.attributes.queries[0].name) : "";
    fields.attrVal = firstQuery.attributes?.queries?.[0]?.value ? String(firstQuery.attributes.queries[0].value) : "";

    const rel = firstQuery.relation;
    if (rel) {
      if (rel.name === "IsDefinedBy") {
        const psetQueries = rel.query?.attributes?.queries;
        const nameQuery = psetQueries?.find((x: any) => x.name.toString().includes("Name"));
        fields.psetName = nameQuery ? String(nameQuery.value) : "";

        const subRel = rel.query?.relation;
        if (subRel && subRel.name === "HasProperties") {
          const propQueries = subRel.query?.attributes?.queries;
          const propNameQ = propQueries?.find((x: any) => x.name.toString().includes("Name"));
          const propValQ = propQueries?.find((x: any) => x.name.toString().includes("NominalValue"));
          fields.propName = propNameQ ? String(propNameQ.value) : "";
          fields.propVal = propValQ !== undefined && propValQ !== null && propValQ.value !== undefined ? String(propValQ.value) : "";
        }
      } else if (rel.name === "ContainedInStructure") {
        fields.containedIn = rel.query?.categories?.[0] ? String(rel.query.categories[0]) : "";
        const structQueries = rel.query?.attributes?.queries;
        const structNameQ = structQueries?.find((x: any) => x.name.toString().includes("Name"));
        fields.structureName = structNameQ ? String(structNameQ.value) : "";
      }
    }
  }

  const cleanRegex = (str: string) => {
    if (!str) return "";
    let cleaned = str;
    if (cleaned.startsWith("/") && cleaned.endsWith("/i")) {
      cleaned = cleaned.substring(1, cleaned.length - 2);
    } else if (cleaned.startsWith("/") && cleaned.endsWith("/")) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }
    if (cleaned.startsWith("^")) cleaned = cleaned.substring(1);
    if (cleaned.endsWith("$")) cleaned = cleaned.substring(0, cleaned.length - 1);
    return cleaned;
  };

  fields.entity = cleanRegex(fields.entity);
  fields.attrName = cleanRegex(fields.attrName);
  fields.attrVal = cleanRegex(fields.attrVal);
  fields.psetName = cleanRegex(fields.psetName);
  fields.propName = cleanRegex(fields.propName);
  fields.propVal = cleanRegex(fields.propVal);
  fields.containedIn = cleanRegex(fields.containedIn);
  fields.structureName = cleanRegex(fields.structureName);

  return fields;
};

export const queriesListTemplate: BUI.StatefullComponent<QueriesListState> = (
  state,
) => {
  const { components, queryString, onLoadQuery } = state;
  const finder = components.get(OBC.ItemsFinder);
  const highlighter = components.get(Highlighter);

  const tableData = [...finder.list.keys()]
    .filter((key) => {
      if (key.startsWith("IFC") || key.startsWith("dash_")) {
        return false;
      }
      if (!queryString) return true;
      return key.toLowerCase().includes(queryString.toLowerCase());
    })
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      return {
        data: {
          Name: key,
          Actions: "",
        },
      };
    });

  const onCreated = (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table;
    table.columns = [{ name: "Name", width: "minmax(0, 1fr)" }, { name: "Actions", width: "auto" }];
    table.headersHidden = true;
    table.noIndentation = true;

    table.defaultContentTemplate = tableDefaultContentTemplate;

    table.dataTransform = {
      Actions: (_, rowData) => {
        const onClick = async () => {
          const { Name } = rowData;
          if (typeof Name !== "string") return;
          const finderQuery = finder.list.get(Name);
          if (!finderQuery) return;
          const items = await finderQuery.test({ modelIds: [/.*/] });
          if (OBC.ModelIdMapUtils.isEmpty(items)) return;
          await highlighter.highlightByID("select", items);
        };

        const onViewDetails = () => {
          const { Name } = rowData;
          if (!Name || typeof Name !== "string") return;

          const allQueries = finder.export();
          const specificQuery = allQueries.data.find((q) => q.name === Name);
          if (!specificQuery) return alert("Query configuration not found");

          const fields = getQueryBuilderFields(specificQuery);
          if (onLoadQuery) {
            onLoadQuery(fields);
          }
        };

        return BUI.html`
          <div style="display: flex; gap: 0.25rem; align-items: center; justify-content: center;">
            <bim-button
              @click=${onClick}
              title="Select items"
              style=${tableButtonStyle}
              icon=${appIcons.SELECT}>
            </bim-button>
            <bim-button
              @click=${onViewDetails}
              title="Load to Query Builder"
              style=${tableButtonStyle}
              icon=${appIcons.REF} >
            </bim-button>
          </div>
        `;
      },
    };
    table.data = tableData;
  };

  return BUI.html`
    <bim-table @rowcreated=${onTableRowCreated} @cellcreated=${onTableCellCreated} .data=${tableData} ${BUI.ref(onCreated)}></bim-table>
  `;
};

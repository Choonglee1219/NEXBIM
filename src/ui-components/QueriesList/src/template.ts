import MarkdownIt from "markdown-it";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { QueriesListState } from "./types";
import { appIcons, tableButtonStyle } from "../../../globals";
import { Highlighter } from "../../../bim-components/Highlighter";
import { tableDefaultContentTemplate, onTableCellCreated, onTableRowCreated } from "../../../globals";

const markdownFiles = import.meta.glob("../../../markdown/*.md", {
  query: "raw",
  import: "default",
  eager: true,
});

const styles = import.meta.glob("../../../style.css", {
  query: "raw",
  import: "default",
  eager: true,
});

export const queriesListTemplate: BUI.StatefullComponent<QueriesListState> = (
  state,
) => {
  const { components, queryString } = state;
  const finder = components.get(OBC.ItemsFinder);
  const highlighter = components.get(Highlighter);

  const tableData = [...finder.list.keys()]
    .filter((key) => {
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

        const onOpenMarkdown = () => {
          const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true,
          });
          const { Name } = rowData;
          if (!Name) return;
          const markdownContent = markdownFiles[
            `../../../markdown/${Name}.md`
          ] as string;
          const renderedHtml = md.render(markdownContent ?? "");
          const newWindow = window.open("", "_blank");
          const styleContent = styles["../../../style.css"] as string;
          if (newWindow) {
            const fullHtml = `
              <!DOCTYPE html>
              <html lang="en" class="bim-ui-dark">
                <head>
                  <meta charset="UTF-8">
                  <title>Help</title>
                  <link rel="stylesheet" href="/src/style.css">
                  <style>${styleContent}</style>
                  <style>
                    body {
                      padding: 5rem;
                      background-color: var(--bim-ui_bg-base);
                      color: var(--bim-ui_bg-contrast-100);
                    }
                  </style>
                </head>
                <body>
                  ${renderedHtml}
                </body>
              </html>
            `;
            newWindow.document.body.innerHTML = fullHtml;
          }
        };

        return BUI.html`
          <div style="display: flex; gap: 0.25rem; align-items: center; justify-content: center;">
            <bim-button
              @click=${onClick}
              style=${tableButtonStyle}
              icon=${appIcons.SELECT}>
            </bim-button>
            <bim-button
              @click=${onOpenMarkdown}
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

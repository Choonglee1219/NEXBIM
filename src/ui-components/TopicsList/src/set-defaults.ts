import * as BUI from "@thatopen/ui";
import { TopicsListState, TopicsListTableData } from "./types";
import { baseTopicTagStyle, defaultTopicStyles } from "./styles";
import { createAuthorTag } from "./author-tag";
import { appIcons, showLightbox } from "../../../globals";
import { tableDefaultContentTemplate } from "../../../globals";

export const setDefaults = (
  state: TopicsListState,
  table: BUI.Table<TopicsListTableData>,
) => {
  const { dataStyles: styles } = state;

  if (table.hiddenColumns.length === 0)
    table.hiddenColumns = ["Guid", "Actions"];
  table.columns = [
    { name: "Title", width: "minmax(0, 2fr)" },
    { name: "Snapshot", width: "70px" },
    { name: "Status", width: "minmax(0, 1fr)" },
    { name: "Type", width: "minmax(0, 1fr)" },
    { name: "Priority", width: "minmax(0, 1fr)" },
    { name: "Author", width: "minmax(0, 1fr)" },
    { name: "Assignee", width: "minmax(0, 1fr)" },
    { name: "Date", width: "minmax(0, 1fr)" },
    { name: "DueDate", width: "minmax(0, 1fr)" },
    { name: "Description", width: "minmax(0, 2fr)" },
  ];

  table.defaultContentTemplate = tableDefaultContentTemplate;

  table.dataTransform = {
    Snapshot: (value) => {
      if (typeof value !== "string" || !value) return "";
      
      const openLightbox = (e: Event) => {
        e.stopPropagation();
        showLightbox(value);
      };

      const showPreview = (e: Event) => {
        const target = e.currentTarget as HTMLElement;
        const img = target.querySelector(".snapshot-preview") as HTMLElement;
        if (img) {
          const rect = target.getBoundingClientRect();
          img.style.display = "block";
          img.style.left = `${rect.left + rect.width / 2}px`;
          img.style.top = `${rect.top + rect.height / 2}px`;
        }
      };

      const hidePreview = (e: Event) => {
        const target = e.currentTarget as HTMLElement;
        const img = target.querySelector(".snapshot-preview") as HTMLElement;
        if (img) img.style.display = "none";
      };

      return BUI.html`
        <div 
          @mouseenter=${showPreview} 
          @mouseleave=${hidePreview} 
          style="position: relative; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;"
        >
          <bim-button icon=${appIcons.IMAGE} @click=${openLightbox} tooltip-title="View Snapshot" style="flex: 0;"></bim-button>
          <img class="snapshot-preview" src="${value}" style="display: none; position: fixed; transform: translate(1.5rem, -50%); width: auto; height: 10rem; border: 1px solid var(--bim-ui_bg-contrast-20); background-color: var(--bim-ui_bg-base); z-index: 9999; border-radius: 0.25rem; box-shadow: 0 4px 6px rgba(0,0,0,0.3); pointer-events: none;">
        </div>
      `;
    },
    Priority: (value) => {
      if (typeof value !== "string") return value;
      const priorityStyles =
        styles?.priorities ?? defaultTopicStyles.priorities;
      const labelStyles = priorityStyles[value];
      return BUI.html`
            <bim-label
              .icon=${labelStyles?.icon}
              style=${BUI.styleMap({ ...baseTopicTagStyle, ...labelStyles?.style })}
            >${value}
            </bim-label>
          `;
    },
    Status: (value) => {
      if (typeof value !== "string") return value;
      const statusStyles = styles?.statuses ?? defaultTopicStyles.statuses;
      const labelStyle = statusStyles[value];
      return BUI.html`
            <bim-label
              .icon=${labelStyle?.icon}
              style=${BUI.styleMap({ ...baseTopicTagStyle, ...labelStyle?.style })}
            >${value}
            </bim-label>
          `;
    },
    Type: (value) => {
      if (typeof value !== "string") return value;
      const typesStyles = styles?.types ?? defaultTopicStyles.types;
      const labelStyles = typesStyles[value];
      return BUI.html`
            <bim-label
              .icon=${labelStyles?.icon}
              style=${BUI.styleMap({ ...baseTopicTagStyle, ...labelStyles?.style })}
            >${value}
            </bim-label>
          `;
    },
    Author: (value) => {
      if (typeof value !== "string") return value;
      return createAuthorTag(value, styles?.users ?? defaultTopicStyles.users);
    },
    Assignee: (value) => {
      if (typeof value !== "string") return value;
      return createAuthorTag(value, styles?.users ?? defaultTopicStyles.users);
    },
  };
};
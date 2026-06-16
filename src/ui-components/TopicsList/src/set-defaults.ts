import * as BUI from "@thatopen/ui";
import { TopicsListState, TopicsListTableData } from "./types";
import { baseTopicTagStyle, defaultTopicStyles } from "./styles";
import { createAuthorTag } from "./author-tag";
import { appIcons, showLightbox, tableButtonStyle } from "../../../globals";
import { tableDefaultContentTemplate } from "../../../globals";

export const setDefaults = (
  state: TopicsListState,
  table: BUI.Table<TopicsListTableData>,
) => {
  const { dataStyles: styles } = state;

  if (table.hiddenColumns.length === 0)
    table.hiddenColumns = ["Guid"];
  table.columns = [
    { name: "Title", width: "minmax(0, 2fr)" },
    { name: "Snapshot", width: "70px" },
    { name: "Status", width: "minmax(0, 1fr)" },
    { name: "Type", width: "minmax(0, 1fr)" },
    { name: "Priority", width: "minmax(0, 1fr)" },
    { name: "Labels", width: "minmax(0, 0.8fr)" },
    { name: "Author", width: "minmax(0, 1fr)" },
    { name: "Assignee", width: "minmax(0, 1fr)" },
    { name: "Date", width: "minmax(0, 1fr)" },
    { name: "DueDate", width: "minmax(0, 1fr)" },
    { name: "Description", width: "minmax(0, 2fr)" },
    { name: "Actions", width: "120px" },
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
          <bim-button icon=${appIcons.IMAGE} @click=${openLightbox} title="View Snapshot" style=${tableButtonStyle}></bim-button>
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
    Labels: (value) => {
      if (typeof value !== "string" || !value.trim()) return "";
      const labelList = value.split(",").map((s) => s.trim()).filter((s) => s !== "");
      const labelStyles = styles?.labels ?? defaultTopicStyles.labels;

      return BUI.html`
        <div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
          ${labelList.map((val) => {
        const config = labelStyles[val];
        const baseStyle = {
          padding: "0.15rem 0.4rem",
          borderRadius: "999px",
          fontSize: "0.7rem",
          backgroundColor: "var(--bim-ui_bg-contrast-20)",
          "--bim-label--c": "var(--bim-ui_bg-contrast-100)",
        };
        const labelStyle = config ? { ...baseStyle, ...config.style } : baseStyle;
        return BUI.html`
              <bim-label
                .icon=${config?.icon}
                style=${BUI.styleMap(labelStyle)}
              >${val}</bim-label>
            `;
      })}
        </div>
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
    Actions: (value, rowData) => {
      const guid = rowData.Guid;
      const isUnsynced = value === "unsynced";

      const onUpdateClick = (e: Event) => {
        e.stopPropagation();
        table.dispatchEvent(new CustomEvent("topic-edit", {
          detail: { guid, rowData }
        }));
      };

      const onDeleteClick = (e: Event) => {
        e.stopPropagation();
        table.dispatchEvent(new CustomEvent("topic-delete", {
          detail: { guid, rowData }
        }));
      };

      const syncIcon = isUnsynced
        ? BUI.html`
            <bim-button 
              icon=${appIcons.WARNING} 
              style="${tableButtonStyle} pointer-events: none;" 
              title="Unsynced comments available. Please open topic details to sync."
              active
            ></bim-button>
          `
        : BUI.html`
            <bim-button 
              icon=${appIcons.IDS_CHECK} 
              style="${tableButtonStyle} opacity: 0.5; pointer-events: none;" 
              title="Synced with TDVS"
            ></bim-button>
          `;

      return BUI.html`
        <div style="display: flex; align-items: center; justify-content: center; gap: 0.375rem; height: 100%; width: 100%;">
          ${syncIcon}
          <bim-button 
            icon=${appIcons.EDIT} 
            @click=${onUpdateClick} 
            title="Update Topic" 
            style="${tableButtonStyle}"
          ></bim-button>
          <bim-button 
            icon=${appIcons.DELETE} 
            @click=${onDeleteClick} 
            title="Delete Topic" 
            style="${tableButtonStyle}"
          ></bim-button>
        </div>
      `;
    },
  };
};
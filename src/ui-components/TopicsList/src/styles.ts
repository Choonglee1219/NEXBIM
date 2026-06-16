import { TopicStyles } from "./types";
import { appIcons } from "../../../globals";

export const defaultTopicStyles: Required<TopicStyles> = {
  users: {
    "jhon.doe@example.com": {
      name: "Jhon Doe",
    },
  },
  priorities: {
    "On hold": {
      icon: appIcons.HOLD,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#767676",
        "--bim-icon--c": "#767676",
      },
    },
    Minor: {
      icon: appIcons.MINOR,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#4CAF50",
        "--bim-icon--c": "#4CAF50",
      },
    },
    Normal: {
      icon: appIcons.NORMAL,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#FB8C00",
        "--bim-icon--c": "#FB8C00",
      },
    },
    Major: {
      icon: appIcons.MAJOR,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#FF5252",
        "--bim-icon--c": "#FF5252",
      },
    },
    Critical: {
      icon: appIcons.CRITICAL,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#FB8C00",
        "--bim-icon--c": "#FB8C00",
      },
    },
  },
  statuses: {
    Open: {
      icon: appIcons.STATUS,
      style: {
        backgroundColor: "#500000",
        "--bim-label--c": "#FB0000",
        "--bim-icon--c": "#FB0000",
      },
    },
    Assigned: {
      icon: appIcons.STATUS,
      style: {
        backgroundColor: "#fa89004d",
        "--bim-label--c": "#FB8C00",
        "--bim-icon--c": "#FB8C00",
      },
    },
    Resolved: {
      icon: appIcons.STATUS,
      style: {
        backgroundColor: "#4CAF504D",
        "--bim-label--c": "#4CAF50",
        "--bim-icon--c": "#4CAF50",
      },
    },
    Closed: {
      icon: appIcons.STATUS,
      style: {
        backgroundColor: "#414141",
        "--bim-label--c": "#727272",
        "--bim-icon--c": "#727272",
      },
    },
  },
  types: {
    Error: {
      icon: appIcons.DELETE,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#FF5252",
        "--bim-icon--c": "#FF5252",
      },
    },
    Info: {
      icon: appIcons.HELP,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#29B6F6",
        "--bim-icon--c": "#29B6F6",
      },
    },
    Unknown: {
      icon: appIcons.HELP,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#9E9E9E",
        "--bim-icon--c": "#9E9E9E",
      },
    },
    Warning: {
      icon: appIcons.CRITICAL,
      style: {
        backgroundColor: "var(--bim-ui_bg-contrast-20)",
        "--bim-label--c": "#FFC107",
        "--bim-icon--c": "#FFC107",
      },
    },
  },
  labels: {
    A: { style: { backgroundColor: "#2196F3", "--bim-label--c": "#ffffff" } },
    C: { style: { backgroundColor: "#795548", "--bim-label--c": "#ffffff" } },
    E: { style: { backgroundColor: "#FFC107", "--bim-label--c": "#000000" } },
    J: { style: { backgroundColor: "#9E9E9E", "--bim-label--c": "#ffffff" } },
    M: { style: { backgroundColor: "#0D47A1", "--bim-label--c": "#ffffff" } },
    P: { style: { backgroundColor: "#009688", "--bim-label--c": "#ffffff" } },
    R: { style: { backgroundColor: "#9C27B0", "--bim-label--c": "#ffffff" } },
  },
  stages: {
    Design: { style: { backgroundColor: "var(--bim-ui_bg-contrast-20)" } },
    Construction: { style: { backgroundColor: "var(--bim-ui_bg-contrast-20)" } },
    Maintenance: { style: { backgroundColor: "var(--bim-ui_bg-contrast-20)" } },
  }
};

export const baseTopicTagStyle = {
  padding: "0.25rem 0.5rem",
  borderRadius: "999px",
  "--bim-label--c": "var(--bim-ui_bg-contrast-100)",
};
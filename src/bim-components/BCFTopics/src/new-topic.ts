import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { users } from "../../../setup/users";
import { topicFormTemplate, TopicFormUI } from "../../../ui-components/TopicsList/src/form-template";

export const newTopic = (components: OBC.Components) => {
  const formTemplate = (state: TopicFormUI) => {
    return BUI.html`
      <div style="flex: 1; display: flex; flex-direction: column; padding: 0; box-sizing: border-box; min-height: 0;">
        ${topicFormTemplate(state)}
      </div>
    `;
  };

  const [topicForm, updateTopicForm] = BUI.Component.create<HTMLDivElement, TopicFormUI>(
    formTemplate,
    {
      components,
      styles: { users },
    }
  );

  return [topicForm, updateTopicForm] as const;
};
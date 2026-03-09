import { DB, ConversationMessage } from "./db.js";
import { render } from "./markdown_renderer.js";
import { DoubleLinkedListNode } from "./double_linked_list.js";
import { main as dbMain } from "./firestore_db.js";
import { currentModal, toggleModal } from "./modal.js";
import { main as authMain } from "./auth.js";
import { createForm, getFormValues } from "./schema_form.js";
import { Api, apiMap, ApiParams } from "./apis.js";
import {
  Conversation,
  ConversationMessageData,
  ConversationMessageList,
} from "./conversation.js";

let apiParams: ApiParams = localStorage.getItem("apiParams")
  ? JSON.parse(localStorage.getItem("apiParams")!)
  : {
      api: "openai.com",
      params: {
        model: "gpt-5-mini",
        stream: true,
      },
    };

const chatDiv = document.getElementById("chat") as HTMLElement;
const input = document.getElementById("chat-input") as HTMLElement;
const roleSelect = document.getElementById("role-select") as HTMLSelectElement;

const historyModal = document.getElementById("history-modal") as HTMLElement;
const historyContainer = document.getElementById(
  "history-container",
) as HTMLElement;
const configModal = document.getElementById("config-modal") as HTMLElement;
const errorModal = document.getElementById("error-modal") as HTMLElement;
const enpointSelect = document.getElementById(
  "set-endpoint-input",
) as HTMLSelectElement;
const paramsForm = document.getElementById("params-form") as HTMLFormElement;
const paramsContainer = document.getElementById(
  "params-container",
) as HTMLElement;
const presetSelect = document.getElementById(
  "preset-select",
) as HTMLSelectElement;

let lastFocusedMessage: DoubleLinkedListNode<ConversationMessageData> | null =
  null;

let db: DB;
let currentConversation = new ConversationMessageList();

let lastChatDivScroll = 0;
let lastCharDivScrollTop = 0;

let currentStopSignal: AbortController | null = null;

function getApiConfiguration(endpoint: string): Api | undefined {
  console.log("getApiConfiguration called with endpoint:", endpoint);
  console.log("apiMap:", apiMap);
  return apiMap[endpoint];
}

async function submitForm() {
  const inputValue = input.innerText.trim();
  let lastMessage = currentConversation.tail;
  if (inputValue !== "") {
    input.innerText = "";

    const message = {
      role: roleSelect.value as "user" | "assistant" | "developer",
      content: inputValue,
    };
    await addMessage(db, message);
    lastMessage = currentConversation.tail;
  } else if (lastFocusedMessage) {
    lastMessage = lastFocusedMessage;
  }

  const api = apiMap[apiParams.api];
  if (!api) {
    showError("API configuration not found for endpoint: " + apiParams.api);
    return;
  }

  const messages: Message[] = [];
  let currentNode = currentConversation.head;
  while (currentNode != null) {
    messages.push({
      role: currentNode.data.message.role,
      content: currentNode.data.message.content,
    });
    if (currentNode === lastMessage) {
      break;
    }
    currentNode = currentNode.next;
  }

  currentStopSignal = new AbortController();
  let response = api.fetcher(
    messages,
    apiParams.params,
    currentStopSignal.signal,
  );
  const isLast = lastMessage === currentConversation.tail;
  const assistantMessage: Message = { role: "assistant", content: "" };
  const { node, element } = await addMessage(db, assistantMessage, lastMessage);
  const message: string[] = [];
  let start = Date.now();
  let lastUpdate = 0;

  try {
    for await (const chunk of response) {
      message.push(chunk);
      const now = Date.now();
      if (now - lastUpdate > 200) {
        updateUiMessage(element, message.join(""));
        if (isLast && start > lastChatDivScroll) {
          chatDiv.scrollTop = chatDiv.scrollHeight;
        }
        lastUpdate = now;
      }
    }
  } catch (err) {
    // Ignore abort errors; they are expected when the user hits "stop".
    if (err instanceof Error && err.name !== "AbortError") {
      // Re‑throw any other unexpected errors.
      throw err;
    }
    // If we caught an AbortError or any other error that we're ignoring,
    // don't update the final message.
    return;
  }

  // Only update the final message if the stream completed normally.
  assistantMessage.content = message.join("");
  updateUiMessage(element, assistantMessage.content);
  if (isLast && start > lastChatDivScroll) {
    chatDiv.scrollTop = chatDiv.scrollHeight;
  }
  await currentConversation.updateMessage(db, assistantMessage, node);
}

function addMessage(
  db: DB,
  message: Message,
  afterMessage?: DoubleLinkedListNode<ConversationMessageData> | null,
) {
  return new Promise<{
    node: DoubleLinkedListNode<ConversationMessageData>;
    element: HTMLDivElement;
  }>(async function (resolve) {
    const node = await currentConversation.addMessage(
      db,
      message,
      afterMessage,
    );
    const element = addMessageToUi(node.data, afterMessage?.data.id);
    resolve({ node, element });
    if (node === currentConversation.head) {
      router.goTo(`/conversation/${node.data.conversationKey}`, false);
      const title = await fetchAsPromise(
        [
          {
            role: "developer",
            content:
              "Generate title for following user prompt (less than 10 words).",
          },
          {
            role: "user",
            content: `Generate title for prompt: "${message.content}"`,
          },
        ],
        apiParams,
      );

      await db.updateObject(
        "conversations",
        {
          title,
        },
        node.data.conversationKey,
      );
    }
  });
}

function addMessageToUi(
  messageData: ConversationMessageData,
  afterMessageId?: number,
): HTMLDivElement {
  const div = document.createElement("div");
  div.setAttribute("contenteditable", "true");
  div.className = `message-div ${messageData.message.role}`;
  const nodes = render(messageData.message.content);
  for (const child of nodes) {
    div.appendChild(child);
  }
  div.dataset.id = messageData.id!.toString();
  div.dataset.role = messageData.message.role;
  div.addEventListener("focusin", function (e) {
    const element = e.currentTarget as HTMLElement;
    element.setAttribute("spellcheck", "true");
    const node = currentConversation.getMessage(parseInt(element.dataset.id!));
    lastFocusedMessage = node;
    if (!node) {
      throw new Error("Message not found");
    }
    element.replaceChildren(document.createTextNode(node.data.message.content));
  });
  div.addEventListener("focusout", function (e) {
    const element = e.currentTarget as HTMLElement;
    element.setAttribute("spellcheck", "false");
    const messageKey = parseInt(element.dataset.id!);
    const content = element.innerText.trim();
    if (!content) {
      if (lastFocusedMessage?.data.id === messageKey) {
        lastFocusedMessage = null;
      }
      currentConversation.deleteMessage(db, messageKey);
      element.parentElement?.removeChild(element);
      return;
    }
    const nodes = render(content);
    element.replaceChildren(...nodes);
    const node = currentConversation.getMessage(messageKey);
    if (!node) throw new Error("Message not found");
    currentConversation.updateMessage(
      db,
      {
        content: content,
        role: element.dataset.role as "user" | "assistant" | "developer",
      },
      node,
    );
  });
  if (afterMessageId !== undefined) {
    const afterElement = chatDiv.querySelector(
      `div.message-div[data-id='${afterMessageId}']`,
    );
    if (!afterElement) {
      throw new Error("After element not found");
    }
    afterElement.after(div);
  } else {
    chatDiv.appendChild(div);
    chatDiv.scrollTop = chatDiv.scrollHeight;
  }
  return div;
}

chatDiv.addEventListener("scroll", function () {
  const scrollTop = chatDiv.scrollTop;
  if (scrollTop - lastCharDivScrollTop < 0) {
    lastChatDivScroll = Date.now();
  }
  lastCharDivScrollTop = scrollTop;
});

function updateUiMessage(element: HTMLDivElement, content: string) {
  const nodes = render(content);
  element.replaceChildren(...nodes);
}

async function setConversation(
  conversationKey: number,
  conversation: Conversation,
) {
  currentConversation.clear();
  const conversationMessages = (await db.getAllIndexKey(
    "conversationsMessages",
    "conversationKey",
    conversationKey,
  )) as Map<number, ConversationMessage>;

  let key: number | null = conversation.root;
  while (key) {
    const conversationMessage = conversationMessages.get(key);
    if (!conversationMessage) {
      throw new Error("Message not found");
    }
    currentConversation.add({
      id: key,
      conversationKey: conversationKey,
      message: conversationMessage.message,
    });
    key = conversationMessage.nextKey;
  }
  chatDiv.replaceChildren();
  currentConversation.forEach(function (conversationMessage) {
    addMessageToUi(conversationMessage);
  });
}

async function deleteConversation(conversationKey: number) {
  if (currentConversation.head?.data.conversationKey === conversationKey) {
    currentConversation.clear();
    chatDiv.replaceChildren();
    router.goTo("/");
  }
  await db.deleteAllIndexKey(
    "conversationsMessages",
    "conversationKey",
    conversationKey,
  );
  await db.deleteObject("conversations", conversationKey);
}

window.addEventListener("error", function (e) {
  alert("Error occurred: " + e.error.message);
});

window.addEventListener("unhandledrejection", function (e) {
  alert("Error occurred: " + e.reason.message);
});

function showError(message: string) {
  const errorText = document.getElementById("error-message") as HTMLElement;
  errorText.textContent = message;
  toggleModal(errorModal);
}

function setPresets(presets: { [key: string]: ApiParams }) {
  localStorage.setItem("presets", JSON.stringify(presets));
  presetSelect.replaceChildren();
  const firstOption = document.createElement("option");
  firstOption.value = "";
  presetSelect.appendChild(firstOption);
  for (const presetName in presets) {
    const option = document.createElement("option");
    option.value = presetName;
    option.textContent = presetName;
    presetSelect.appendChild(option);
  }
}

async function main() {
  dbMain();
  authMain();

  db = new DB();
  await db.init();

  document
    .getElementById("form")!
    .addEventListener("submit", async function (e) {
      e.preventDefault();
      await submitForm();
    });

  document
    .getElementById("history-button")!
    .addEventListener("click", async function () {
      if (currentModal === historyModal) {
        toggleModal(historyModal);
        return;
      }
      historyContainer.replaceChildren();
      const conversations = (await db.getAll("conversations", "prev")) as Map<
        number,
        Conversation
      >;
      for (const [key, conversation] of conversations) {
        const container = document.createElement("div");
        container.className = "history-item-container";
        container.dataset.id = key.toString();
        const a = document.createElement("a");
        a.href = `/conversation/${key}`;
        a.className = "history-item undecorated-a";
        a.title = conversation.title;
        a.textContent = `${new Date(conversation.timestamp).toLocaleString()} | ${conversation.title.length > 50 ? conversation.title.slice(0, 50) + "..." : conversation.title}`;
        const button = document.createElement("button");
        button.textContent = "Delete";
        // button.className = 'history-delete-button'
        button.addEventListener("click", async function (e) {
          const parent = (e.currentTarget as HTMLElement).parentElement!;
          const id = parseInt(parent.dataset.id as string);
          await deleteConversation(id);
          parent.remove();
        });
        a.addEventListener("click", async function (e) {
          e.preventDefault();
          const id = parseInt(
            (e.currentTarget as HTMLElement).parentElement!.dataset
              .id as string,
          );
          router.goTo(`/conversation/${id}`);
        });
        container.appendChild(a);
        container.appendChild(button);
        historyContainer.appendChild(container);
      }
      toggleModal(historyModal, "flex");
    });

  document
    .getElementById("new-chat-button")
    ?.addEventListener("click", function () {
      router.goTo("/");
    });

  document
    .getElementById("input-set-button")
    ?.addEventListener("click", async function () {
      const content = input.innerText.trim();
      if (!content) {
        console.warn("Empty input, ignoring");
      }
      input.innerText = "";
      const message = {
        role: roleSelect.value as "user" | "assistant" | "developer",
        content,
      };
      const node = await currentConversation.addMessage(db, message);
      addMessageToUi(node.data);
    });

  input.addEventListener("keydown", async function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await submitForm();
    }
  });

  document
    .getElementById("set-config-button")
    ?.addEventListener("click", function () {
      toggleModal(configModal);
    });

  document.getElementById("set-preset")?.addEventListener("click", function () {
    const name = (document.getElementById("preset-name") as HTMLInputElement)
      .value;
    if (!name) {
      showError("Enter preset name to set");
    }
    const params = {
      api: enpointSelect.value,
      params: getFormValues(
        paramsContainer.querySelector(".schema-form-container") as HTMLElement,
      ),
    };
    const presets: { [key: string]: ApiParams } = localStorage.getItem(
      "presets",
    )
      ? JSON.parse(localStorage.getItem("presets")!)
      : {};
    presets[name] = params;

    setPresets(presets);
  });

  presetSelect.addEventListener("change", function (e) {
    const name = (e.currentTarget as HTMLSelectElement).value;
    if (!name) {
      return;
    }
    const presets: { [key: string]: ApiParams } = localStorage.getItem(
      "presets",
    )
      ? JSON.parse(localStorage.getItem("presets")!)
      : [];
    apiParams = presets[name];
    enpointSelect.value = apiParams.api;
    const api = getApiConfiguration(apiParams.api);
    if (!api) {
      showError("API configuration not found for endpoint: " + apiParams.api);
      return;
    }
    paramsContainer.replaceChildren(
      createForm(api.paramsSchema, apiParams.params),
    );
    presetSelect.value = "";
  });

  document
    .getElementById("delete-preset")
    ?.addEventListener("click", function () {
      const name = (document.getElementById("preset-name") as HTMLInputElement)
        .value;
      if (!name) {
        showError("Enter preset name to delete");
      }
      const presets: { [key: string]: ApiParams } = localStorage.getItem(
        "presets",
      )
        ? JSON.parse(localStorage.getItem("presets")!)
        : {};
      delete presets[name];
      setPresets(presets);
    });

  document
    .getElementById("export-button")
    ?.addEventListener("click", function () {
      const json = JSON.stringify(
        currentConversation.map(function (conversationMessage) {
          return conversationMessage.message;
        }),
      );
      const element = document.createElement("a");
      element.style.display = "none";
      element.setAttribute(
        "href",
        "data:application/json;charset=utf-8," + encodeURIComponent(json),
      );
      element.setAttribute("download", "chat-ui-export.json");
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    });

  document
    .getElementById("import-button")
    ?.addEventListener("click", function () {
      document.getElementById("import-input")?.click();
    });

  document
    .getElementById("import-input")
    ?.addEventListener("change", async function () {
      const file = (this as HTMLInputElement).files![0];
      if (!file) {
        return;
      }
      const messages = JSON.parse(await file.text());
      currentConversation.clear();
      chatDiv.replaceChildren();
      for (const message of messages) {
        addMessageToUi(
          (await currentConversation.addMessage(db, message)).data,
          message,
        );
      }
    });

  document
    .getElementById("error-close-button")
    ?.addEventListener("click", function () {
      errorModal.style.display = "none";
    });

  window.addEventListener("popstate", async function (e) {
    const path = location.pathname;
    router.render(path);
  });

  if (location.pathname !== "/") {
    const path = location.pathname;
    router.render(path);
  }

  document
    .getElementById("app-heading-a")!
    .addEventListener("click", function (e) {
      e.preventDefault();
      router.goTo("/");
    });

  for (const api of Object.keys(apiMap)) {
    const option = document.createElement("option");
    option.value = api;
    option.textContent = api;
    enpointSelect.appendChild(option);
  }
  enpointSelect.addEventListener("change", function () {
    apiParams.api = enpointSelect.value;
    if (!enpointSelect.value) {
      paramsContainer.replaceChildren();
      paramsForm.style.display = "none";
      return;
    }
    paramsForm.style.display = "block";
    const api = getApiConfiguration(enpointSelect.value);
    if (!api) {
      showError(
        "API configuration not found for endpoint: " + enpointSelect.value,
      );
      return;
    }
    paramsContainer.replaceChildren(createForm(api.paramsSchema ?? {}));
  });

  paramsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const values = getFormValues(
      paramsContainer.querySelector(".schema-form-container") as HTMLElement,
    );
    apiParams.params = values;
    localStorage.setItem("apiParams", JSON.stringify(apiParams));
    toggleModal(configModal);
  });

  if (apiParams) {
    enpointSelect.value = apiParams.api;
    paramsForm.style.display = "block";
    const api = getApiConfiguration(apiParams.api);
    if (!api) {
      showError("API configuration not found for endpoint: " + apiParams.api);
      return;
    }
    paramsContainer.replaceChildren(
      createForm(api.paramsSchema, apiParams.params),
    );
  }

  const presets = localStorage.getItem("presets")
    ? JSON.parse(localStorage.getItem("presets")!)
    : {};
  setPresets(presets);

  document.getElementById("stop-button")?.addEventListener("click", () => {
    if (currentStopSignal) {
      currentStopSignal.abort();
    }
  });
}

main();

export async function fetchAsPromise(
  message: Message[],
  apiParams: ApiParams,
  signal?: AbortSignal,
): Promise<string> {
  const api = apiMap[apiParams.api];
  const response = api.fetcher(message, apiParams.params, signal);
  let result = [];
  try {
    for await (const chunk of response) {
      result.push(chunk);
    }
  } catch (err) {
    // Ignore abort errors; they are expected when the user hits "stop".
    if (err instanceof Error && err.name !== "AbortError") {
      // Re‑throw any other unexpected errors.
      throw err;
    }
    // If aborted, return empty string (conversation title generation was cancelled)
    return "";
  }
  return Promise.resolve(result.join(""));
}

const router = {
  async goTo(path: string, render: boolean = true) {
    if (currentModal) {
      toggleModal(currentModal);
    }
    history.pushState(null, "", path);
    if (!render) return;
    this.render(path);
  },
  async render(path: string) {
    if (path === "/") {
      currentConversation.clear();
      chatDiv.replaceChildren();
      return;
    }
    if (path.startsWith("/conversation/")) {
      const id = parseInt(path.split("/")[2]);
      if (isNaN(id)) {
        throw new Error("Invalid conversation ID");
      }
      await setConversation(
        id,
        (await db.getObject("conversations", id)) as Conversation,
      );
    }
  },
};

export interface Message {
  role: "user" | "assistant" | "developer";
  content: string;
}

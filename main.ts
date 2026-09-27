import { DB, ConversationMessage } from "./db.js";
import "./chat-message.js"; // registers <chat-message> custom element
import type { ChatMessage } from "./chat-message.js";
import { DoubleLinkedListNode } from "./double_linked_list.js";
// import { main as dbMain } from "./firestore_db.js";
import { currentModal, toggleModal } from "./modal.js";
import { main as authMain } from "./auth.js";
import { createForm, getFormValues } from "./schema_form.js";
import { Api, apiMap, ApiParams, StreamChunk } from "./apis.js";
import type { TokenUsage } from "./apis.js";
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

// Listen for events from chat-message custom elements.
chatDiv.addEventListener("chat-message:focus", (e) => {
  const id = (e as CustomEvent).detail.id;
  lastFocusedMessage = currentConversation.getMessage(id);
});

chatDiv.addEventListener("chat-message:update", (e) => {
  const { id, content, role } = (e as CustomEvent).detail;
  const node = currentConversation.getMessage(id);
  if (!node) throw new Error("Message not found");
  currentConversation.updateMessage(db, { content, role }, node);
});

chatDiv.addEventListener("chat-message:delete", (e) => {
  const id = (e as CustomEvent).detail.id;
  if (lastFocusedMessage?.data.id === id) {
    lastFocusedMessage = null;
  }
  // The element is still in the DOM while the event dispatches.
  const element = chatDiv.querySelector(
    `chat-message[data-id='${id}']`,
  ) as ChatMessage | null;
  if (element) {
    removeMessageElement(element);
  }
  currentConversation.deleteMessage(db, id);
  resetTokenTotal();
});

chatDiv.addEventListener("chat-message:retry", (e) => {
  retryMessage((e as CustomEvent).detail.id);
});

chatDiv.addEventListener("chat-message:branch", (e) => {
  branchMessage((e as CustomEvent).detail.id);
});

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
const tokenTotalEl = document.getElementById("token-total") as HTMLElement;

let lastFocusedMessage: DoubleLinkedListNode<ConversationMessageData> | null =
  null;

let db: DB;
let currentConversation = new ConversationMessageList();

let currentStopSignal: AbortController | null = null;

function getApiConfiguration(endpoint: string): Api | undefined {
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
    // Continuing from a summary node sends from the end of the
    // conversation, not a response inserted before the verbatim tail.
    lastMessage =
      lastFocusedMessage.data.message.role === "summary"
        ? currentConversation.tail
        : lastFocusedMessage;
  }

  await streamResponse(lastMessage);
}

async function retryMessage(messageId: number) {
  const node = currentConversation.getMessage(messageId);
  if (!node) return;
  const prev = node.prev;
  if (!prev) return;

  // Remove the existing assistant message from conversation and DOM.
  const element = chatDiv.querySelector(
    `chat-message[data-id='${messageId}']`,
  ) as ChatMessage | null;
  if (element) {
    removeMessageElement(element);
  }
  await currentConversation.deleteMessage(db, messageId);

  await streamResponse(prev);
}

async function branchMessage(messageId: number) {
  const node = currentConversation.getMessage(messageId);
  if (!node) throw new Error("Message not found");

  const branch = new ConversationMessageList();
  let current = currentConversation.head;
  while (current) {
    await branch.addMessage(db, current.data.message);
    if (current === node) break;
    current = current.next;
  }
  if (!current) throw new Error("Branch point not reached");

  router.goTo(`/conversation/${branch.head!.data.conversationKey}`);
}

async function summarizeConversation() {
  // Use the last summary node as the roll-up base. Older summaries stay
  // in the list as history — the payload walk picks up the last one.
  const allNodes = currentConversation.toNodeArray();
  const summaryNodes = allNodes.filter(
    (node) => node.data.message.role === "summary",
  );
  const lastSummaryNode = summaryNodes[summaryNodes.length - 1] ?? null;

  // Collect story messages after the last summary; the last few stay
  // verbatim and the rest are folded into the new summary.
  const tailSize = Math.max(
    1,
    parseInt(
      (document.getElementById("summarize-tail-input") as HTMLInputElement)
        .value,
    ) || 4,
  );
  let afterLastSummary = !lastSummaryNode;
  const storyNodes: DoubleLinkedListNode<ConversationMessageData>[] = [];
  for (const node of allNodes) {
    if (node === lastSummaryNode) {
      afterLastSummary = true;
      continue;
    }
    if (
      afterLastSummary &&
      ["user", "assistant"].includes(node.data.message.role)
    ) {
      storyNodes.push(node);
    }
  }
  const summarizableNodes = storyNodes.slice(0, -tailSize);
  const tailNodes = storyNodes.slice(-tailSize);

  if (summarizableNodes.length === 0) {
    console.warn("Nothing new to summarize, ignoring");
    return;
  }

  // JSON input: unambiguous role attribution even when message contents
  // contain newlines, colons, or role-like text.
  const summaryInput = {
    ...(lastSummaryNode && lastSummaryNode.data.message.content
      ? { previousSummary: lastSummaryNode.data.message.content }
      : {}),
    messages: summarizableNodes.map((node) => ({
      role: node.data.message.role,
      content: node.data.message.content,
    })),
  };

  // The new summary goes right before the verbatim tail. It is added
  // empty and streamed into; older summaries stay in the list as history.
  const anchor = tailNodes[0]?.prev ?? null;
  if (!anchor) {
    throw new Error("Cannot place summary: no anchor before tail");
  }

  const summaryMessage: Message = { role: "summary", content: "" };
  const { node, element } = await addMessage(db, summaryMessage, anchor);

  const stopSignal = new AbortController();
  element.stopController = stopSignal;
  element.setStreaming(true);
  element.scrollIntoView(true);

  const chunks: string[] = [];
  let lastUpdate = 0;

  try {
    const response = apiMap[apiParams.api].fetcher(
      [
        {
          role: "developer",
          content:
            "You are summarizing a long conversation so it fits in context. " +
            "The conversation is provided as JSON: a 'messages' array of " +
            "{role, content} objects, and optionally a 'previousSummary' " +
            "string covering earlier messages. Write a concise summary of " +
            "everything that has happened, combining the previous summary " +
            "(if present) with the new messages, preserving the information " +
            "that matters for continuing the conversation correctly. " +
            "Do not include anything from this instruction in the summary.",
        },
        { role: "user", content: JSON.stringify(summaryInput) },
      ],
      apiParams.params,
      stopSignal.signal,
    );
    for await (const chunk of response) {
      if (!chunk) continue;
      const text = typeof chunk === "string" ? chunk : chunk.text;
      if (text) {
        chunks.push(text);
        const now = Date.now();
        if (now - lastUpdate > 100) {
          updateUiMessage(element, chunks.join(""));
          lastUpdate = now;
        }
      }
      if (typeof chunk === "object" && chunk.usage) {
        element.setUsage(chunk.usage);
        updateTokenTotal(chunk.usage);
      }
    }
  } catch (err) {
    // Aborted or failed — remove the incomplete node; the previous
    // summary (if any) is still in place.
    removeMessageElement(element);
    if (lastFocusedMessage?.data.id === node.data.id) {
      lastFocusedMessage = null;
    }
    await currentConversation.deleteMessage(db, node.data.id);
    resetTokenTotal();
    if (err instanceof Error && err.name !== "AbortError") {
      throw err;
    }
    return;
  }

  element.stopController = null;
  element.setStreaming(false);
  summaryMessage.content = chunks.join("");
  updateUiMessage(element, summaryMessage.content);
  await currentConversation.updateMessage(db, summaryMessage, node);

  if (!summaryMessage.content.trim()) {
    console.warn("Summarization returned empty content, removing node");
    removeMessageElement(element);
    if (lastFocusedMessage?.data.id === node.data.id) {
      lastFocusedMessage = null;
    }
    await currentConversation.deleteMessage(db, node.data.id);
    return;
  }
}

async function streamResponse(
  lastMessage: DoubleLinkedListNode<ConversationMessageData> | null,
) {
  const api = apiMap[apiParams.api];
  if (!api) {
    showError("API configuration not found for endpoint: " + apiParams.api);
    return;
  }

  let messages: Message[] = [];
  let summaryContent: string | null = null;
  let currentNode = currentConversation.head;
  while (currentNode != null) {
    const msg: Message = {
      role: currentNode.data.message.role,
      content: currentNode.data.message.content,
    };
    if (msg.role === "summary") {
      // Summary nodes are never sent directly: they replace everything
      // before them (except the developer message) and get folded into
      // the developer message below. Empty nodes (e.g. mid-stream) are
      // skipped entirely.
      if (msg.content) {
        summaryContent = msg.content;
        messages = messages.filter((m) => m.role === "developer");
      }
    } else if (msg.role !== "hint") {
      // Skip hint messages — if the last message is a hint,
      // it gets merged into the final user message below.
      messages.push(msg);
    }
    // A summary node is a watermark, not a stop point: the live window
    // after it must still be sent.
    if (currentNode === lastMessage && msg.role !== "summary") {
      break;
    }
    currentNode = currentNode.next;
  }
  if (lastMessage?.data.message.role === "hint") {
    const last = messages[messages.length - 1];
    if (last && last.role === "user") {
      last.content = `${last.content}\n\n[Hint: ${lastMessage.data.message.content}]`;
    } else {
      messages.push({
        role: "user",
        content: `[Hint: ${lastMessage.data.message.content}]`,
      });
    }
  }

  if (summaryContent) {
    // Append the summary to the first developer message (every fetcher
    // treats the first developer specially), or create one if absent.
    const developerIndex = messages.findIndex((m) => m.role === "developer");
    const summaryBlock = `\n\n[Summary of events so far]\n${summaryContent}`;
    if (developerIndex !== -1) {
      messages[developerIndex].content += summaryBlock;
    } else {
      messages.unshift({
        role: "developer",
        content: `[Summary of events so far]\n${summaryContent}`,
      });
    }
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
  element.stopController = currentStopSignal;
  const initialPaddingHeight = isLast ? window.innerHeight * 0.7 : 0;
  chatDiv.style.setProperty("--spacer-padding", `${initialPaddingHeight}px`);
  // chatDiv.offsetHeight; // force layout
  element.scrollIntoView(true);
  let observer: ResizeObserver | undefined;
  if (isLast) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        let paddingHeight = Math.max(
          0,
          initialPaddingHeight - entry.borderBoxSize[0].blockSize,
        );
        chatDiv.style.setProperty("--spacer-padding", `${paddingHeight}px`);
      }
    });
    observer.observe(element);
  }

  element.setStreaming(true);

  const message: string[] = [];
  let lastUpdate = 0;

  let tokenUsage: TokenUsage | undefined;

  try {
    for await (const chunk of response) {
      if (!chunk) continue;
      // Support both legacy string chunks and new StreamChunk objects.
      const text = typeof chunk === "string" ? chunk : chunk.text;
      if (text) {
        message.push(text);
        const now = Date.now();
        if (now - lastUpdate > 100) {
          updateUiMessage(element, message.join(""));
          lastUpdate = now;
        }
      }
      if (typeof chunk === "object" && chunk.usage) {
        tokenUsage = { ...tokenUsage, ...chunk.usage };
        element.setUsage(chunk.usage);
        updateTokenTotal(chunk.usage);
      }
    }
  } catch (err) {
    // Ignore abort errors; they are expected when the user hits "stop".
    if (err instanceof Error && err.name !== "AbortError") {
      throw err;
    }
    return;
  } finally {
    element.stopController = null;
    element.setStreaming(false);
    observer?.disconnect();
    assistantMessage.content = message.join("");
    updateUiMessage(element, assistantMessage.content);
    if (tokenUsage) {
      element.setUsage(tokenUsage);
    }
    await currentConversation.updateMessage(db, assistantMessage, node);
  }
}

function addMessage(
  db: DB,
  message: Message,
  afterMessage?: DoubleLinkedListNode<ConversationMessageData> | null,
) {
  return new Promise<{
    node: DoubleLinkedListNode<ConversationMessageData>;
    element: ChatMessage;
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
  atHead: boolean = false,
  beforeElement?: HTMLElement,
): ChatMessage {
  const el = document.createElement("chat-message") as ChatMessage;
  el.setAttribute("data-id", messageData.id!.toString());
  el.setAttribute("data-role", messageData.message.role);
  el.updateContent(messageData.message.content);
  const gap = createMessageGap();
  if (atHead) {
    chatDiv.prepend(gap, el);
  } else if (beforeElement) {
    beforeElement.before(gap, el);
  } else if (afterMessageId !== undefined) {
    const afterElement = chatDiv.querySelector(
      `chat-message[data-id='${afterMessageId}']`,
    );
    if (!afterElement) {
      throw new Error("After element not found");
    }
    afterElement.after(gap, el);
  } else {
    chatDiv.appendChild(gap);
    chatDiv.appendChild(el);
  }
  return el;
}

function createMessageGap(): HTMLElement {
  const gap = document.createElement("div");
  gap.className = "message-gap";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "new message";
  button.addEventListener("click", function () {
    // Insert before the message this gap precedes.
    const beforeEl = gap.nextElementSibling as ChatMessage | null;
    insertMessageBefore(beforeEl);
  });
  gap.appendChild(button);
  return gap;
}

async function insertMessageBefore(beforeEl: ChatMessage | null) {
  const message: Message = {
    role: roleSelect.value as "user" | "assistant" | "developer" | "hint",
    content: "",
  };

  // Insert after the previous message; at the head if this gap is above
  // the first message; at the tail if there is no message below.
  let atHead = false;
  let afterNode: DoubleLinkedListNode<ConversationMessageData> | null = null;
  if (beforeEl) {
    const anchorNode = currentConversation.getMessage(beforeEl.messageId);
    if (!anchorNode) return;
    if (anchorNode.prev) {
      afterNode = anchorNode.prev;
    } else {
      atHead = true;
    }
  } else {
    afterNode = currentConversation.tail;
  }

  const node = atHead
    ? await currentConversation.addHeadMessage(db, message)
    : await currentConversation.addMessage(db, message, afterNode);
  const element = addMessageToUi(
    node.data,
    afterNode?.data.id,
    atHead,
    beforeEl ?? undefined,
  );
  // Focus the new message so it can be typed into immediately.
  (element.querySelector(".message-content") as HTMLElement).focus();
}

function removeMessageElement(element: ChatMessage) {
  const gap = element.previousElementSibling;
  if (gap?.classList.contains("message-gap")) {
    gap.remove();
  }
  element.remove();
}

function updateUiMessage(element: ChatMessage, content: string) {
  element.updateContent(content);
}

function updateTokenTotal(usage: TokenUsage) {
  const parts: string[] = [];
  if (usage.total_tokens !== undefined) parts.push(`${usage.total_tokens} total`);
  if (usage.prompt_tokens !== undefined) parts.push(`${usage.prompt_tokens} in`);
  if (parts.length > 0) {
    tokenTotalEl.textContent = parts.join(" · ");
    tokenTotalEl.style.display = "";
  }
}

function resetTokenTotal() {
  tokenTotalEl.textContent = "";
  tokenTotalEl.style.display = "none";
}

async function setConversation(
  conversationKey: number,
  conversation: Conversation,
) {
  currentConversation.clear();
  resetTokenTotal();
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
    resetTokenTotal();
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
  // dbMain();
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
    .getElementById("summarize-button")
    ?.addEventListener("click", async function (e) {
      const button = e.currentTarget as HTMLButtonElement;
      if (button.hasAttribute("disabled")) {
        return;
      }
      button.setAttribute("disabled", "");
      try {
        await summarizeConversation();
      } finally {
        button.removeAttribute("disabled");
      }
    });

  // TODO: consider integrating the "keep last" summary input into the
  // config mechanisms (schema_form, presets, apiParams localStorage)
  // instead of this bespoke persistence.
  const summarizeTailInput = document.getElementById(
    "summarize-tail-input",
  ) as HTMLInputElement | null;
  if (summarizeTailInput) {
    summarizeTailInput.value =
      localStorage.getItem("summarizeTailSize") ?? "4";
    summarizeTailInput.addEventListener("change", function () {
      localStorage.setItem("summarizeTailSize", summarizeTailInput.value);
    });
  }

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

  // Keyboard shortcuts for role selection (Alt+letter). Ctrl combos were
  // avoided because they collide with browser defaults: Ctrl+d bookmark,
  // Ctrl+u view source, Ctrl+h history, Ctrl+a select all.
  document.addEventListener("keydown", (e) => {
    // Excluding e.ctrlKey also skips AltGr (Ctrl+Alt) combinations used
    // to type characters on some keyboard layouts.
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    const roleMap: Record<string, string> = {
      d: "developer",
      u: "user",
      a: "assistant",
      h: "hint",
    };
    const role = roleMap[e.key.toLowerCase()];
    if (role) {
      e.preventDefault();
      roleSelect.value = role;
      input.focus();
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
        await addMessage(db, message)
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
    if (enpointSelect.value === "custom") {
      const customFieldButton = document.createElement("button");
      customFieldButton.textContent = "Add Custom Field";
      customFieldButton.addEventListener("click", function () {
        const fieldTypeSelection = document.createElement("select");
      });
    }
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

  const bottomBar = document.querySelector("#form")!;
  // Create an observer that fires whenever the bottom bar changes size
  const observer = new ResizeObserver(function (entries) {
    for (const entry of entries) {
      // Get the exact pixel height of the bar
      const height = entry.borderBoxSize[0].blockSize;
      // Update the CSS variable globally
      document.body.style.setProperty("--bottom-bar-height", `${height}px`);
    }
  });
  observer.observe(bottomBar);
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
      const text = typeof chunk === "string" ? chunk : chunk.text;
      if (text) result.push(text);
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
      resetTokenTotal();
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
  role: "user" | "assistant" | "developer" | "hint" | "summary";
  content: string;
}

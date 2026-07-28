import { render } from "./markdown_renderer.js";
import type { TokenUsage } from "./apis.js";

export class ChatMessage extends HTMLElement {
  private _rawContent: string = "";
  private _tokenBadge: HTMLElement | null = null;
  private _stopBtn: HTMLElement | null = null;
  private _streaming: boolean = false;
  /** AbortController for this message's in-flight stream, if any. */
  stopController: AbortController | null = null;

  connectedCallback() {
    this.#build();
    const contentDiv = this.querySelector(".message-content")!;
    contentDiv.addEventListener("focusin", this.#onFocusIn);
    contentDiv.addEventListener("focusout", this.#onFocusOut);
  }

  disconnectedCallback() {
    const contentDiv = this.querySelector(".message-content");
    if (contentDiv) {
      contentDiv.removeEventListener("focusin", this.#onFocusIn);
      contentDiv.removeEventListener("focusout", this.#onFocusOut);
    }
  }

  /** Update displayed content (e.g. during streaming). */
  updateContent(content: string) {
    this._rawContent = content;
    if (this.isConnected) {
      this.#renderContent();
    }
  }

  get content(): string {
    return this._rawContent;
  }

  get messageId(): number {
    return parseInt(this.getAttribute("data-id")!);
  }

  /** Display token count for this message (output tokens only). */
  setUsage(usage: TokenUsage) {
    if (!this._tokenBadge) return;
    if (usage.completion_tokens !== undefined) {
      this._tokenBadge.textContent = `${usage.completion_tokens} tokens`;
      this._tokenBadge.style.display = "";
    }
  }

  /** Show or hide the blinking cursor and stop button during streaming. */
  setStreaming(active: boolean) {
    this._streaming = active;
    if (this.isConnected) {
      if (active) {
        this.#appendCursor();
        if (this._stopBtn) this._stopBtn.style.display = "";
      } else {
        this.#removeCursor();
        if (this._stopBtn) this._stopBtn.style.display = "none";
      }
    }
  }

  #build() {
    // Action buttons.
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this._rawContent);
    });

    const editBtn = document.createElement("button");
    editBtn.textContent = "edit";
    editBtn.addEventListener("click", () => {
      (this.querySelector(".message-content") as HTMLElement).focus();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "delete";
    deleteBtn.addEventListener("click", () => {
      this.dispatchEvent(
        new CustomEvent("chat-message:delete", {
          bubbles: true,
          detail: { id: this.messageId },
        }),
      );
      this.remove();
    });

    actions.append(copyBtn, editBtn, deleteBtn);

    // Retry + stop — only for assistant messages.
    if (this.getAttribute("data-role") === "assistant") {
      const retryBtn = document.createElement("button");
      retryBtn.textContent = "retry";
      retryBtn.addEventListener("click", () => {
        this.dispatchEvent(
          new CustomEvent("chat-message:retry", {
            bubbles: true,
            detail: { id: this.messageId },
          }),
        );
      });
      actions.append(retryBtn);

      const stopBtn = document.createElement("button");
      stopBtn.textContent = "stop";
      stopBtn.style.display = "none";
      stopBtn.addEventListener("click", () => {
        if (this.stopController) {
          this.stopController.abort();
        }
      });
      actions.append(stopBtn);
      this._stopBtn = stopBtn;
    }

    // Branch button — fork a new conversation from this message.
    const branchBtn = document.createElement("button");
    branchBtn.textContent = "branch";
    branchBtn.addEventListener("click", () => {
      this.dispatchEvent(
        new CustomEvent("chat-message:branch", {
          bubbles: true,
          detail: { id: this.messageId },
        }),
      );
    });
    actions.append(branchBtn);

    // Token count badge (hidden until usage data arrives).
    const tokenBadge = document.createElement("span");
    tokenBadge.className = "token-badge";
    tokenBadge.style.display = "none";
    actions.append(tokenBadge);
    this._tokenBadge = tokenBadge;

    // Content wrapper.
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    contentDiv.setAttribute("contenteditable", "true");
    const nodes = render(this._rawContent);
    contentDiv.append(...nodes);

    this.replaceChildren(actions, contentDiv);
  }

  #renderContent() {
    const contentDiv = this.querySelector(".message-content");
    if (contentDiv) {
      const nodes = render(this._rawContent);
      contentDiv.replaceChildren(...nodes);
      if (this._streaming) {
        this.#appendCursor();
      }
    }
  }

  #appendCursor() {
    this.#removeCursor();
    const contentDiv = this.querySelector(".message-content");
    if (!contentDiv) return;
    const cursor = document.createElement("span");
    cursor.className = "streaming-cursor";
    cursor.textContent = "▌";
    contentDiv.appendChild(cursor);
  }

  #removeCursor() {
    const cursor = this.querySelector(".streaming-cursor");
    cursor?.remove();
  }

  #onFocusIn = () => {
    const contentDiv = this.querySelector(".message-content")!;
    contentDiv.setAttribute("spellcheck", "true");
    this.classList.add("editing");
    // Swap rendered markdown for raw text.
    contentDiv.replaceChildren(document.createTextNode(this._rawContent));
    this.dispatchEvent(
      new CustomEvent("chat-message:focus", {
        bubbles: true,
        detail: { id: this.messageId },
      }),
    );
  };

  #onFocusOut = () => {
    const contentDiv = this.querySelector(".message-content") as HTMLElement;
    contentDiv.setAttribute("spellcheck", "false");
    this.classList.remove("editing");
    const newContent = contentDiv.innerText.trim();
    if (!newContent) {
      this.dispatchEvent(
        new CustomEvent("chat-message:delete", {
          bubbles: true,
          detail: { id: this.messageId },
        }),
      );
      this.remove();
      return;
    }
    this._rawContent = newContent;
    this.#renderContent();
    this.dispatchEvent(
      new CustomEvent("chat-message:update", {
        bubbles: true,
        detail: {
          id: this.messageId,
          content: newContent,
          role: this.getAttribute("data-role")!,
        },
      }),
    );
  };
}

customElements.define("chat-message", ChatMessage);

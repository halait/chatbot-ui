import { getUidDek } from "./auth.js";
import { encrypt } from "./crypto.js";
import { DB } from "./db.js";
import {
  DoubleLinkedList,
  DoubleLinkedListNode,
} from "./double_linked_list.js";
import { set } from "./firestore_db.js";
import { fetchAsPromise, Message } from "./main.js";

export class ConversationMessageList extends DoubleLinkedList<ConversationMessageData> {
  constructor() {
    super();
  }

  async updateConversation(db: DB, title: string, conversationKey: number) {
    await db.updateObject(
      "conversations",
      {
        title,
      },
      conversationKey,
    );
  }

  async addMessage(
    db: DB,
    message: Message,
    afterMessage?: DoubleLinkedListNode<ConversationMessageData> | null,
  ) {
    let conversationKey: number;
    let conversationStart: number | null = null;

    if (!this.head) {
      conversationStart = Date.now();
      const title = message.content.split("\n")[0].slice(0, 50);
      conversationKey = await db.addObject("conversations", {
        title,
        timestamp: conversationStart,
      });
      const uidDek = await getUidDek();
      if (uidDek) {
        await set("conversations", {
          uid: uidDek?.uid,
          timestamp: conversationStart,
          encryptedData: await encrypt(
            JSON.stringify({
              title,
            }),
            uidDek.dek,
            "string",
          ),
        });
      }
    } else {
      conversationKey = this.head.data.conversationKey;
    }
    const conversationMessage = {
      conversationKey,
      message,
      id: -1,
    };

    const node = afterMessage
      ? super.addAfter(afterMessage, conversationMessage)
      : super.add(conversationMessage);
    const id = await this.setDbMessage(db, node);
    node.data.id = id;

    if (conversationStart) {
      await db.updateObject(
        "conversations",
        {
          root: id,
        },
        conversationKey,
      );
    }

    if (node.prev) {
      await this.setDbMessage(db, node.prev);
    }

    if (afterMessage && node.next) {
      await this.setDbMessage(db, node.next);
    }

    return node;
  }

  getMessage(messageKey: number) {
    return this.find(function (data) {
      return data.id === messageKey;
    });
  }

  async deleteMessage(db: DB, messageKey: number) {
    const node = this.getMessage(messageKey);

    if (!node) {
      throw new Error("Message not found");
    }

    if (!node.data.id) {
      throw new Error("Node to be delete does not have id set.");
    }

    await db.deleteMessage(node.data.id);

    if (!node.prev && !node.next) {
      await db.deleteObject("conversations", node.data.conversationKey);
    }

    if (!node.prev && node.next) {
      const conversation = await db.getObject(
        "conversations",
        node.data.conversationKey,
      );
      await db.updateObject(
        "conversations",
        {
          root: node.next.data.id,
        },
        node.data.conversationKey,
      );
    }

    const prev = node.prev;
    const next = node.next;

    super.delete(node);

    if (prev) {
      await this.setDbMessage(db, prev);
    }

    if (next) {
      await this.setDbMessage(db, next);
    }
  }

  async updateMessage(
    db: DB,
    message: Message,
    node: DoubleLinkedListNode<ConversationMessageData>,
  ) {
    node.data.message = message;
    await this.setDbMessage(db, node);
  }

  private async setDbMessage(
    db: DB,
    node: DoubleLinkedListNode<ConversationMessageData>,
  ) {
    const message = {
      message: node.data.message,
      prevKey: node.prev?.data.id ?? null,
      nextKey: node.next?.data.id ?? null,
      conversationKey: node.data.conversationKey,
    };
    if (node.data.id != -1) {
      await db.updateMessage(message, node.data.id);
      return node.data.id;
    } else {
      return await db.addMessage(message);
    }
  }
}

export interface ConversationMessageData {
  message: Message;
  conversationKey: number;
  id: number;
}

export interface Conversation {
  title: string;
  timestamp: number;
  root: number;
}

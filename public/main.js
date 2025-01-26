import { DB } from './db.js';
import { render, htmlToMarkdown } from './markdown_renderer.js';
let endpoint = localStorage.getItem('endpoint') ?? 'https://api.openai.com/v1/chat/completions';
let apiKey = localStorage.getItem('apiKey') ?? '';
let apiParams = localStorage.getItem('apiParams') ? JSON.parse(localStorage.getItem('apiParams')) : {
    'model': 'gpt-4o-mini'
};
const chatDiv = document.getElementById('chat');
const input = document.getElementById('chat-input');
const roleSelect = document.getElementById('role-select');
const historyModal = document.getElementById('history-modal');
const historyContainer = document.getElementById('history-container');
const configModal = document.getElementById('config-modal');
const apiMap = {
    'openai.com': {
        developerRole: 'developer',
        stream: true,
        store: false
    },
    'deepseek.com': {
        developerRole: 'system',
        stream: true
    },
    'mistral.ai': {
        developerRole: 'system',
        stream: true
    }
};
let db;
let lastChatDivScroll = 0;
let lastCharDivScrollTop = 0;
async function submitForm() {
    const inputValue = input.innerText.trim();
    if (inputValue !== '') {
        input.innerText = '';
        const message = {
            role: roleSelect.value,
            content: inputValue
        };
        const messageId = await currentConversation.addMessage(db, message);
        addMessageToUi(messageId, message);
    }
    const domains = (new URL(endpoint)).hostname.split('.').slice();
    if (!domains) {
        throw new Error('Invalid URL, hostname parse failed');
    }
    const domain = domains.slice(Math.max(0, domains.length - 2)).join('.');
    const api = apiMap[domain] ?? 'openai.com';
    const messages = currentConversation.map(function (conversationMessage) {
        return {
            role: conversationMessage.message.role === 'developer' ? api.developerRole : conversationMessage.message.role,
            content: conversationMessage.message.content
        };
    });
    if (!apiKey) {
        throw new Error('API Key missing');
    }
    const body = {
        messages: messages
    };
    for (const key of Object.keys(apiParams)) {
        if (apiParams[key]) {
            body[key] = apiParams[key];
        }
    }
    if (api.stream) {
        body['stream'] = api.stream;
    }
    if (api.store !== undefined) {
        body['store'] = api.store;
    }
    const result = await fetch(endpoint, {
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    });
    if (!api.stream) {
        const output = (await result.json()).choices[0].message.content;
        const assistantMessage = { role: 'assistant', content: output };
        const assistantMessageId = await currentConversation.addMessage(db, assistantMessage);
        addMessageToUi(assistantMessageId, assistantMessage);
    }
    else {
        if (result.body === null) {
            throw new Error('response missing');
        }
        const utf8decoder = new TextDecoder();
        const assistantMessage = { role: 'assistant', content: '' };
        const assistantMessageId = await currentConversation.addMessage(db, assistantMessage);
        const element = addMessageToUi(assistantMessageId, assistantMessage);
        const message = [];
        let start = Date.now();
        let lastUpdate = 0;
        for await (const chunk of result.body) {
            const lines = utf8decoder.decode(chunk).split('\n');
            for (let line of lines) {
                if (line === '') {
                    continue;
                }
                if (line.slice(0, 6) !== 'data: ') {
                    throw new Error('Unexpected stream data');
                }
                line = line.slice(6);
                if (line === '[DONE]') {
                    assistantMessage.content = message.join('');
                    updateUiMessage(element, assistantMessage.content);
                    if (start > lastChatDivScroll) {
                        chatDiv.scrollTop = chatDiv.scrollHeight;
                    }
                    await currentConversation.updateMessage(db, assistantMessage, assistantMessageId);
                    break;
                }
                message.push(JSON.parse(line).choices[0].delta.content);
                const now = Date.now();
                if (now - lastUpdate > 200) {
                    updateUiMessage(element, message.join(''));
                    if (start > lastChatDivScroll) {
                        chatDiv.scrollTop = chatDiv.scrollHeight;
                    }
                    lastUpdate = now;
                }
            }
        }
    }
}
function addMessageToUi(messageId, message) {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.className = `message-div ${message.role}`;
    const nodes = render(message.content);
    for (const child of nodes) {
        div.appendChild(child);
    }
    div.dataset.id = messageId.toString();
    div.dataset.role = message.role;
    div.addEventListener('focusin', function (e) {
        const element = e.currentTarget;
        element.setAttribute('spellcheck', 'true');
        element.replaceChildren(document.createTextNode(htmlToMarkdown(element.childNodes)));
    });
    div.addEventListener('focusout', function (e) {
        const element = e.currentTarget;
        element.setAttribute('spellcheck', 'false');
        const messageKey = parseInt(element.dataset.id);
        const content = element.innerText.trim();
        if (!content) {
            currentConversation.deleteMessage(db, messageKey);
            element.parentElement?.removeChild(element);
            return;
        }
        const nodes = render(content);
        element.replaceChildren(...nodes);
        currentConversation.updateMessage(db, {
            content: content,
            role: element.dataset.role ?? ''
        }, parseInt(element.dataset.id));
    });
    chatDiv.appendChild(div);
    chatDiv.scrollTop = chatDiv.scrollHeight;
    return div;
}
chatDiv.addEventListener('scroll', function () {
    const scrollTop = chatDiv.scrollTop;
    if (scrollTop - lastCharDivScrollTop < 0) {
        lastChatDivScroll = Date.now();
    }
    lastCharDivScrollTop = scrollTop;
});
function updateUiMessage(element, content) {
    const nodes = render(content);
    element.replaceChildren(...nodes);
}
async function setConversation(conversationKey, conversation) {
    currentConversation.clear();
    const conversationMessages = await db.getAllIndexKey('conversationsMessages', 'conversationKey', conversationKey);
    let key = conversation.root;
    while (key) {
        const conversationMessage = conversationMessages.get(key);
        if (!conversationMessage) {
            throw new Error('Message not found');
        }
        currentConversation.add({
            id: key,
            conversationKey: conversationKey,
            message: conversationMessage.message
        });
        key = conversationMessage.nextKey;
    }
    chatDiv.replaceChildren();
    currentConversation.forEach(function (conversationMessage) {
        addMessageToUi(conversationMessage.id, conversationMessage.message);
    });
}
async function deleteConversation(conversationKey) {
    if (currentConversation.head?.data.conversationKey === conversationKey) {
        currentConversation.clear();
        chatDiv.replaceChildren();
    }
    await db.deleteAllIndexKey('conversationsMessages', 'conversationKey', conversationKey);
    await db.deleteObject('conversations', conversationKey);
}
window.addEventListener("error", function (e) {
    alert("Error occurred: " + e.error.message);
    return false;
});
window.addEventListener('unhandledrejection', function (e) {
    alert("Error occurred: " + e.reason.message);
});
async function main() {
    db = new DB;
    await db.init();
    document.getElementById('form').addEventListener('submit', async function (e) {
        e.preventDefault();
        await submitForm();
    });
    document.getElementById('history-button').addEventListener('click', async function () {
        const showModal = historyModal.style.display !== 'flex';
        if (!showModal) {
            historyModal.style.display = 'none';
            return;
        }
        historyContainer.replaceChildren();
        const conversations = await db.getAll('conversations');
        for (const [key, conversation] of conversations) {
            const container = document.createElement('div');
            container.className = 'history-item-container';
            container.dataset.id = key.toString();
            const div = document.createElement('div');
            div.className = 'history-item';
            div.textContent = `${new Date(conversation.timestamp).toLocaleString()} | ${conversation.title}`;
            const button = document.createElement('button');
            button.textContent = 'Delete';
            // button.className = 'history-delete-button'
            button.addEventListener('click', async function (e) {
                const parent = e.currentTarget.parentElement;
                const id = parseInt(parent.dataset.id);
                await deleteConversation(id);
                parent.remove();
            });
            div.addEventListener('click', async function (e) {
                const id = parseInt(e.currentTarget.parentElement.dataset.id);
                await setConversation(id, conversations.get(key));
                historyModal.style.display = 'none';
            });
            container.appendChild(div);
            container.appendChild(button);
            historyContainer.appendChild(container);
        }
        historyModal.style.display = 'flex';
    });
    document.getElementById('new-chat-button')?.addEventListener('click', function () {
        currentConversation.clear();
        chatDiv.replaceChildren();
    });
    document.getElementById('input-set-button')?.addEventListener('click', async function () {
        const content = input.innerText.trim();
        console.log('content: ' + content);
        if (!content) {
            console.warn('Empty input, ignoring');
        }
        input.innerText = '';
        const message = { role: roleSelect.value, content };
        const id = await currentConversation.addMessage(db, message);
        addMessageToUi(id, message);
    });
    input.addEventListener('keydown', async function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await submitForm();
        }
    });
    document.getElementById('set-config-button')?.addEventListener('click', function () {
        const showModal = configModal.style.display !== 'block';
        if (!showModal) {
            configModal.style.display = 'none';
            return;
        }
        const keyInput = document.getElementById('set-key-input');
        keyInput.value = apiKey;
        const endpointInput = document.getElementById('set-endpoint-input');
        endpointInput.value = endpoint;
        const apiParamInputs = document.querySelectorAll('#config-form > [data-api-param]');
        for (const input of apiParamInputs) {
            input.value = apiParams[input.getAttribute('data-api-param')] ?? '';
        }
        configModal.style.display = 'block';
    });
    document.getElementById('config-form')?.addEventListener('submit', function (e) {
        e.preventDefault();
        const keyInput = document.getElementById('set-key-input');
        apiKey = keyInput.value;
        localStorage.setItem('apiKey', apiKey);
        const endpointInput = document.getElementById('set-endpoint-input');
        endpoint = endpointInput.value;
        localStorage.setItem('endpoint', endpoint);
        const apiParamInputs = document.querySelectorAll('#config-form > [data-api-param]');
        for (const input of apiParamInputs) {
            const param = input.getAttribute('data-api-param');
            apiParams[param] = input.value && input.type === 'number' ? parseFloat(input.value) : input.value;
        }
        localStorage.setItem('apiParams', JSON.stringify(apiParams));
        configModal.style.display = 'none';
    });
    document.getElementById('export-button')?.addEventListener('click', function () {
        const json = JSON.stringify(currentConversation.map(function (conversationMessage) { return conversationMessage.message; }));
        const element = document.createElement('a');
        element.style.display = 'none';
        element.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(json));
        element.setAttribute('download', 'chat-ui-export.json');
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    });
    document.getElementById('import-button')?.addEventListener('click', function () {
        document.getElementById('import-input')?.click();
    });
    document.getElementById('import-input')?.addEventListener('change', async function () {
        const file = this.files[0];
        if (!file) {
            return;
        }
        const messages = JSON.parse(await file.text());
        console.log(messages);
        currentConversation.clear();
        chatDiv.replaceChildren();
        for (const message of messages) {
            addMessageToUi(await currentConversation.addMessage(db, message), message);
        }
    });
}
main();
class DoubleLinkedListNode {
    data;
    prev = null;
    next = null;
    constructor(data) {
        this.data = data;
    }
}
class DoubleLinkedList {
    head = null;
    tail = null;
    constructor() {
    }
    add(data) {
        const node = new DoubleLinkedListNode(data);
        if (!this.head) {
            this.head = node;
        }
        if (this.tail) {
            this.tail.next = node;
            node.prev = this.tail;
            this.tail = node;
        }
        else {
            this.tail = node;
        }
        return node;
    }
    delete(node) {
        if (this.head === node) {
            this.head = node.next;
        }
        if (this.tail === node) {
            this.tail = node.prev;
        }
        if (node.prev) {
            node.prev.next = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
    }
    clear() {
        let node = this.head;
        while (node != null) {
            this.delete(node);
            node = node.next;
        }
    }
    toArray() {
        const result = [];
        let node = this.head;
        while (node != null) {
            result.push(node.data);
            node = node.next;
        }
        return result;
    }
    toNodeArray() {
        const result = [];
        let node = this.head;
        while (node != null) {
            result.push(node);
            node = node.next;
        }
        return result;
    }
    map(fn) {
        const result = [];
        let node = this.head;
        while (node != null) {
            result.push(fn(node.data));
            node = node.next;
        }
        return result;
    }
    find(fn) {
        let node = this.head;
        while (node != null) {
            if (fn(node.data)) {
                return node;
            }
            node = node.next;
        }
        return null;
    }
    forEach(fn) {
        let node = this.head;
        while (node != null) {
            fn(node.data);
            node = node.next;
        }
    }
}
class ConversationMessageList extends DoubleLinkedList {
    constructor() {
        super();
    }
    async addMessage(db, message) {
        let conversationKey;
        let conversationStart = null;
        if (!this.head) {
            conversationStart = Date.now();
            conversationKey = await db.addObject('conversations', {
                title: message.content.slice(0, 10),
                timestamp: conversationStart
            });
        }
        else {
            conversationKey = this.head.data.conversationKey;
        }
        const conversationMessage = {
            conversationKey,
            message
        };
        const node = super.add(conversationMessage);
        const id = await this.setDbMessage(db, node);
        node.data.id = id;
        if (conversationStart) {
            await db.updateObject('conversations', {
                title: message.content.slice(0, 10),
                timestamp: conversationStart,
                root: id
            }, conversationKey);
        }
        if (node.prev) {
            await this.setDbMessage(db, node.prev);
        }
        return id;
    }
    async deleteMessage(db, messageKey) {
        const node = this.find(function (data) { if (data.id == messageKey) {
            return true;
        } });
        if (!node) {
            throw new Error('Message not found');
        }
        if (!node.data.id) {
            throw new Error('Node to be delete does not have id set.');
        }
        super.delete(node);
        await db.deleteMessage(node.data.id);
        if (!node.prev && !node.next) {
            await db.deleteObject('conversations', node.data.conversationKey);
        }
        if (!node.prev && node.next) {
            const conversation = await db.getObject('conversations', node.data.conversationKey);
            await db.updateObject('conversations', {
                title: conversation.title,
                timestamp: conversation.timestamp,
                root: node.next.data.id
            }, node.data.conversationKey);
        }
        if (node.prev) {
            await this.setDbMessage(db, node.prev);
        }
        if (node.next) {
            await this.setDbMessage(db, node.next);
        }
    }
    async updateMessage(db, message, messageKey) {
        const node = this.find(function (data) { if (data.id == messageKey) {
            return true;
        } });
        if (!node) {
            throw new Error('Message not found');
        }
        node.data.message = message;
        await this.setDbMessage(db, node);
    }
    async setDbMessage(db, node) {
        const message = {
            message: node.data.message,
            prevKey: node.prev?.data.id ?? null,
            nextKey: node.next?.data.id ?? null,
            conversationKey: node.data.conversationKey
        };
        if (node.data.id) {
            await db.updateMessage(message, node.data.id);
            return node.data.id;
        }
        else {
            return await db.addMessage(message);
        }
    }
}
let currentConversation = new ConversationMessageList();

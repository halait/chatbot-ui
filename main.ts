import { DB, ConversationMessage } from './db.js'
import { render, htmlToMarkdown } from './markdown_renderer.js'

let endpoint = 'https://api.openai.com/v1/chat/completions'
let apiKey = localStorage.getItem('apiKey') ?? ''
// let endpoint = 'http://127.0.0.1:5000/chat'

const chatDiv = document.getElementById('chat') as HTMLElement
const input = document.getElementById('chat-input') as HTMLInputElement
const roleSelect = document.getElementById('role-select') as HTMLSelectElement

const historyModal = document.getElementById('history-modal') as HTMLElement
const historyContainer = document.getElementById('history-container') as HTMLElement

const configModal = document.getElementById('config-modal') as HTMLElement

let db: DB

async function submitForm() {
    const inputValue = input!.value.trim()
    if (inputValue !== '') {
        input.value = ''

        const message = {
            role: roleSelect.value,
            content: inputValue
        }

        const messageId = await currentConversation.addMessage(db, message)

        addMessageToUi(messageId, message)
    }

    const messages = currentConversation.map(function (conversationMessage) { return conversationMessage.message })

    if (!apiKey) {
        throw new Error('API Key missing')
    }
    const result = await (await fetch(endpoint, {
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            store: false,
            messages: messages
        })
    })).json()

    const output = result.choices[0].message.content
    const assistantMessage = { role: 'assistant', content: output }

    const assistantMessageId = await currentConversation.addMessage(db, assistantMessage)

    addMessageToUi(assistantMessageId, assistantMessage)
}

function addMessageToUi(messageId: number, message: Message) {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    div.className = message.role
    const nodes = render(message.content)
    for (const child of nodes) {
        div.appendChild(child)
    }
    // div.innerHTML = message.content.replace(/\n/g, '<br>')
    div.dataset.id = messageId.toString()
    div.addEventListener('focusin', function (e) {
        const element = e.currentTarget as HTMLElement
        element.setAttribute('spellcheck', 'true')
        element.style.whiteSpace = 'pre-wrap'
        element.replaceChildren(document.createTextNode(htmlToMarkdown(element.childNodes)))
    })
    div.addEventListener('focusout', function (e) {
        const element = e.currentTarget as HTMLElement
        element.setAttribute('spellcheck', 'false')
        const messageKey = parseInt(element.dataset.id!)
        // const content = htmlToMarkdown(element.childNodes).trim()
        const content = element.textContent?.trim()
        // for (const child of nodes) {
        //     element.appendChild(child)
        // }
        if (!content) {
            currentConversation.deleteMessage(db, messageKey)
            element.parentElement?.removeChild(element)
            return
        }
        const nodes = render(content)
        element.replaceChildren(...nodes)
        currentConversation.updateMessage(db, {
            content: content,
            role: element.className
        }, parseInt(element.dataset.id!))
    })
    chatDiv.appendChild(div)
    chatDiv.scrollTop = chatDiv.scrollHeight
}

async function setConversation(conversationKey: number, conversation: Conversation) {
    currentConversation.clear()
    const conversationMessages = await db.getAllIndexKey('conversationsMessages', 'conversationKey', conversationKey) as Map<number, ConversationMessage>

    let key: number | null = conversation.root
    while (key) {
        const conversationMessage = conversationMessages.get(key)
        if (!conversationMessage) {
            throw new Error('Message not found')
        }
        currentConversation.add({
            id: key,
            conversationKey: conversationKey,
            message: conversationMessage.message
        })
        key = conversationMessage.nextKey
    }
    chatDiv.replaceChildren()
    currentConversation.forEach(function (conversationMessage) {
        addMessageToUi(conversationMessage.id!, conversationMessage.message)
    })
}

async function deleteConversation(conversationKey: number) {
    if (currentConversation.head?.data.conversationKey === conversationKey) {
        currentConversation.clear()
        chatDiv.replaceChildren()
    }
    await db.deleteAllIndexKey('conversationsMessages', 'conversationKey', conversationKey)
    await db.deleteObject('conversations', conversationKey)
}

window.addEventListener("error", function (e) {
    alert("Error occurred: " + e.error.message);
    return false;
})

window.addEventListener('unhandledrejection', function (e) {
    alert("Error occurred: " + e.reason.message);
})

async function main() {
    db = new DB
    await db.init()

    document.getElementById('form')!.addEventListener('submit', async function (e) {
        e.preventDefault()
        await submitForm()
    })

    document.getElementById('history-button')!.addEventListener('click', async function () {
        const showModal = historyModal.style.display !== 'flex'
        if (!showModal) {
            historyModal.style.display = 'none';
            return
        }
        historyContainer.replaceChildren()
        const conversations = await db.getAll('conversations') as Map<number, Conversation>
        for (const [key, conversation] of conversations) {
            const container = document.createElement('div')
            container.className = 'history-item-container'
            container.dataset.id = key.toString()
            const div = document.createElement('div')
            div.className = 'history-item'
            div.textContent = `${new Date(conversation.timestamp).toLocaleString()} | ${conversation.title}`
            const button = document.createElement('button')
            button.textContent = 'Delete'
            // button.className = 'history-delete-button'
            button.addEventListener('click', async function (e) {
                const parent = (e.currentTarget as HTMLElement).parentElement!
                const id = parseInt(parent.dataset.id as string)
                await deleteConversation(id)
                parent.remove()
            })
            div.addEventListener('click', async function (e) {
                const id = parseInt((e.currentTarget as HTMLElement).parentElement!.dataset.id as string)
                await setConversation(id, conversations.get(key)!)
                historyModal.style.display = 'none'
            })
            container.appendChild(div)
            container.appendChild(button)
            historyContainer.appendChild(container)
        }
        historyModal.style.display = 'flex';
    })

    document.getElementById('new-chat-button')?.addEventListener('click', function () {
        currentConversation.clear()
        chatDiv.replaceChildren()
    })

    document.getElementById('input-set-button')?.addEventListener('click', async function () {
        const content = input.value.trim()
        if (content) {
            input.value = ''
            const message = { role: roleSelect.value, content }
            const id = await currentConversation.addMessage(db, message)
            addMessageToUi(id, message)
        }
    })

    input.addEventListener('keydown', async function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            await submitForm()
        }
    })

    document.getElementById('set-config-button')?.addEventListener('click', function () {
        const showModal = configModal.style.display !== 'block'
        if (!showModal) {
            configModal.style.display = 'none';
            return
        }
        const keyInput = document.getElementById('set-key-input') as HTMLInputElement
        keyInput.value = apiKey
        const endpointInput = document.getElementById('set-endpoint-input') as HTMLInputElement
        endpointInput.value = endpoint

        configModal.style.display = 'block'
    })

    document.getElementById('config-form')?.addEventListener('submit', function (e) {
        e.preventDefault()
        const keyInput = document.getElementById('set-key-input') as HTMLInputElement
        apiKey = keyInput.value
        localStorage.setItem('apiKey', apiKey)
        const endpointInput = document.getElementById('set-endpoint-input') as HTMLInputElement
        endpoint = endpointInput.value
    })
}

main()

class DoubleLinkedListNode<T> {
    data!: T
    prev: DoubleLinkedListNode<T> | null = null
    next: DoubleLinkedListNode<T> | null = null

    constructor(data: T) {
        this.data = data
    }
}

class DoubleLinkedList<T> {
    head: DoubleLinkedListNode<T> | null = null
    tail: DoubleLinkedListNode<T> | null = null
    constructor() {
    }

    add(data: T): DoubleLinkedListNode<T> {
        const node = new DoubleLinkedListNode<T>(data)
        if (!this.head) {
            this.head = node
        }

        if (this.tail) {
            this.tail.next = node
            node.prev = this.tail
            this.tail = node
        } else {
            this.tail = node
        }
        return node
    }

    delete(node: DoubleLinkedListNode<T>) {
        if (this.head === node) {
            this.head = node.next
        }
        if (this.tail === node) {
            this.tail = node.prev
        }
        if (node.prev) {
            node.prev.next = node.next
        }
        if (node.next) {
            node.next.prev = node.prev
        }
    }

    clear() {
        let node = this.head
        while (node != null) {
            this.delete(node)
            node = node.next
        }
    }

    toArray() {
        const result = []
        let node = this.head
        while (node != null) {
            result.push(node.data)
            node = node.next
        }
        return result
    }

    toNodeArray() {
        const result = []
        let node = this.head
        while (node != null) {
            result.push(node)
            node = node.next
        }
        return result
    }

    map(fn: (param: T) => any): any[] {
        const result = []
        let node = this.head
        while (node != null) {
            result.push(fn(node.data))
            node = node.next
        }
        return result
    }

    find(fn: (param: T) => any): DoubleLinkedListNode<T> | null {
        let node = this.head
        while (node != null) {
            if (fn(node.data)) {
                return node
            }
            node = node.next
        }
        return null
    }

    forEach(fn: (param: T) => any) {
        let node = this.head
        while (node != null) {
            fn(node.data)
            node = node.next
        }
    }
}

class ConversationMessageList extends DoubleLinkedList<ConversationMessageData> {
    constructor() {
        super()
    }

    async addMessage(db: DB, message: Message): Promise<number> {
        let conversationKey: number
        let conversationStart: number | null = null
        if (!this.head) {
            conversationStart = Date.now()
            conversationKey = await db.addObject('conversations', {
                title: message.content.slice(0, 10),
                timestamp: conversationStart
            })
        } else {
            conversationKey = this.head.data.conversationKey
        }
        const conversationMessage = {
            conversationKey,
            message
        }

        const node = super.add(conversationMessage)
        const id = await this.setDbMessage(db, node)
        node.data.id = id

        if (conversationStart) {
            await db.updateObject('conversations', {
                title: message.content.slice(0, 10),
                timestamp: conversationStart,
                root: id
            }, conversationKey)
        }

        if (node.prev) {
            await this.setDbMessage(db, node.prev)
        }

        return id
    }

    async deleteMessage(db: DB, messageKey: number) {
        const node = this.find(function (data) { if (data.id == messageKey) { return true } })

        if (!node) {
            throw new Error('Message not found')
        }

        if (!node.data.id) {
            throw new Error('Node to be delete does not have id set.')
        }

        super.delete(node)

        await db.deleteMessage(node.data.id)

        if (!node.prev && !node.next) {
            await db.deleteObject('conversations', node.data.conversationKey)
        }

        if (!node.prev && node.next) {
            const conversation = await db.getObject('conversations', node.data.conversationKey)
            await db.updateObject('conversations', {
                title: conversation.title,
                timestamp: conversation.timestamp,
                root: node.next.data.id
            }, node.data.conversationKey)
        }

        if (node.prev) {
            await this.setDbMessage(db, node.prev)
        }

        if (node.next) {
            await this.setDbMessage(db, node.next)
        }
    }

    async updateMessage(db: DB, message: Message, messageKey: number) {
        const node = this.find(function (data) { if (data.id == messageKey) { return true } })
        if (!node) {
            throw new Error('Message not found')
        }
        node.data.message = message
        await this.setDbMessage(db, node)
    }

    async setDbMessage(db: DB, node: DoubleLinkedListNode<ConversationMessageData>) {
        const message = {
            message: node.data.message,
            prevKey: node.prev?.data.id ?? null,
            nextKey: node.next?.data.id ?? null,
            conversationKey: node.data.conversationKey
        }
        if (node.data.id) {
            await db.updateMessage(message, node.data.id)
            return node.data.id
        } else {
            return await db.addMessage(message)
        }
    }
}

let currentConversation = new ConversationMessageList()

interface Message {
    role: string
    content: string
}

interface ConversationMessageData {
    message: Message
    conversationKey: number
    id?: number
}

interface Conversation {
    title: string
    timestamp: number
    root: number
}

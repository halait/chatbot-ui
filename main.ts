import { DB, ConversationMessage } from './db.js'
import { render/*, htmlToMarkdown*/ } from './markdown_renderer.js'
import { DoubleLinkedList, DoubleLinkedListNode } from './double_linked_list.js'

let apiParams: ApiParams = localStorage.getItem('apiParams') ? JSON.parse(localStorage.getItem('apiParams')!) : {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    key: '',
    params: {
        model: 'gpt-4o-mini',
        stream: true
    }
}

const chatDiv = document.getElementById('chat') as HTMLElement
const input = document.getElementById('chat-input') as HTMLElement
const roleSelect = document.getElementById('role-select') as HTMLSelectElement

const historyModal = document.getElementById('history-modal') as HTMLElement
const historyContainer = document.getElementById('history-container') as HTMLElement
const configModal = document.getElementById('config-modal') as HTMLElement
const errorModal = document.getElementById('error-modal') as HTMLElement

const apiMap: { [key: string]: ApiInformation } = {
    'openai.com': {
        developerRole: 'developer',
        store: false,
        titleModel: 'gpt-4o-mini',
    },
    'deepseek.com': {
        developerRole: 'system',
        titleModel: 'deepseek-chat',
    },
    'mistral.ai': {
        developerRole: 'system',
        titleModel: 'mistral-small-latest'
    }
}

let db: DB

let lastChatDivScroll = 0
let lastCharDivScrollTop = 0

async function submitForm() {
    const inputValue = input.innerText.trim()
    if (inputValue !== '') {
        input.innerText = ''

        const message = {
            role: roleSelect.value,
            content: inputValue
        }

        const messageId = await currentConversation.addMessage(db, message)

        addMessageToUi(messageId, message)
    }

    const domains = (new URL(apiParams.endpoint)).hostname.split('.')
    if (!domains) {
        throw new Error('Invalid URL, hostname parse failed')
    }
    const domain = domains.slice(Math.max(0, domains.length - 2)).join('.')

    const api = apiMap[domain] ?? apiMap['deepseek.com']
    const messages = currentConversation.map(function (conversationMessage) {
        return {
            role: conversationMessage.message.role === 'developer' ? api.developerRole : conversationMessage.message.role,
            content: conversationMessage.message.content
        }
    })

    const body = {
        messages: messages
    } as any

    for (const key of Object.keys(apiParams.params)) {
        if (apiParams.params[key]) {
            body[key] = apiParams.params[key]
        }
    }

    if (api.store !== undefined) {
        body['store'] = api.store
    }

    const response = await fetch(apiParams.endpoint, {
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiParams.key}`
        },
        body: JSON.stringify(body)
    })

    if (!response.ok) {
        showError(await response.text())
        return
    }

    if (!apiParams.params['stream']) {
        const output = (await response.json()).choices[0].message.content
        const assistantMessage = { role: 'assistant', content: output }

        const assistantMessageId = await currentConversation.addMessage(db, assistantMessage)

        addMessageToUi(assistantMessageId, assistantMessage)
    } else {
        if (response.body === null) {
            throw new Error('response missing')
        }

        const utf8decoder = new TextDecoder();
        const assistantMessage = { role: 'assistant', content: '' }
        const assistantMessageId = await currentConversation.addMessage(db, assistantMessage)
        const element = addMessageToUi(assistantMessageId, assistantMessage)
        const message: string[] = []
        let start = Date.now()
        let lastUpdate = 0

        let remainder: null | string = null
        for await (const chunk of response.body) {
            const lines = utf8decoder.decode(chunk).split('\n\n')
            if (remainder) {
                lines[0] = remainder + lines[0]
                remainder = null
            }
            if (chunk[chunk.length - 1] !== 10 && chunk[chunk.length - 2] !== 10) {
                remainder = lines.pop() ?? null
            }
            for (let line of lines) {
                if (line === '') {
                    continue
                }

                if (line.trim() === ': keep-alive') {
                    continue
                }

                if (line.slice(0, 6) !== 'data: ') {
                    throw new Error('Unexpected stream data')
                }
                line = line.slice(6)
                if (line === '[DONE]') {
                    assistantMessage.content = message.join('')
                    updateUiMessage(element, assistantMessage.content)
                    if (start > lastChatDivScroll) {
                        chatDiv.scrollTop = chatDiv.scrollHeight
                    }
                    await currentConversation.updateMessage(db, assistantMessage, assistantMessageId)
                    break
                }
                message.push(JSON.parse(line).choices[0].delta.content)
                const now = Date.now()
                if (now - lastUpdate > 200) {
                    updateUiMessage(element, message.join(''))
                    if (start > lastChatDivScroll) {
                        chatDiv.scrollTop = chatDiv.scrollHeight
                    }
                    lastUpdate = now
                }

            }
        }
    }
}

function addMessageToUi(messageId: number, message: Message): HTMLDivElement {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    div.className = `message-div ${message.role}`
    const nodes = render(message.content)
    for (const child of nodes) {
        div.appendChild(child)
    }
    div.dataset.id = messageId.toString()
    div.dataset.role = message.role
    div.addEventListener('focusin', function (e) {
        const element = e.currentTarget as HTMLElement
        element.setAttribute('spellcheck', 'true')
        const node = currentConversation.getMessage(parseInt(element.dataset.id!))
        if (!node) {
            throw new Error('Message not found')
        }
        element.replaceChildren(document.createTextNode(node.data.message.content))
    })
    div.addEventListener('focusout', function (e) {
        const element = e.currentTarget as HTMLElement
        element.setAttribute('spellcheck', 'false')
        const messageKey = parseInt(element.dataset.id!)
        const content = element.innerText.trim()
        if (!content) {
            currentConversation.deleteMessage(db, messageKey)
            element.parentElement?.removeChild(element)
            return
        }
        const nodes = render(content)
        element.replaceChildren(...nodes)
        currentConversation.updateMessage(db, {
            content: content,
            role: element.dataset.role ?? ''
        }, parseInt(element.dataset.id!))
    })
    chatDiv.appendChild(div)
    chatDiv.scrollTop = chatDiv.scrollHeight

    return div
}

chatDiv.addEventListener('scroll', function () {
    const scrollTop = chatDiv.scrollTop
    if (scrollTop - lastCharDivScrollTop < 0) {
        lastChatDivScroll = Date.now()
    }
    lastCharDivScrollTop = scrollTop
})

function updateUiMessage(element: HTMLDivElement, content: string) {
    const nodes = render(content)
    element.replaceChildren(...nodes)
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
        router.goTo('/')
    }
    await db.deleteAllIndexKey('conversationsMessages', 'conversationKey', conversationKey)
    await db.deleteObject('conversations', conversationKey)
}

window.addEventListener("error", function (e) {
    alert("Error occurred: " + e.error.message);
})

window.addEventListener('unhandledrejection', function (e) {
    alert("Error occurred: " + e.reason.message);
})

function showError(message: string) {
    const errorText = document.getElementById('error-message') as HTMLElement
    errorText.textContent = message
    toggleModal(errorModal)
}

async function main() {
    db = new DB
    await db.init()

    document.getElementById('form')!.addEventListener('submit', async function (e) {
        e.preventDefault()
        await submitForm()
    })

    document.getElementById('history-button')!.addEventListener('click', async function () {
        if (currentModal === historyModal) {
            toggleModal(historyModal);
            return
        }
        historyContainer.replaceChildren()
        const conversations = await db.getAll('conversations') as Map<number, Conversation>
        for (const [key, conversation] of conversations) {
            const container = document.createElement('div')
            container.className = 'history-item-container'
            container.dataset.id = key.toString()
            const a = document.createElement('a')
            a.href = `/conversation/${key}`
            a.className = 'history-item undecorated-a'
            a.title = conversation.title
            a.textContent = `${new Date(conversation.timestamp).toLocaleString()} | ${conversation.title.length > 50 ? conversation.title.slice(0, 50) + "..." : conversation.title}`
            const button = document.createElement('button')
            button.textContent = 'Delete'
            // button.className = 'history-delete-button'
            button.addEventListener('click', async function (e) {
                const parent = (e.currentTarget as HTMLElement).parentElement!
                const id = parseInt(parent.dataset.id as string)
                await deleteConversation(id)
                parent.remove()
            })
            a.addEventListener('click', async function (e) {
                e.preventDefault()
                const id = parseInt((e.currentTarget as HTMLElement).parentElement!.dataset.id as string)
                router.goTo(`/conversation/${id}`)
            })
            container.appendChild(a)
            container.appendChild(button)
            historyContainer.appendChild(container)
        }
        toggleModal(historyModal, 'flex')
    })

    document.getElementById('new-chat-button')?.addEventListener('click', function () {
        router.goTo('/')
    })

    document.getElementById('input-set-button')?.addEventListener('click', async function () {
        const content = input.innerText.trim()
        if (!content) {
            console.warn('Empty input, ignoring')
        }
        input.innerText = ''
        const message = { role: roleSelect.value, content }
        const id = await currentConversation.addMessage(db, message)
        addMessageToUi(id, message)
    })

    input.addEventListener('keydown', async function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            await submitForm()
        }
    })

    function setConfigForm(apiParamsSet: ApiParams = apiParams, presets: { [key: string]: ApiParams } = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : {}, presetName: string = '') {
        (document.getElementById('set-endpoint-input') as HTMLInputElement).value = apiParamsSet.endpoint;
        (document.getElementById('set-key-input') as HTMLInputElement).value = apiParamsSet.key

        const apiParamInputs = document.querySelectorAll('#config-form > [data-api-param]') as NodeListOf<HTMLInputElement>
        for (const input of apiParamInputs) {
            if (input.type === 'checkbox') {
                input.checked = apiParamsSet.params[input.getAttribute('data-api-param')!] ?? false
                continue
            }
            input.value = apiParamsSet.params[input.getAttribute('data-api-param')!] ?? ''
        }

        const presetSelect = document.getElementById('preset-select')
        let firstOption = document.createElement('option')
        firstOption.value = ''
        const nodes = [firstOption]
        for (const name in presets) {
            const option = document.createElement('option')
            option.value = name
            option.textContent = name
            nodes.push(option)
        }
        presetSelect?.replaceChildren(...nodes);

        (document.getElementById('preset-name') as HTMLInputElement).value = presetName
    }

    document.getElementById('set-config-button')?.addEventListener('click', function () {
        if (currentModal !== configModal) {
            setConfigForm()
        }
        toggleModal(configModal)
    })

    function getApiParams(): ApiParams {
        const key = (document.getElementById('set-key-input') as HTMLInputElement).value
        const endpoint = (document.getElementById('set-endpoint-input') as HTMLInputElement).value

        const apiParamInputs = document.querySelectorAll('#config-form > [data-api-param]') as NodeListOf<HTMLInputElement>

        const params: { [key: string]: any } = {}
        for (const input of apiParamInputs) {
            const param = input.getAttribute('data-api-param')!
            if (input.type === 'checkbox') {
                params[param] = input.checked
                continue
            }
            params[param] = input.value && input.type === 'number' ? parseFloat(input.value) : input.value
        }
        return { key, endpoint, params }
    }

    document.getElementById('config-form')?.addEventListener('submit', function (e) {
        e.preventDefault()
        apiParams = getApiParams()
        localStorage.setItem('apiParams', JSON.stringify(apiParams))

        toggleModal(configModal)
    })

    document.getElementById('set-preset')?.addEventListener('click', function () {
        const name = (document.getElementById('preset-name') as HTMLInputElement).value
        if (!name) {
            showError('Enter preset name to set')
        }
        const apiParams = getApiParams()
        const presets: { [key: string]: ApiParams } = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : {}
        presets[name] = apiParams
        localStorage.setItem('presets', JSON.stringify(presets))
        setConfigForm(apiParams, presets, name)
    })

    document.getElementById('preset-select')?.addEventListener('change', function (e) {
        const name = (e.currentTarget as HTMLSelectElement).value
        const presets: { [key: string]: ApiParams } = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : []
        apiParams = presets[name]
        setConfigForm(apiParams, presets, name)
    })

    document.getElementById('delete-preset')?.addEventListener('click', function () {
        const name = (document.getElementById('preset-name') as HTMLInputElement).value
        if (!name) {
            showError('Enter preset name to delete')
        }
        const presets: { [key: string]: ApiParams } = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : {}
        delete presets[name]
        localStorage.setItem('presets', JSON.stringify(presets))
        setConfigForm(apiParams, presets)
    })


    document.getElementById('export-button')?.addEventListener('click', function () {
        const json = JSON.stringify(currentConversation.map(function (conversationMessage) { return conversationMessage.message }))
        const element = document.createElement('a');
        element.style.display = 'none'
        element.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(json));
        element.setAttribute('download', 'chat-ui-export.json');
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    })

    document.getElementById('import-button')?.addEventListener('click', function () {
        document.getElementById('import-input')?.click()
    })

    document.getElementById('import-input')?.addEventListener('change', async function () {
        const file = (this as HTMLInputElement).files![0]
        if (!file) {
            return
        }
        const messages = JSON.parse(await file.text())
        currentConversation.clear()
        chatDiv.replaceChildren()
        for (const message of messages) {
            addMessageToUi(await currentConversation.addMessage(db, message), message)
        }
    })

    document.getElementById('error-close-button')?.addEventListener('click', function () {
        errorModal.style.display = 'none'
    })

    window.addEventListener('popstate', async function (e) {
        const state = e.state as { id: number, conversation: Conversation }
        if (!state || !state.id || !state.conversation) {
            return
        }
        await setConversation(state.id, state.conversation)
    })

    if (location.pathname !== '/') {
        const pathParts = location.pathname.split('/')
        if (pathParts[1] === 'conversation') {
            const conversationId = parseInt(pathParts[2])
            if (!isNaN(conversationId)) {
                try {
                    const conversation = await db.getObject('conversations', conversationId) as Conversation
                    history.replaceState({ id: conversationId, conversation }, '', `/conversation/${conversationId}`)
                    await setConversation(conversationId, conversation)
                } catch (e) {
                    console.log('Conversation not found:', e)
                    console.error(e)
                    showError('Conversation not found, start new chat or select from history')
                }
            }
        }
    }

    document.getElementById('app-heading-a')!.addEventListener('click', function (e) {
        e.preventDefault()
        router.goTo('/')
    })
}

main()

class ConversationMessageList extends DoubleLinkedList<ConversationMessageData> {
    constructor() {
        super()
    }

    async addMessage(db: DB, message: Message): Promise<number> {
        let conversationKey: number
        let conversationStart: number | null = null

        if (!this.head) {
            conversationStart = Date.now()
            const title = message.content.split('\n')[0].slice(0, 50) || 'New Conversation'
            conversationKey = await db.addObject('conversations', {
                title,
                timestamp: conversationStart
            })
            const api = apiMap[(new URL(apiParams.endpoint)).hostname.split('.').slice(-2).join('.')]
            fetch(apiParams.endpoint, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiParams.key}`,
                },
                body: JSON.stringify({
                    messages: [{
                        role: api?.developerRole ?? 'system',
                        content: 'Output topic of conversation based on next prompt in 10 words or less.'
                    },
                    {
                        role: 'user',
                        content: message.content
                    }],
                    model: api?.titleModel ?? apiParams.params.model
                })
            }).then(async function (response) {
                if (!response.ok) {
                    console.warn('Failed to get conversation title from API, using first message as title')
                    return
                }
                const data = await response.json()
                if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
                    console.warn('Failed to get conversation title from API, using first message as title')
                    return
                }
                const title = data.choices[0].message.content.slice(0, 100) ?? 'New Conversation'
                await db.updateObject('conversations', {
                    title
                }, conversationKey)
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
                root: id
            }, conversationKey)
            router.goTo(`/conversation/${conversationKey}`)
        }

        if (node.prev) {
            await this.setDbMessage(db, node.prev)
        }

        return id
    }

    getMessage(messageKey: number) {
        return this.find(function (data) { return data.id === messageKey })
    }

    async deleteMessage(db: DB, messageKey: number) {
        const node = this.getMessage(messageKey)

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
        const node = this.getMessage(messageKey)
        if (!node) {
            throw new Error('Message not found')
        }
        node.data.message = message
        await this.setDbMessage(db, node)
    }

    private async setDbMessage(db: DB, node: DoubleLinkedListNode<ConversationMessageData>) {
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

let currentModal: HTMLElement | null = null;

function toggleModal(modal: HTMLElement, display?: string): boolean {
    if (currentModal) {
        currentModal.style.display = 'none';
    }
    if (modal === currentModal) {
        currentModal = null;
        return false;
    }
    currentModal = modal;
    modal.style.display = display ?? 'block';
    return true;
}

const router = {
    async goTo(path: string): Promise<void> {
        if (currentModal) {
            toggleModal(currentModal)
        }
        history.pushState(null, '', path)
        if (path === '/') {
            currentConversation.clear()
            chatDiv.replaceChildren()
            return;
        }
        if (path.startsWith('/conversation/')) {
            const id = parseInt(path.split('/')[2]);
            if (isNaN(id)) {
                throw new Error('Invalid conversation ID')
            }
            await setConversation(id, await db.getObject('conversations', id) as Conversation)
        }
    }
};



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

interface ApiInformation {
    developerRole: string,
    store?: boolean,
    titleModel: string
}

interface ApiParams {
    endpoint: string
    key: string
    params: { [key: string]: any }
}

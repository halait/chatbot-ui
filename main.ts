import { DB, ConversationMessage } from './db.js'
import { render } from './markdown_renderer.js'
import { DoubleLinkedList, DoubleLinkedListNode } from './double_linked_list.js'
import { main as dbMain } from './firestore_db.js'
import { currentModal, toggleModal } from './modal.js'
import { main as authMain } from './auth.js'
import { createForm, getFormValues } from './schema_form.js'

let apiParams: ApiParams = localStorage.getItem('apiParams') ? JSON.parse(localStorage.getItem('apiParams')!) : {
  api: 'openai.com',
  params: {
    model: 'gpt-5-mini',
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
const enpointSelect = document.getElementById('set-endpoint-input') as HTMLSelectElement
const paramsForm = document.getElementById('params-form') as HTMLFormElement
const paramsContainer = document.getElementById('params-container') as HTMLElement
const presetSelect = document.getElementById('preset-select') as HTMLSelectElement

let lastFocusedMessage: DoubleLinkedListNode<ConversationMessageData> | null = null;

const apiMap: { [key: string]: Api } = {
  'openai.com': {
    url: 'https://api.openai.com/v1/responses',
    defaultModel: 'gpt-5-mini',
    paramsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', format: 'password' },
        model: { type: 'string' },
        temperture: { type: 'number' },
        max_output_tokens: { type: 'number' },
        stream: { type: 'boolean', default: true },
        store: { type: 'boolean' },
        reasoning: {
          type: 'object',
          title: 'reasoning',
          properties: {
            effort: {
              enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
            },
            summary: {
              enum: ['auto', 'concise', 'detailed']
            }
          }
        },
        prompt_cache_retention: {
          enum: ['in-memory', '24h']
        },
        prompt_cache_key: { type: 'string' }
      }
    },
    fetcher: async function* (messages: Message[], params: any, signal?: AbortSignal): AsyncIterable<string> {
      const { key, ...regularParams } = params
      if (!key) {
        throw new Error('API key is required')
      }
      const firstDeveloper = messages[0]?.role === 'developer' ? messages[0].content : null
      if (firstDeveloper) {
        messages = messages.slice(1)
      }
      const body = {
        input: messages,
        ...regularParams
      } as any
      if (firstDeveloper) body['instructions'] = firstDeveloper
      const response = await fetch(this.url, {
        method: 'post',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const data = await response.json();
        const textItem = data.output?.find((item: any) => item.type === 'message');
        yield textItem?.content[0]?.text
        return
      } else if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        if (!response.body) throw new Error('Response body is null for stream response')
        for await (const { event, data } of sseParser(response.body.getReader())) {
          if (event === 'response.output_text.delta') {
            yield JSON.parse(data).delta
          }
        }
      } else {
        throw new Error('Unsupported response type: ' + response.headers.get('Content-Type'))
      }
    }
  },
  'deepseek.com': {
    url: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    paramsSchema: {
      type: 'object',
      properties: {
        'key': { type: 'string', format: 'password' },
        model: { type: 'string' },
        thinking: {
          enum: ['enabled', 'disabled']
        },
        frequency_penalty: { type: 'number', min: -2, max: 2 },
        max_tokens: { type: 'number' },
        presence_penalty: { type: 'number', min: -2, max: 2 },
        response_format: { enum: ['text', 'json_object'] },
        stream: { type: 'boolean', default: true },
        temperature: { type: 'number', min: 0, max: 2 },
        top_p: { type: 'number', min: 0, max: 1 }
      }
    },
    fetcher: async function* (messages: Message[], params: any, signal?: AbortSignal): AsyncIterable<string> {
      const { key, ...regularParams } = params
      if (!key) {
        throw new Error('API key is required')
      }
      messages = messages.map((message: any) => {
        if (message.role === 'developer') {
          return { role: 'system', content: message.content }
        }
        return message
      })
      const body = {
        messages,
        ...regularParams
      } as any
      const response = await fetch(this.url, {
        method: 'post',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const data = await response.json();
        yield data.choices?.[0]?.message?.content;
        return
      } else if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        if (!response.body) throw new Error('Response body is null for stream response')
        for await (const { event, data } of sseParser(response.body.getReader())) {
          if (data) {
            yield JSON.parse(data).choices?.[0]?.delta?.content
          }
        }
      } else {
        throw new Error('Unsupported response type: ' + response.headers.get('Content-Type'))
      }
    }
  },
  'mistral.ai': {
    url: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    paramsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', format: 'password' },
        model: { type: 'string' },
        frequency_penalty: { type: 'number' },
        max_tokens: { type: 'number' },
        n: { type: 'number' },
        presence_penalty: { type: 'number' },
        prompt_mode: { enum: ['reasoning'] },
        random_seed: { type: 'number' },
        response_format: {
          type: 'object', properties: {
            type: { enum: ['text', 'json_object'] }
          }
        },
        safe_prompt: { type: 'boolean' },
        stop: { type: 'string' },
        stream: { type: 'boolean', default: true },
        temperature: { type: 'number' },
        top_p: { type: 'number' }
      }
    },
    fetcher: async function* (messages: Message[], params: any, signal?: AbortSignal): AsyncIterable<string> {
      const { key, ...regularParams } = params
      if (!key) {
        throw new Error('API key is required')
      }
      messages = messages.map((message: any) => {
        if (message.role === 'developer') {
          return { role: 'system', content: message.content }
        }
        return message
      })
      const body = {
        messages,
        ...regularParams
      } as any
      const response = await fetch(this.url, {
        method: 'post',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const data = await response.json();
        yield data.choices[0]?.message?.content.find((item: any) => item.type === 'text')?.text
        return
      } else if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        if (!response.body) throw new Error('Response body is null for stream response')
        for await (const { event, data } of sseParser(response.body.getReader())) {
          if (data) {
            const text = JSON.parse(data).choices?.[0]?.delta?.content
            if (typeof text === 'string') {
              yield text
            }
          }
        }
      } else {
        throw new Error('Unsupported response type: ' + response.headers.get('Content-Type'))
      }
    }
  },
  'x.ai': {
    url: 'https://api.x.ai/v1/chat/completions',
    defaultModel: 'grok-4-1-fast-reasoning',
    paramsSchema: {
      type: 'object',
      properties: {
        'key': { type: 'string', format: 'password' },
        'model': { type: 'string' },
        frequency_penalty: { type: 'number' },
        max_completion_tokens: { type: 'number' },
        n: { type: 'number' },
        presence_penalty: { type: 'number' },
        reasoning_effort: { enum: ['low', 'high'] },
        response_format: { enum: ['text', 'json_object'] },
        seed: { type: 'number' },
        stream: { type: 'boolean', default: true },
        stream_options: {
          type: 'object', properties: {
            include_usage: { type: 'boolean' }
          }
        },
        temperature: { type: 'number', min: 0, max: 2 },
        top_p: { type: 'number', min: 0, max: 1 }
      }
    },
    fetcher: async function* (messages: Message[], params: any, signal?: AbortSignal): AsyncIterable<string> {
      const { key, ...regularParams } = params
      if (!key) {
        throw new Error('API key is required')
      }
      messages = messages.map((message: any) => {
        if (message.role === 'developer') {
          return { role: 'system', content: message.content }
        }
        return message
      })
      const body = {
        messages,
        ...regularParams
      } as any
      const response = await fetch(this.url, {
        method: 'post',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const data = await response.json();
        yield data.choices?.[0]?.message?.content;
        return
      } else if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        if (!response.body) throw new Error('Response body is null for stream response')
        for await (const { event, data } of sseParser(response.body.getReader())) {
          if (data) {
            yield JSON.parse(data).choices?.[0]?.delta?.content
          }
        }
      } else {
        throw new Error('Unsupported response type: ' + response.headers.get('Content-Type'))
      }
    }
  },
  'anthropic.com': {
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5',
    paramsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', format: 'password' },
        model: { type: 'string' },
        max_tokens: { type: 'number', default: 1024 },
        cache_control: {
          type: 'object', properties: {
            type: { enum: ['ephemeral'], default: 'ephemeral' },
            ttl: { enum: ['5m', '1h'] }
          }
        },
        container: { type: 'string' },
        inference_geo: { type: 'string' },
        output_config: {
          type: 'object',
          properties: {
            effort: { enum: ['low', 'medium', 'high', 'max'] },
            format: {
              type: 'object',
              properties: {
                schema: { type: 'string' },
                type: { enum: ['json_schema'] }
              }
            }
          }
        },
        service_tier: { enum: ['auto', 'standard_only'] },
        stream: { type: 'boolean', default: true },
        temperature: { type: 'number', min: 0, max: 1 },
        top_k: { type: 'number', min: 0 },
        top_p: { type: 'number', min: 0, max: 1 }
      }
    },
    fetcher: async function* (messages: Message[], params: any, signal?: AbortSignal): AsyncIterable<string> {
      const { key, ...regularParams } = params
      if (!key) {
        throw new Error('API key is required')
      }
      const firstDeveloper = messages[0]?.role === 'developer' ? messages[0].content : null
      if (firstDeveloper) {
        messages = messages.slice(1)
      }

      messages = messages.map((message: any) => {
        if (message.role === 'developer') {
          return { role: 'system', content: message.content }
        }
        return message
      })

      const body = {
        messages,
        ...regularParams
      } as any
      if (firstDeveloper) body['system'] = firstDeveloper
      const response = await fetch(this.url, {
        method: 'post',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const data = await response.json();
        yield data.content?.[0]?.text;
        return
      } else if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        if (!response.body) throw new Error('Response body is null for stream response')
        for await (const { event, data } of sseParser(response.body.getReader())) {
          if (data) {
            let result = JSON.parse(data)
            if (result.type === 'content_block_delta') {
              yield result.delta?.text
            } else if (result.type === 'message_stop') {
              return
            }
          }
        }
      } else {
        throw new Error('Unsupported response type: ' + response.headers.get('Content-Type'))
      }
    }
  },
  'google.com': {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:streamGenerateContent',
    defaultModel: 'gemini-3.0-flash',
    paramsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', format: 'password' },
        model: { type: 'string' },
        temperature: { type: 'number', min: 0, max: 2 },
        top_p: { type: 'number', min: 0, max: 1 },
        top_k: { type: 'number' },
        max_output_tokens: { type: 'number' },
        system_instruction: { type: 'string' }
      }
    },
    fetcher: async function* (messages: Message[], params: any, signal?: AbortSignal): AsyncIterable<string> {
      const { key, model, ...generationConfig } = params;
      if (!key) throw new Error('API key is required');

      let systemInstruction = undefined;
      const contentMessages = messages.filter(m => {
        if (m.role === 'developer') {
          systemInstruction = { parts: [{ text: m.content }] };
          return false;
        }
        return true;
      });

      const contents = contentMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await fetch(this.url.replace('gemini-3.0-flash', model ?? this.defaultModel) + '?alt=sse', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key 
        },
        body: JSON.stringify({ 
          contents, 
          system_instruction: systemInstruction,
          generationConfig 
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (!response.body) throw new Error('Response body is null');
      
      for await (const { data } of sseParser(response.body.getReader())) {
        try {
          console.log('Received SSE data:', data);
          const json = JSON.parse(data);
          console.log('Parsed JSON:', json);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            yield text;
          }
        } catch (e) {
          // Gemini sometimes sends a "metadata" event at the end which might not parse the same
        }
      }
    }
  }
}

const lineBreakRegex = /\r\n|\r|\n/;
async function* sseParser(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let lines = buffer.split(lineBreakRegex);
      
      buffer = lines.pop() || "";

      let currentEvent = "message";
      let currentData = "";

      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed === "") {
          if (currentData) {
            yield { event: currentEvent, data: currentData.trim() };
            currentData = "";
            currentEvent = "message";
          }
          continue;
        }

        if (line.startsWith(":")) continue;


        if (line.startsWith("data:")) {
          const data = line.slice(5);
          if(data.trim() === "[DONE]") return
          currentData += data; 
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("id:")) {
        }
      }
    }
    
    if (buffer.startsWith("data:")) {
        yield { event: "message", data: buffer.slice(5).trim() };
    }
  } finally {
    reader.releaseLock();
  }
}

let db: DB

let lastChatDivScroll = 0
let lastCharDivScrollTop = 0

function getApiConfiguration(endpoint: string): Api | undefined {
  return apiMap[enpointSelect.value]
}

async function submitForm() {
  const inputValue = input.innerText.trim()
  let lastMessage = currentConversation.tail
  if (inputValue !== '') {
    input.innerText = ''

    const message = {
      role: roleSelect.value as ('user' | 'assistant' | 'developer'),
      content: inputValue
    }

    const messageId = await currentConversation.addMessage(db, message)
    addMessageToUi(messageId, message)
    lastMessage = currentConversation.tail
  } else if (lastFocusedMessage) {
    lastMessage = lastFocusedMessage
  }

  const api = apiMap[apiParams.api]
  if (!api) {
    showError('API configuration not found for endpoint: ' + apiParams.api)
    return
  }

  const messages: Message[] = []
  let currentNode = currentConversation.head
  while (currentNode != null) {
    messages.push({
      role: currentNode.data.message.role,
      content: currentNode.data.message.content
    })
    if (currentNode === lastMessage) {
      break
    }
    currentNode = currentNode.next
  }

  const controller = new AbortController();
  let response = api.fetcher(messages, apiParams.params, controller.signal)
  const isLast = lastMessage === currentConversation.tail
  const assistantMessage: Message = { role: 'assistant', content: '' }
  const assistantMessageId = await currentConversation.addMessage(db, assistantMessage, lastMessage)
  const element = addMessageToUi(assistantMessageId, assistantMessage, lastMessage?.data.id)
  const message: string[] = []
  let start = Date.now()
  let lastUpdate = 0
  for await (const chunk of response) {
    message.push(chunk)
    const now = Date.now()
    if (now - lastUpdate > 200) {
      updateUiMessage(element, message.join(''))
      if (isLast && start > lastChatDivScroll) {
        chatDiv.scrollTop = chatDiv.scrollHeight
      }
      lastUpdate = now
    }
  }

  assistantMessage.content = message.join('')
  updateUiMessage(element, assistantMessage.content)
  if (isLast && start > lastChatDivScroll) {
    chatDiv.scrollTop = chatDiv.scrollHeight
  }
  await currentConversation.updateMessage(db, assistantMessage, assistantMessageId)
}

function addMessageToUi(messageId: number, message: Message, afterMessageId?: number): HTMLDivElement {
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
    lastFocusedMessage = node
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
      if (lastFocusedMessage?.data.id === messageKey) {
        lastFocusedMessage = null
      }
      currentConversation.deleteMessage(db, messageKey)
      element.parentElement?.removeChild(element)
      return
    }
    const nodes = render(content)
    element.replaceChildren(...nodes)
    currentConversation.updateMessage(db, {
      content: content,
      role: element.dataset.role as 'user' | 'assistant' | 'developer'
    }, parseInt(element.dataset.id!))
  })
  if (afterMessageId !== undefined) {
    const afterElement = chatDiv.querySelector(`div.message-div[data-id='${afterMessageId}']`)
    if (!afterElement) {
      throw new Error('After element not found')
    }
    afterElement.after(div)
  } else {
    chatDiv.appendChild(div)
    chatDiv.scrollTop = chatDiv.scrollHeight
  }
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
  element.replaceChildren(...nodes);
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

function setPresets(presets: { [key: string]: ApiParams }) {
  localStorage.setItem('presets', JSON.stringify(presets))
  presetSelect.replaceChildren()
  const firstOption = document.createElement('option')
  firstOption.value = ''
  presetSelect.appendChild(firstOption)
  for (const presetName in presets) {
    const option = document.createElement('option')
    option.value = presetName
    option.textContent = presetName
    presetSelect.appendChild(option)
  }
}

async function main() {


  dbMain()
  authMain()




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
    const conversations = await db.getAll('conversations', 'prev') as Map<number, Conversation>
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
    const message = { role: roleSelect.value as 'user' | 'assistant' | 'developer', content }
    const id = await currentConversation.addMessage(db, message)
    addMessageToUi(id, message)
  })

  input.addEventListener('keydown', async function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      await submitForm()
    }
  })

  document.getElementById('set-config-button')?.addEventListener('click', function () {
    toggleModal(configModal)
  })

  document.getElementById('set-preset')?.addEventListener('click', function () {
    const name = (document.getElementById('preset-name') as HTMLInputElement).value
    if (!name) {
      showError('Enter preset name to set')
    }
    const params = {
      api: enpointSelect.value,
      params: getFormValues(paramsContainer.querySelector('.schema-form-container') as HTMLElement)
    }
    const presets: { [key: string]: ApiParams } = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : {}
    presets[name] = params

    setPresets(presets)
  })

  presetSelect.addEventListener('change', function (e) {
    const name = (e.currentTarget as HTMLSelectElement).value
    if (!name) {
      return
    }
    const presets: { [key: string]: ApiParams } = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : []
    apiParams = presets[name]
    enpointSelect.value = apiParams.api
    const api = getApiConfiguration(apiParams.api)
    if (!api) {
      showError('API configuration not found for endpoint: ' + apiParams.api)
      return
    }
    paramsContainer.replaceChildren(createForm(api.paramsSchema, apiParams.params))
    presetSelect.value = ''
  })

  document.getElementById('delete-preset')?.addEventListener('click', function () {
    const name = (document.getElementById('preset-name') as HTMLInputElement).value
    if (!name) {
      showError('Enter preset name to delete')
    }
    const presets: { [key: string]: ApiParams } = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : {}
    delete presets[name]
    setPresets(presets)
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
    const path = location.pathname
    router.render(path)
  })

  if (location.pathname !== '/') {
    const path = location.pathname
    router.render(path)
  }

  document.getElementById('app-heading-a')!.addEventListener('click', function (e) {
    e.preventDefault()
    router.goTo('/')
  })

  for (const api of Object.keys(apiMap)) {
    const option = document.createElement('option')
    option.value = api
    option.textContent = api
    enpointSelect.appendChild(option)
  }
  enpointSelect.addEventListener('change', function () {
    apiParams.api = enpointSelect.value
    if (!enpointSelect.value) {
      paramsContainer.replaceChildren()
      paramsForm.style.display = 'none'
      return
    }
    paramsForm.style.display = 'block'
    const api = getApiConfiguration(enpointSelect.value)
    if (!api) {
      showError('API configuration not found for endpoint: ' + enpointSelect.value)
      return
    }
    paramsContainer.replaceChildren(createForm(api.paramsSchema ?? {}))
  })

  paramsForm.addEventListener('submit', function (e) {
    e.preventDefault()
    const values = getFormValues(paramsContainer.querySelector('.schema-form-container') as HTMLElement)
    apiParams.params = values
    localStorage.setItem('apiParams', JSON.stringify(apiParams))
    toggleModal(configModal)
  })

  if (apiParams) {
    enpointSelect.value = apiParams.api
    paramsForm.style.display = 'block'
    const api = getApiConfiguration(apiParams.api)
    if (!api) {
      showError('API configuration not found for endpoint: ' + apiParams.api)
      return
    }
    paramsContainer.replaceChildren(createForm(api.paramsSchema, apiParams.params))
  }

  const presets = localStorage.getItem('presets') ? JSON.parse(localStorage.getItem('presets')!) : {}
  setPresets(presets)
}

main()

async function fetchAsPromise(message: Message[], apiParams: ApiParams, signal?: AbortSignal): Promise<string> {
  const api = apiMap[apiParams.api]
  const response = api.fetcher(message, apiParams.params, signal)
  let result = []
  for await (const chunk of response) {
    result.push(chunk)
  }
  return Promise.resolve(result.join(''))
}

class ConversationMessageList extends DoubleLinkedList<ConversationMessageData> {
  constructor() {
    super()
  }

  async addMessage(db: DB, message: Message, afterMessage?: DoubleLinkedListNode<ConversationMessageData> | null): Promise<number> {
    let conversationKey: number
    let conversationStart: number | null = null

    if (!this.head) {
      conversationStart = Date.now()
      const title = message.content.split('\n')[0].slice(0, 50) || 'New Conversation'
      conversationKey = await db.addObject('conversations', {
        title,
        timestamp: conversationStart
      })
      fetchAsPromise([
        {
          role: 'developer',
          content: 'Output title for conversation based on next prompt in 10 words or less.'
        },
        {
          role: 'user',
          content: message.content
        }
      ], apiParams).then(async function (title) {
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

    const node = afterMessage ?
      super.addAfter(afterMessage, conversationMessage) :
      super.add(conversationMessage)
    const id = await this.setDbMessage(db, node)
    node.data.id = id

    if (conversationStart) {
      await db.updateObject('conversations', {
        root: id
      }, conversationKey)
      router.goTo(`/conversation/${conversationKey}`, false)
    }

    if (node.prev) {
      await this.setDbMessage(db, node.prev)
    }

    if (afterMessage && node.next) {
      await this.setDbMessage(db, node.next)
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


const router = {
  async goTo(path: string, render: boolean = true) {
    if (currentModal) {
      toggleModal(currentModal)
    }
    history.pushState(null, '', path)
    if(!render) return
    this.render(path)
  },
  async render(path: string) {
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


export interface Message {
  role: 'user' | 'assistant' | 'developer'
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

interface Api {
  url: string
  defaultModel?: string
  paramsSchema: any
  fetcher: ApiFetcher
}

interface ApiFetcher {
  (messages: Message[], params: any, signal?: AbortSignal): AsyncIterable<string>
}

interface ApiParams {
  api: string
  params: any
}

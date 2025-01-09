export class DB {
    db?: IDBDatabase

    async init() {
        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('chat_ui', 1)

            request.onerror = function (e) {
                reject()
            }

            request.onupgradeneeded = function (e) {
                const connection = (e.target as IDBOpenDBRequest).result
                // const messages = connection.createObjectStore('messages', { autoIncrement: true })

                const conversations = connection.createObjectStore('conversations', { autoIncrement: true })
                conversations.createIndex('timestamp', 'timestamp', { unique: false })

                const conversationsMessages = connection.createObjectStore('conversationsMessages', { autoIncrement: true })
                conversationsMessages.createIndex('conversationKey', 'conversationKey', { unique: false })
            }

            request.onsuccess = (e) => {
                this.db = (e.target as IDBOpenDBRequest).result
                resolve()
            }
        })
    }

    addObject(store: string, object: any): Promise<number> {
        return new Promise((resolve) => {
            if (!this.db) {
                throw new Error('Not initialized')
            }
            const transaction = this.db.transaction([store], 'readwrite')

            transaction.onerror = (event) => {
                throw new Error('Transaction error, unable to add object.')
            }

            transaction.objectStore(store).add(object).onsuccess = function (e) {
                resolve((e.target as IDBRequest).result)
            }
        })
    }

    getObject(store: string, key: any): Promise<any> {
        return new Promise((resolve) => {
            if (!this.db) {
                throw new Error('Not initialized')
            }
            const transaction = this.db.transaction([store], 'readwrite')

            transaction.onerror = (event) => {
                throw new Error('Transaction error, unable to update object.')
            }

            const objectStore = transaction.objectStore(store)
            const request = objectStore.get(key)

            request.onerror = function (e) {
                throw new Error('Get error, unable to update object.')
            }
            request.onsuccess = function (e) {
                const data = (e.target as IDBRequest).result
                if (!data) {
                    throw new Error('Object does not exist, unable to get object.')
                }
                resolve(data)
            }
        })
    }

    updateObject(store: string, object: any, key: any): Promise<number> {
        return new Promise((resolve) => {
            if (!this.db) {
                throw new Error('Not initialized')
            }
            const transaction = this.db.transaction([store], 'readwrite')

            transaction.onerror = (event) => {
                throw new Error('Transaction error, unable to update object.')
            }

            const objectStore = transaction.objectStore(store)
            const request = objectStore.get(key)
            request.onerror = function (e) {
                throw new Error('Get error, unable to update object.')
            }
            request.onsuccess = function (e) {
                const data = (e.target as IDBRequest).result
                if (!data) {
                    throw new Error('Object does not exist, unable to update object.')
                }
                const requestUpdate = objectStore.put(object, key)

                requestUpdate.onerror = function () {
                    throw new Error('Put error, unable to update object.')
                }

                requestUpdate.onsuccess = function (e) {
                    resolve((e.target as IDBRequest).result)
                }
            }
        })
    }

    getAll(store: string): Promise<Map<number, any>> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                throw new Error('Not initialized')
            }
            const transaction = this.db.transaction([store])

            transaction.onerror = (event) => {
                throw new Error('Transaction error, unable to get all objects.')
            }

            const request = transaction.objectStore(store).openCursor()

            request.onerror = function (e) {
                reject('Unable to get all from store.')
            }

            const result = new Map()

            request.onsuccess = function (e) {
                const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    result.set(cursor.key, cursor.value);
                    cursor.continue();
                } else {
                    resolve(result)
                }
            }
        })
    }

    getAllIndexKey(store: string, index: string, key: any): Promise<Map<number, any>> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                throw new Error('Not initialized')
            }
            const transaction = this.db.transaction([store])

            transaction.onerror = (event) => {
                throw new Error('Transaction error, unable to get all objects.')
            }

            const request = transaction.objectStore(store).index(index).openCursor(key)

            request.onerror = function (e) {
                reject('Unable to get all from index .')
            }

            const result = new Map()

            request.onsuccess = function (e) {
                const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    result.set(cursor.primaryKey, cursor.value);
                    cursor.continue();
                } else {
                    resolve(result)
                }
            }
        })
    }

    deleteAllIndexKey(store: string, index: string, key: any): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                throw new Error('Not initialized')
            }
            const transaction = this.db.transaction([store], 'readwrite')

            transaction.onerror = (event) => {
                throw new Error('Transaction error, unable to get all objects.')
            }
            const objectStore = transaction.objectStore(store)
            const request = objectStore.index(index).openKeyCursor(key)

            request.onerror = function (e) {
                reject('Unable to get all from index .')
            }

            request.onsuccess = function (e) {
                const cursor = (e.target as IDBRequest).result as IDBCursor;
                if (cursor) {
                    objectStore.delete(cursor.primaryKey)
                    cursor.continue();
                } else {
                    resolve()
                }
            }
        })
    }

    deleteObject(store: string, key: any) {
        return new Promise<void>((resolve) => {
            if (!this.db) {
                throw new Error('Not initialized')
            }
            const transaction = this.db.transaction([store], 'readwrite')

            transaction.onerror = (event) => {
                throw new Error('Transaction error, unable to delete object.')
            }

            const request = transaction.objectStore(store).delete(key)
            request.onerror = function (e) {
                throw new Error('Get error, unable to update object.')
            }
            request.onsuccess = function (e) {
                resolve()
            }
        })
    }

    async addMessage(message: ConversationMessage): Promise<number> {
        return await this.addObject('conversationsMessages', message)
    }

    async updateMessage(message: ConversationMessage, messageKey: number) {
        return await this.updateObject('conversationsMessages', message, messageKey)
    }

    async deleteMessage(messageKey: number) {
        return await this.deleteObject('conversationsMessages', messageKey)
    }
}

export interface ConversationMessage {
    message: Message
    prevKey: number | null
    nextKey: number | null
    conversationKey: number
}

interface Message {
    role: string
    content: string
}
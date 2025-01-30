export class DoubleLinkedListNode<T> {
    data: T
    prev: DoubleLinkedListNode<T> | null = null
    next: DoubleLinkedListNode<T> | null = null

    constructor(data: T) {
        this.data = data
    }
}

export class DoubleLinkedList<T> {
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

    pop() {
        if (!this.tail) {
            return null
        }
        const node = this.tail
        this.delete(node)
        return node.data
    }

    shift() {
        if (!this.head) {
            return null
        }
        const node = this.head
        this.delete(node)
        return node.data
    }
}

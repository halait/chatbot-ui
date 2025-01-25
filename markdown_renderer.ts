/*
Grammar rules

document = { statement }
statement = text | 
*/

import { text } from "stream/consumers";

function isTextChar(char: string) {
    const code = char.charCodeAt(0);
    return (code >= 32 && code <= 41) ||
        (code >= 43 && code <= 126)
}

function isTextStart(char: string) {
    const code = char.charCodeAt(0);
    return (code >= 32 && code <= 34) ||
        (code >= 36 && code <= 41) ||
        (code >= 43 && code <= 44) ||
        (code >= 46 && code <= 61) ||
        (code >= 63 && code <= 126)
}



// function getToken(markdown: string, start: number) {

// }

function tokenize(markdown: string): Token[] {
    const tokens: Token[] = []
    for (let i = 0, len = markdown.length; i != len;) {

        if (markdown[i] === '*') {
            const start = i
            do {
                ++i
            } while (markdown[i] === '*' && i - start < 3)
            tokens.push({ type: 'asterisks', value: markdown.slice(start, i) })
            continue
        }
        if (markdown[i] === '#') {
            let start = i
            do {
                ++i
            } while (markdown[i] === '#')
            if(i - start > 6) {
                console.warn('more than 6 numberSigns in token, truncating')
                start  = i - 6
            }
            tokens.push({ type: 'numberSigns', value: markdown.slice(start, i) })
            continue
        }
        if (markdown[i] === '\n') {
            const start = i
            do {
                ++i
            } while (markdown[i] === '\n')
            if (i - start === 1) {
                tokens.push({ type: 'newLine', value: markdown.slice(start, i) })
            } else {
                tokens.push({ type: 'newLines', value: markdown.slice(start, i) })
            }
            continue
        }
        const start = i
        do {
            ++i
        } while (i != len && isTextChar(markdown[i]))
        tokens.push({ type: 'text', value: markdown.slice(start, i) })

        // console.warn('unknown token start, interperting as text')
        // tokens.push({type: 'text', value: markdown.slice(i, ++i)})
    }
    return tokens
}

class Parser {
    tokens: Token[]
    i: number = 0
    len: number

    constructor(tokens: Token[]) {
        this.tokens = tokens
        this.len = tokens.length
    }

    increment() {
        ++this.i
    }

    getCurrentToken(): Token | null {
        return this.tokens[this.i] ?? null
    }

    hasToken() {
        return this.i < this.len
    }

    isTokenType(tokenType: TokenType) {
        return this.tokens[this.i].type === tokenType
    }

    parse(...endTokenTypes: TokenType[]): Element[] {
        const elements: Element[] = []
        while (this.hasToken()) {
            if (endTokenTypes.includes(this.getCurrentToken()!.type)) {
                this.increment()
                return elements
            }

            if (this.isTokenType('numberSigns')) {
                elements.push(this.parseH())
            } else if(endTokenTypes.length === 0) {
                elements.push(this.parseP())
            } else if (this.isTokenType('text')) {
                elements.push({ name: 'text', value: this.getCurrentToken()!.value } as TextElement)
                this.increment()
            } else if (this.isTokenType('asterisks')) {
                elements.push(this.parseEm())
            } else if(this.isTokenType('newLine') || this.isTokenType('newLines')) {
                this.increment()
                elements.push({name: 'br'})
            } else {
                throw new Error('Unhandled token type: ' + this.getCurrentToken()?.type)
            }
        }
        return elements
    }

    parseP(): Element {
        return { name: 'p', children: this.parse('newLines') }
    }

    parseEm(): Element {
        const length = this.getCurrentToken()!.value.length
        this.increment()
        let name: ElementType;
        if (length === 1) {
            name = 'em'
        } else if (length === 2) {
            name = 'strong'
        } else {
            if (length > 3) {
                console.warn('Ignoring astericks, more than 3.')
            }
            return { name: 'em', children: [{ name: 'strong', children: this.parse('asterisks') }] }
        }
        return { name, children: this.parse('asterisks') }
    }

    parseH(): Element {
        const length = this.getCurrentToken()!.value.length
        if (length > 6) {
            throw new Error('Heading level more than 6.')
        }
        this.increment()
        if(this.getCurrentToken()?.type === 'text') {
            this.tokens[this.i].value = this.tokens[this.i].value.trim()
        }
        return { name: ('h' + length) as ElementType, children: this.parse('newLines', 'newLine') }
    }
}

function renderHTML(ast: Element[]): Node[] {
    const nodes: Node[] = []
    for(const node of ast) {
        if(node.name === 'text') {
            nodes.push(document.createTextNode((node as TextElement).value))
        } else {
            const element = document.createElement(node.name)
            if(node.children) {
                for(const child of renderHTML(node.children)) {
                    element.appendChild(child)
                }
            }
            nodes.push(element)
        }
        
    }
    return nodes
}

export function render(markdown: string): Node[] {
    const tokens = tokenize(markdown)
    const ast = (new Parser(tokens)).parse()
    const nodes = renderHTML(ast)
    return nodes
}

export function htmlToMarkdown(nodes: NodeListOf<ChildNode>): string {
    const markdown: string[] = []
    for(const child of nodes) {
        if(child.nodeName === '#text') {
            markdown.push(child.textContent ?? '')
        } else if(child.nodeName === 'P') {
            markdown.push(htmlToMarkdown(child.childNodes))
            markdown.push('\n\n')
        } else if(child.nodeName === 'H1' ||
            child.nodeName === 'H2' ||
            child.nodeName === 'H3' ||
            child.nodeName === 'H4' ||
            child.nodeName === 'H5' ||
            child.nodeName === 'H6'
        ) {
            markdown.push('######'.slice(0, parseInt(child.nodeName[1])))
            markdown.push(' ')
            markdown.push(htmlToMarkdown(child.childNodes))
            markdown.push('\n')
        } else if(child.nodeName === 'EM') {
            markdown.push('*')
            markdown.push(htmlToMarkdown(child.childNodes))
            markdown.push('*')
        } else if(child.nodeName === 'STRONG') {
            markdown.push('**')
            markdown.push(htmlToMarkdown(child.childNodes))
            markdown.push('**')
        } else if(child.nodeName === 'BR') {
            markdown.push('\n')
        }
    }
    return markdown.join('')
}

type TokenType = 'text' | 'asterisks' | 'numberSigns' | 'newLine' | 'newLines'

interface Token {
    type: TokenType
    value: string
}

type ElementType = 'text' | 'p' | 'strong' | 'em' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'br'


interface Element {
    name: ElementType
    children?: Element[]
}

interface TextElement extends Element {
    name: 'text'
    value: string
}

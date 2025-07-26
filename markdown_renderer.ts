/*
Grammar rules
document = { statement }
*/
class Tokenizer {
    private markdown: string
    private i: number = 0
    constructor(markdown: string) {
        this.markdown = markdown
    }

    isTextChar() {
        const code = this.markdown[this.i].charCodeAt(0);
        return (code >= 32 && code <= 41) ||
            (code >= 43 && code <= 126)
    }

    // private static isTextStart(char: string) {
    //     const code = char.charCodeAt(0);
    //     return (code >= 32 && code <= 34) ||
    //         (code >= 36 && code <= 41) ||
    //         (code >= 43 && code <= 44) ||
    //         (code >= 46 && code <= 61) ||
    //         (code >= 63 && code <= 126)
    // }



    // function getToken(markdown: string, start: number) {

    // }
    private eatRepeat(type: TokenType, max?: number): Token {
        const char = this.markdown[this.i]
        const start = this.i
        do {
            ++this.i
        } while (this.markdown[this.i] === char && (max ? this.i - start < max : true))
        return { type, value: this.markdown.slice(start, this.i) }
    }

    private eatNumber(): Token {
        const start = this.i
        let code
        do {
            code = this.markdown[this.i].charCodeAt(0)
            ++this.i
        } while (code >= 48 && code <= 57)
        if(this.markdown[this.i] !== '.') {
            throw new Error('Missing period after number')
        }
        ++this.i
        return { type: 'number', value: this.markdown.slice(start, this.i) }
    }

    private isNumber() {
        const len = this.markdown.length
        let i = this.i
        let code
        do {
            code = this.markdown[i].charCodeAt(0)
            ++i
        } while (i != len && code >= 48 && code <= 57)
        if(this.markdown[i] === '.') {
            return true
        }
        return false
    }

    tokenize(): Token[] {
        const tokens: Token[] = []
        const len = this.markdown.length
        while (this.i != len) {
            switch (this.markdown[this.i]) {
                case '*':
                    tokens.push(this.eatRepeat('asterisks', 3))
                    break
                case '#':
                    tokens.push(this.eatRepeat('numberSigns', 6))
                    break
                case '\n':
                    tokens.push(this.eatRepeat('newLines', 2))
                    break
                case ' ':
                    tokens.push(this.eatRepeat('space'))
                    break
                case '-':
                    tokens.push(this.eatRepeat('hyphen'))
                    break
                case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9': case '0':
                    if(this.isNumber()) {
                        tokens.push(this.eatNumber())
                        break
                    }
                default:
                    const start = this.i
                    do {
                        ++this.i
                    } while (this.i != len && this.isTextChar())
                    tokens.push({ type: 'text', value: this.markdown.slice(start, this.i) })
            }
        }
        // for (let i = 0, len = this.markdown.length; i != len;) {
        // if (markdown[i] === '*') {
        //     const start = i
        //     do {
        //         ++i
        //     } while (markdown[i] === '*' && i - start < 3)
        //     tokens.push({ type: 'asterisks', value: markdown.slice(start, i) })
        //     continue
        // }
        // if (markdown[i] === '#') {
        //     let start = i
        //     do {
        //         ++i
        //     } while (markdown[i] === '#')
        //     if (i - start > 6) {
        //         console.warn('more than 6 numberSigns in token, truncating')
        //         start = i - 6
        //     }
        //     tokens.push({ type: 'numberSigns', value: markdown.slice(start, i) })
        //     continue
        // }
        // if (markdown[i] === '\n') {
        //     const start = i
        //     do {
        //         ++i
        //     } while (markdown[i] === '\n')
        //     if (i - start === 1) {
        //         tokens.push({ type: 'newLine', value: markdown.slice(start, i) })
        //     } else {
        //         tokens.push({ type: 'newLines', value: markdown.slice(start, i) })
        //     }
        //     continue
        // }
        // const start = i
        // do {
        //     ++i
        // } while (i != len && Tokenizer.isTextChar(markdown[i]))
        // tokens.push({ type: 'text', value: markdown.slice(start, i) })

        // console.warn('unknown token start, interperting as text')
        // tokens.push({type: 'text', value: markdown.slice(i, ++i)})
        // }
        return tokens
    }


}


class Parser {
    tokens: Token[]
    i: number = 0
    len: number

    constructor(tokens: Token[]) {
        this.tokens = tokens
        this.len = tokens.length
    }

    private increment() {
        ++this.i
    }

    private get(): Token | null {
        return this.tokens[this.i] ?? null
    }

    private has() {
        return this.i < this.len
    }

    private isType(tokenType: TokenType) {
        return this.tokens[this.i].type === tokenType
    }

    private next(): Token | null {
        ++this.i
        return this.tokens[this.i - 1] ?? null
    }

    private peek(): Token | null {
        return this.tokens[this.i + 1] ?? null
    }

    private previous(): Token | null {
        return this.tokens[this.i - 1] ?? null
    }

    parse(currentElement?: ElementType): Element[] {
        const elements: Element[] = []
        while (this.has()) {
            // console.log('Parsing, current element: "' + currentElement + '" current token:')
            // console.log(this.get())
            const type = this.get()!.type
            if (currentElement === 'ul' && type !== 'newLines' && type !== 'hyphen') {
                return elements
            }
            if(currentElement === 'ol' && type !== 'newLines' && type !== 'number') {
                return elements
            }
            switch (type) {
                case 'newLines':
                    if (currentElement === 'p' && this.get()!.value.length === 1 && this.peek()?.type === 'text') {
                        elements.push(this.parseText())
                    } else if ((currentElement === 'ul' || currentElement === 'ol') && this.get()!.value.length === 1) {
                        this.next()
                    } else if(currentElement) {
                        return elements
                    } else {
                        this.next()
                    }
                    break
                case 'text':
                    if (!currentElement) {
                        elements.push(this.parseP())
                    } else {
                        elements.push(this.parseText())
                    }
                    break
                case 'numberSigns':
                    if (this.peek()?.type === 'space') {
                        elements.push(this.parseH())
                    } else {
                        elements.push(this.parseText())
                    }
                    break
                case 'hyphen':
                    if (this.get()!.value.length > 1) {
                        elements.push(this.parseText())
                    } else if (this.peek()?.type === 'space') {
                        if (currentElement === 'ul') {
                            elements.push(this.parseLi())
                        } else {
                            elements.push(this.parseUl())
                        }
                    } else {
                        elements.push(this.parseText())
                    }
                    break
                case 'number':
                    if (currentElement === 'ol') {
                        elements.push(this.parseLi())
                    } else {
                        elements.push(this.parseOl())
                    }
                    break
                case 'asterisks':
                    if (currentElement === 'em' || currentElement === 'strong') {
                        this.next()
                        return elements
                    }
                    if (this.previous()?.type === 'newLines' && this.peek()?.type === 'space') {
                        if (currentElement === 'ul') {
                            elements.push(this.parseLi())
                        } else {
                            elements.push(this.parseUl())
                        }
                    } else {
                        if(!currentElement) {
                            elements.push(this.parseP())
                        } else {
                            elements.push(this.parseEm())
                        }
                    }
                    break
                default:
                    elements.push({ name: 'text', value: this.next()!.value } as TextElement)
                    break
            }
        }
        return elements
    }

    parseText(): Element {
        return { name: 'text', value: this.next()!.value } as TextElement
    }

    parseP(): Element {
        return { name: 'p', children: this.parse('p') }
    }

    parseUl(): Element {
        return { name: 'ul', children: this.parse('ul') }
    }

    parseOl(): Element {
        return { name: 'ol', children: this.parse('ol') }
    }

    parseLi(): Element {
        this.next(); this.next();
        return { name: 'li', children: this.parse('li') }
    }

    parseEm(): Element {
        const length = this.next()!.value.length
        if (length === 1) {
            return { name: 'em', children: this.parse('em') }
        } else if (length === 2) {
            return { name: 'strong', children: this.parse('strong') }
        } else {
            if (length > 3) {
                console.warn('Ignoring astericks, more than 3.')
            }
            return { name: 'em', children: [{ name: 'strong', children: this.parse('strong') }] }
        }

    }

    parseH(): Element {
        let length = this.next()!.value.length
        if (length > 6) {
            console.warn('Ignoring heading level more than 6')
            length = 6
        }
        this.next()
        const name = 'h' + length as ElementType
        return { name, children: this.parse(name) }
    }
}

function generateNodes(ast: Element[]): Node[] {
    const nodes: Node[] = []
    for (const node of ast) {
        if (node.name === 'text') {
            nodes.push(document.createTextNode((node as TextElement).value))
        } else {
            const element = document.createElement(node.name)
            if (node.children) {
                for (const child of generateNodes(node.children)) {
                    element.appendChild(child)
                }
            }
            nodes.push(element)
        }

    }
    return nodes
}

export function render(markdown: string): Node[] {
    const tokens = (new Tokenizer(markdown)).tokenize()
    const ast = (new Parser(tokens)).parse()
    const nodes = generateNodes(ast)
    return nodes
}

// export function htmlToMarkdown(nodes: NodeListOf<ChildNode>): string {
//     const markdown: string[] = []
//     for(const child of nodes) {
//         if(child.nodeName === '#text') {
//             markdown.push(child.textContent ?? '')
//         } else if(child.nodeName === 'P') {
//             markdown.push(htmlToMarkdown(child.childNodes))
//             markdown.push('\n\n')
//         } else if(child.nodeName === 'H1' ||
//             child.nodeName === 'H2' ||
//             child.nodeName === 'H3' ||
//             child.nodeName === 'H4' ||
//             child.nodeName === 'H5' ||
//             child.nodeName === 'H6'
//         ) {
//             markdown.push('######'.slice(0, parseInt(child.nodeName[1])))
//             markdown.push(' ')
//             markdown.push(htmlToMarkdown(child.childNodes))
//             markdown.push('\n')
//         } else if(child.nodeName === 'EM') {
//             markdown.push('*')
//             markdown.push(htmlToMarkdown(child.childNodes))
//             markdown.push('*')
//         } else if(child.nodeName === 'STRONG') {
//             markdown.push('**')
//             markdown.push(htmlToMarkdown(child.childNodes))
//             markdown.push('**')
//         } else if(child.nodeName === 'BR') {
//             markdown.push('\n')
//         }
//     }
//     return markdown.join('')
// }

type TokenType =
    'text' |
    'space' |
    'hyphen' |
    'number' |
    'numberSigns' |
    'asterisks' |
    'newLines'

interface Token {
    type: TokenType
    value: string
}

type ElementType = 'text' |
    'p' |
    'strong' |
    'em' |
    'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' |
    'ul' | 'ol' |
    'li' |
    'br'


interface Element {
    name: ElementType
    children?: Element[]
}

interface TextElement extends Element {
    name: 'text'
    value: string
}

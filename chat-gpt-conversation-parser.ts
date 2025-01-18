import * as fs from 'fs'

function main(filepath: string, index?: number) {
    const conversations = JSON.parse(fs.readFileSync(filepath, 'utf-8'))

    if (index) {
        parseAndSaveConversation(conversations[index])
    } else {
        for (const conversation of conversations) {
            parseAndSaveConversation(conversation)
        }
    }



}

function parseAndSaveConversation(conversation: any) {
    if (!conversation) {
        throw new Error('Conversation missing')
    }
    const messages = (Object.values(conversation.mapping) as Array<any>)
        .filter(function(e) {
            return e.message && e.message.create_time && e.message.content && e.message.author.role
        })
        .sort(function (a, b) {
            if(a.message.create_time < b.message.create_time) {
                return -1
            } else {
                return 1
            }
        })

    console.log(messages.slice(0, 10))
}

main(process.argv[2], parseInt(process.argv[3]))

interface Message {
    role: string
    content: string
}
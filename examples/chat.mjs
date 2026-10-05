// The chat's state and functions (chat.html). The bot lives in the "chat" component, for as long as the page shows.
let id = Date.now() // past the ids the server gives
const message = (author, text, n = ++id) => ({ id: n, author, text, at: Date.now() })

export const state = () => ({
  title: 'Chat · core-query',
  text: '',
  typing: false,
  msgs: [message('bot', 'Hi! I answer with whatever you write, backwards.', 1)],
})

export const fns = {
  blank: (t) => !t.trim(),
  say: (msgs, text) => ((text = text.trim()) ? [...msgs, message('me', text)] : undefined),
  time: (t) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
  count: (msgs) => (msgs.length === 1 ? '1 message' : `${msgs.length} messages`),
}

export const components = {
  /** On the list: scrolls to the last message and answers yours; it stops when the page leaves. */
  chat: (box, _, app) => {
    let live = true
    let answered = 0
    const scroll = async () => {
      await app.tick() // the new <li> is in the DOM now
      box.scrollTop = box.scrollHeight
    }
    const off = app.on('msgs', (msgs) => {
      scroll()
      const last = msgs[msgs.length - 1]
      if (last?.author !== 'me' || last.id <= answered) return
      answered = last.id
      app.set('typing', true)
      scroll()
      setTimeout(() => {
        if (!live) return
        app.set('typing', false)
        app.push('msgs', message('bot', [...last.text].reverse().join('')))
      }, 900)
    })
    return () => ((live = false), off())
  },
}

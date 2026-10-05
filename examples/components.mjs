// The components page's state and functions (components.html).
let id = Date.now() // past the ids the server gives

export const state = () => ({
  title: 'Components · core-query',
  // '': the system's theme, which only the browser knows; a click picks one.
  theme: '',
  tabs: [
    { id: 'profile', title: 'Profile' },
    { id: 'notifications', title: 'Notifications' },
    { id: 'about', title: 'About' },
  ],
  tab: 'profile',
  profile: { name: 'Ana', notify: true },
  showBoth: true,
  newItem: '',
  shopping: [{ id: 1, text: 'Bread' }, { id: 2, text: 'Milk' }],
  modal: false,
  toasts: [],
  volume: 40,
  faq: [
    { question: 'Do I need a build?', answer: 'No: a <script> tag is enough. With a bundler, import core-query.' },
    { question: 'Does it work with SSR?', answer: 'Yes: renderToString on the server, and the browser hydrates without touching the DOM.' },
    { question: 'Where does the state live?', answer: 'In a single tree, addressed by paths such as todos.0.title.' },
  ],
})

export const fns = {
  toggle: (theme) => (theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark'),
  notify: (toasts, text, kind = 'ok') => [...toasts, { id: ++id, text, kind }],
  addItem: (shopping, text) => (text.trim() ? [...shopping, { id: ++id, text: text.trim() }] : undefined),
  // A click on the dialog itself, not on its form, is a click on the backdrop.
  backdrop: (open, e) => (e.target === e.currentTarget ? false : undefined),
}

export const components = {
  // <dialog> opens as a modal through a method, not an attribute: a component syncs it with the state.
  dialog: (el, path, app) => app.on(path, (open) => (open ? el.open || el.showModal() : el.close()), { now: true }),
  /** Each toast leaves on its own after 3 s; the ones still up when the page leaves stop counting. */
  toasts: (_, __, app) => {
    const timers = new Map()
    const off = app.on('toasts', (toasts) => {
      for (const t of toasts)
        if (!timers.has(t.id)) timers.set(t.id, setTimeout(() => app.set('toasts', app.get('toasts').filter((x) => x.id !== t.id)), 3000))
    })
    return () => (off(), timers.forEach(clearTimeout))
  },
}

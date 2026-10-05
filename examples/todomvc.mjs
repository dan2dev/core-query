// TodoMVC's functions (todomvc.html). The list lives in this browser: the "todos" component loads and saves it.
const KEY = 'todos-core-query'
let id = Date.now()
const filter = (hash) => hash.replace(/^#\/?/, '') || 'all'

export const state = () => ({ title: 'TodoMVC · core-query', draft: '', todos: [] })

export const fns = {
  filter,
  visible: (t, hash) => (filter(hash) === 'active' ? !t.done : filter(hash) === 'completed' ? t.done : true),
  allDone: (todos) => todos.length > 0 && todos.every((t) => t.done),
  someDone: (todos) => todos.some((t) => t.done),
  left: (todos) => {
    const n = todos.filter((t) => !t.done).length
    return n + (n === 1 ? ' item left' : ' items left')
  },
  // Actions: they get the value at the path and return its new value (undefined: leave it).
  create: (todos, title) => ((title = title.trim()) ? [...todos, { id: id++, title, done: false }] : undefined),
  toggleAll: (todos, done) => todos.map((t) => ({ ...t, done })),
  clearDone: (todos) => todos.filter((t) => !t.done),
  dropEmpty: (todos) => (todos.some((t) => !t.title) ? todos.filter((t) => t.title) : undefined),
  // Blur also fires after Enter/Esc removed the input: only an edit still open is saved.
  rename: (t, edit) => (edit.on ? { ...t, title: edit.text.trim() } : undefined),
}

export const components = {
  focus: (el) => {
    el.focus()
    el.select()
  },
  /** Loads the list of this browser, and saves it on every change; #keys are UI state, left out of what is saved. */
  todos: (_, __, app) => {
    app.set('todos', JSON.parse(localStorage.getItem(KEY) || '[]'))
    return app.on('todos', (todos) => localStorage.setItem(KEY, JSON.stringify(todos, (k, v) => (k[0] === '#' ? undefined : v))))
  },
}

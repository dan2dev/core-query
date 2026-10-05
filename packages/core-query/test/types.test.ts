// Type-level checks: `tsc` (pnpm typecheck) fails if inference or path checking regresses. The calls never run.
import { expect, it } from 'vitest'
import { createApp, route, type App, type At, type Component, type Flags, type ValidPath } from '../src/index'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const is = <T extends true>() => {}
type Todo = { id: number; title: string; done: boolean }

it('types the state from createApp(state), at any depth, without annotations', () => {
  const check = () => {
    const app = createApp({ filter: 'all', todos: [] as Todo[], draft: { title: '', labels: [] }, user: null, form: {} })
    is<Equal<typeof app, App<{ filter: string; todos: Todo[]; draft: { title: string; labels: any[] }; user: any; form: any }>>>()
    is<Equal<ReturnType<typeof app.get<'todos.0.done'>>, boolean>>()
    app.set('todos.0.title', 'x')
    app.push('todos', { id: 1, title: 'a', done: false })
    app.push('draft.labels', 'ui') // [] holds anything
    app.set('user', { name: 'Ana' }) // null is a value to come
    app.set('form.a.b', 1)
    app.on('todos', (todos) => is<Equal<typeof todos, Todo[]>>())
    const i = 2 as number
    app.set(`todos.${i}.done`, true) // a template literal path is checked too
    const deep = createApp({ a: { b: { c: { d: { e: { f: [{ g: 1 }] } } } } } })
    deep.set('a.b.c.d.e.f.0.g', 2) // no depth limit
    // @ts-expect-error a number is not a string
    app.set('filter', 1)
    // @ts-expect-error 'titel' is not a key of a todo
    app.get('todos.0.titel')
    // @ts-expect-error a todo needs every key
    app.push('todos', { title: 'x' })
    // @ts-expect-error push needs an array
    app.push('filter', 'x')
    // @ts-expect-error a string built at runtime is not checked: write a template literal
    app.get('todos.' + i)
    // @ts-expect-error
    deep.set('a.b.c.d.e.f.0.h', 2)
  }
  expect(check).toBeTypeOf('function')
})

it('keeps an explicit state type as written, partial initial state included', () => {
  const check = () => {
    type State = { n: number; todos: Todo[]; point: [number, number]; opt?: string }
    const app = createApp<State>({ n: 1 })
    const takes = (a: App<State>) => a
    takes(app)
    takes(createApp<State>({ n: 1, todos: [], point: [0, 0] }))
    // @ts-expect-error a tuple stays a tuple
    app.set('point', [1, 2, 3])
    const any = createApp<any>({ visits: 1 })
    any.get('anything.at.all')
    createApp().set('anything', 1)
  }
  expect(check).toBeTypeOf('function')
})

it('types the keys the runtime writes: request flags, local state, UI keys', () => {
  const check = () => {
    const app = createApp({ todos: [] as Todo[], '#menu': { open: false } })
    is<Equal<At<{ todos: Todo[] }, '#todos'>, Flags | undefined>>() // there once a request ran
    is<Equal<ReturnType<typeof app.get<'#todos.loading'>>, boolean | undefined>>()
    app.set('#menu.open', true) // declared: its own type
    app.set('todos.0.#editing', true) // any other #key: UI state of any type
    app.get('#hover.i')
    // @ts-expect-error flags have their types
    app.set('#todos.loading', 'yes')
    // @ts-expect-error a declared #key too
    app.set('#menu.open', 1)
  }
  expect(check).toBeTypeOf('function')
})

it('stops paths at JSON leaves and accepts optional arrays', () => {
  const check = () => {
    const app = createApp<{ due: Date; tags?: string[] }>({ due: new Date() })
    app.push('tags', 'a')
    is<Equal<ReturnType<typeof app.pop<'tags'>>, string | undefined>>()
    // @ts-expect-error a Date has no paths
    app.get('due.getTime')
    // @ts-expect-error
    app.push('tags', 1)
  }
  expect(check).toBeTypeOf('function')
})

it('infers route names and params from the patterns', () => {
  const check = () => {
    const app = createApp({ title: '' }).router({ home: '/', user: '/users/:id', docs: '/docs/*' })
    const r = app.get('route')
    if (r.name === 'user') is<Equal<typeof r.params, { id: string }>>()
    if (r.name === 'docs') r.params['*']
    app.get('route.is.home')
    app.get('route.query.tab')
    // @ts-expect-error not a route
    app.get('route.is.users')
    // @ts-expect-error not a param of /users/:id
    if (r.name === 'user') r.params.uid
    const s = route('/users/7', { user: '/users/:id' } as const)
    if (s.name === 'user') is<Equal<typeof s.params, { id: string }>>()
    const loose: Record<string, string> = { home: '/' } // not `as const`: names known, params any
    const l = route('/', loose)
    l.params.anything
  }
  expect(check).toBeTypeOf('function')
})

it('types components from the app, narrowed by an annotation', () => {
  const check = () => {
    const app = createApp({ modal: false, volume: 40 })
    app.component('focus', (el) => el.focus())
    app.component('dialog', (el: HTMLDialogElement, path: 'modal', a) => a.on(path, (open) => (open ? el.showModal() : el.close())))
    app.component('chart', (el: SVGSVGElement, path, a) => void a.get(path))
    app.component({ 'ui:focus': (el) => el.focus() })
    const shared: Component<{ volume: number }> = (el, path: 'volume', a) => a.on(path, (v) => (el.title = '' + v))
    createApp({ volume: 1 }).component('vol', shared)
    // @ts-expect-error not a path of the state
    app.component('x', (el, path: 'nope') => {})
    // @ts-expect-error the app is typed
    app.component('y', (el, path, a) => a.set('volume', 'loud'))
  }
  expect(check).toBeTypeOf('function')
})

it('checks the paths of bind, render, post and send; relative paths pass', () => {
  const check = () => {
    const app = createApp({ filter: 'all', todos: [] as Todo[] })
    const el = document.body
    app.bind(el, 'filter')
    app.bind(el, '.title')
    app.render(el, 'todos.0')
    app.render(el)
    app.send('todos', 'get', '/api/todos')
    app.post('todos', '/api/todos')
    app.click('button', (v, path, e) => e.shiftKey)
    // @ts-expect-error
    app.bind(el, 'filtr')
    // @ts-expect-error
    app.send('todoz', 'GET', '/api/todos')
  }
  expect(check).toBeTypeOf('function')
})

it('reusable logic: a function of (app, path) typed by ValidPath', () => {
  const check = () => {
    const undoable = <S, P extends string>(app: App<S>, path: ValidPath<S, P>) => {
      const past: At<S, P>[] = []
      app.on(path, (v) => void past.push(structuredClone(v)), { now: true })
      return () => past.length > 1 && (past.pop(), app.set(path, past.pop()!))
    }
    const app = createApp({ todos: [] as Todo[] })
    undoable(app, 'todos')
    // @ts-expect-error
    undoable(app, 'todoz')
  }
  expect(check).toBeTypeOf('function')
})

it('handles the shapes the review found: recursive JSON, index signatures, numeric keys, dynamic DOM paths', () => {
  const check = () => {
    type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
    type User = { name: string }
    const app = createApp({ title: '', settings: {} as { [k: string]: Json }, todos: [] as Todo[], users: {} as Record<string, User>, byId: {} as Record<number, User> })
    app.component('x', (el) => el.focus()) // a recursive type does not instantiate forever
    app.get('settings.a')
    is<Equal<ReturnType<typeof app.get<'users.u1.name'>>, string>>()
    is<Equal<ReturnType<typeof app.get<'byId.5.name'>>, string>>()
    app.send('todos.0', 'GET', '/api/todos/1')
    is<Equal<ReturnType<typeof app.get<'todos.#0.loading'>>, boolean | undefined>>() // where send puts an item's flags
    is<Equal<ReturnType<typeof app.get<'users.#u1.loading'>>, boolean | undefined>>()
    const input = document.createElement('input')
    app.bind(input, input.name) // a path known only at runtime
    app.render(document.body, document.body.dataset.path)
    app.click('.rm', (v, path) => app.delete(path))
    app.component('chart', async (el: SVGSVGElement) => void (await Promise.resolve(el.viewBox)))
    app.component({ chart: (el: SVGSVGElement) => void el.viewBox, focus: (el) => el.focus() })
    // @ts-expect-error #todos is there once a request ran
    app.get('#todos').loading
    // @ts-expect-error push needs an array, even with no values
    app.push('title')
    // @ts-expect-error a cleanup returned by an async component would be lost
    app.component('late', async () => () => {})
  }
  expect(check).toBeTypeOf('function')
})

it('registers a component typed for a part of the state on an app that has it', () => {
  const check = () => {
    const volume: Component<{ volume: number }> = (el, path: 'volume', a) => a.on(path, (v) => (el.title = '' + v))
    createApp({ volume: 1, modal: false }).component('vol', volume)
    // @ts-expect-error the app has no volume
    createApp({ modal: false }).component('vol', volume)
    // @ts-expect-error volume is not a number there
    createApp({ volume: 'loud' }).component('vol', volume)
  }
  expect(check).toBeTypeOf('function')
})

import {
  args,
  BAD,
  builtins,
  createStore,
  evaluate,
  getIn,
  isCmp,
  itemScope,
  join,
  json,
  parseFor,
  resolve,
  route,
  text,
  type Arg,
  type Cleanup,
  type Cursor,
  type Fn,
  type Loose,
  type Path,
  type Route,
  type Routes,
  type Scope,
  type Store,
  type ValidPath,
} from './core'

export { route } from './core'
export type { At, Cleanup, Flags, Fn, Path, Route, Routes, Store, ValidPath } from './core'

/**
 * Runs for each `data-component="name"` element, with its `data-value` path; may return a cleanup. Annotate `el`
 * (HTMLDialogElement, SVGSVGElement) or `path` ('modal') to narrow them, unchecked like querySelector<E>.
 */
export type Component<S = any, E extends Element = HTMLElement> = {
  // A method: its parameters are bivariant, so a narrower `path` annotation is accepted.
  c(el: E, path: Path<S>, app: App<S>): void | Cleanup | Promise<void>
}['c']
/** A path relative to the element's context: '', '.', '.x'. */
type Rel = '' | '.' | `.${string}`

export interface App<S = any> extends Store<S> {
  /** POSTs the value at `path` as JSON, without its `#keys`. */
  post<P extends string>(path: ValidPath<S, P>, url: string, init?: RequestInit): Promise<Response>
  /**
   * A request for `path`: GET stores the JSON response there, the other methods send its value as JSON (without its
   * `#keys`, unless `init.body` is given). The sibling `#key` holds `loading` and `error` ({ status, message }; status 0:
   * network). A new request for the same path aborts the one in flight. Rejects on a network error or a non-2xx response.
   */
  send<P extends string>(
    path: ValidPath<S, P>,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'get' | 'post' | 'put' | 'patch' | 'delete' | (string & {}),
    url: string,
    init?: RequestInit,
  ): Promise<Response>
  /** Two-way binds a form control (or text-binds any other element) to `path`; a path known only at runtime is not checked. */
  bind<P extends string>(el: Element, path: string extends P ? P : ValidPath<S, P> | Rel): Cleanup
  /** Click handler on an element, or delegated to every element matching a selector. */
  click(target: Element | string, fn: (value: any, path: Path<S>, event: MouseEvent) => void): Cleanup
  component<E extends Element = HTMLElement>(name: string, fn: Component<S, E>): void
  /** A component written for a part of the state (`Component<{ volume: number }>`), on an app that has that part. */
  component<T>(name: string, fn: Component<T, any> & ([S] extends [T] ? unknown : never)): void
  /** Registers every component of a record: `{ 'ui:focus': (el) => el.focus() }`. */
  component<C>(components: { [K in keyof C]: Component<S, C[K] extends Element ? C[K] : HTMLElement> }): void
  /** Registers a template function: `path | name(args)` shows `fn(value, ...args)`, `path.name(args)` stores it. */
  fn(name: string, fn: Fn): void
  /** Registers every function of a record: the `fns` that `renderToString(html, state, fns)` takes. */
  fn(fns: Record<string, Fn>): void
  /**
   * Keeps the URL matched against `routes` at the `route` path: `route.is.<name>`, `route.params`, `route.query`.
   * With `pages` (the URL of each route's page template), every route is its own page: navigating renders its
   * template, fetched once and preloaded while idle, in the `data-page` element, with the state the server answers
   * for the URL as JSON. Call before `mount`. Returns the app, typed with `route`.
   */
  router<const R extends Routes>(
    routes: R,
    opts?: { pages?: (name: keyof R & string) => string; base?: string },
  ): App<0 extends 1 & S ? any : Omit<S, 'route'> & { route: Route<R> }>
  /** Navigates without reloading: pushes (or replaces) the history entry, loads the page (with `pages`) and updates `route`. */
  go(url: string, replace?: boolean): Promise<void>
  /** Binds `el` and its subtree (e.g. markup added after mount) with `path` as their context. Returns unbind. */
  render<P extends string>(el: Element, path?: string extends P ? P : ValidPath<S, P> | Rel): Cleanup
  /** Binds the `data-*` template under `root`, hydrating server-rendered markup. */
  mount(root?: Element): Cleanup
}

type Action = [path: string, method: string, args: Arg[]]
/**
 * A block item: the first element of each unit (after walk replaced or wrapped it), its cleanups, key and index; keyed,
 * also the value it shows and its cursor.
 */
type Item = [units: Element[], c: Cleanup[], key: unknown, i: number, v?: unknown, k?: Cursor]
/**
 * What walk reads of a block's prototype element, for its clones: its data-* attributes, and its children's shapes
 * when binding cannot change their places (none for a data-if chain, a component, data-use or data-page). 0: nothing
 * to bind in it.
 */
type Shape = 0 | [a: Record<string, string>, k?: Shape[]]
/** A keyed data-for: each item's key and value, a cursor for a new item, and whether an index alias rebinds moved items. */
type Keyed = { key(i: number): unknown; val(i: number): unknown; cursor(i: number): Cursor; rebind: boolean }

const METHODS = ['set', 'push', 'pop', 'shift', 'delete', 'unshift', 'splice']
/** Request actions: "list.get('/api/todos')". `delete` already removes a key, so DELETE is `del`. */
const REQ: Record<string, string> = { __proto__: null as never, get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE' }
const BODYLESS = /^(GET|DELETE)$/
const CALL = /([^\s()'",]*)\(((?:'[^']*'|"[^"]*"|[^)'"])*)\)/g
const actions = new Map<string, Action[]>()

/** "list.push(description) description.set('')" → [["list", "push", [{p: "description"}]], ["description", "set", [""]]] */
const parse = (src: string): Action[] => {
  let r = actions.get(src)
  if (!r) {
    // Like expressions: what is not a call ("x.set(1", "n.add 1") would otherwise do nothing, silently.
    if (src.replace(CALL, '').trim()) throw Error('CoreQuery: bad actions "' + src + '"')
    actions.set(
      src,
      (r = [...src.matchAll(CALL)].map(([, callee, a]) => {
        const i = callee.lastIndexOf('.')
        return [callee.slice(0, Math.max(i, 0)), callee.slice(i + 1), args(a)]
      })),
    )
  }
  return r
}

const FORM = /^(INPUT|TEXTAREA|SELECT)$/
const MOD = /^(prevent|stop|once|self|outside|window|document|debounce|throttle)$/
const DELAY = /^(debounce|throttle)$/
/** Toggles the data-transition class of `e` ("fade" → "fade-enter"; no name: "cq-enter"). */
const tc = (e: Element, x: string, on: boolean) => e.classList.toggle((e.getAttribute('data-transition') || 'cq') + x, on)
const STATE = 'script[data-cq-state]'
/** Runs every cleanup, even after one throws, then rethrows the first error. */
const dispose = (c: Cleanup[]) => {
  let err: [unknown] | undefined
  for (const f of c)
    try {
      f()
    } catch (e) {
      err ||= [e]
    }
  if (err) throw err[0]
}
const cased: Record<string, string> = Object.create(null)
/** HTML lowercases data-attr-viewBox, but SVG names are case-sensitive: let the HTML parser re-case them. */
const svgName = (n: string) => {
  if (!cased[n]) {
    const t = document.createElement('template')
    t.innerHTML = `<svg ${n}>`
    cased[n] = (t.content.firstChild as Element).attributes[0].name
  }
  return cased[n]
}
/** Template actions store copies, so "list.push(draft)" doesn't alias the draft (the legacy copied too). */
const copy = (v: unknown) => (v !== null && typeof v === 'object' ? structuredClone(v) : v)
/** Marks the longest increasing run of `a` (-1: none): the items already in order, which need not move. */
const lis = (a: number[]) => {
  const r: number[] = [] // r[k]: where the smallest end of a run of length k + 1 is
  const p: number[] = [] // p[i]: the element before i in its run
  a.forEach((v, i) => {
    let lo = 0
    for (let hi = r.length, m; lo < hi; ) a[r[(m = (lo + hi) >> 1)]] < v ? (lo = m + 1) : (hi = m)
    if (v >= 0) (p[i] = r[lo - 1]), (r[lo] = i)
  })
  const on: boolean[] = []
  for (let i = r[r.length - 1]; i !== undefined; i = p[i]) on[i] = true
  return on
}
/** data-else(-if) elements belong to the data-if before them. */
const isElse = (e: Element) => e.hasAttribute('data-else') || e.hasAttribute('data-else-if')
const dataAttrs = (el: Element): Record<string, string> =>
  Object.fromEntries(el.getAttributeNames().flatMap((n) => (n.startsWith('data-') ? [[n, el.getAttribute(n)!]] : [])))
const shape = (el: Element): Shape => {
  const a = dataAttrs(el)
  const ch = [...el.children]
  const t = el.localName === 'template'
  // Binding these changes what is inside, or what follows: their children are read when they are bound.
  const k = t || ['data-for', 'data-if', 'data-use', 'data-page'].some((n) => n in a) || ch.some((e) => e.matches('[data-if],[data-else],[data-else-if],[data-component]')) ? undefined : ch.map(shape)
  return Object.keys(a).length || (k ? k.some(Boolean) : !t) ? [a, k] : 0
}
/** `el` as a <template> holding it, with the block attributes `names` moved onto the template. */
const wrap = (el: Element, names: string[]): Element => {
  if (el.localName === 'template') return el
  const tpl = el.ownerDocument.createElement('template')
  for (const n of names) {
    const v = el.getAttribute(n)
    if (v != null) tpl.setAttribute(n, v), el.removeAttribute(n)
  }
  el.replaceWith(tpl)
  tpl.content.append(el)
  return tpl
}
/** data-use: the element's content becomes a copy of <template id>, the element's children filling its <slot>s. */
const stamp = (el: Element, id: string) => {
  const t = el.ownerDocument.getElementById(id) as HTMLTemplateElement | null
  if (!t?.content) throw Error('CoreQuery: no <template id="' + id + '">')
  const f = t.content.cloneNode(true) as DocumentFragment
  const kids = [...el.childNodes]
  // <slot name="x"> takes the [slot="x"] children, <slot> the others; an unfilled slot keeps its own content.
  f.querySelectorAll('slot').forEach((slot) => {
    const name = slot.getAttribute('name')
    const fill = kids.filter((n) => ((n as Element).getAttribute?.('slot') ?? null) === name)
    slot.replaceWith(...(fill.some((n) => n.nodeType === 1 || n.textContent!.trim()) ? fill : slot.childNodes))
  })
  el.replaceChildren(f)
  el.removeAttribute('data-use')
}

/**
 * An app over `state`, typed from it: `[]`, `null` and `{}` stand for values to come (any). With keys that come later
 * (the server's, the router's), name the type: `createApp<State>(partial)`, or `createApp<any>()` for none.
 */
// The unused `_` has no default, so an explicit `createApp<State>(…)` skips this overload and keeps State as written.
export function createApp<S extends object, _>(state: S | undefined): App<Loose<S>>
export function createApp<S = any>(state?: NoInfer<Partial<S>>): App<S>
export function createApp(state?: object): App {
  const { keyed, keys, sub: subscribe, ...store } = createStore(state)
  const components: Record<string, Component> = Object.create(null)
  const fns: Record<string, Fn> = Object.assign(Object.create(null), builtins)
  const scopes = new WeakMap<Element, Scope>()
  const hydrated = new WeakSet<Element>()
  const refresh = new WeakMap<Element, () => void>()
  /** Each block's last element, by its template: an item that is itself a block ends where that block ends. */
  const ends = new WeakMap<Element, () => Element>()
  const endOf = (start: Element) => ends.get(start)?.() || start
  /** Elements animating out (data-transition): still in the page, already gone for the blocks. */
  const leaving = new WeakSet<Element>()
  const nx = (e: Element | null) => {
    do e = e!.nextElementSibling
    while (e && leaving.has(e))
    return e
  }
  /** Removes `e`: at once, or with data-transition after the animations its -leave class started. */
  const leave = (e: Element) => {
    const a = e.hasAttribute('data-transition') && (tc(e, '-leave', true), e.getAnimations?.())
    if (a && a.length) leaving.add(e), Promise.allSettled(a.map((x) => x.finished)).then(() => e.remove())
    else e.remove()
  }
  let mounted: Element | null = null
  /** The handlers resuming after their request, in a row. */
  let resume: Promise<unknown> = Promise.resolve()
  /** While a keyed item is rebound at its new index. */
  let moving = false
  let routes: Routes | undefined
  /** With `pages`: the URL of each route's page template. */
  let pages: ((name: string) => string) | undefined
  let base: string | undefined
  /** The path and query of the page asked for last, and the route of the page in the outlet. */
  let page = ''
  let shown: string | undefined
  /** data-page, the outlet: its element, its scope and the cleanups of its content; set while it is bound. */
  let outlet: [el: Element, s: Scope, c: Cleanup[]] | undefined
  /** Each route's page template, fetched once; one that did not come resolves to undefined and is asked for again. */
  // ponytail: kept until the document is reloaded, so a deployed template shows after one; a version in its URL if sooner.
  const tpls: Record<string, Promise<string | void>> = Object.create(null)
  const tpl = (name: string) =>
    (tpls[name] ||= fetch(pages!(name))
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .catch(() => void delete tpls[name]))
  const here = () => location.pathname + location.search
  const now = () => route(location.href, routes!, base)
  const sync = () => routes && store.set('route', now())
  /** The route a link leads to, when it is one of this app's. */
  const linked = (a: HTMLAnchorElement) => a.origin === location.origin && route(a.href, routes!, base).name
  /** Once the browser is idle: the templates of the routes the page links to, so a click finds them loaded. */
  // ponytail: links added later (a list a request filled) wait for the next navigation; a MutationObserver if it matters.
  const preload = () =>
    pages &&
    (window.requestIdleCallback || setTimeout)(
      () =>
        outlet &&
        mounted?.querySelectorAll('a[href]').forEach((a) => {
          const name = linked(a as HTMLAnchorElement)
          if (name) tpl(name)
        }),
    )
  /**
   * After the URL changed. With `pages`, another path or query is another page (a hash is not): the server answers
   * its state as JSON and the route's template goes in the outlet, unless that route is the one showing: then the
   * page stays and only its state changes. What cannot be shown this way is the browser's to load.
   */
  const arrive = async (top?: boolean) => {
    const at = here()
    if (pages && page !== at) {
      page = at
      const { name } = now()
      const stay = name === shown
      const [data, html] =
        name && outlet
          ? await Promise.all([
              // no-store: the browser must not find this JSON when the same URL is loaded as a document (back, a restored tab).
              fetch(location.href, { headers: { accept: 'application/json' }, cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : 0))
                .catch(() => 0),
              stay ? '' : tpl(name),
            ])
          : []
      if (at !== here()) return // a later navigation won
      // No route (the server's 404), no outlet, or one of the two did not come (offline, a redirect, an error page).
      if (!data || html == null) return location.reload()
      if (!outlet) return // unmounted meanwhile
      const [el, s, c] = outlet
      // Its state over the current one, by literal key: what the server does not send (a cart) stays. A page that
      // leaves takes the root "#keys" along (local state, request flags): a full load starts without them.
      const next = { ...store.get(), ...data }
      store.set('', stay ? next : Object.fromEntries(Object.entries(next).filter(([k]) => k[0] !== '#')))
      sync()
      if (!stay) {
        shown = name
        try {
          dispose(c.splice(0))
        } finally {
          // Even after a cleanup threw: the page that left must not stay in the outlet.
          el.innerHTML = html
          kids(el, s, c)
        }
      }
      preload()
    } else sync()
    if (top) scrollTo(0, 0)
  }
  /** Applies the server state of `root`: the scripts inside it, else the one right after it (a rendered fragment) or
   *  directly in <body> (a rendered page), never one inside another element, e.g. another app. */
  const hydrate = (root: Element) => {
    const own = root.querySelectorAll(STATE)
    const after = root.nextElementSibling
    ;[...(own.length ? own : after?.matches(STATE) ? [after] : root.ownerDocument.querySelectorAll('body>' + STATE))].forEach((x) => {
      if (hydrated.has(x)) return // a remount keeps the client's changes
      hydrated.add(x)
      // Merged by literal key (keys may come from data: "a.b", "", "constructor"); spread makes own keys only.
      store.set('', { ...store.get(), ...JSON.parse(x.textContent!) })
    })
  }

  /** The request in flight for each path: a newer one aborts it. */
  const reqs = new Map<string, AbortController>()
  const send = async (path: string, method: string, url: string, init?: RequestInit) => {
    path = keys(path).join('.') // a keyed item's flags sit at its index too: "todos.#2"
    const i = path.lastIndexOf('.') + 1
    const f = path.slice(0, i) + '#' + path.slice(i) // "a.b.list" → "a.b.#list": UI state, never sent
    const ac = new AbortController()
    const headers = new Headers(init?.headers)
    const was = store.get(path)
    method = method.toUpperCase()
    const body = init?.body || BODYLESS.test(method) ? undefined : json(store.get(path))
    let r: Response | undefined
    if (body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    reqs.get(path)?.abort()
    reqs.set(path, ac)
    store.set(f + '.loading', true)
    store.set(f + '.error', null)
    try {
      r = await fetch(url, { body, ...init, method, headers, signal: ac.signal })
      if (!r.ok) throw Error(r.statusText)
      const v = method === 'GET' ? await r.json() : 0
      ac.signal.throwIfAborted() // a fetch that ignored the signal: its late response must not win
      // Paths are by index: when the value was replaced meanwhile (another item moved there), the response is not for it.
      if (method === 'GET' && Object.is(store.get(path), was)) store.set(path, v)
      return r
    } catch (e) {
      // Aborted by a newer request: the flags are that one's now.
      if (reqs.get(path) === ac) store.set(f + '.error', { status: r?.status || 0, message: (e as Error).message })
      throw e
    } finally {
      if (reqs.get(path) === ac) reqs.delete(path), store.set(f + '.loading', false)
    }
  }

  /** Context of `el`, or undefined when it is outside every root this app mounted. */
  const scopeOf = (el: Element | null): Scope | undefined => {
    for (; el; el = el.parentElement) {
      const s = scopes.get(el)
      if (s) return s
    }
  }
  const read = (expr: string, s: Scope) => {
    const p = resolve(expr, s)
    return typeof p === 'number' ? p : store.get(p)
  }
  /** Renders `fn(value)` now and after every change of the resolved path. */
  const sub = (p: string | number, c: Cleanup[], fn: (v: any) => void, d?: number) => {
    if (typeof p === 'number') return fn(p)
    const f = () => fn(store.get(p))
    f()
    c.push(subscribe(p, f, d))
  }
  /** Renders `fn(value)` of a read expression now and after every change of the paths it reads. */
  const watch = (src: string, s: Scope, c: Cleanup[], fn: (v: any) => void) => {
    const [v, deps] = evaluate(src, s, store.get, fns)
    const f = () => fn(evaluate(src, s, store.get, fns)[0])
    fn(v)
    if (deps[1] && !deps[2] && isCmp(src) && fns.eq === builtins.eq && fns.ne === builtins.ne) pick(deps[0], deps[1], c, f, s.d)
    else for (const p of deps) c.push(subscribe(p, f, s.d))
  }
  type Picks = [Map<unknown, Set<() => void>>, Cleanup]
  /** The renders of "a | eq(b)" by `b`, then by the value of their `a`; and the subscription to `b`. */
  const picks: Record<string, Picks> = Object.create(null)
  const select = (b: string, d?: number): Picks => {
    const by = new Map<unknown, Set<() => void>>()
    const run = (k: unknown) => by.get(k)?.forEach((g) => g())
    let v = store.get(b)
    return [
      by,
      subscribe(b, () => {
        const was = v
        v = store.get(b)
        // An app.fn('eq') of its own may not compare with ===: then all render.
        if (fns.eq !== builtins.eq || fns.ne !== builtins.ne) by.forEach((_, k) => run(k))
        else run(was), Object.is(v, was) || run(v)
      }, d),
    ]
  }
  /** Renders `f` after `a` changes, and after `b` changes from or to the value of `a`: one row of a list is selected, two render. */
  const pick = (a: string, b: string, c: Cleanup[], f: () => void, d?: number) => {
    const [by, off] = (picks[b] ||= select(b, d))
    let k = store.get(a)
    const file = (on?: 1) => (on ? (by.get(k) || by.set(k, new Set()).get(k)!).add(g) : by.get(k)!.delete(g) && (by.get(k)!.size || by.delete(k)))
    const g = () => {
      if (!Object.is(store.get(a), k)) file(), (k = store.get(a)), file(1)
      f()
    }
    file(1)
    c.push(subscribe(a, g, d), () => (file(), by.size || (off(), delete picks[b])))
  }
  const evt = (el: Element, type: string, c: Cleanup[], h: (e: Event) => void, capture?: boolean) => {
    el.addEventListener(type, h, capture)
    c.push(() => el.removeEventListener(type, h, capture))
  }
  const textOf = (el: Element) => (v: unknown) => {
    const t = text(v)
    // Child elements go too, even when their text already matches (as the server renders it).
    if (el.firstElementChild || el.textContent !== t) el.textContent = t
  }

  const model = (el: any, expr: string, s: Scope, c: Cleanup[]) => {
    const p = resolve(expr, s)
    if (!FORM.test(el.tagName)) return sub(p, c, textOf(el), s.d)
    const t = el.type
    const select = el.tagName === 'SELECT'
    const many = select && el.multiple
    const box = t === 'checkbox'
    const radio = t === 'radio'
    const num = t === 'number' || t === 'range'
    /** A <select multiple>, or a checkbox bound to an array, holds the values in that array. */
    const has = (v: unknown, x: string) => Array.isArray(v) && v.some((y) => text(y) === x)
    const apply = (v: unknown) => {
      if (many) for (const o of el.options) o.selected = has(v, o.value)
      else if (box) el.checked = Array.isArray(v) ? has(v, el.value) : !!v
      else if (radio) el.checked = text(v) === el.value
      // A number input keeps "1.0" while it is typed: only rewrite it when the number differs.
      // A select showing no option reads "" too: still write "" so its value="" option gets selected.
      else if ((el.value !== (v = text(v)) || (select && el.selectedIndex < 0)) && !(num && v && el.value && +el.value === +v)) el.value = v
    }
    sub(p, c, apply, s.d)
    if (typeof p === 'number') return // a loop index: shown, nothing to write back
    // Options of a select, or a radio's own value, may change under the same bound value: re-apply then.
    if (select || radio) {
      const r = () => apply(store.get(p))
      refresh.set(el, r)
      c.push(() => refresh.get(el) === r && refresh.delete(el))
    }
    // click/input fire before change, so data-click/data-on-input actions see the new value;
    // change still covers scripted events (writing the same value again changes nothing).
    for (const type of [box || radio ? 'click' : 'input', 'change'])
      evt(el, type, c, () => {
        const v = store.get(p)
        store.set(
          p,
          many
            ? [...el.selectedOptions].map((o) => o.value)
            : !box
              ? num && el.value !== ''
                ? +el.value
                : el.value
              : !Array.isArray(v)
                ? el.checked
                : !el.checked
                  ? v.filter((y) => text(y) !== el.value)
                  : has(v, el.value)
                    ? v
                    : [...v, el.value],
        )
      })
  }

  const listen = (el: Element, name: string, src: string, scope: Scope, c: Cleanup[]) => {
    // "keydown.enter.prevent": the event type, then modifiers; any that is not in MOD is a key to match.
    const [type, ...mods] = name.split('.')
    const has = (m: string) => mods.includes(m)
    /** ".debounce.300" → 300; 250 when no number follows, 0 without the modifier. */
    const ms = (m: string) => (has(m) ? +mods[mods.indexOf(m) + 1] || 250 : 0)
    const deb = ms('debounce')
    const thr = ms('throttle')
    // .outside listens in the capture phase: before a .stop elsewhere, and before a handler removes the target.
    const out = has('outside')
    const at: any = has('window') ? window : has('document') || out ? document : el
    let timer: any
    const acts = parse(src)
    for (const [, m] of acts) if (!METHODS.includes(m) && !REQ[m] && !fns[m]) throw Error('CoreQuery: unknown action "' + m + '" in "' + src + '"')
    const run = (e: Event, i = 0, s = scope): void => {
      for (; i < acts.length; i++) {
        const [path, m, a] = acts[i]
        const p = resolve(path, s) as string
        const vs = a.map((x) => {
          if (x === null || typeof x !== 'object') return x
          // $event is the event ($event.key, $event.target.value); state values are copied, never aliased.
          if (/^\$event(\.|$)/.test(x.p)) return getIn(e, x.p.slice(7))
          const v = read(x.p, s)
          if (v === undefined) console.warn('CoreQuery: "' + x.p + '" is undefined in "' + src + '"')
          return copy(v)
        })
        // A request: the rest runs after it, or not at all when it fails (its #flags tell). The URL is the arguments
        // joined: literals as written, values encoded.
        if (REQ[m]) {
          let url = ''
          a.forEach((x, j) => {
            const v = x !== null && typeof x === 'object' ? encodeURIComponent(text(vs[j])) : '' + x
            // No encoding keeps a "." or ".." segment: the browser resolves %2E%2E too, to the parent URL.
            if (v !== x && /^\.\.?$/.test(v) && !/[?#]/.test(url)) throw Error('CoreQuery: "' + v + '" cannot be a URL path segment in "' + src + '"')
            url += v
          })
          // Paths are by index and the list may have changed meanwhile: the rest runs in the element's scope by then
          // (a keyed rebind refreshed it), or not at all when it left the page. One handler at a time, each after
          // the DOM caught up: two answers landing together would otherwise both see the scopes of before.
          return void send(p, REQ[m], url).then(
            () => (resume = resume.catch(() => {}).then(store.tick).then(() => el.isConnected && run(e, i + 1, scopeOf(el)))),
            () => {},
          )
        }
        if (METHODS.includes(m)) (store as any)[m](p, ...vs)
        else {
          const v = fns[m](store.get(p), ...vs)
          if (v !== undefined) store.set(p, v)
        }
      }
    }
    // data-on-mount is no DOM event: it runs once the subtree is bound, unless cleaned up before that.
    if (type === 'mount') {
      if (moving) return // a keyed item at another index: the same element, already mounted
      let live = 1
      c.push(() => (live = 0))
      return queueMicrotask(() => live && run(0 as any))
    }
    const h = (e: Event) => {
      const key = (e as KeyboardEvent).key
      const k = key === ' ' ? 'space' : key?.toLowerCase()
      // The number after debounce/throttle is its delay, not a key.
      if (mods.some((m, i) => !MOD.test(m) && !(+m >= 0 && DELAY.test(mods[i - 1])) && m !== k)) return
      if (has('self') ? e.target !== el : out && el.contains(e.target as Node)) return
      if (type === 'submit' || has('prevent')) e.preventDefault()
      if (has('stop')) e.stopPropagation()
      if (has('once')) at.removeEventListener(type, h, out)
      // Only the actions wait: debounce runs the last event after the quiet period, throttle the first and then rests.
      if (deb) clearTimeout(timer), (timer = setTimeout(run, deb, e))
      else if (!thr) run(e)
      else if (!timer) run(e), (timer = setTimeout(() => (timer = 0), thr))
    }
    evt(at, type, c, h, out)
    // ponytail: a pending debounced action is dropped when its element is rebound or removed first (a keyed list
    // with an index alias reordering within the delay); run it on cleanup, or key the timer by element, if that ever matters.
    if (deb || thr) c.push(() => clearTimeout(timer))
  }

  /**
   * A <template> whose elements are stamped right after it once per item (data-for, data-if). Returns sync(n), which
   * renders n items: by index (the bindings of item i follow the new value), or `keyed`: an item keeps its elements
   * and its "@" path wherever it moves, and only moves when it is out of order.
   */
  const block = (tpl: Element, c: Cleanup[], scopeAt: (it: Item) => Scope, keyed?: Keyed) => {
    // Inside <svg> a parsed <template> is a foreign element: no .content, its children are the prototype.
    const protos = [...((tpl as HTMLTemplateElement).content || tpl).children]
    const units = protos.filter((e) => !isElse(e)).length
    let items: Item[] = []
    let live = false // after the first sync: items added from then on enter with their transition
    const end = ([u]: Item) => (u.length ? endOf(u[u.length - 1]) : null)
    const last = () => {
      for (let i = items.length; i--; ) {
        const e = end(items[i])
        if (e) return e
      }
      return tpl
    }
    ends.set(tpl, last)
    /** A new item at index i, tracked before it binds: one that fails to bind still leaves with the list. */
    const item = (i: number) => {
      const it: Item = keyed ? [[], [], keyed.key(i), i, keyed.val(i), keyed.cursor(i)] : [[], [], undefined, i]
      items.push(it)
      return it
    }
    let shapes: Shape[] | undefined
    /** Binds `n` units from `node`, the element after `prev`; returns the element after them. `sh`: they are fresh clones. */
    const bind = (it: Item, node: Element | null | undefined, prev: Element, n: number, sh?: Shape[]) => {
      const s = scopeAt(it)
      for (let next: Element | null | undefined, j = 0; n-- > 0 && node; node = next) {
        scopes.set(node, s)
        next = undefined
        try {
          next = walk(node, s, it[1], sh?.[j++])
        } finally {
          // The unit's first element: the node or what replaced it (a block's template, a component's wrapper);
          // tracked even when binding threw, so it leaves with the item; none when a component removed it.
          const top = nx(prev)
          if (top && top !== next) it[0].push(top), (prev = endOf(top))
        }
      }
      return node
    }
    const add = (i: number, prev: Element) => {
      const nodes = protos.map((e) => e.cloneNode(true) as Element)
      prev.after(...nodes)
      const it = item(i)
      bind(it, nodes[0], prev, units, (shapes ||= protos.filter((e) => !isElse(e)).map(shape)))
      // After binding: an element that is itself a block is in its template until then. The reflow renders the
      // -enter state (SVG has no offsetWidth), so a CSS transition runs from it once the class is gone.
      if (live)
        for (let e: Element | null = it[0][0], z = end(it); e; e = e === z ? null : nx(e))
          if (e.localName !== 'template' && e.hasAttribute('data-transition')) tc(e, '-enter', true), e.getBoundingClientRect(), tc(e, '-enter', false)
      return it
    }
    const drop = (it: Item) => {
      for (let e: Element | null = it[0][0], z = end(it); e; ) {
        const n: Element | null = e === z ? null : nx(e)
        leave(e)
        e = n
      }
      it[5]?.drop()
      dispose(it[1]) // after removal: a throwing cleanup must not leave the item in the page
    }
    c.push(() => {
      // Like server output, so mounting again adopts these elements instead of duplicating them.
      tpl.setAttribute('data-n', '' + items.length)
      dispose(items.map((it) => () => (it[5]?.drop(), dispose(it[1]))))
    })
    // Hydration: the server put `data-n` rendered items right after the template.
    for (let n = +(tpl.getAttribute('data-n') || 0), next: Element | null | undefined = nx(tpl); n-- > 0 && next; )
      next = bind(item(items.length), next, last(), units)
    return (n: number) => {
      if (!keyed) {
        while (items.length > n) drop(items.pop()!)
        while (items.length < n) add(items.length, last())
      } else {
        const { key, val } = keyed
        let i = 0
        // Nothing came, left or moved: what changed inside the items, their own bindings show.
        if (n === items.length) while (i < n && items[i][4] === val(i) && items[i][2] === key(i)) i++
        if (i < n || n !== items.length) {
          const old = new Map<unknown, Item>()
          for (const it of items) old.has(it[2]) ? drop(it) : old.set(it[2], it)
          const keep = Array.from({ length: n }, (_, i) => {
            const k = key(i)
            const it = old.get(k)
            old.delete(k)
            return it
          })
          old.forEach(drop)
          const stay = lis(keep.map((it) => (it ? it[3] : -1)))
          items = []
          let prev = tpl
          keep.forEach((it, i) => {
            if (!it) it = add(i, prev)
            else {
              items.push(it)
              const [u] = it
              if (!stay[i] && u.length && nx(prev) !== u[0]) {
                const els = [u[0]]
                for (const z = end(it); els[els.length - 1] !== z; ) els.push(nx(els[els.length - 1])!)
                prev.after(...els)
              }
              const v = val(i)
              const moved = it[3] !== i
              if (moved) it[5]!.at((it[3] = i))
              if (moved && keyed.rebind) {
                // An index alias shows the new index: rebind its elements where they are, the way hydration adopts them.
                dispose(it[1])
                it[0] = []
                it[1] = []
                moving = true
                try {
                  bind(it, u[0], u[0]?.previousElementSibling || prev, u.length)
                } finally {
                  moving = false
                }
              }
              // The same key with another value (a reloaded list): its bindings read it again.
              else if (it[4] !== v) it[5]!.touch()
              it[4] = v
            }
            prev = end(it) || prev
          })
        }
      }
      // A <select> picks some option when its options change: re-apply its value once they are all updated.
      live = true
      const sel = tpl.closest('select')
      if (sel) queueMicrotask(() => refresh.get(sel)?.())
    }
  }

  /** data-for: the template's elements once per array entry, matched by data-key or by index. */
  const list = (el: Element, expr: string, s: Scope, c: Cleanup[]) => {
    const [item, index, src] = parseFor(expr)
    const tpl = wrap(el, ['data-for', 'data-key'])
    const p = resolve(src, s) as string
    const at = (i: number) => itemScope(s, p, i, item, index)
    const key = tpl.getAttribute('data-key')
    let a: any[] = []
    const arr = (v: unknown) => (a = Array.isArray(v) ? v : []).length
    arr(store.get(p)) // hydration reads the keys before the first sync
    // The key's path inside the item ("t.id" → "id") is read from the item; any other key is resolved per item.
    const kp = key && resolve(key, at(0)) + '.'
    const i0 = join(p, '0.')
    const rel = kp && kp.startsWith(i0) && kp.slice(i0.length).split('.').filter(Boolean)
    const sync = block(
      tpl,
      c,
      (it) => itemScope(s, p, it[3], item, index, it[5]?.s),
      key
        ? {
            key: rel ? (i) => rel.reduce((o, k) => o?.[k], a[i]) : (i) => read(key, at(i)),
            val: (i) => a[i],
            cursor: keyed(p),
            rebind: !!index,
          }
        : undefined,
    )
    sub(p, c, (v) => sync(arr(v)), s.d)
    return nx(endOf(tpl))
  }

  /** data-if, then the data-else-if/data-else elements right after it: blocks of 0 or 1 item, the first true one shown. */
  const cond = (el: Element, s: Scope, c: Cleanup[]) => {
    const ms: [sync: (n: number) => void, expr: string | null][] = []
    const inner = { ...s, d: (s.d || 0) + 1 } // its content, after the condition
    const run = () => {
      // Conditions are read now, not cached: a listener earlier in this flush may have changed one.
      let done = false
      for (const [sync, expr] of ms) {
        const on: boolean = !done && (expr == null || !!evaluate(expr, s, store.get, fns)[0])
        done ||= on
        sync(+on)
      }
    }
    let tpl = el
    let first: Element | undefined
    for (let e: Element | null = el, a = 'data-if'; e && a; ) {
      tpl = wrap(e, [a])
      first ||= tpl
      const expr = a === 'data-else' ? null : tpl.getAttribute(a)!
      ms.push([block(tpl, c, () => inner), expr])
      if (expr != null) for (const p of evaluate(expr, s, store.get, fns)[1]) c.push(subscribe(p, run, s.d))
      e = a === 'data-else' ? null : nx(endOf(tpl))
      a = e?.hasAttribute('data-else-if') ? 'data-else-if' : e?.hasAttribute('data-else') ? 'data-else' : ''
    }
    // The chain ends where its last block ends: an item made of it moves and leaves whole.
    if (first !== tpl) ends.set(first!, ends.get(tpl)!)
    run()
    return nx(endOf(tpl))
  }

  /** Binds the children of `el` (`ks`: their shapes); the router calls it again for each page it puts in the outlet. */
  const kids = (el: Element, s: Scope, c: Cleanup[], ks?: Shape[]) => {
    let i = 0
    for (let ch = el.firstElementChild; ch; ch = walk(ch, s, c, ks && ks[i++]));
  }

  /** Binds `el` and its subtree; returns the next sibling to bind (blocks insert their items after themselves). */
  const walk = (el: Element, s: Scope, c: Cleanup[], sh?: Shape): Element | null => {
    if (sh === 0) return nx(el) // a clone's part with nothing to bind
    const [da, ks] = sh || [dataAttrs(el)]
    const forExpr = da['data-for']
    if (forExpr != null) return list(el, forExpr, s, c)
    if ('data-if' in da) return cond(el, s, c)
    if ('data-else' in da || 'data-else-if' in da) throw Error('CoreQuery: data-else without data-if')
    if ('data-cloak' in da) el.removeAttribute('data-cloak') // bound from here on: "[data-cloak]{display:none}" hid the raw template
    const ctx = da['data-context']
    if (ctx != null) scopes.set(el, (s = { ...s, p: resolve(ctx, s) as string }))
    // data-state-menu='{"open": false}': UI state at the context's "#menu" key, read through the alias "menu".
    // data-let-user="users.0": the alias "user" for a path, a named prop of the element and its subtree.
    for (const name in da) {
      const value = da[name]
      const l = name.startsWith('data-let-')
      if (l || name.startsWith('data-state-')) {
        if (l && BAD.test(value.trim())) throw Error('CoreQuery: bad ' + name + ' "' + value + '"')
        const cp = s.p
        const n = name.slice(l ? 9 : 11)
        const p = resolve(l ? value : '.#' + n, s)
        // Only while there is none: an item that moved, or a remount, keeps its state; a replaced context (a new
        // array of todos) gets it again, a missing one is left alone until it is there.
        if (!l)
          sub(p, c, (v) => {
            const o = store.get(cp)
            if (v !== undefined || o == null) return
            if (typeof o !== 'object') throw Error('CoreQuery: ' + name + ' needs an object context, "' + cp + '" is not one')
            try {
              store.set(p as string, JSON.parse(value || '{}'))
            } catch {
              throw Error('CoreQuery: bad ' + name + ' "' + value + '"')
            }
          }, s.d)
        const a = Object.create(s.a || null)
        a[n] = p
        scopes.set(el, (s = { ...s, a }))
      }
    }
    const use = da['data-use']
    if (use != null) stamp(el, use)
    // data-page, the router's outlet: its content is bound apart, so another page can take its place alone.
    let kc = c
    if ('data-page' in da) {
      const o = (outlet = [el, s, (kc = [])])
      c.push(() => (outlet === o && (outlet = undefined), dispose(kc)))
    }
    if (el.localName !== 'template') kids(el, s, kc, ks)
    const comp = da['data-component']
    const bound = da['data-value'] ?? da['data-bind']
    const on: [string, string][] = []
    for (const name in da) {
      const value = da[name]
      if (name === 'data-text') watch(value, s, c, textOf(el))
      else if (name === 'data-show')
        watch(value, s, c, (v) => {
          if (el.hasAttribute('hidden') === !!v) el.toggleAttribute('hidden', !v) // the attribute: SVG has no .hidden
        })
      else if (name.startsWith('data-attr-')) {
        const a = el instanceof SVGElement ? svgName(name.slice(10)) : name.slice(10)
        watch(value, s, c, (v) => {
          if (v == null || v === false) el.removeAttribute(a)
          else if (el.getAttribute(a) !== (v = v === true ? '' : text(v))) el.setAttribute(a, v)
          if (a === 'value') refresh.get(el)?.() // a radio of a data-for group got another value
        })
      } else if (name.startsWith('data-class-')) {
        const k = name.slice(11)
        watch(value, s, c, (v) => el.classList.toggle(k, !!v))
      }
      else if (name.startsWith('data-style-')) {
        const k = name.slice(11)
        const { style } = el as HTMLElement
        watch(value, s, c, (v) =>
          v == null || v === false ? style.removeProperty(k) : style.getPropertyValue(k) !== (v = text(v)) && style.setProperty(k, v),
        )
      } else if (name.startsWith('data-prop-')) {
        // HTML lowercases attribute names: data-prop-current-time sets currentTime.
        const k = name.slice(10).replace(/-(.)/g, (_, x: string) => x.toUpperCase())
        watch(value, s, c, (v) => (el as any)[k] !== v && ((el as any)[k] = v))
      } else if (/^data-(on-|click(\.|$))/.test(name)) on.push([name[5] === 'c' ? 'click' + name.slice(10) : name.slice(8), value])
    }
    // After data-attr-* (it may set the type), before actions (they must see the new value);
    // a non-form component only gets the path.
    if (bound != null && (!comp || FORM.test(el.tagName))) model(el, bound, s, c)
    for (const [type, src] of on) listen(el, type, src, s, c)
    const parent = el.parentNode
    const next = nx(el)
    // An unknown name is only warned about: data-component may be another script's attribute on the same page.
    const r = comp && (components[comp] ? components[comp](el as HTMLElement, '' + resolve(bound || '', s), app) : console.warn('CoreQuery: unknown component "' + comp + '"', el))
    if (typeof r === 'function') c.push(r)
    // The component may have moved el (e.g. wrapped it) or its next sibling (e.g. a portal).
    return next?.parentNode === parent ? next : el.parentNode === parent ? nx(el) : null
  }

  const app: App = {
    ...store,
    post(path, url, init) {
      const headers = new Headers(init?.headers)
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      return fetch(url, { method: 'POST', body: json(store.get(path)), ...init, headers })
    },
    send,
    bind(el, path) {
      const c: Cleanup[] = []
      model(el, path, scopeOf(el) || { p: '' }, c)
      return () => dispose(c)
    },
    click(target, fn) {
      const c: Cleanup[] = []
      const delegate = typeof target === 'string'
      evt(delegate ? document.documentElement : target, 'click', c, (e) => {
        // A selector only matches inside the mounted root; an element works anywhere.
        const el = delegate && (e.target as Element).closest?.(target)
        const s = delegate ? el && mounted?.contains(el) && scopeOf(el) : scopeOf(target) || { p: '' }
        if (s) fn(store.get(s.p), s.p, e as MouseEvent)
      })
      return () => dispose(c)
    },
    component(name: any, fn?: Component) {
      Object.assign(components, typeof name == 'string' ? { [name]: fn } : name)
    },
    fn(name: any, fn?: Fn) {
      Object.assign(fns, typeof name == 'string' ? { [name]: fn } : name)
    },
    router(r, opts) {
      routes = r
      pages = opts?.pages as typeof pages
      base = opts?.base
      sync()
      return app
    },
    go(url, replace) {
      history[replace ? 'replaceState' : 'pushState'](null, '', url)
      return arrive(true)
    },
    render(el, path: string = '') {
      const c: Cleanup[] = []
      const at = scopeOf(el) || { p: '' }
      const s = { ...at, p: '' + resolve(path, at) }
      scopes.set(el, s)
      try {
        walk(el, s, c)
      } catch (e) {
        dispose(c) // e.g. a template typo: drop what was bound so a fixed template can bind
        throw e
      }
      return () => dispose(c)
    },
    mount(root = document.body) {
      // Two live mounts would bind elements twice (e.g. the script-tag build already mounted <body>).
      if (mounted) throw Error('CoreQuery: already mounted')
      hydrate(root)
      // The browser's URL wins over the server's route: only it knows the hash. Same URL, same route: nothing changes.
      sync()
      const c = [app.render(root)]
      if (routes) {
        // The page the server rendered for this URL is the one in the outlet.
        page = here()
        shown = now().name
        evt(window as any, 'popstate', c, () => arrive())
        // Links to a route navigate in place; any other link, a new tab or a download is left to the browser.
        evt(root, 'click', c, (e) => {
          const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
          const { button, metaKey, ctrlKey, shiftKey, altKey } = e as MouseEvent
          if (!a || e.defaultPrevented || button || metaKey || ctrlKey || shiftKey || altKey || a.target || a.hasAttribute('download')) return
          if (!linked(a)) return
          // An anchor in this page: the browser scrolls to it and fires popstate.
          if (a.hash && a.pathname === location.pathname && a.search === location.search) return
          e.preventDefault()
          app.go(a.href)
        })
        preload()
      }
      mounted = root
      let done = false
      return () => {
        if (done) return // a stale handle must not unmount a later mount
        done = true
        mounted = null
        dispose(c)
      }
    },
  }
  return app
}

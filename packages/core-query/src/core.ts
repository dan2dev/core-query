// TreeModel: one plain state object addressed by dot paths ("todos.0.title"),
// observed through a tree of listeners that mirrors those paths.

export type Cleanup = () => void
type Listener = () => void
/**
 * Children, listeners with their depth (both made on first use) and the keyed items of an array (see `keyed`), by the
 * index they are at.
 */
type Node = { c?: Record<string, Node>; f?: Map<Listener, number>; x?: Map<number, Set<Node>> }
/** A keyed item: the segment "@<id>" in a path stands for index `i` of its array, wherever the item moves. */
export type Cursor = { s: string; i: number; at(i: number): void; touch(): void; drop(): void }

/** The child `k` of `n`, made when missing. */
const kid = (n: Node, k: string): Node => ((n.c ||= Object.create(null))[k] ||= {})
const split = (path: string) => {
  if (/(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(path)) throw Error('CoreQuery: bad path ' + path)
  return path ? path.split('.') : []
}
const isIndex = (k: string) => /^\d+$/.test(k)

export const join = (a: string, b: string) => (a && b ? a + '.' + b : a || b)

export const getIn = (obj: any, path: string): any => {
  for (const k of split(path)) {
    if (obj == null) return
    obj = obj[k]
  }
  return obj
}

// Typed paths (types only): a typed state checks "todos.0.title" and its value; an untyped one takes any string.
/** Values a path stops at: the state is JSON, these have nothing inside to address. */
type Leaf = Date | RegExp | Map<any, any> | Set<any> | ((...a: any[]) => unknown)
type Prim = string | number | boolean | bigint | symbol | null | undefined | Leaf
/** Request flags, at `#todos` next to `todos` (see `send`). */
export type Flags = { loading?: boolean; error?: { status: number; message: string } | null }
/** The keys a path can take after a value of type T: indices, `length` and `#i` (an item's request flags), object keys, and `#keys`. */
type Keys<T> = 0 extends 1 & T
  ? string
  : T extends Prim
    ? never
    : T extends readonly unknown[]
      ? 'length' | `${number}` | `#${number}`
      : (keyof T & string) | `${keyof T & number}` | `#${string}`
/** `true` when P is a path of T, else the keys that fit where it went wrong, after the valid part: the error and the completions. */
type Check<T, P extends string, Pre extends string = ''> = 0 extends 1 & T
  ? true
  : P extends `${infer K}.${infer R}`
    ? K extends Keys<T>
      ? Check<Child<T, K>, R, `${Pre}${K}.`>
      : `${Pre}${Keys<T>}`
    : P extends Keys<T>
      ? true
      : `${Pre}${Keys<T>}`
/** P when it is a path of T (every member of a union), else what fits instead. Checks the literal written, at any depth. */
export type ValidPath<T, P extends string> = Valid<Check<T, P>, P>
// never: nothing fits (a path into a Date).
type Valid<C, P> = [C] extends [never] ? never : [C] extends [true] ? P : C
/** Every path of T as one union, to six segments: a component's `path`, or a variable that holds any path. */
type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7]
export type Path<T, D extends number = 5> = 0 extends 1 & T
  ? string
  : [D] extends [never]
    ? never
    : T extends Prim
      ? never
      : T extends readonly (infer I)[]
        ? 'length' | `${number}` | `${number}.${Path<I, Depth[D]>}`
        : { [K in keyof T & string]: K | `${K}.${Path<T[K], Depth[D]>}` }[keyof T & string] | `#${string}`
export type At<T, P extends string> = 0 extends 1 & T ? any : P extends `${infer K}.${infer R}` ? At<Child<T, K>, R> : Child<T, P>
/**
 * "#k": a declared key keeps its type; next to a key `k` (or an item, or under an index signature) it holds the request
 * flags, there once a request ran; else it is UI state of any type.
 */
type Child<T, K extends string> = T extends readonly (infer I)[]
  ? K extends 'length'
    ? number
    : K extends `#${number}`
      ? Flags | undefined
      : I
  : K extends `#${infer N}`
    ? K extends keyof T
      ? string extends keyof T
        ? Flags | undefined
        : T[K]
      : N extends keyof T | `${keyof T & number}`
        ? Flags | undefined
        : any
    : K extends keyof T
      ? T[K]
      : K extends `${infer N extends number}`
        ? N extends keyof T
          ? T[N]
          : undefined
        : undefined
type Item<A> = 0 extends 1 & A ? any : NonNullable<A> extends readonly (infer I)[] ? I : never
/** push/unshift values: none at all for what is not an array (it would become one). */
type Items<A> = [Item<A>] extends [never] ? [never] : Item<A>[]
/**
 * An inferred state with its placeholders open: `null`, `undefined` → any, `[]` → any[], `{}` → any. Stops after 8
 * levels, where a recursive type (a JSON value) is left as it is.
 */
export type Loose<T, D extends number = 8> = [D] extends [never]
  ? T
  : [T] extends [null | undefined]
    ? any
    : [T] extends [readonly never[]]
      ? any[]
      : unknown extends T
        ? T
        : T extends Prim
          ? T
          : [keyof T] extends [never]
            ? any
            : { [K in keyof T]: Loose<T[K], Depth[D]> }

export interface Store<S = any> {
  /** The whole state, or the value at `path`. */
  get(): S
  get<P extends string>(path: ValidPath<S, P>): At<S, P>
  /** Sets `path`, creating objects (or arrays for numeric keys) on the way. */
  set<P extends string>(path: ValidPath<S, P>, value: At<S, P>): void
  push<P extends string>(path: ValidPath<S, P>, ...values: Items<At<S, P>>): void
  unshift<P extends string>(path: ValidPath<S, P>, ...values: Items<At<S, P>>): void
  pop<P extends string>(path: ValidPath<S, P>): Item<At<S, P>> | undefined
  shift<P extends string>(path: ValidPath<S, P>): Item<At<S, P>> | undefined
  /** `Array.prototype.splice` on the array at `path`. */
  splice<P extends string>(path: ValidPath<S, P>, start: number, deleteCount?: number, ...items: Item<At<S, P>>[]): Item<At<S, P>>[]
  /** Removes `path` from its parent (splices arrays). */
  delete<P extends string>(path: ValidPath<S, P>): void
  /** Calls `fn(value)` after the value at `path` (or inside it) may have changed, and right away with `now`. Returns unsubscribe. */
  on<P extends string>(path: ValidPath<S, P>, fn: (value: At<S, P>) => void, opts?: { now?: boolean }): Cleanup
  /** Resolves once the pending changes have reached the DOM and the `on` listeners. */
  tick(): Promise<void>
}

/**
 * The binder's side of a store: `sub` runs `f` (no value read) after `path` or inside it changed, after the queued
 * listeners of a lower depth `d`; `keyed(path)` makes the cursors of the items of the array at `path`.
 */
type Internal = { keyed(path: string): (i: number) => Cursor; keys(path: string): string[]; sub(path: string, f: Listener, d?: number): Cleanup }

export function createStore(state: any = {}): Store & Internal {
  const root: Node = {}
  // Changes are batched: changed subtrees are walked once and each listener runs once per microtask. queue[d] holds
  // the listeners of depth d, run outer first: a list drops and re-indexes its items before their bindings read them,
  // however those were reached (a `money(currency)` of a row, when the list and `currency` changed together).
  const queue: Set<Listener>[] = []
  let low = 0 // the queues below it are empty
  // Changed node → -1, or the lowest index from which array items only moved: those below it kept their values.
  const dirty = new Map<Node, number>()
  const cursors = new Map<string, Cursor>()
  let ids = 0
  let pending = false
  const enqueue = (d: number, f: Listener) => {
    ;(queue[d] ||= new Set()).add(f)
    if (d < low) low = d
  }
  const schedule = () => pending || ((pending = true), queueMicrotask(flush))
  const flush = () => {
    pending = false
    dirty.forEach(deep)
    dirty.clear()
    try {
      while (low < queue.length) {
        const d = low
        const q = (queue[d] ||= new Set())
        for (const f of q) {
          q.delete(f)
          f()
          if (low < d) break // it queued an outer one: that one first
        }
        if (low === d) low++
      }
    } finally {
      // A listener threw: the error propagates, the rest still run.
      if (low < queue.length) schedule()
    }
  }
  const deep = (from: number, n: Node) => {
    n.f?.forEach(enqueue)
    const c = n.c
    for (const k in c) if (!(+k < from) && k[0] !== '@') deep(-1, c[k])
    // Keyed items ("@"), once their list (in n.f, so after its depth) dropped the ones that left: after a move they
    // follow their values, and the list touches the ones whose value changed.
    if (from < 0 && c && n.x) {
      const ks = Object.keys(c).filter((k) => k[0] === '@')
      let d = 0
      n.f?.forEach((e) => e < d || (d = e + 1))
      enqueue(d, () => ks.forEach((k) => c[k] && deep(-1, c[k])))
    }
  }
  /** Walks `keys` (indices, no "@" segments) from `n`, through the keyed items at each index too. */
  const reach = (n: Node | undefined, keys: string[], i: number, from: number): void => {
    for (; n && i < keys.length; n = n.c?.[keys[i++]]) n.f?.forEach(enqueue), n.x?.get(+keys[i])?.forEach((m) => reach(m, keys, i + 1, from))
    if (n) dirty.set(n, Math.min(from, dirty.get(n) ?? from))
  }
  /** `from`: the array at `keys` only moved its items from that index on. */
  const notify = (keys: string[], from = -1) => (schedule(), reach(root, keys, 0, from))
  /** The path's keys, with each live "@<id>" replaced by its index. */
  const keysOf = (path: string) => split(path).map((k) => (k[0] === '@' ? '' + (cursors.get(k)?.i ?? k) : k))
  const get = (path = '') => keysOf(path).reduce((o, k) => o?.[k], state)

  const set = (path: string, value: unknown) => {
    const keys = keysOf(path)
    if (!keys.length) return (state = value), notify(keys)
    // Walk down, creating containers; remember where the tree first changes: [container, its old length, key index].
    let o = state
    let at: [any, number, number] | undefined
    let old: unknown
    keys.forEach((k, i) => {
      const end = i === keys.length - 1
      if (end || o[k] === null || typeof o[k] !== 'object') {
        at ||= [o, Array.isArray(o) ? o.length : -1, i]
        if (end) old = o[k]
        o[k] = end ? value : isIndex(keys[i + 1]) ? [] : {}
      }
      o = o[k]
    })
    const [c, len, j] = at!
    // An array that grew or shrank (set('xs.3', v), set('xs.length', 0)): its length and the indices from there changed.
    if (Array.isArray(c) && c.length !== len) notify(keys.slice(0, j), Math.min(len, c.length))
    // Unless the same primitive was written again (then a listener that writes its own path settles).
    else if (j < keys.length - 1 || !Object.is(old, value) || (value !== null && typeof value === 'object')) notify(keys.slice(0, j + 1))
  }

  const at = (path: string) => split(path).reduce(kid, root)
  const sub = (path: string, f: Listener, d = 0) => {
    // ponytail: listener nodes are never pruned (a keyed item's go with it); bounded by the distinct paths ever observed.
    const n = at(path)
    ;(n.f ||= new Map()).set(f, d)
    return () => {
      n.f!.delete(f)
      queue[d]?.delete(f)
    }
  }
  const take = (m: 'pop' | 'shift') => (path: string) => {
    const a = get(path)
    if (!Array.isArray(a) || !a.length) return
    const v = a[m]()
    notify(keysOf(path), m === 'pop' ? a.length : 0)
    return v
  }

  return {
    get,
    set,
    push(path, ...values) {
      const a = get(path)
      if (!Array.isArray(a)) return set(path, values)
      notify(keysOf(path), a.push(...values) - values.length)
    },
    unshift(path, ...values) {
      const a = get(path)
      if (!Array.isArray(a)) return set(path, values)
      a.unshift(...values)
      notify(keysOf(path), 0)
    },
    pop: take('pop'),
    shift: take('shift'),
    splice(path, start, count, ...items) {
      const a = get(path)
      if (!Array.isArray(a)) return []
      const i = start < 0 ? Math.max(a.length + start, 0) : Math.min(start, a.length)
      const r = count === undefined ? a.splice(i) : a.splice(i, count, ...items)
      notify(keysOf(path), i)
      return r
    },
    delete(path) {
      const keys = keysOf(path)
      const k = keys.pop()
      const o = get(keys.join('.'))
      if (k == null || o === null || typeof o !== 'object') return
      if (!Array.isArray(o)) delete o[k]
      else if (isIndex(k)) o.splice(+k, 1)
      else return
      notify(keys, Array.isArray(o) ? +k : -1)
    },
    on(path, fn, opts) {
      const f = () => fn(get(path))
      if (opts?.now) f()
      return sub(path, f)
    },
    sub,
    keys: keysOf,
    keyed(path) {
      const n = at(path)
      const x = (n.x ||= new Map())
      return (i) => {
        const s = '@' + ++ids
        const m = kid(n, s)
        const file = (on?: 1) => (on ? x.get(c.i) || x.set(c.i, new Set()).get(c.i)! : x.get(c.i)!)[on ? 'add' : 'delete'](m)
        const c: Cursor = {
          s,
          i,
          at: (j) => (file(), (c.i = j), file(1)),
          touch: () => (schedule(), deep(-1, m)),
          drop: () => cursors.delete(s) && (file(), delete n.c![s]),
        }
        cursors.set(s, c)
        file(1)
        return c
      }
    },
    // A microtask after every flush, including the ones listeners schedule: before the browser paints.
    tick: () =>
      new Promise((r) => {
        const wait = () => queueMicrotask(() => (pending ? wait() : r()))
        wait()
      }),
  }
}

// ---- template helpers shared by the browser binder and the server renderer ----

/** Where template paths resolve: `p` is the context path, `a` the loop aliases (path or index), `d` the blocks around. */
export interface Scope {
  p: string
  a?: Record<string, string | number>
  d?: number
}

/**
 * "" / "." → the context, ".x" → relative to it, "item.x" → through a loop alias,
 * anything else → absolute. An index alias resolves to its number.
 */
export const resolve = (expr: string, s: Scope): string | number => {
  expr = expr.trim()
  if (!expr || expr[0] === '.') return join(s.p, expr.slice(1))
  const i = expr.indexOf('.')
  const a = s.a?.[i < 0 ? expr : expr.slice(0, i)]
  if (a === undefined) return expr
  return typeof a === 'number' ? a : join(a, i < 0 ? '' : expr.slice(i + 1))
}

/** `data-for` value: "list" | "item in list" | "item, i in list" → [item, index, list]. */
export const parseFor = (expr: string): [string | undefined, string | undefined, string] => {
  const m = /^\s*(?:([^\s,]+)(?:\s*,\s*([^\s,]+))?\s+in\s+)?(\S+)\s*$/.exec(expr)
  if (!m) throw Error('CoreQuery: bad data-for "' + expr + '"')
  return [m[1], m[2], m[3]]
}

/** Scope of the i-th item of the list at `path`: "." is the item, aliases chain to outer loops. `seg`: a keyed item's "@<id>". */
export const itemScope = (s: Scope, path: string, i: number, item?: string, index?: string, seg = '' + i): Scope => {
  const p = join(path, seg)
  const d = (s.d || 0) + 1
  if (!item) return { p, a: s.a, d }
  const a = Object.create(s.a || null)
  a[item] = p
  if (index) a[index] = i
  return { p, a, d }
}

export const text = (v: unknown): string =>
  v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)

/** JSON without the `#keys`: UI state that stays in the browser (not posted, not in the SSR state). */
export const json = (v: unknown) => JSON.stringify(v, (k, x) => (k[0] === '#' ? undefined : x))

/** An action or pipe argument: a literal, or a path to read. */
export type Arg = string | number | boolean | null | { p: string }
const ARG = /'([^']*)'|"([^"]*)"|([^,\s]+)/g
export const args = (src: string): Arg[] =>
  [...src.matchAll(ARG)].map(([, a, b, c]) =>
    a ?? b ?? (c === 'true' ? true : c === 'false' ? false : c === 'null' ? null : isNaN(+c) ? { p: c } : +c),
  )

/** A template function: `path | name(args)` shows `fn(value, ...args)`, `path.name(args)` stores it (unless undefined). */
export type Fn = (value: any, ...args: any[]) => unknown

/** Always there (app.fn and the server's `fns` override them): expressions have no operators. */
export const builtins: Record<string, Fn> = {
  __proto__: null as never,
  eq: (v, x) => v === x,
  ne: (v, x) => v !== x,
  gt: (v, x) => v > x,
  gte: (v, x) => v >= x,
  lt: (v, x) => v < x,
  lte: (v, x) => v <= x,
  not: (v) => !v,
  and: (v, x) => v && x,
  or: (v, x) => v || x,
  then: (v, a, b) => (v ? a : b),
  add: (v, n) => (+v || 0) + n,
}

/** "!path | f(x, 'y') | g" → [negate the result, path, pipes] */
type Expr = [boolean, string, [string, Arg[]][]]
/** What a path cannot hold: an operator, a call, a space (expressions and data-let take paths). */
export const BAD = /[\s'"()=<>&|!+*?]/
const PIPE = /\|\s*([^\s|()'",]+)\s*(?:\(((?:'[^']*'|"[^"]*"|[^)'"])*)\))?\s*/g
const exprs = new Map<string, Expr>()

/** Value of a read expression ("path", "!path", "path | fn(args) | fn2") and the paths it depends on. */
export const evaluate = (src: string, s: Scope, get: (p: string) => any, fns: Record<string, Fn>): [any, string[]] => {
  let e = exprs.get(src)
  if (!e) {
    const i = src.indexOf('|')
    let p = (i < 0 ? src : src.slice(0, i)).trim()
    const not = p[0] === '!'
    if (not) p = p.slice(1).trim()
    const rest = i < 0 ? '' : src.slice(i)
    // Paths have no operators: "a == 'b'" or "n+1" would otherwise read undefined, silently.
    if (BAD.test(p) || rest.replace(PIPE, '').trim()) throw Error('CoreQuery: bad expression "' + src + '"')
    exprs.set(src, (e = [not, p, [...rest.matchAll(PIPE)].map(([, n, a]) => [n, a ? args(a) : []])]))
  }
  const deps: string[] = []
  const read = (x: string) => {
    const r = resolve(x, s)
    if (typeof r === 'number') return r
    deps.push(r)
    return get(r)
  }
  let v = read(e[1])
  for (const [n, a] of e[2]) {
    if (!fns[n]) throw Error('CoreQuery: unknown function "' + n + '" in "' + src + '"')
    v = fns[n](v, ...a.map((x) => (x !== null && typeof x === 'object' ? read(x.p) : x)))
  }
  return [e[0] ? !v : v, deps]
}

const isPath = (x: Arg) => x !== null && typeof x === 'object'
/** An evaluated "a | eq(b)" or `ne`, then functions of literals only: its value changes only as a and b become, or stop being, equal. */
export const isCmp = (src: string) => {
  const [p, ...rest] = exprs.get(src)![2]
  return /^(eq|ne)$/.test(p?.[0]) && p[1].length === 1 && isPath(p[1][0]) && !rest.some(([, a]) => a.some(isPath))
}

// ---- router: the URL as state, computed the same way by the browser and the server ----

/** name → pattern: "/", "/users/:id", "/docs/*" (a last `*` takes the rest of the path, as `params['*']`). */
export type Routes = Record<string, string>
type Seg<P extends string> = P extends `${infer A}/${infer B}` ? Seg<A> | Seg<B> : P extends `:${infer N}` ? N : P extends '*' ? '*' : never
/**
 * The URL matched against the routes: `is[name]` and `params` belong to the first route that matches (none: a 404).
 * Typed by the routes it was matched against: `name === 'user'` narrows `params` to `{ id: string }` for "/users/:id".
 */
export type Route<R extends Routes = Routes> = { path: string; query: Record<string, string>; hash: string } & (string extends keyof R
  ? { name?: string; params: Record<string, string>; is: Record<string, true> }
  : { is: { [K in keyof R]?: true } } & (
      // A pattern known only as `string` (routes not written `as const`) may have any params.
      | { [N in keyof R & string]: { name: N; params: string extends R[N] ? Record<string, string> : { [K in Seg<R[N]>]: string } } }[keyof R & string]
      | { name?: undefined; params: {} }
    ))

/** `base` ("/app"): the prefix the patterns are relative to; a URL outside it matches no route. */
export const route = <const R extends Routes>(url: string, routes: R, base = ''): Route<R> => {
  const r: Route<any> = { path: url, query: {}, hash: '', params: {}, is: {} }
  try {
    const u = new URL(url, 'http://x')
    r.path = u.pathname
    r.query = Object.fromEntries(u.searchParams)
    r.hash = u.hash
    // Empty segments are skipped, so a trailing slash matches too.
    const all = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const b = base.split('/').filter(Boolean)
    const segs = all.slice(b.length)
    for (const name in b.every((x, i) => x === all[i]) ? routes : {}) {
      const pat = routes[name].split('/').filter(Boolean)
      const rest = pat[pat.length - 1] === '*'
      if (rest) pat.pop()
      const params: Record<string, string> = rest ? { '*': segs.slice(pat.length).join('/') } : {}
      if ((rest ? segs.length >= pat.length : segs.length === pat.length) && pat.every((p, i) => (p[0] === ':' ? ((params[p.slice(1)] = segs[i]), true) : p === segs[i])))
        return { ...r, name, params, is: { [name]: true } } as any
    }
  } catch {} // a URL that does not parse or decode ("/%E0%A4%A") matches no route
  return r as any
}

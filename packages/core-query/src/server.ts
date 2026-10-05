// Server-side rendering without a DOM: parse the template once, render directives
// to strings, and leave every data-* attribute in place so the client can hydrate.
export { route } from './core'
export type { At, Fn, Route, Routes } from './core'
import { BAD, builtins, createStore, evaluate, getIn, itemScope, join, json, parseFor, resolve, text, type Fn, type Scope } from './core'

/** [lowercased name, value, source text (dropped once we rewrite the attribute)] */
type Attr = [string, string, string?]
/** Element: tag as written, attributes, children, self-closed in source ("<path/>"). */
type El = { t: string; a: Attr[]; k: Kid[]; s?: boolean }
/** Raw text, comments and doctypes pass through untouched. */
type Kid = El | string

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i
const RAW = /^(script|style|textarea|title)$/i
const TOKEN =
  /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g // unquoted: anything but space and >, as browsers read it

// A start tag that ends its open parent in HTML ("<li>a<li>b"): the browser would build another tree than ours.
const SAME = /^(li li|option option|tr tr|t[dh] t[dh]|d[dt] d[dt])$/i
// Block tags end an open <p>, through inline ancestors; these hide it from them.
const BLOCK = /^(p|div|ul|ol|table|h[1-6]|section|article|form|pre|blockquote|header|footer|nav|main|aside)$/i
const P_SCOPE = /^(button|object|template|foreignobject|desc|mtext|marquee|noscript|applet|caption|td|th)$/i

// ponytail: no implied end tags and entities stay encoded; templates are developer-written, so a full HTML5
// parser is not worth its size. The common unclosed <p>/<li>/<td>... throw instead of nesting wrongly; the rest
// (an <li> behind an unclosed <p>, open elements at the end of the input) stays lenient.
const parse = (html: string): El => {
  const root: El = { t: '', a: [], k: [] }
  const stack = [root]
  const top = () => stack[stack.length - 1]
  let at = 0
  TOKEN.lastIndex = 0
  for (let m; (m = TOKEN.exec(html)); ) {
    if (m.index > at) top().k.push(html.slice(at, m.index))
    at = TOKEN.lastIndex
    const [all, close, open, attrs, slash] = m
    if (close) {
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].t.toLowerCase() === close.toLowerCase()) {
          stack.length = i
          break
        }
    } else if (open) {
      let bad = SAME.test(top().t + ' ' + open) && top().t
      if (BLOCK.test(open)) for (let i = stack.length; --i > 0 && !bad && !P_SCOPE.test(stack[i].t); ) if (/^p$/i.test(stack[i].t)) bad = 'p'
      if (bad) throw Error(`CoreQuery: unclosed <${bad}> before <${open}> (line ${html.slice(0, m.index).split('\n').length})`)
      const el: El = {
        t: open,
        a: [...attrs.matchAll(ATTR)].map(([raw, n, a, b, c]) => [n.toLowerCase(), a ?? b ?? c ?? '', raw]),
        k: [],
      }
      top().k.push(el)
      if (RAW.test(open)) {
        const end = new RegExp('</' + open + '\\s*>', 'gi')
        end.lastIndex = at
        const e = end.exec(html)
        const stop = e ? e.index : html.length
        if (stop > at) el.k.push(html.slice(at, stop))
        at = TOKEN.lastIndex = e ? end.lastIndex : stop
      } else if (slash) el.s = true
      else if (!VOID.test(open)) stack.push(el)
    } else top().k.push(all)
  }
  if (at < html.length) top().k.push(html.slice(at))
  return root
}

const ENT: Record<string, string> = { __proto__: null as never, amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
/** Numeric and the common named references: enough to compare option values like the browser. */
const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] !== '#' ? ENT[e] ?? m : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)),
  )
// \r too: the HTML parser turns a raw CR into LF, a &#13; stays CR, as the client sets it.
const esc = (s: string) => s.replace(/[&<>"\r]/g, (c) => '&#' + c.charCodeAt(0) + ';')
const tag = (el: El, a: Attr[], inner: string) =>
  '<' +
  el.t +
  a.map(([n, v, raw]) => ' ' + (raw ?? n + '="' + esc(v) + '"')).join('') +
  // " />", not "/>": after an unquoted value (r=4/>) the slash would join it (r="4/").
  (VOID.test(el.t) ? '>' : el.s && !inner ? ' />' : '>' + inner + '</' + el.t + '>')
const raw = (k: Kid): string => (typeof k === 'string' ? k : tag(k, k.a, k.k.map(raw).join('')))

/** Values of a bound <select> (all of them in a multiple one) and whether an option took one: like the client, only the first does in a single select. */
type Sel = { v: string[]; m?: boolean; hit?: boolean }
/** Besides the scope, a render reads the state, calls the template functions and stamps <template id>s. */
type Ctx = { get: (p: string) => any; set: (p: string, v: unknown) => void; fns: Record<string, Fn>; tpls: Record<string, El> }

const isEl = (k: Kid): k is El => typeof k !== 'string'
const attrOf = (k: El, n: string) => k.a.find((a) => a[0] === n)?.[1]

/** <template> + `n` copies of its elements rendered with scopeAt(i), exactly what the client adopts; its first element. */
const block = (k: El, names: string[], n: number, scopeAt: (i: number) => Scope, x: Ctx, sel?: Sel, svg?: boolean): [string, El?] => {
  const isTpl = k.t.toLowerCase() === 'template'
  const protos = isTpl ? k.k.filter(isEl) : [{ ...k, a: k.a.filter((a) => !names.includes(a[0])) }]
  let html = tag(
    { t: 'template', a: [], k: [] },
    [...(isTpl ? k.a.filter((a) => a[0] !== 'data-n') : k.a.filter((a) => names.includes(a[0])).map(([an, av]): Attr => [an, av])), ['data-n', '' + n]],
    isTpl ? k.k.map(raw).join('') : raw(protos[0]),
  )
  for (let i = 0; i < n; i++) html += kids(protos, scopeAt(i), x, sel, undefined, svg)
  return [html, protos[0]]
}

// Rows (or cols) directly under <table> get an implied <tbody> (<colgroup>) from the browser, which would leave
// a block's template outside it: wrap the block ourselves. Items may be nested blocks of rows.
const group = (html: string, parent?: string, leaf?: El) => {
  while (leaf?.t.toLowerCase() === 'template') leaf = leaf.k.find(isEl)
  const g = parent === 'table' && ({ tr: 'tbody', col: 'colgroup' } as Record<string, string>)[leaf?.t.toLowerCase() as string]
  return g ? `<${g}>${html}</${g}>` : html
}

/** data-use content: the <template>'s children, its <slot>s taking the element's children ([slot=name] ones in named slots). */
const fill = (ks: Kid[], host: Kid[]): Kid[] =>
  ks.flatMap((k) => {
    if (typeof k === 'string' || k.t.toLowerCase() === 'template') return k
    if (k.t.toLowerCase() !== 'slot') return { ...k, k: fill(k.k, host) }
    const name = attrOf(k, 'name') ?? null
    const parts = host.filter((h) => (typeof h === 'string' ? null : (attrOf(h, 'slot') ?? null)) === name)
    return parts.some((h) => typeof h !== 'string' || h.trim()) ? parts : k.k
  })

/** Siblings; a data-if takes the data-else-if/data-else elements right after it (only text between them). */
const kids = (ks: Kid[], s: Scope, x: Ctx, sel?: Sel, parent?: string, svg?: boolean): string => {
  let html = ''
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    // data-for comes first, as on the client: a data-if on the same element is each item's condition.
    if (typeof k === 'string' || attrOf(k, 'data-if') == null || attrOf(k, 'data-for') != null) {
      html += render(k, s, x, sel, parent, svg)
      continue
    }
    // Blocks of 0 or 1 item, the first true one shown; the rows of a chain share one <tbody>.
    let out = ''
    let done = false
    let leaf: El | undefined
    for (let m = k, a = 'data-if'; ; ) {
      const on: boolean = !done && (a === 'data-else' || !!evaluate(attrOf(m, a)!, s, x.get, x.fns)[0])
      done ||= on
      const [h, l] = block(m, [a], +on, () => s, x, sel, svg)
      out += h
      leaf ||= l
      let j = i + 1
      while (j < ks.length && typeof ks[j] === 'string') j++
      const e = ks[j]
      a = a === 'data-else' || !e || typeof e === 'string' ? '' : attrOf(e, 'data-else-if') != null ? 'data-else-if' : attrOf(e, 'data-else') != null ? 'data-else' : ''
      if (!a) break
      out += ks.slice(i + 1, j).join('')
      i = j
      m = e as El
    }
    html += group(out, parent, leaf)
  }
  return html
}

/** `sel`: the enclosing bound <select>; `parent`: the parent's tag; `svg`: inside <svg>/<math>. */
const render = (kid: Kid, s: Scope, x: Ctx, sel?: Sel, parent?: string, svg?: boolean): string => {
  if (typeof kid === 'string') return kid
  let k = kid
  const t = k.t.toLowerCase()
  const attr = (n: string) => attrOf(k, n)
  const read = (expr: string) => {
    const p = resolve(expr, s)
    return typeof p === 'number' ? p : x.get(p)
  }
  const val = (expr: string) => evaluate(expr, s, x.get, x.fns)[0]

  // data-for → <template data-for data-n="N"> + N rendered items, exactly what the client adopts.
  const forExpr = attr('data-for')
  if (forExpr != null) {
    const [item, index, src] = parseFor(forExpr)
    const p = '' + resolve(src, s)
    const arr = x.get(p)
    const n = Array.isArray(arr) ? arr.length : 0
    const [html, leaf] = block(k, ['data-for', 'data-key'], n, (i) => itemScope(s, p, i, item, index), x, sel, svg)
    return group(html, parent, leaf)
  }
  if (attr('data-else') != null || attr('data-else-if') != null) throw Error('CoreQuery: data-else without data-if')
  const ctx = attr('data-context')
  if (ctx != null) s = { p: '' + resolve(ctx, s), a: s.a }
  // data-state-<name>: UI state at "#name" in the context, started from the attribute as the client will (not while
  // the context is missing); `name` aliases it below.
  for (const [n, v] of k.a)
    if (n.startsWith('data-let-')) {
      // data-let-<name>: the alias `name` for a path, in attribute order with data-state, as the client does.
      if (BAD.test(v.trim())) throw Error('CoreQuery: bad ' + n + ' "' + v + '"')
      const a = Object.create(s.a || null)
      a[n.slice(9)] = resolve(v, s)
      s = { p: s.p, a }
    } else if (n.startsWith('data-state-')) {
      const name = n.slice(11)
      const p = join(s.p, '#' + name)
      const o = x.get(s.p)
      if (o != null && typeof o !== 'object') throw Error('CoreQuery: ' + n + ' needs an object context, "' + s.p + '" is not')
      // The browser decodes every named reference, `decode` only a few: the two sides would start from different values.
      const ent = v.match(/&[a-z]+;/gi)?.find((e) => !ENT[e.slice(1, -1)])
      if (ent) throw Error('CoreQuery: ' + n + ' has "' + ent + '": write the character itself or a numeric reference (&#233;)')
      if (o != null && x.get(p) === undefined) {
        let init
        try {
          init = JSON.parse(decode(v) || '{}')
        } catch {
          throw Error('CoreQuery: bad ' + n + ' ' + v)
        }
        x.set(p, init)
      }
      const a = Object.create(s.a || null)
      a[name] = p
      s = { p: s.p, a }
    }
  const use = attr('data-use')
  if (use != null) {
    const tpl = x.tpls[use]
    if (!tpl) throw Error('CoreQuery: no <template id="' + use + '">')
    k = { ...k, a: k.a.filter((a) => a[0] !== 'data-use'), k: fill(tpl.k, k.k) }
  }
  const a = k.a.slice()
  const put = (n: string, v: string | null) => {
    const i = a.findIndex((x) => x[0] === n)
    if (v != null) a.splice(i < 0 ? a.length : i, i < 0 ? 0 : 1, [n, v])
    else if (i >= 0) a.splice(i, 1)
  }
  const flag = (n: string, on: boolean) => put(n, on ? '' : null)
  /** An attribute as the browser will see it: after data-attr-*, entities decoded. */
  const rendered = (n: string) => {
    const x = a.find((y) => y[0] === n)
    return x && (x[2] ? decode(x[1]) : x[1])
  }
  let inner: string | undefined
  let label: string | undefined
  let childSel = t === 'optgroup' ? sel : undefined
  const classes: [string, boolean][] = []
  const styles: string[] = []
  for (const [n, v] of k.a) {
    if (n === 'data-text') {
      const y = val(v)
      label = text(y)
      // HTML <script>/<style> are raw text (entities are not decoded): keep out the tokens that end it or
      // switch the tokenizer's state (<!-- with <script). JSON can lose every '<', a string gets a '\'.
      // Inside <svg>/<math> they are normal markup, so they are escaped like any text.
      // ponytail: <style> in a <foreignObject> is escaped too (safe; entities then show up in its CSS).
      inner = svg || !/^(script|style)$/.test(t)
        ? esc(label)
        : y !== null && typeof y === 'object'
          ? label.replace(/</g, '\\u003c')
          : label.replace(/<(?=!--|\/?script|\/style)/gi, '<\\')
    } else if (n === 'data-show') flag('hidden', !val(v))
    else if (n.startsWith('data-attr-')) {
      const y = val(v)
      put(n.slice(10), y == null || y === false ? null : y === true ? '' : text(y))
    } else if (n.startsWith('data-class-')) classes.push([n.slice(11), !!val(v)])
    else if (n.startsWith('data-style-')) {
      const y = val(v)
      if (y != null && y !== false) styles.push(n.slice(11) + ': ' + text(y))
    }
  }
  // Toggled classes go after the attribute's own, as classList adds them; styles are appended, so they win.
  if (classes.length) {
    const cls = new Set(rendered('class')?.split(/\s+/).filter(Boolean))
    for (const [c, on] of classes) on ? cls.add(c) : cls.delete(c)
    put('class', cls.size || rendered('class') != null ? [...cls].join(' ') : null)
  }
  if (styles.length) put('style', [rendered('style'), ...styles].filter(Boolean).join('; '))
  const bound = attr('data-value') ?? attr('data-bind')
  if (bound != null) {
    const y = read(bound)
    const type = rendered('type')?.toLowerCase()
    if (t === 'select') {
      const m = rendered('multiple') != null
      childSel = { v: m && Array.isArray(y) ? y.map(text) : [text(y)], m }
    } else if (t !== 'input' && t !== 'textarea') {
      if (attr('data-component') == null) inner = esc((label = text(y))) // a component only gets the path
    } else if (type === 'checkbox') {
      const v = rendered('value') ?? 'on'
      flag('checked', Array.isArray(y) ? y.some((z) => text(z) === v) : !!y)
    } else if (type === 'radio') flag('checked', text(y) === (rendered('value') ?? 'on'))
    else if (t === 'input') put('value', text(y))
    else inner = esc(text(y))
  }
  // An option of a bound <select>: selected when its value matches, computed like the browser's
  // option.value (the value attribute, else the text with ASCII whitespace collapsed).
  if (t === 'option' && sel) {
    const content = label ?? decode(k.k.filter((c) => typeof c === 'string').join(''))
    const on = (sel.m || !sel.hit) && sel.v.includes(rendered('value') ?? content.replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, ''))
    if (on) sel.hit = true
    flag('selected', on)
  }
  // The HTML parser drops a newline right after <pre>/<textarea>: double it so the value keeps it.
  if (inner?.[0] === '\n' && /^(pre|textarea|listing)$/.test(t)) inner = '\n' + inner
  if (inner === undefined) inner = t === 'template' ? k.k.map(raw).join('') : kids(k.k, s, x, childSel, t, svg || t === 'svg' || t === 'math')
  return tag(k, a, inner)
}

const find = (el: El, t: string): El | undefined => {
  for (const k of el.k)
    if (typeof k !== 'string') {
      const r = k.t.toLowerCase() === t ? k : find(k, t)
      if (r) return r
    }
}

/**
 * Renders a `data-*` template with `state` and the template functions `fns` (the ones the client
 * registers with `app.fn`), and embeds the state for hydration (first in <body>, or at the end of
 * a fragment). Mount the client on the element that contains the output.
 */
export function renderToString(html: string, state: object = {}, fns: Record<string, Fn> = {}): string {
  const root = parse(html)
  const data = json(state)
  const script = '<script type="application/json" data-cq-state>' + data.replace(/</g, '\\u003c') + '</script>'
  // First in <body>, so the page's own scripts (even classic ones at the end) find it; last in a fragment.
  const body = find(root, 'body')
  body ? body.k.unshift(script) : root.k.push(script)
  // Render what the client will hydrate from: JSON turns Dates into strings, drops undefined and #keys, etc.
  const parsed = JSON.parse(data)
  const tpls: Record<string, El> = Object.create(null)
  const index = (el: El): void =>
    el.k.forEach((k) => {
      if (typeof k === 'string') return
      const id = k.t.toLowerCase() === 'template' && attrOf(k, 'id')
      if (id) tpls[id] = k
      index(k)
    })
  index(root)
  const { set } = createStore(parsed)
  let again = false
  const out = () => kids(root.k, { p: '' }, { get: (p) => getIn(parsed, p), set: (p, v) => ((again = true), set(p, v)), fns: Object.assign(Object.create(null), builtins, fns), tpls })
  const first = out()
  // A data-state was started: what came before its element may have read it (the client updates those once it is
  // set), so render again, now with every state there.
  return again ? out() : first
}

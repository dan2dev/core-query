// Edge cases of the DOM-free parts: the store, the template helpers, the router and the server renderer.
import { describe, expect, it, vi } from 'vitest'
import { args, builtins, createStore, evaluate, getIn, itemScope, join, json, parseFor, resolve, route, type Scope } from '../src/core'
import { renderToString } from '../src/server'

const STATE = '<script type="application/json" data-cq-state>'
const strip = (html: string) => html.slice(0, html.indexOf(STATE))

describe('store edges', () => {
  it('refuses prototype keys on every method, but not names that only contain them', () => {
    const s = createStore({ a: {} })
    for (const p of ['prototype', '__proto__', 'a.constructor', 'a.__proto__.x']) expect(() => s.get(p)).toThrow('CoreQuery: bad path ' + p)
    expect(() => s.on('a.prototype', () => {})).toThrow(/bad path/)
    expect(() => s.unshift('__proto__', 1)).toThrow(/bad path/)
    expect(() => s.splice('constructor', 0)).toThrow(/bad path/)
    expect(() => s.pop('__proto__')).toThrow(/bad path/)
    s.set('constructors', 1)
    s.set('a.__proto__x', 2)
    s.set('my_prototype', 3)
    expect(s.get()).toEqual({ a: { __proto__x: 2 }, constructors: 1, my_prototype: 3 })
  })

  it('get() reads through primitives like JS and stops at null', () => {
    const s = createStore({ s: 'abc', n: null, z: 0, xs: [1, 2] })
    expect(s.get('s.length')).toBe(3)
    expect([s.get('n'), s.get('n.x'), s.get('z.x'), s.get('xs.-1')]).toEqual([null, undefined, undefined, undefined])
    expect(getIn(null, '')).toBeNull()
  })

  it('set() replaces a primitive or null on the way with a container', () => {
    const s = createStore({ a: 1, b: null, c: 'x' })
    s.set('a.b', 1)
    s.set('b.0', 'x')
    s.set('c.d.0.e', true)
    expect(s.get()).toEqual({ a: { b: 1 }, b: ['x'], c: { d: [{ e: true }] } })
  })

  it('set("") replaces the whole state and notifies every listener', async () => {
    const s = createStore({ a: { b: 1 } })
    const seen: string[] = []
    for (const p of ['', 'a', 'a.b']) s.on(p, (v) => seen.push(p + '=' + JSON.stringify(v)))
    s.set('', { a: { b: 2 } })
    await s.tick()
    expect(seen.sort()).toEqual(['={"a":{"b":2}}', 'a.b=2', 'a={"b":2}'])
  })

  it('writing the same primitive again notifies nobody; an object always notifies (it may have been mutated)', async () => {
    const o = { k: 1 }
    const s = createStore({ n: 1, nan: NaN, o })
    const seen: string[] = []
    for (const p of ['', 'n', 'nan', 'o']) s.on(p, () => seen.push(p))
    s.set('n', 1)
    s.set('nan', NaN)
    await s.tick()
    expect(seen).toEqual([])
    o.k = 2
    s.set('o', o)
    await s.tick()
    expect(seen.sort()).toEqual(['', 'o'])
  })

  it('calls a listener once per flush, with the value at flush time', async () => {
    const s = createStore({ n: 0 })
    const fn = vi.fn()
    s.on('n', fn)
    s.set('n', 1)
    s.set('n', 2)
    s.set('n', 3)
    await s.tick()
    expect(fn.mock.calls).toEqual([[3]])
  })

  it('set() past the end of an array leaves holes and notifies from the old length', async () => {
    const s = createStore({ xs: ['a', 'b'] })
    const seen: string[] = []
    for (const p of ['xs.0', 'xs.1', 'xs.2', 'xs.3', 'xs.length']) s.on(p, (v) => seen.push(p + '=' + v))
    s.set('xs.3', 'd')
    await s.tick()
    expect(s.get('xs')).toEqual(['a', 'b', undefined, 'd'])
    expect(2 in s.get('xs')).toBe(false)
    expect(seen.sort()).toEqual(['xs.2=undefined', 'xs.3=d', 'xs.length=4'])
  })

  it('pop/shift of an empty array, splice and delete where there is nothing change nothing and notify nobody', async () => {
    const s = createStore({ xs: [], s: 'str' })
    const fn = vi.fn()
    s.on('', fn)
    expect([s.pop('xs'), s.shift('xs'), s.pop('s'), s.shift('nope')]).toEqual([undefined, undefined, undefined, undefined])
    expect(s.splice('s', 0, 1)).toEqual([])
    expect(s.splice('nope', 0)).toEqual([])
    s.delete('')
    s.delete('nope.x')
    s.delete('s.0')
    await s.tick()
    expect(fn).not.toHaveBeenCalled()
    expect(s.get()).toEqual({ xs: [], s: 'str' })
  })

  it('splice clamps its start like Array.prototype.splice', () => {
    const s = createStore({ xs: ['a', 'b'] })
    expect(s.splice('xs', 10, 0, 'z')).toEqual([])
    expect(s.splice('xs', -10, 1)).toEqual(['a'])
    expect(s.splice('xs', 0, 0, 'x', 'y')).toEqual([])
    expect(s.get('xs')).toEqual(['x', 'y', 'b', 'z'])
  })

  it('push/unshift turn a value that is not an array into an array of the values', () => {
    const s = createStore({ s: 'x', o: { a: 1 } })
    s.push('s', 1, 2)
    s.unshift('o', 3)
    s.push('none')
    expect(s.get()).toEqual({ s: [1, 2], o: [3], none: [] })
  })

  it('unsubscribing twice is harmless and leaves the other listeners of the path', async () => {
    const s = createStore()
    const a = vi.fn()
    const b = vi.fn()
    const off = s.on('n', a)
    s.on('n', b)
    off()
    off()
    s.set('n', 1)
    await s.tick()
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1])
  })

  it('a listener removed by another listener in the same flush does not run', async () => {
    const s = createStore()
    const b = vi.fn()
    let offB = () => {}
    s.on('n', () => offB())
    offB = s.on('n', b)
    s.set('n', 1)
    await s.tick()
    expect(b).not.toHaveBeenCalled()
  })

  it('tick() resolves with nothing pending, and only after a chain of listener writes settled', async () => {
    const s = createStore({ a: 0 })
    await s.tick()
    s.on('a', (a) => a < 5 && s.set('a', a + 1))
    s.set('a', 1)
    await s.tick()
    expect(s.get('a')).toBe(5)
  })
})

describe('template helper edges', () => {
  it('join skips an empty side', () => {
    expect([join('', ''), join('a', ''), join('', 'b'), join('a', 'b')]).toEqual(['', 'a', 'b', 'a.b'])
  })

  it('resolve trims; a loop without an alias keeps the outer ones; an inner alias shadows; an index alias is its number', () => {
    expect(resolve('  .x  ', { p: 'a' })).toBe('a.x')
    const outer = itemScope({ p: '' }, 'gs', 1, 'g', 'gi')
    const plain = itemScope(outer, 'gs.1.xs', 0)
    expect([resolve('.', plain), resolve('g.name', plain), resolve('gi', plain), resolve('other.x', plain)]).toEqual(['gs.1.xs.0', 'gs.1.name', 1, 'other.x'])
    expect(resolve('gi.anything', plain)).toBe(1)
    expect(resolve('g', itemScope(outer, 'gs.1.xs', 0, 'g'))).toBe('gs.1.xs.0')
  })

  it('parseFor takes a tight comma and rejects anything else', () => {
    expect(parseFor('x,i in xs')).toEqual(['x', 'i', 'xs'])
    for (const bad of ['', '   ', 'x in', 'in xs', 'a b c', 'x, in xs', 'x, i, j in xs']) expect(() => parseFor(bad)).toThrow('CoreQuery: bad data-for')
  })

  it('json drops the #keys at any depth and keeps the rest', () => {
    expect(json({ '': 1, a: { '#ui': 1, b: [{ '#x': 1, c: 2 }] }, '#top': 1, 'x#': 1 })).toBe('{"":1,"a":{"b":[{"c":2}]},"x#":1}')
    expect(json(undefined)).toBeUndefined()
  })

  it('args: quotes keep commas, spaces and the other quote; literals; everything else is a path', () => {
    expect(args(`'a, b', "it's", '', -1.5, 1e3, true, false, null, x.y, $event.key`)).toEqual([
      'a, b',
      "it's",
      '',
      -1.5,
      1000,
      true,
      false,
      null,
      { p: 'x.y' },
      { p: '$event.key' },
    ])
    expect([args(''), args('   ')]).toEqual([[], []])
  })
})

describe('evaluate edges', () => {
  const state = { a: 1, b: 2, s: 'x', list: { n: 3 } }
  const ev = (src: string, s: Scope = { p: '' }) => evaluate(src, s, (p) => getIn(state, p), builtins)

  it('reports every path it read, pipe arguments included; a loop index is not one', () => {
    expect(ev('a | eq(b) | then(s, "y")')).toEqual(['y', ['a', 'b', 's']])
    const item = itemScope({ p: '' }, 'xs', 4, 'x', 'i')
    expect(ev('i | eq(4)', item)).toEqual([true, []])
    expect(ev('x.n | or(i)', item)).toEqual([4, ['xs.4.n']])
  })

  it('"" and "." read the context; "!" may stand apart from its path', () => {
    expect(ev('', { p: 'list' })[0]).toEqual({ n: 3 })
    expect(ev('.', { p: 'list.n' })[0]).toBe(3)
    expect([ev('! a')[0], ev('!missing')[0]]).toEqual([false, true])
  })

  it('takes a quoted ")" or "|" in a pipe argument', () => {
    expect(ev(`a | then(')', '|')`)[0]).toBe(')')
    expect(ev(`missing | then(')', '|')`)[0]).toBe('|')
  })

  it('looks functions up without a prototype: Object methods are unknown', () => {
    for (const n of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) expect(() => ev('a | ' + n)).toThrow(`CoreQuery: unknown function "${n}"`)
  })

  it('rejects a dangling or unclosed pipe and anything that is not a path', () => {
    for (const src of ['a |', 'a | eq(1', 'a | eq(1) b', "a | eq('x)", 'a?.b', 'a * 2', 'f()', '"lit"', 'a b'])
      expect(() => ev(src)).toThrow('CoreQuery: bad expression')
  })
})

describe('route edges', () => {
  const routes = { home: '/', user: '/users/:id' }

  it('the first route that matches wins, in the order written', () => {
    expect(route('/users/new', { create: '/users/new', user: '/users/:id' }).name).toBe('create')
    expect(route('/users/new', { user: '/users/:id', create: '/users/new' })).toMatchObject({ name: 'user', params: { id: 'new' } })
  })

  it('several params; literals are case-sensitive and compared decoded', () => {
    const r = { post: '/u/:user/posts/:id', cafe: '/café' }
    expect(route('/u/ana/posts/3', r).params).toEqual({ user: 'ana', id: '3' })
    expect(route('/U/ana/posts/3', r).name).toBeUndefined()
    expect(route('/caf%C3%A9', r).name).toBe('cafe')
  })

  it('an encoded slash stays inside its param', () => {
    expect(route('/users/a%2Fb', routes).params).toEqual({ id: 'a/b' })
  })

  it('a lone "*" matches every path, the root with an empty rest', () => {
    expect(route('/', { all: '*' })).toMatchObject({ name: 'all', params: { '*': '' } })
    expect(route('/a/b/', { all: '/*' }).params).toEqual({ '*': 'a/b' })
  })

  it('ignores the origin, decodes the query and keeps the last of a repeated key', () => {
    expect(route('https://example.com/users/7?a=1&a=2&b=x%20y', routes)).toMatchObject({ name: 'user', path: '/users/7', query: { a: '2', b: 'x y' } })
  })

  it('no routes, no match', () => {
    expect(route('/', {})).toEqual({ path: '/', query: {}, hash: '', params: {}, is: {} })
  })
})

describe('renderToString edges', () => {
  it('embeds {} without a state, first in a <BODY> written in capitals, and never mutates the state it is given', () => {
    expect(renderToString('<p></p>')).toBe(`<p></p>${STATE}{}</script>`)
    expect(renderToString('<HTML><BODY><p></p></BODY></HTML>')).toBe(`<HTML><BODY>${STATE}{}</script><p></p></BODY></HTML>`)
    const state = { todos: [{ t: 'a' }] }
    renderToString(`<li data-for="todos" data-state-ui='{"open": true}'></li>`, state)
    expect(JSON.stringify(state)).toBe('{"todos":[{"t":"a"}]}')
  })

  it('leaves out what JSON leaves out: functions, undefined, #keys', () => {
    expect(renderToString(`<p data-text="f"></p><p data-text="u"></p>`, { f: () => 1, u: undefined, '#k': 1, n: 1 })).toBe(
      `<p data-text="f"></p><p data-text="u"></p>${STATE}{"n":1}</script>`,
    )
  })

  it('renders 0, false and objects as text; data-for over a non-array renders no item', () => {
    expect(strip(renderToString(`<b data-text="z"></b><i data-text="f"></i><u data-text="o"></u><li data-for="s"></li>`, { z: 0, f: false, o: { a: [1] }, s: 'abc' }))).toBe(
      `<b data-text="z">0</b><i data-text="f">false</i><u data-text="o">{&#34;a&#34;:[1]}</u><template data-for="s" data-n="0"><li></li></template>`,
    )
  })

  it('data-show drops a hidden the element had; data-attr-* false drops an attribute it had; 0 is a value', () => {
    expect(strip(renderToString(`<p hidden data-show="on">x</p><a title="old" data-attr-title="off" data-attr-href="n">l</a>`, { on: true, off: false, n: 0 }))).toBe(
      `<p data-show="on">x</p><a data-attr-title="off" data-attr-href="n" href="0">l</a>`,
    )
  })

  it('class and style toggles: no class attribute when none is on, an existing style comes first, 0 is a value', () => {
    expect(
      strip(
        renderToString(`<i data-class-a="no"></i><b class="" data-class-a="no"></b><s style="color: red" data-style-width="w" data-style-opacity="z"></s>`, {
          no: false,
          w: '1px',
          z: 0,
        }),
      ),
    ).toBe(`<i data-class-a="no"></i><b class="" data-class-a="no"></b><s style="color: red; width: 1px; opacity: 0" data-style-width="w" data-style-opacity="z"></s>`)
  })

  it('leaves data-prop-* and event attributes to the browser', () => {
    const tpl = `<video data-prop-muted="m" data-on-click="x.set(1)" data-click.once="x.set(2)"></video>`
    expect(strip(renderToString(tpl, { m: true }))).toBe(tpl)
  })

  it('checks an input whose type is in capitals and selects the option matching a number', () => {
    expect(strip(renderToString(`<input type="CHECKBOX" data-value="ok"><select data-value="n"><option>1</option><option>2</option></select>`, { ok: 1, n: 2 }))).toBe(
      `<input type="CHECKBOX" data-value="ok" checked=""><select data-value="n"><option>1</option><option selected="">2</option></select>`,
    )
  })

  it('escapes data-text in <title>: raw text, but entities are decoded there', () => {
    expect(strip(renderToString(`<title data-text="t">old</title>`, { t: 'A & <B>' }))).toBe(`<title data-text="t">A &#38; &#60;B&#62;</title>`)
  })

  it('reads a ">" inside a quoted attribute value', () => {
    expect(strip(renderToString(`<a title="a>b" data-text="x">old</a><b data-text="x"></b>`, { x: 1 }))).toBe(`<a title="a>b" data-text="x">1</a><b data-text="x">1</b>`)
  })

  it('drops a stray end tag and closes what is left open at the end', () => {
    expect(strip(renderToString('a</div>b<main><p data-text="x">', { x: 1 }))).toBe('ab<main><p data-text="x">1</p></main>')
  })

  it('keeps the case of tags and closes them case-insensitively', () => {
    expect(strip(renderToString('<DIV data-text="x">old</div><UL><LI data-for="xs" data-text="."></LI></UL>', { x: 1, xs: ['a'] }))).toBe(
      '<DIV data-text="x">1</DIV><UL><template data-for="xs" data-n="1"><LI data-text="."></LI></template><LI data-text=".">a</LI></UL>',
    )
  })

  it('throws on an unknown function, a bad expression and a bad data-for, as the client does', () => {
    expect(() => renderToString(`<p data-text="x | nope"></p>`)).toThrow('CoreQuery: unknown function "nope"')
    expect(() => renderToString(`<p data-show="a == 1"></p>`)).toThrow('CoreQuery: bad expression')
    expect(() => renderToString(`<p data-for="x of xs"></p>`)).toThrow('CoreQuery: bad data-for')
  })

  it('a data-context on a data-for element is the context of each item', () => {
    expect(strip(renderToString(`<li data-for="xs" data-context=".meta" data-text=".n"></li>`, { xs: [{ meta: { n: 1 } }] }))).toBe(
      `<template data-for="xs" data-n="1"><li data-context=".meta" data-text=".n"></li></template><li data-context=".meta" data-text=".n">1</li>`,
    )
  })

  it('data-use: whitespace keeps a slot fallback, text fills the slot, a template without slots drops the children', () => {
    const tpls = `<template id="t"><b><slot>fallback</slot></b></template><template id="bare"><i>bare</i></template>`
    expect(strip(renderToString(`${tpls}<p data-use="t">  \n </p><p data-use="t">text</p><p data-use="bare"><u>gone</u></p>`))).toBe(
      `${tpls}<p><b>fallback</b></p><p><b>text</b></p><p><i>bare</i></p>`,
    )
  })
})

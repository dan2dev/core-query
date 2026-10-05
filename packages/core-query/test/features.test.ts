// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { renderToString } from '../src/server'

const tick = () => new Promise((r) => setTimeout(r))
const $ = (sel: string) => document.querySelector(sel) as HTMLElement
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[]
const texts = (sel: string) => $$(sel).map((e) => e.textContent)
const setup = (html: string, state?: object) => {
  document.body.innerHTML = html
  return createApp(state)
}
const fire = (el: EventTarget, type: string, init?: object) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), init))

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.useRealTimers()
})

describe('event modifiers', () => {
  it('.debounce runs once, with the last event, after the quiet period', () => {
    vi.useFakeTimers()
    const app = setup(`<input data-on-input.debounce.300="search.set($event.target.value)">`)
    app.mount()
    const input = $('input') as HTMLInputElement
    for (const v of ['a', 'ab', 'abc']) {
      input.value = v
      fire(input, 'input')
      vi.advanceTimersByTime(200)
    }
    expect(app.get('search')).toBeUndefined()
    vi.advanceTimersByTime(100)
    expect(app.get('search')).toBe('abc')
  })

  it('.debounce defaults to 250ms, still matches keys and prevents at once', () => {
    vi.useFakeTimers()
    const app = setup(`<input data-on-keydown.enter.debounce.prevent="n.set(1)">`)
    app.mount()
    fire($('input'), 'keydown', { key: 'a' })
    vi.advanceTimersByTime(300)
    expect(app.get('n')).toBeUndefined()
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' })
    $('input').dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    vi.advanceTimersByTime(249)
    expect(app.get('n')).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(app.get('n')).toBe(1)
  })

  it('.throttle runs at once, then ignores events until the delay passed', () => {
    vi.useFakeTimers()
    const app = setup(`<button data-click.throttle.100="xs.push(1)"></button>`, { xs: [] })
    app.mount()
    $('button').click()
    $('button').click()
    expect(app.get('xs')).toEqual([1])
    vi.advanceTimersByTime(100)
    $('button').click()
    expect(app.get('xs')).toEqual([1, 1])
  })

  it('unmount clears a pending debounce', () => {
    vi.useFakeTimers()
    const app = setup(`<button data-click.debounce="n.set(1)"></button>`)
    const unmount = app.mount()
    $('button').click()
    unmount()
    vi.advanceTimersByTime(1000)
    expect(app.get('n')).toBeUndefined()
  })

  it('.window and .document listen there, until unmount', () => {
    const app = setup(`<p data-on-ping.window="w.push(1)" data-on-pong.document="d.push(1)"></p>`, { w: [], d: [] })
    const unmount = app.mount()
    fire(window, 'ping')
    fire(document, 'pong')
    $('p').dispatchEvent(new Event('ping')) // does not bubble: the element itself is not listening
    expect(app.get()).toEqual({ w: [1], d: [1] })
    unmount()
    fire(window, 'ping')
    fire(document, 'pong')
    expect(app.get()).toEqual({ w: [1], d: [1] })
  })

  it('.once with .window removes the window listener', () => {
    const app = setup(`<p data-on-ping.window.once="w.push(1)"></p>`, { w: [] })
    app.mount()
    fire(window, 'ping')
    fire(window, 'ping')
    expect(app.get('w')).toEqual([1])
  })

  it('.outside runs only for events outside the element', () => {
    const app = setup(`<div id="menu" data-click.outside="open.set(false)"><b>in</b></div><i>out</i>`, { open: true })
    app.mount()
    $('b').click()
    $('#menu').click()
    expect(app.get('open')).toBe(true)
    $('i').click()
    expect(app.get('open')).toBe(false)
  })

  it('.outside listens in the capture phase: a .stop elsewhere does not hide the click, .once still removes it', () => {
    const app = setup(`<div id="menu" data-click.outside="n.add(1)"></div><div data-click.outside.once="m.add(1)"></div><button data-click.stop="hit.set(true)"></button>`)
    const unmount = app.mount()
    $('button').click()
    $('button').click()
    expect(app.get()).toEqual({ hit: true, n: 2, m: 1 })
    unmount()
    $('button').click()
    expect(app.get('n')).toBe(2)
  })

  it('.self runs only when the element itself is the target', () => {
    const app = setup(`<div id="back" data-click.self="n.push(1)"><b>in</b></div>`, { n: [] })
    app.mount()
    $('b').click()
    expect(app.get('n')).toEqual([])
    $('#back').click()
    expect(app.get('n')).toEqual([1])
  })
})

describe('data-transition', () => {
  /** Records the classes (and whether it was in the page) of each element at its forced reflow. */
  const reflows = () => {
    const seen: string[] = []
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      seen.push(this.getAttribute('class') + (this.isConnected ? '' : ' detached'))
      return {} as DOMRect
    })
    return seen
  }
  /** Makes elements report one running animation each; returns how to finish them all. */
  const animate = () => {
    const done: (() => void)[] = []
    ;(Element.prototype as any).getAnimations = () => [{ finished: new Promise<void>((r) => done.push(r)) }]
    return () => done.forEach((f) => f())
  }
  afterEach(() => {
    delete (Element.prototype as any).getAnimations
    vi.restoreAllMocks()
  })

  it('enter class: not on the first render, on items added later, gone after insertion', async () => {
    const app = setup(`<ul><li data-for="xs" data-transition="fade" data-text="."></li></ul><p data-if="on" data-transition>hi</p>`, { xs: ['a'], on: true })
    const seen = reflows()
    app.mount()
    await tick()
    expect(seen).toEqual([])
    expect($$('[class]')).toHaveLength(0)
    app.push('xs', 'b')
    app.set('on', false)
    await tick()
    app.set('on', true)
    await tick()
    expect(seen).toEqual(['fade-enter', 'cq-enter'])
    expect(texts('li')).toEqual(['a', 'b'])
    expect($$('[class*=enter]')).toHaveLength(0)
  })

  it('enter class on an item that is itself a block (data-for + data-if), and on SVG elements', async () => {
    const app = setup(
      `<ul><li data-for="t in todos" data-if="t.on" data-transition="fade"></li></ul><svg><circle data-for="cs" data-transition="pop"></circle></svg>`,
      { todos: [{ on: true }], cs: [] },
    )
    const seen = reflows()
    app.mount()
    app.push('todos', { on: true }, { on: false })
    app.push('cs', 1)
    await tick()
    expect(seen).toEqual(['fade-enter', 'pop-enter'])
    expect($$('li')).toHaveLength(2)
    expect($$('[class*=enter]')).toHaveLength(0)
  })

  it('leave without animations removes synchronously', async () => {
    const app = setup(`<p data-if="on" data-transition="fade">hi</p>`, { on: true })
    app.mount()
    app.set('on', false)
    await app.tick()
    expect($('p')).toBeNull()
    ;(Element.prototype as any).getAnimations = () => []
    app.set('on', true)
    await app.tick()
    app.set('on', false)
    await app.tick()
    expect($('p')).toBeNull()
  })

  it('leave waits for the animations, with the bindings already gone', async () => {
    const app = setup(`<ul><li data-for="xs" data-transition="fade" data-text="." data-click="hits.push(1)"></li></ul>`, { xs: ['a', 'b'], hits: [] })
    app.mount()
    const finish = animate()
    const b = $$('li')[1]
    app.pop('xs')
    await tick()
    expect(b.isConnected).toBe(true)
    expect(b.className).toBe('fade-leave')
    b.click()
    expect(app.get('hits')).toEqual([])
    // The list goes on without it: a new item lands before the leaving one, with its own bindings.
    app.push('xs', 'c')
    await tick()
    expect(texts('li')).toEqual(['a', 'c', 'b'])
    finish()
    await tick()
    expect(texts('li')).toEqual(['a', 'c'])
    expect(b.isConnected).toBe(false)
  })

  it('a leaving node stays in place in a keyed list, and is not counted nor adopted after unmount', async () => {
    const html = `<ul><li data-for="x in xs" data-key="x.id" data-transition data-text="x.id"></li></ul>`
    const app = setup(html, { xs: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    const unmount = app.mount()
    const finish = animate()
    const [one, two, three] = $$('li')
    app.splice('xs', 1, 1)
    await tick()
    expect($$('li')).toEqual([one, two, three]) // nothing moved
    expect(two.className).toBe('cq-leave')
    expect(three.textContent).toBe('3')
    unmount()
    expect($('template').getAttribute('data-n')).toBe('2')
    app.mount()
    app.push('xs', { id: 4 })
    await tick()
    expect(texts('li')).toEqual(['1', '2', '3', '4'])
    finish()
    await tick()
    expect(texts('li')).toEqual(['1', '3', '4'])
  })

  it('an if/else chain is found again past a leaving node', async () => {
    const app = setup(`<div><p data-if="on" data-transition>yes</p><p data-else>no</p></div>`, { on: true })
    const unmount = app.mount()
    const finish = animate()
    app.set('on', false)
    await tick()
    expect(texts('p')).toEqual(['yes', 'no'])
    unmount()
    app.mount() // would throw "data-else without data-if" if the leaving <p> broke the chain
    $('div').remove() // parent removal while leaving
    finish()
    await tick()
  })
})

describe('data-state', () => {
  it('declares local state under #name, read through the alias', async () => {
    const app = setup(
      `<div data-state-menu='{"open": false}'>
        <button data-click="menu.open.set(true)"></button>
        <p data-show="menu.open" data-text=".title"></p>
      </div>`,
      { title: 'oi' },
    )
    app.mount()
    expect(app.get('#menu')).toEqual({ open: false })
    expect($('p').hidden).toBe(true)
    expect($('p').textContent).toBe('oi') // the outer context is unchanged
    $('button').click()
    await tick()
    expect($('p').hidden).toBe(false)
  })

  it('an empty value is {}, several states fit one element, bindings on the element see them', async () => {
    const app = setup(`<div data-state-a data-state-b='{"n": 2}' data-text="b.n" data-click="a.on.set(true)"></div>`)
    app.mount()
    expect($('div').textContent).toBe('2')
    $('div').click()
    expect(app.get('#a')).toEqual({ on: true })
  })

  it('each data-for item has its own state, kept when a keyed list reorders', async () => {
    const app = setup(
      `<ul><li data-for="t in todos" data-key="t.id" data-state-ui='{"open": false}'>
        <button data-click="ui.open.set(true)" data-text="t.id"></button><i data-show="ui.open" data-text=".id"></i>
      </li></ul>`,
      { todos: [{ id: 1 }, { id: 2 }] },
    )
    app.mount()
    $$('button')[1].click()
    await tick()
    expect($$('i').map((e) => e.hidden)).toEqual([true, false])
    expect(app.get('todos.1.#ui')).toEqual({ open: true })
    expect(app.get('todos.0.#ui')).toEqual({ open: false })
    app.set('todos', [...app.get('todos')].reverse())
    await tick()
    expect(texts('button')).toEqual(['2', '1'])
    expect($$('i').map((e) => e.hidden)).toEqual([false, true])
  })

  it('a remount keeps the state', async () => {
    const app = setup(`<div data-state-menu='{"open": false}'><p data-show="menu.open"></p></div>`)
    const unmount = app.mount()
    app.set('#menu.open', true)
    unmount()
    app.mount()
    expect($('p').hidden).toBe(false)
  })

  it('is not sent by app.post', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response())
    vi.stubGlobal('fetch', fetch)
    const app = setup(`<ul><li data-for="todos" data-state-ui='{"open": true}'></li></ul>`, { todos: [{ id: 1 }] })
    app.mount()
    expect(app.get('todos.0.#ui')).toEqual({ open: true })
    await app.post('todos', '/save')
    expect(fetch.mock.calls[0][1].body).toBe('[{"id":1}]')
    vi.unstubAllGlobals()
  })

  it('throws on bad JSON and on a primitive context', () => {
    expect(() => setup(`<div data-state-menu="{open}"></div>`).mount()).toThrow('CoreQuery: bad data-state-menu')
    const app = setup(`<ul><li data-for="xs" data-state-ui></li></ul>`, { xs: ['a'] })
    expect(() => app.mount()).toThrow(/CoreQuery: data-state-ui .*"xs.0"/)
    expect(app.get('xs')).toEqual(['a'])
  })

  it('is started again when its context is replaced', async () => {
    const app = setup(`<ul><li data-for="t in todos" data-state-ui='{"open": true}'><b data-show="ui.open"></b></li></ul>`, { todos: [{ id: 1 }, { id: 2 }] })
    app.mount()
    app.set('todos', [{ id: 3 }, { id: 4 }])
    await tick()
    expect($$('b').map((e) => e.hidden)).toEqual([false, false])
    expect(app.get('todos.1.#ui')).toEqual({ open: true })
  })

  it('waits for a missing context instead of creating it', async () => {
    const app = setup(`<div data-context="user" data-state-m='{"a": 1}'><b data-text="m.a"></b></div>`)
    app.mount()
    await tick()
    expect(app.get()).toEqual({})
    app.set('user', {})
    await tick()
    expect(app.get('user.#m')).toEqual({ a: 1 })
    expect($('b').textContent).toBe('1')
  })

  it('app.click and app.render see the state scope', () => {
    const app = setup(`<section data-context="user" data-state-ui='{"n": 1}'><b></b></section>`, { user: { name: 'ana' } })
    app.mount()
    expect(app.get('user.#ui')).toEqual({ n: 1 })
    $('b').setAttribute('data-text', 'ui.n')
    app.render($('b'))
    expect($('b').textContent).toBe('1')
  })
})

describe('data-let', () => {
  // A block that takes two props and reads one inside its own loop, where `.` is the loop's item.
  const PICK = `<template id="pick"><label data-for="o in options"><input type="checkbox" data-attr-value="o" data-value="value"><span data-text="o"></span></label></template>`
  const state = () => ({ labels: ['ui', 'bug'], draft: { labels: ['bug'] }, issue: { labels: [] as string[] } })

  it('names paths for the element and its subtree: props of a data-use block, reachable inside its loops', async () => {
    const app = setup(
      `${PICK}<fieldset id="a" data-use="pick" data-let-options="labels" data-let-value="draft.labels"></fieldset>
      <fieldset id="b" data-use="pick" data-let-options="labels" data-let-value="issue.labels"></fieldset>`,
      state(),
    )
    app.mount()
    const boxes = $$('input') as HTMLInputElement[]
    expect(texts('#a span')).toEqual(['ui', 'bug'])
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false, false])
    boxes[0].click()
    boxes[3].click()
    expect(app.get('draft.labels')).toEqual(['bug', 'ui'])
    expect(app.get('issue.labels')).toEqual(['bug'])
  })

  it('renders on the server the same, and hydration adopts it without a change', async () => {
    const html = `${PICK}<fieldset data-use="pick" data-let-options="labels" data-let-value="draft.labels"></fieldset>
      <ul><li data-for="t, i in todos" data-key="t.id" data-let-title="t.title" data-let-n="i"><b data-text="title"></b><i data-text="n"></i></li></ul>`
    document.body.innerHTML = renderToString(html, { ...state(), todos: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] })
    const before = document.body.innerHTML
    expect(texts('b')).toEqual(['a', 'b'])
    expect(texts('i')).toEqual(['0', '1'])
    expect(($$('input') as HTMLInputElement[]).map((b) => b.hasAttribute('checked'))).toEqual([false, true])
    const app = createApp<any>()
    app.mount()
    expect(document.body.innerHTML).toBe(before)
    app.set('todos', [...app.get('todos')].reverse())
    await tick()
    expect(texts('b')).toEqual(['b', 'a']) // a keyed item that moved is rebound through its alias
    expect(texts('i')).toEqual(['0', '1'])
  })

  it('aliases a data-state, in attribute order: each copy of a block gets its own', async () => {
    const app = setup(
      `<template id="menu"><button data-click="menu.open.not()"></button><p data-show="menu.open"></p></template>
      <div data-use="menu" data-state-sort='{"open": false}' data-let-menu="sort"></div>
      <div data-use="menu" data-state-filter='{"open": false}' data-let-menu="filter"></div>`,
    )
    app.mount()
    $$('button')[1].click()
    await tick()
    expect($$('p').map((p) => p.hidden)).toEqual([true, false])
    expect(app.get('#filter')).toEqual({ open: true })
  })

  it('takes a path: an expression throws on both sides', () => {
    expect(() => setup(`<div data-let-x="!user.admin"><b data-text="x"></b></div>`).mount()).toThrow('CoreQuery: bad data-let-x "!user.admin"')
    expect(() => renderToString(`<div data-let-x="a | eq(1)"></div>`, { a: 1 })).toThrow('CoreQuery: bad data-let-x')
  })

  it('gives a component its path through the alias', () => {
    const app = setup(`<ul><li data-for="t in todos"><b data-let-x="t.title" data-component="c" data-value="x"></b></li></ul>`, { todos: [{ title: 'a' }] })
    const c = vi.fn()
    app.component('c', c)
    app.mount()
    expect(c.mock.calls[0][1]).toBe('todos.0.title')
  })
})

describe('registration and mistakes', () => {
  it('fn() and component() take a record: the fns renderToString takes', () => {
    const fns = { double: (v: number) => v * 2, 'ui:shout': (v: string) => v.toUpperCase() }
    const app = setup(`<b data-text="n | double"></b><i data-text="s | ui:shout"></i><u data-component="ui:mark"></u>`, { n: 2, s: 'a' })
    app.fn(fns)
    app.component({ 'ui:mark': (el) => void (el.textContent = 'marked') })
    app.mount()
    expect([$('b').textContent, $('i').textContent, $('u').textContent]).toEqual(['4', 'A', 'marked'])
    expect(renderToString(`<b data-text="n | double"></b>`, { n: 2 }, fns)).toContain('<b data-text="n | double">4</b>')
  })

  it('malformed actions throw when mounting, as bad expressions do', () => {
    expect(() => setup(`<button data-click="x.set(1"></button>`).mount()).toThrow('CoreQuery: bad actions "x.set(1"')
    expect(() => setup(`<button data-click="n.add 1"></button>`).mount()).toThrow('CoreQuery: bad actions')
    expect(() => setup(`<button data-click.stop="" data-on-input="a.set($event.target.value) b.set('x y')"></button>`).mount()).not.toThrow()
  })

  it('an unknown component is warned about, with its element; the rest still binds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = setup(`<div data-component="carousel"></div><b data-text="n"></b>`, { n: 1 })
    app.mount()
    expect(warn).toHaveBeenCalledWith('CoreQuery: unknown component "carousel"', $('div'))
    expect($('b').textContent).toBe('1')
    warn.mockRestore()
  })

  it('an unknown function names the expression it is in', () => {
    expect(() => setup(`<b data-text="n | fmt"></b>`).mount()).toThrow('CoreQuery: unknown function "fmt" in "n | fmt"')
  })

  it('router() returns the app', () => {
    const app = createApp()
    expect(app.router({ home: '/' })).toBe(app)
  })
})

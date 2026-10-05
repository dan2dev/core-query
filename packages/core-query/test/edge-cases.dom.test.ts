// @vitest-environment happy-dom
// Edge cases of the browser binder: form bindings, actions, blocks, data-use, components, requests and the router.
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
const write = (el: Element, value: string, type = 'input') => {
  ;(el as HTMLInputElement).value = value
  el.dispatchEvent(new Event(type))
}
const res = (body: unknown, status = 200) => ({ ok: status < 300, status, statusText: 'S' + status, json: async () => body }) as Response

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('form binding edges', () => {
  it('a range input stores numbers; a number input that is emptied stores ""', () => {
    const app = setup(`<input type="range" data-value="r"><input type="number" data-value="n">`, { r: 5, n: 3 })
    app.mount()
    const [r, n] = $$('input')
    write(r, '7')
    write(n, '')
    expect(app.get()).toEqual({ r: 7, n: '' })
  })

  it('radios and selects match a number by its text, and store the string they hold', () => {
    const app = setup(
      `<input type="radio" name="r" value="1" data-value="r"><input type="radio" name="r" value="2" data-value="r">` +
        `<select data-value="s"><option>1</option><option>2</option></select>`,
      { r: 2, s: 2 },
    )
    app.mount()
    const [one, two] = $$('input') as HTMLInputElement[]
    expect([one.checked, two.checked, ($('select') as HTMLSelectElement).value]).toEqual([false, true, '2'])
    one.click()
    write($('select'), '1', 'change')
    expect(app.get()).toEqual({ r: '1', s: '1' })
  })

  it('a checkbox bound to an array never adds its value twice, and matches numbers by their text', () => {
    const app = setup(`<input type="checkbox" value="a" data-value="tags"><input type="checkbox" value="1" data-value="ids">`, { tags: ['a'], ids: [1, 2] })
    app.mount()
    const [a, one] = $$('input') as HTMLInputElement[]
    expect([a.checked, one.checked]).toEqual([true, true])
    a.dispatchEvent(new Event('change')) // still checked: a scripted change
    one.click() // unchecked: the number 1 leaves
    expect(app.get()).toEqual({ tags: ['a'], ids: [2] })
  })

  it('a <select multiple> bound to a value that is not an array selects nothing', () => {
    const app = setup(`<select multiple data-value="v"><option selected>a</option><option>b</option></select>`, { v: 'a' })
    app.mount()
    expect([...($('select') as HTMLSelectElement).options].map((o) => o.selected)).toEqual([false, false])
  })

  it('data-value wins over data-bind; an undefined value empties the control', () => {
    const app = setup(`<input data-value="a" data-bind="b"><input data-value="missing" value="x">`, { a: 'A', b: 'B' })
    app.mount()
    expect(($$('input') as HTMLInputElement[]).map((i) => i.value)).toEqual(['A', ''])
  })

  it('bind() resolves a relative path in the context of the element', () => {
    const app = setup(`<div data-context="user"><input></div>`, { user: { name: 'Ana' } })
    app.mount()
    app.bind($('input'), '.name')
    expect(($('input') as HTMLInputElement).value).toBe('Ana')
    write($('input'), 'Bia')
    expect(app.get('user.name')).toBe('Bia')
  })
})

describe('action edges', () => {
  it('a method without a path acts on the context: an item deletes itself', () => {
    const app = setup(`<ul><li data-for="xs"><button data-click="delete()"></button></li></ul><div data-context="o"><button id="s" data-click="set('x')"></button></div>`, {
      xs: ['a', 'b'],
      o: 1,
    })
    app.mount()
    $$('li button')[0].click()
    $('#s').click()
    expect(app.get()).toEqual({ xs: ['b'], o: 'x' })
  })

  it('a quoted ")" or space stays inside its argument', () => {
    const app = setup(`<button data-click="a.set(') (') b.set(&quot;x y&quot;)"></button>`)
    app.mount()
    $('button').click()
    expect(app.get()).toEqual({ a: ') (', b: 'x y' })
  })

  it('$event is the event; "$eventual" is a state path', () => {
    const app = setup(`<button data-click="x.set($eventual) t.set($event.type)"></button>`, { $eventual: 1 })
    app.mount()
    $('button').click()
    expect(app.get()).toMatchObject({ x: 1, t: 'click' })
  })

  it('a function that returns undefined writes nothing', () => {
    const app = setup(`<button data-click="x.peek() y.peek()"></button>`, { y: 1 })
    const peek = vi.fn()
    app.fn('peek', peek)
    app.mount()
    $('button').click()
    expect(Object.keys(app.get())).toEqual(['y'])
    expect(peek.mock.calls).toEqual([[undefined], [1]])
  })

  it('key modifiers: "space" for " ", names in any case, a digit is a key unless it follows debounce/throttle', () => {
    const app = setup(`<input data-on-keydown.space="log.push('space')" data-on-keydown.arrowup="log.push('up')" data-on-keydown.1="log.push('one')">`, { log: [] })
    app.mount()
    for (const key of [' ', 'ArrowUp', '1', '2']) $('input').dispatchEvent(new KeyboardEvent('keydown', { key }))
    expect(app.get('log')).toEqual(['space', 'up', 'one'])
  })

  it('.throttle defaults to 250ms', () => {
    vi.useFakeTimers()
    const app = setup(`<button data-click.throttle="n.add(1)"></button>`, { n: 0 })
    app.mount()
    $('button').click()
    vi.advanceTimersByTime(249)
    $('button').click()
    vi.advanceTimersByTime(1)
    $('button').click()
    expect(app.get('n')).toBe(2)
  })

  it('data-on-mount runs again each time a data-if shows its element', async () => {
    const app = setup(`<p data-if="on" data-on-mount="n.add(1)"></p>`, { on: true, n: 0 })
    app.mount()
    await tick()
    app.set('on', false)
    await tick()
    app.set('on', true)
    await tick()
    expect(app.get('n')).toBe(2)
  })
})

describe('block edges', () => {
  it('data-for over a value that is not an array renders nothing, and follows it becoming one and back', async () => {
    const app = setup(`<ul><li data-for="xs" data-text="."></li></ul>`, { xs: 'abc' })
    app.mount()
    expect($$('li')).toHaveLength(0)
    app.set('xs', ['a'])
    await app.tick()
    expect(texts('li')).toEqual(['a'])
    for (const v of [{ 0: 'x', length: 1 }, null]) {
      app.set('xs', v)
      await app.tick()
      expect($$('li')).toHaveLength(0)
    }
  })

  it('items with the same key, or none, still get one element each', async () => {
    const app = setup(`<ul><li data-for="x in xs" data-key="x.k" data-text="x.v"></li></ul>`, {
      xs: [{ k: 1, v: 'a' }, { k: 1, v: 'b' }, { v: 'c' }, { v: 'd' }],
    })
    app.mount()
    expect(texts('li')).toEqual(['a', 'b', 'c', 'd'])
    app.push('xs', { k: 1, v: 'e' })
    app.shift('xs')
    await app.tick()
    expect(texts('li')).toEqual(['b', 'c', 'd', 'e'])
  })

  it('a keyed list keeps its elements when the array is replaced by new objects with the same keys', async () => {
    const app = setup(`<ul><li data-for="t in ts" data-key="t.id" data-text="t.title"></li></ul>`, { ts: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] })
    app.mount()
    const lis = $$('li')
    app.set('ts', [{ id: 1, title: 'A' }, { id: 2, title: 'B' }])
    await app.tick()
    expect($$('li').every((li, i) => li === lis[i])).toBe(true)
    expect(texts('li')).toEqual(['A', 'B'])
  })

  it('a block drops its items before their bindings run, also those reached through an outer path', async () => {
    // `unit` changes first: its row bindings would otherwise read rows at indices that are no longer theirs.
    const app = setup(`<ul><li data-for="r in rows" data-key="r.id" data-text="r | label(unit)"></li></ul><p data-if="user"><b data-text="user | label(unit)"></b></p>`, {
      unit: 'kg',
      rows: [{ id: 1, n: 1 }, { id: 2, n: 2 }],
      user: { n: 9 },
    })
    const missing: unknown[] = []
    app.fn('label', (x, u) => (x == null ? missing.push(x) : x.n + u))
    app.mount()
    app.set('unit', 'g')
    app.set('rows', [{ id: 3, n: 3 }])
    app.set('user', null)
    await app.tick()
    expect(missing).toEqual([])
    expect(texts('li')).toEqual(['3g'])
    expect($('b')).toBeNull()
  })

  it('a keyed insertion in the middle creates one element and keeps the others', async () => {
    const app = setup(`<ul><li data-for="t in ts" data-key="t.id" data-text="t.id"></li></ul>`, { ts: [{ id: 1 }, { id: 3 }] })
    app.mount()
    const [one, three] = $$('li')
    app.splice('ts', 1, 0, { id: 2 })
    await app.tick()
    const lis = $$('li')
    expect(texts('li')).toEqual(['1', '2', '3'])
    expect([lis[0] === one, lis[2] === three]).toEqual([true, true])
  })

  it('if / else-if / else-if / else shows only the first true branch, client and SSR', async () => {
    const tpl = `<div><p data-if="a">A</p><p data-else-if="b">B</p><p data-else-if="c">C</p><p data-else>D</p></div>`
    for (const ssr of [false, true]) {
      const state = { a: false, b: true, c: true }
      document.body.innerHTML = ssr ? renderToString(tpl, state) : tpl
      const app = createApp<any>(ssr ? {} : state)
      app.mount()
      expect(texts('p')).toEqual(['B'])
      app.set('b', false)
      await app.tick()
      expect(texts('p')).toEqual(['C'])
      app.set('c', false)
      await app.tick()
      expect(texts('p')).toEqual(['D'])
      app.set('a', true)
      app.set('c', true)
      await app.tick()
      expect(texts('p')).toEqual(['A'])
    }
  })

  it('an element between data-if and data-else, or a second data-else, breaks the chain on both sides', () => {
    for (const tpl of [`<p data-if="a">A</p><hr><p data-else>B</p>`, `<p data-if="a">A</p><p data-else>B</p><p data-else>C</p>`]) {
      expect(() => setup(tpl).mount()).toThrow('CoreQuery: data-else without data-if')
      expect(() => renderToString(tpl)).toThrow('CoreQuery: data-else without data-if')
    }
  })

  it('a <template data-if> shows all its elements, client and SSR', async () => {
    const tpl = `<div><template data-if="on"><b>1</b><i>2</i></template><u>end</u></div>`
    const shown = () => [...$('div').children].filter((e) => e.localName !== 'template').map((e) => e.textContent)
    for (const ssr of [false, true]) {
      document.body.innerHTML = ssr ? renderToString(tpl, { on: true }) : tpl
      const app = createApp<any>(ssr ? {} : { on: true })
      app.mount()
      expect(shown()).toEqual(['1', '2', 'end'])
      app.set('on', false)
      await app.tick()
      expect(shown()).toEqual(['end'])
    }
  })

  it('a data-context on a data-for element is the context of each item, as on the server', async () => {
    const tpl = `<ul><li data-for="xs" data-context=".meta" data-text=".n"></li></ul>`
    const app = setup(tpl, { xs: [{ meta: { n: 1 } }, { meta: { n: 2 } }] })
    app.mount()
    expect(texts('li')).toEqual(['1', '2'])
    app.set('xs.1.meta.n', 3)
    await app.tick()
    expect(texts('li')).toEqual(['1', '3'])
  })

  it('nested data-context: a relative one joins the outer, an absolute one leaves it', () => {
    const app = setup(`<div data-context="a"><div data-context=".b"><i data-text=".c"></i></div><div data-context="x"><u data-text="."></u></div></div>`, { a: { b: { c: 1 } }, x: 2 })
    app.mount()
    expect([$('i').textContent, $('u').textContent]).toEqual(['1', '2'])
  })
})

describe('data-use, data-state, attributes and components', () => {
  it('data-use: whitespace keeps a slot fallback, text fills the slot, a template without slots drops the children, as on the server', () => {
    const tpl =
      `<template id="t"><b><slot>fallback</slot></b></template><template id="bare"><i>bare</i></template>` +
      `<p data-use="t">  \n </p><p data-use="t">text</p><p data-use="bare"><u>gone</u></p>`
    for (const html of [tpl, renderToString(tpl)]) {
      document.body.innerHTML = html
      createApp().mount()
      expect($$('p').map((p) => p.innerHTML)).toEqual(['<b>fallback</b>', '<b>text</b>', '<i>bare</i>'])
    }
  })

  it('data-state leaves a value the state already has, e.g. one given to createApp', () => {
    const app = setup(`<div data-state-menu='{"open": false}'><p data-show="menu.open"></p></div>`, { '#menu': { open: true } })
    app.mount()
    expect($('p').hidden).toBe(false)
  })

  it('data-attr-* writes objects as JSON and numbers as text; data-prop-* camel-cases its name and sets the value itself', () => {
    const app = setup(`<div data-attr-data-x="o" data-attr-tabindex="n" data-prop-foo-bar="o"></div>`, { o: { a: 1 }, n: 0 })
    app.mount()
    const div = $('div')
    expect([div.getAttribute('data-x'), div.getAttribute('tabindex')]).toEqual(['{"a":1}', '0'])
    expect((div as any).fooBar).toBe(app.get('o'))
  })

  it('a component may remove its element: the siblings after it still bind', () => {
    const app = setup(`<div><i data-component="gone"></i><b data-text="n"></b></div>`, { n: 1 })
    app.component('gone', (el) => el.remove())
    app.mount()
    expect([$('i'), $('b').textContent]).toEqual([null, '1'])
  })

  it('the promise of an async component is not taken for a cleanup', () => {
    const app = setup(`<i data-component="late"></i>`)
    app.component('late', async (el) => void (el.textContent = 'x'))
    const unmount = app.mount()
    expect(() => unmount()).not.toThrow()
  })

  it('render(el, ".x") resolves the path in the context of the element', () => {
    const app = setup(`<section data-context="user"><div id="later"></div></section>`, { user: { address: { city: 'Rio' } } })
    app.mount()
    $('#later').innerHTML = '<b data-text=".city"></b>'
    app.render($('#later'), '.address')
    expect($('b').textContent).toBe('Rio')
  })

  it('hydration merges the server state over the initial state by top-level key', () => {
    document.body.innerHTML = renderToString(`<b data-text="a.x"></b>`, { a: { x: 2 }, s: 1 })
    const app = createApp<any>({ a: { y: 1 }, c: 1 })
    app.mount()
    expect(app.get()).toEqual({ a: { x: 2 }, s: 1, c: 1 })
  })
})

describe('request edges', () => {
  it("an item's flags sit next to it, at #<index>, and stay out of its JSON", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ id: 1, fresh: true })))
    const app = createApp({ todos: [{ id: 1 }] })
    await app.send('todos.0', 'GET', '/t/1')
    expect(app.get('todos.#0')).toEqual({ loading: false, error: null })
    expect(app.get('todos.length')).toBe(1)
    expect(JSON.stringify(app.get('todos'))).toBe('[{"id":1,"fresh":true}]')
  })

  it('a GET answer that is not JSON sets the error with its status and stores nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse('<html>') })))
    const app = createApp({ list: [1] })
    await expect(app.send('list', 'GET', '/l')).rejects.toThrow(SyntaxError)
    expect(app.get('list')).toEqual([1])
    expect(app.get('#list')).toMatchObject({ loading: false, error: { status: 200 } })
  })

  it('a GET answer is dropped when the value was set meanwhile', async () => {
    let answer!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (answer = r))))
    const app = createApp({ q: 'old' })
    const p = app.send('q', 'GET', '/q')
    app.set('q', 'typed')
    answer(res('server'))
    await p
    expect(app.get('q')).toBe('typed')
  })

  it('requests for different paths do not abort each other', async () => {
    const answers: ((r: Response) => void)[] = []
    const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((r) => answers.push(r)))
    vi.stubGlobal('fetch', fetch)
    const app = createApp<any>()
    const a = app.send('a', 'GET', '/a')
    const b = app.send('b', 'GET', '/b')
    expect(fetch.mock.calls.map((c) => c[1].signal!.aborted)).toEqual([false, false])
    answers[1](res(2))
    answers[0](res(1))
    await Promise.all([a, b])
    expect(app.get()).toMatchObject({ a: 1, b: 2 })
  })

  it('send and post keep a content-type they are given; post takes another method from init', async () => {
    const calls: unknown[][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => (calls.push([init.method, new Headers(init.headers).get('content-type')]), res({}))),
    )
    const app = createApp({ f: { a: 1 } })
    await app.send('f', 'POST', '/x', { headers: { 'Content-Type': 'text/plain' } })
    await app.post('f', '/x', { method: 'PUT', headers: { 'content-type': 'application/merge-patch+json' } })
    expect(calls).toEqual([
      ['POST', 'text/plain'],
      ['PUT', 'application/merge-patch+json'],
    ])
  })
})

describe('router edges', () => {
  const routes = { home: '/', user: '/users/:id' }
  /** Whether the click was prevented by the time it reached the window; then it is, so happy-dom does not follow the link. */
  const click = (el: Element, init?: MouseEventInit) => {
    let prevented = false
    addEventListener('click', (e) => ((prevented = e.defaultPrevented), e.preventDefault()), { once: true })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    return prevented
  }

  it('leaves to the browser: target, download, another button, a click already prevented, an anchor in the page', () => {
    history.replaceState(null, '', '/users/7')
    document.body.innerHTML =
      `<div id="app"><a id="t" href="/" target="_blank">t</a><a id="d" href="/" download>d</a>` +
      `<a id="h" href="#sec">h</a><a id="p" href="/" data-click.prevent="">p</a><a id="ok" href="/"><span>in</span></a></div>`
    const app = createApp()
    app.router(routes)
    const unmount = app.mount($('#app'))
    expect([click($('#t')), click($('#d')), click($('#h')), click($('#ok'), { button: 1 })]).toEqual([false, false, false, false])
    expect(click($('#p'))).toBe(true) // by its own .prevent
    expect(location.pathname).toBe('/users/7')
    expect(click($('#ok span'))).toBe(true) // a click inside the link
    expect(location.pathname).toBe('/')
    unmount()
  })

  it('go(url, true) replaces the history entry; go scrolls to the top, popstate does not', async () => {
    history.replaceState(null, '', '/')
    document.body.innerHTML = `<div id="app"></div>`
    const app = createApp()
    app.router(routes)
    const unmount = app.mount($('#app'))
    const scroll = vi.spyOn(globalThis, 'scrollTo').mockImplementation(() => {})
    const push = vi.spyOn(history, 'pushState')
    const replace = vi.spyOn(history, 'replaceState')
    await app.go('/users/1', true)
    expect([push.mock.calls.length, replace.mock.calls.length, app.get('route.params.id')]).toEqual([0, 1, '1'])
    await app.go('/users/2')
    expect([push.mock.calls.length, scroll.mock.calls.length]).toEqual([1, 2])
    history.back()
    dispatchEvent(new Event('popstate'))
    await tick()
    expect(scroll).toHaveBeenCalledTimes(2)
    unmount()
  })

  const pages = (name: string) => `/pages/${name}.html`
  /** Answers a page's state as {} and its template as `<h1>name</h1>`, when `go()` is called (or at once). */
  const serve = (wait = false) => {
    const answers: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string, init?: RequestInit) =>
          new Promise((r) => {
            const answer = () => r(init ? { ok: true, json: async () => ({}) } : { ok: true, text: async () => `<h1>${url.slice(7, -5)}</h1>` })
            wait ? answers.push(answer) : answer()
          }),
      ),
    )
    return answers
  }

  it('with pages, an unmount while a page loads leaves the outlet alone and reloads nothing', async () => {
    history.replaceState(null, '', '/')
    document.body.innerHTML = `<div id="app"><main data-page><h1>home</h1></main></div>`
    const answers = serve(true)
    const reload = vi.spyOn(location, 'reload').mockImplementation(() => {})
    const app = createApp()
    app.router(routes, { pages })
    const unmount = app.mount($('#app'))
    const done = app.go('/users/1')
    unmount()
    answers.forEach((f) => f())
    await done
    expect([$('h1').textContent, reload.mock.calls.length]).toEqual(['home', 0])
  })

  it('with pages, the new page is shown even when a cleanup of the old one throws', async () => {
    history.replaceState(null, '', '/')
    document.body.innerHTML = `<div id="app"><main data-page><h1 data-component="boom">home</h1></main></div>`
    serve()
    const app = createApp()
    app.component('boom', () => () => {
      throw Error('cleanup failed')
    })
    app.router(routes, { pages })
    const unmount = app.mount($('#app'))
    await expect(app.go('/users/1')).rejects.toThrow('cleanup failed')
    expect($('h1').textContent).toBe('user')
    unmount()
  })
})

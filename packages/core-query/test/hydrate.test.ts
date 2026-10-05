// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { createApp } from '../src/index'
import { renderToString } from '../src/server'

const tick = () => new Promise((r) => setTimeout(r))

const TODO = `
  <div class="app">
    <div data-context="draft"><input type="text" data-value=".title"></div>
    <input type="button" data-click="list.push(draft) draft.title.set('')" value="ADD">
    <p data-show="!list.length">nothing to do</p>
    <ul>
      <li data-for="item, i in list"><input type="checkbox" data-value="item.done">
        <span data-text="i"></span> <span data-text="item.title" data-attr-class="item.color"></span>
        <input type="button" data-click=".delete()" value="x"></li>
      <li class="footer">footer</li>
    </ul>
  </div>`

it('hydrates server markup without touching the DOM, then stays interactive', async () => {
  const state = {
    draft: { title: 'unsaved' },
    list: [
      { title: 'bread', done: true, color: 'red' },
      { title: 'milk', done: false },
    ],
  }
  document.body.innerHTML = renderToString(TODO, state)
  const before = document.body.innerHTML
  const items = [...document.querySelectorAll('li')]

  const mutations: MutationRecord[] = []
  const mo = new MutationObserver((r) => mutations.push(...r))
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })

  const app = createApp() // no state: it comes from the embedded script
  app.mount()
  await tick()
  mutations.push(...mo.takeRecords())
  expect(mutations).toEqual([])
  expect(document.body.innerHTML).toBe(before)
  expect(app.get()).toEqual(state)
  expect([...document.querySelectorAll('li')]).toEqual(items) // same nodes adopted

  const input = document.querySelector('[data-value=".title"]') as HTMLInputElement
  expect(input.value).toBe('unsaved')
  input.value = 'café'
  input.dispatchEvent(new Event('input'))
  ;(document.querySelector('[value=ADD]') as HTMLElement).click()
  ;(document.querySelectorAll('li [value=x]')[0] as HTMLElement).click()
  await tick()
  mo.disconnect()

  const spans = [...document.querySelectorAll('li span[data-text="item.title"]')].map((s) => s.textContent)
  expect(spans).toEqual(['milk', 'café'])
  expect(document.querySelector('li span')?.textContent).toBe('0')
  expect(document.querySelectorAll('li')[2].className).toBe('footer')
  expect(document.querySelector('p')?.hidden).toBe(true)
  expect(input.value).toBe('')
  expect(app.get('list.1')).toEqual({ title: 'café' }) // a copy, not the draft object
})

it('renders from scratch when there is no server state', () => {
  document.body.innerHTML = TODO
  const app = createApp({ list: [{ title: 'x' }] })
  app.mount()
  expect(document.querySelectorAll('li')).toHaveLength(2)
  expect(document.querySelector('p')?.hidden).toBe(true)
})

it('hydrates every state script, also when it sits outside the mount root, and only once', async () => {
  const page = renderToString(
    `<html><body><div id="app"><h1 data-text="title"></h1><ul><li data-for="list" data-text="."></li></ul></div></body></html>`,
    { title: 'Hi', list: ['a', 'b'] },
  )
  document.body.innerHTML = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))
  const app = createApp()
  const unmount = app.mount(document.querySelector('#app')!)
  expect(document.querySelector('#app')!.textContent).toBe('Hiab')
  app.push('list', 'c')
  unmount()
  app.mount(document.querySelector('#app')!)
  await tick()
  expect(app.get('list')).toEqual(['a', 'b', 'c'])

  document.body.innerHTML =
    renderToString(`<span data-text="user.name"></span>`, { user: { name: 'Ana' } }) +
    renderToString(`<ul><li data-for="todos" data-text="."></li></ul>`, { todos: ['x', 'y'] })
  const two = createApp()
  two.mount()
  await tick()
  expect(document.querySelector('span')!.textContent).toBe('Ana')
  expect([...document.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['x', 'y'])
})

it('hydrates and renders lists inside <svg>', async () => {
  const svg = `<svg><circle data-for="p in ps" data-attr-cx="p.x" r="1"></circle></svg>`
  const state = { ps: [{ x: 1 }, { x: 2 }] }
  document.body.innerHTML = renderToString(svg, state)
  const circles = [...document.querySelectorAll('svg > circle')]
  const mo = new MutationObserver(() => {})
  mo.observe(document.body, { subtree: true, childList: true, attributes: true })
  const app = createApp()
  app.mount()
  await tick()
  expect(mo.takeRecords()).toEqual([])
  expect([...document.querySelectorAll('svg > circle')]).toEqual(circles)
  app.push('ps', { x: 3 })
  await tick()
  expect([...document.querySelectorAll('svg > circle')].map((c) => c.getAttribute('cx'))).toEqual(['1', '2', '3'])

  document.body.innerHTML = svg // client-only render of the same template
  createApp(state).mount()
  expect([...document.querySelectorAll('svg > circle')].map((c) => c.getAttribute('cx'))).toEqual(['1', '2'])
})

it("never hydrates from another app's state", () => {
  const list = (id: string) => `<div id="${id}"><ul><li data-for="items" data-text="."></li></ul></div>`
  document.body.innerHTML = renderToString(list('cart'), { items: ['tv', 'radio'] }) + renderToString(list('wish'), { items: ['book'] })
  createApp().mount(document.querySelector('#cart')!)
  createApp().mount(document.querySelector('#wish')!)
  const texts = (id: string) => [...document.querySelectorAll(`#${id} li`)].map((li) => li.textContent)
  expect([texts('cart'), texts('wish')]).toEqual([['tv', 'radio'], ['book']])

  document.body.innerHTML = `<section>${renderToString(list('ssr'), { items: ['tv'] })}</section>${list('csr')}`
  createApp().mount(document.querySelector('section')!)
  const csr = createApp({ items: [] })
  csr.mount(document.querySelector('#csr')!)
  expect(csr.get('items')).toEqual([])
  expect(texts('csr')).toEqual([])
})

it('data-show toggles the hidden attribute, also on SVG and after SSR', async () => {
  const tpl = `<svg><g data-show="on"><rect></rect></g></svg><p data-show="!on">off</p>`
  for (const html of [tpl, renderToString(tpl, { on: false })]) {
    document.body.innerHTML = html
    const app = createApp({ on: false })
    app.mount()
    const [g, p] = [document.querySelector('g')!, document.querySelector('p')!]
    expect([g.hasAttribute('hidden'), p.hidden]).toEqual([true, false])
    app.set('on', true)
    await tick()
    expect([g.hasAttribute('hidden'), p.hidden]).toEqual([false, true])
  }
})

it('a classic script at the end of <body> already finds the server state', () => {
  const page = renderToString(
    `<html><body><div id="app"><h1 data-text="title"></h1><ul><li data-for="list" data-text="."></li></ul></div><script src="/app.js"></script></body></html>`,
    { title: 'Server title', list: ['one', 'two'] },
  )
  // What the page holds when /app.js runs: everything before its tag.
  const body = page.slice(page.indexOf('<body>') + 6, page.indexOf('<script src="/app.js">'))
  document.body.innerHTML = body
  createApp({ list: [] }).mount(document.querySelector('#app')!)
  expect(document.querySelector('h1')!.textContent).toBe('Server title')
  expect([...document.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two'])
})

it('hydrates state keys literally, whatever they look like', () => {
  const state = { title: 'Hello', items: ['a', 'b'], constructor: 1, '': 'x', 'title.x': 1, ['__proto__']: { polluted: 1 } }
  document.body.innerHTML = renderToString(`<h1 data-text="title"></h1><ul><li data-for="x in items" data-text="x"></li></ul>`, state)
  const app = createApp()
  app.mount()
  expect(document.querySelector('h1')!.textContent).toBe('Hello')
  expect([...document.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b'])
  expect(({} as any).polluted).toBeUndefined()
})

it('data-text replaces placeholder markup even when the value is empty, like SSR', () => {
  const tpl = `<h2 data-text="user.name"><span class="skeleton"></span></h2>`
  for (const html of [tpl, renderToString(tpl, { user: { name: '' } })]) {
    document.body.innerHTML = html
    createApp({ user: { name: '' } }).mount()
    expect(document.querySelector('h2')!.innerHTML).toBe('')
  }
})

it('data-value on a loop index shows the index in form controls, like SSR', () => {
  const tpl = `<ul><li data-for="row, i in rows"><input readonly data-value="i"><input type="checkbox" data-value="i"></li></ul>`
  for (const html of [tpl, renderToString(tpl, { rows: ['a', 'b'] })]) {
    document.body.innerHTML = html
    createApp({ rows: ['a', 'b'] }).mount()
    const inputs = [...document.querySelectorAll('input')] as HTMLInputElement[]
    expect(inputs.map((x) => (x.type === 'checkbox' ? x.checked : x.value))).toEqual(['0', false, '1', true])
    expect(inputs.every((x) => !x.childNodes.length)).toBe(true)
  }
})

it('hydrates data-if chains, keyed lists, data-use and toggles without touching the DOM', async () => {
  const tpl =
    `<template id="tag"><b data-text="."></b></template>` +
    `<p data-if="open" data-class-on="open" data-style-color="color">open</p><p data-else>closed</p>` +
    `<ul><li data-for="t in todos" data-key="t.id"><span data-use="tag" data-context="t.title"></span>` +
    `<input type="checkbox" value="x" data-value="t.tags"></li></ul>` +
    `<select multiple data-value="picked"><option>a</option><option>b</option></select>`
  const state = {
    open: true,
    color: 'red',
    todos: [
      { id: 1, title: 'a', tags: ['x'] },
      { id: 2, title: 'b', tags: [] },
    ],
    picked: ['b'],
  }
  document.body.innerHTML = renderToString(tpl, state)
  const before = document.body.innerHTML
  const lis = [...document.querySelectorAll('li')]
  const mo = new MutationObserver(() => {})
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  const app = createApp()
  app.mount()
  await app.tick()
  expect(mo.takeRecords()).toEqual([])
  expect(document.body.innerHTML).toBe(before)
  mo.disconnect()

  app.set('open', false)
  app.set('todos', [app.get('todos.1'), app.get('todos.0')])
  await app.tick()
  expect(document.querySelector('p')!.textContent).toBe('closed')
  expect([...document.querySelectorAll('li')]).toEqual([lis[1], lis[0]])
  expect([...document.querySelectorAll('li b')].map((b) => b.textContent)).toEqual(['b', 'a'])
  expect([...document.querySelectorAll('li input')].map((i) => (i as HTMLInputElement).checked)).toEqual([false, true])
})

it('hydrates a list whose items each have a data-if', async () => {
  const tpl = `<ul><li data-for="t in ts" data-key="t.id" data-if="t.ok" data-text="t.id"></li><li>end</li></ul>`
  document.body.innerHTML = renderToString(tpl, { ts: [{ id: 1, ok: true }, { id: 2 }, { id: 3, ok: true }] })
  const mo = new MutationObserver(() => {})
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  const app = createApp()
  app.mount()
  await app.tick()
  expect(mo.takeRecords()).toEqual([])
  mo.disconnect()
  expect([...document.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['1', '3', 'end'])
  app.set('ts.1.ok', true)
  app.set('ts.0.ok', false)
  await app.tick()
  expect([...document.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['2', '3', 'end'])
})

it('a state read before the element that declares it hydrates to the same HTML', async () => {
  document.body.innerHTML = renderToString(`<b data-show="#menu.open">open</b><div data-state-menu='{"open": true}'></div>`)
  const before = document.body.innerHTML
  expect(before).not.toContain('hidden')
  const app = createApp()
  app.mount()
  await app.tick()
  expect(document.body.innerHTML).toBe(before)
})

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { renderToString } from '../src/server'

const tick = () => new Promise((r) => setTimeout(r))
const $ = (sel: string) => document.querySelector(sel) as HTMLElement
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[]
const texts = (sel: string) => $$(sel).map((e) => e.textContent)
const type = (el: HTMLElement, value: string) => {
  ;(el as HTMLInputElement).value = value
  el.dispatchEvent(new Event('input'))
}
const setup = (html: string, state?: object) => {
  document.body.innerHTML = html
  const app = createApp(state)
  return app
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('legacy TODO app (thesis fig. 20)', () => {
  const html = `
    <div class="app">
      <div class="insertItem">
        <input type="text" data-value="description">
        <input type="button" data-click="list.push(description) description.set('')" value="ADD">
      </div>
      <ul>
        <li data-for="list">
          <input data-click=".delete()" type="button" value="x" />
          <span data-text="."></span>
        </li>
      </ul>
    </div>`

  it('adds, clears and deletes items with zero JS', async () => {
    const app = setup(html)
    app.mount()
    const input = $('[data-value]') as HTMLInputElement
    for (const t of ['bread', 'milk', 'café']) {
      type(input, t)
      $('[value=ADD]').click()
      await tick()
    }
    expect(texts('li span')).toEqual(['bread', 'milk', 'café'])
    expect(input.value).toBe('')
    expect(app.get()).toEqual({ description: '', list: ['bread', 'milk', 'café'] })

    $$('li input')[1].click()
    await tick()
    expect(texts('li span')).toEqual(['bread', 'café'])
    expect($$('li')).toHaveLength(2)
  })
})

describe('templates', () => {
  it('data-context scopes relative paths (fig. 10)', async () => {
    const app = setup(
      `<div data-context="person"><input data-value=".name"><b data-text=".name"></b><i data-text="other"></i></div>`,
      { person: { name: 'Ana' }, other: 'x' },
    )
    app.mount()
    expect($('b').textContent).toBe('Ana')
    expect(($('input') as HTMLInputElement).value).toBe('Ana')
    expect($('i').textContent).toBe('x')
    type($('input'), 'Bia')
    await tick()
    expect(app.get('person.name')).toBe('Bia')
    expect($('b').textContent).toBe('Bia')
  })

  it('data-bind + data-on-click + "item in list" (fig. 12)', async () => {
    const app = setup(`
      <input type="text" data-bind="task">
      <input type="button" data-on-click="tasks.push(task)">
      <ul><li data-for="item in tasks"><span data-text="item"></span></li></ul>`)
    app.mount()
    type($('[data-bind]'), 'study')
    $('[data-on-click]').click()
    await tick()
    expect(texts('li span')).toEqual(['study'])
  })

  it('index aliases, nested loops and outer aliases', async () => {
    const app = setup(
      `<div data-for="g, i in groups"><h2 data-text="g.name"></h2>
         <p data-for="m in g.members"><span data-text="i"></span>-<span data-text="m"></span></p></div>`,
      { groups: [{ name: 'A', members: ['a1', 'a2'] }, { name: 'B', members: ['b1'] }] },
    )
    app.mount()
    expect(texts('h2')).toEqual(['A', 'B'])
    expect($$('p').map((p) => p.textContent)).toEqual(['0-a1', '0-a2', '1-b1'])
    app.push('groups.1.members', 'b2')
    app.shift('groups')
    await tick()
    expect(texts('h2')).toEqual(['B'])
    expect($$('p').map((p) => p.textContent)).toEqual(['0-b1', '0-b2'])
  })

  it('accepts <template data-for> and keeps static siblings', async () => {
    const app = setup(`<ul><template data-for="xs"><li data-text="."></li></template><li id="end">end</li></ul>`, {
      xs: [1, 2],
    })
    app.mount()
    expect($$('li').map((l) => l.textContent)).toEqual(['1', '2', 'end'])
    app.set('xs', [3])
    await tick()
    expect($$('li').map((l) => l.textContent)).toEqual(['3', 'end'])
  })

  it('reuses item nodes by index and disposes removed ones', async () => {
    const app = setup(`<ul><li data-for="xs" data-text="."></li></ul>`, { xs: ['a', 'b', 'c'] })
    app.mount()
    const first = $('li')
    app.delete('xs.0')
    await tick()
    expect($('li')).toBe(first)
    expect(texts('li')).toEqual(['b', 'c'])
  })

  it('data-show, data-attr-* and literal action args', async () => {
    const app = setup(
      `<p data-show="!xs.length">empty</p><a data-attr-href="link" data-attr-aria-busy="busy">l</a>
       <button data-click="n.set(42) ok.set(true) s.set('a b') xs.push(1)">go</button>`,
      { link: '/a', busy: false },
    )
    app.mount()
    expect($('p').hidden).toBe(false)
    expect($('a').getAttribute('href')).toBe('/a')
    expect($('a').hasAttribute('aria-busy')).toBe(false)
    $('button').click()
    app.set('busy', true)
    await tick()
    expect(app.get()).toMatchObject({ n: 42, ok: true, s: 'a b', xs: [1] })
    expect($('p').hidden).toBe(true)
    expect($('a').getAttribute('aria-busy')).toBe('')
  })

  it('binds checkbox, radio, select, number and textarea', async () => {
    const app = setup(
      `<input type="checkbox" data-value="ok"><input type="radio" name="r" value="a" data-value="r">
       <input type="radio" name="r" value="b" data-value="r"><select data-value="sel"><option>x</option><option>y</option></select>
       <input type="number" data-value="n"><textarea data-value="t"></textarea>`,
      { ok: true, r: 'b', sel: 'y', n: 1, t: 'hi' },
    )
    app.mount()
    const [box, ra, rb, num] = $$('input') as HTMLInputElement[]
    expect([box.checked, ra.checked, rb.checked]).toEqual([true, false, true])
    expect(($('select') as HTMLSelectElement).value).toBe('y')
    expect(($('textarea') as HTMLTextAreaElement).value).toBe('hi')
    box.checked = false
    box.dispatchEvent(new Event('change'))
    ra.checked = true
    ra.dispatchEvent(new Event('change'))
    type(num, '7')
    await tick()
    expect(app.get()).toMatchObject({ ok: false, r: 'a', n: 7 })
    expect(rb.checked).toBe(false)
  })

  it('leaves what is being typed in a number input alone', async () => {
    const app = setup(`<input type="number" data-value="n">`, { n: 5 })
    app.mount()
    const input = $('input') as HTMLInputElement
    for (const typed of ['1.0', '-0', '2.50']) {
      type(input, typed)
      await tick()
      expect(input.value).toBe(typed)
    }
    expect(app.get('n')).toBe(2.5)
    app.set('n', null)
    await tick()
    expect(input.value).toBe('')
  })

  it('keeps a <select> on its value when its options change', async () => {
    const app = setup(`<select data-value="color"><option data-for="c in colors" data-attr-value="c" data-text="c"></option></select>`, {
      color: 'blue',
      colors: [],
    })
    app.mount()
    const select = $('select') as HTMLSelectElement
    app.set('colors', ['green', 'blue']) // options arrive after the value
    await tick()
    expect(select.value).toBe('blue')
    app.set('colors', ['red', 'green', 'blue']) // the selected node is rebound to another option
    await tick()
    expect(select.value).toBe('blue')
  })

  it('an unbound <select> keeps the user choice when its options change', async () => {
    const app = setup(`<select><option data-for="o in opts" data-attr-value="o" data-text="o"></option></select>`, {
      opts: ['a', 'b', 'c'],
      choice: 'b',
    })
    app.mount()
    const select = $('select') as HTMLSelectElement
    app.bind(select, 'choice')()
    select.value = 'c'
    app.push('opts', 'd')
    await tick()
    expect(select.value).toBe('c')
  })

  it('updates the bound value before actions on the same event run', () => {
    const app = setup(
      `<select data-on-change="log.push(choice)" data-value="choice"><option>a</option><option>b</option></select>` +
        `<input type="checkbox" data-on-change="log.push(done)" data-value="done">`,
      { choice: 'a', done: false, log: [] },
    )
    app.mount()
    ;($('select') as HTMLSelectElement).value = 'b'
    $('select').dispatchEvent(new Event('change'))
    $('input').click()
    expect(app.get('log')).toEqual(['b', true])
  })

  it('click/input actions on checkboxes and selects see the new value', () => {
    const app = setup(
      `<input type="checkbox" data-value="done" data-click="log.push(done)">` +
        `<select data-value="x" data-on-input="log.push(x)"><option>a</option><option>b</option></select>`,
      { done: false, x: 'a', log: [] },
    )
    app.mount()
    $('input').click()
    ;($('select') as HTMLSelectElement).value = 'b'
    $('select').dispatchEvent(new Event('input'))
    expect(app.get('log')).toEqual([true, 'b'])
  })

  it('radios built by data-for follow their value when the list shifts', async () => {
    const app = setup(`<label data-for="o in opts"><input type="radio" name="c" data-attr-value="o.id" data-value="choice"></label>`, {
      opts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      choice: 'b',
    })
    app.mount()
    const checked = () => ($$('input') as HTMLInputElement[]).map((r) => r.value + (r.checked ? '*' : ''))
    expect(checked()).toEqual(['a', 'b*', 'c'])
    app.delete('opts.0')
    await tick()
    expect(checked()).toEqual(['b*', 'c'])
  })

  it('binds data-value after data-attr-type set the type', async () => {
    const app = setup(`<input data-value="ok" data-attr-type="t">`, { ok: true, t: 'checkbox' })
    app.mount()
    expect(($('input') as HTMLInputElement).checked).toBe(true)
    $('input').click()
    await tick()
    expect(app.get('ok')).toBe(false)
  })

  it('a select showing no option still selects the value="" option on reset', async () => {
    const app = setup(`<select data-value="status"><option value="">All</option><option value="open">Open</option></select>`, { status: 'archived' })
    app.mount()
    const select = $('select') as HTMLSelectElement
    expect(select.selectedIndex).toBe(-1)
    app.set('status', '')
    await tick()
    expect(select.selectedIndex).toBe(0)
  })

  it('prevents default on submit actions', () => {
    const app = setup(`<form data-on-submit="sent.set(true)"><button>go</button></form>`)
    app.mount()
    const e = new Event('submit', { cancelable: true })
    $('form').dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(app.get('sent')).toBe(true)
  })

  it('accepts any path characters in actions and aliases', async () => {
    const app = setup(
      `<input data-value="résumé"><button data-click="list.push(résumé) résumé.set('') my-list.push('x')">add</button>` +
        `<ul><li data-for="task, nº in list"><b data-text="nº"></b><i data-text="task"></i></li></ul>`,
      { list: [], 'my-list': [] },
    )
    app.mount()
    type($('input'), 'bread')
    $('button').click()
    await tick()
    expect(app.get()).toEqual({ list: ['bread'], 'my-list': ['x'], résumé: '' })
    expect($('li').textContent).toBe('0bread')
  })

  it('rejects unknown actions loudly', () => {
    const app = setup(`<button data-click="x.explode()"></button>`)
    expect(() => app.mount()).toThrow(/unknown action/)
  })
})

describe('API', () => {
  it('component(name, fn) gets the element and its bound path, cleanup on removal (fig. 13)', async () => {
    const app = setup(`<ul><li data-for="p in people"><input data-bind="p.birth" data-component="datepicker"></li></ul>`, {
      people: [{ birth: '2000-01-01' }],
    })
    const cleanup = vi.fn()
    const fn = vi.fn((_el: Element, _path: string) => cleanup)
    app.component('datepicker', fn)
    app.mount()
    expect(fn).toHaveBeenCalledWith($('input'), 'people.0.birth', app)
    app.pop('people')
    await tick()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('a component may wrap its element without breaking the siblings after it', async () => {
    const app = setup(
      `<ul><li data-for="p in people"><input data-bind="p.birth" data-component="wrap"><span data-text="p.name"></span>` +
        `<button data-click="p.delete()">x</button></li></ul>`,
      { people: [{ name: 'Ana' }, { name: 'Bia' }] },
    )
    app.component('wrap', (el) => {
      const div = document.createElement('div')
      el.replaceWith(div)
      div.append(el)
    })
    app.mount()
    expect(texts('li span')).toEqual(['Ana', 'Bia'])
    $('li button').click()
    await tick()
    expect(texts('li span')).toEqual(['Bia'])
  })

  it('a component may wrap a list item root or move its next sibling', async () => {
    const wrap = (el: Element) => {
      const div = document.createElement('div')
      div.className = 'wrap'
      el.replaceWith(div)
      div.append(el)
    }
    const tpl = `<div id="grid"><article data-for="p in ps" data-component="wrap" data-text="p"></article><p data-text="ps.length"></p></div>`
    const app = setup(tpl, { ps: ['a', 'b'] })
    app.component('wrap', wrap)
    app.mount()
    app.push('ps', 'c')
    await tick()
    expect([...$('#grid').children].map((e) => e.className || e.textContent)).toEqual(['', 'wrap', 'wrap', 'wrap', '3'])
    app.pop('ps')
    await tick()
    expect(texts('article')).toEqual(['a', 'b'])
    expect(texts('.wrap')).toEqual(['a', 'b'])

    const ssr = createApp()
    ssr.component('wrap', wrap)
    document.body.innerHTML = renderToString(tpl, { ps: ['a', 'b', 'c'] })
    ssr.mount()
    await tick()
    expect(texts('article')).toEqual(['a', 'b', 'c'])

    const portal = setup(`<div><button data-component="tip">?</button><i class="tip" data-text="help"></i><input data-value="name"></div>`, {
      name: 'Ana',
      help: 'H',
    })
    portal.component('tip', (el) => document.body.append(el.nextElementSibling!))
    portal.mount()
    expect([($('input') as HTMLInputElement).value, $('.tip').textContent]).toEqual(['Ana', 'H'])
  })

  it('list items may themselves be lists (flattened groups), client and SSR', async () => {
    const state = () => ({ groups: [{ items: ['a', 'b'] }, { items: ['c'] }], footer: 'F' })
    for (const tpl of [
      `<ul><template data-for="g in groups"><template data-for="x in g.items"><li data-text="x"></li></template></template><li data-text="footer"></li></ul>`,
      `<ul><template data-for="g in groups"><li data-for="x in g.items" data-text="x"></li></template><li data-text="footer"></li></ul>`,
    ])
      for (const ssr of [false, true]) {
        document.body.innerHTML = ssr ? renderToString(tpl, state()) : tpl
        const app = createApp(ssr ? {} : state())
        app.mount()
        await tick()
        expect(texts('li')).toEqual(['a', 'b', 'c', 'F'])
        app.push('groups.0.items', 'b2')
        app.push('groups', { items: ['d'] })
        await tick()
        expect(texts('li')).toEqual(['a', 'b', 'b2', 'c', 'd', 'F'])
        app.shift('groups')
        await tick()
        expect(texts('li')).toEqual(['c', 'd', 'F'])
        app.set('groups', [])
        await tick()
        expect(texts('li')).toEqual(['F'])
      }
  })

  it('an item that fails to bind is still tracked and removed with the list', async () => {
    const app = setup(`<ul><li data-for="x in xs" data-component="w" data-text="x"></li></ul>`, { xs: [] })
    app.component('w', (el) => {
      if (!el.textContent) throw Error('bad item')
    })
    app.mount()
    const errors: unknown[] = []
    vi.stubGlobal('queueMicrotask', (f: () => void) =>
      Promise.resolve().then(() => {
        try {
          f()
        } catch (e) {
          errors.push(e)
        }
      }),
    )
    app.push('xs', 'a', '', 'c')
    await tick()
    vi.unstubAllGlobals()
    expect(errors).toHaveLength(1)
    app.set('xs', ['z'])
    await tick()
    expect(texts('li')).toEqual(['z'])
  })

  it('a non-form component gets its data-value path without a text binding over its markup', async () => {
    const app = setup(`<div data-component="badge" data-value="user"></div>`, { user: { name: 'Ana' } })
    app.component('badge', (el, path) => {
      el.innerHTML = '<b></b>'
      return app.on(path + '.name', (n) => (el.firstElementChild!.textContent = n))
    })
    app.mount()
    app.set('user.name', 'Bia')
    await tick()
    expect($('div').innerHTML).toBe('<b>Bia</b>')
  })

  it('a throwing cleanup neither leaves its item behind nor stops the other cleanups', async () => {
    const app = setup(`<ul><li data-for="x in xs" data-component="boom" data-text="x"></li></ul><button data-click="n.push(1)"></button>`, {
      xs: ['a', 'b', 'c'],
      n: [],
    })
    app.component('boom', (el) => () => {
      if (el.textContent === 'c') throw Error('destroy failed')
    })
    const unmount = app.mount()
    const errors: unknown[] = []
    vi.stubGlobal('queueMicrotask', (f: () => void) =>
      Promise.resolve().then(() => {
        try {
          f()
        } catch (e) {
          errors.push(e)
        }
      }),
    )
    app.pop('xs')
    await tick()
    vi.unstubAllGlobals()
    expect(errors).toHaveLength(1)
    expect(texts('li')).toEqual(['a', 'b'])
    app.push('xs', 'c')
    await tick()
    expect(() => unmount()).toThrow('destroy failed')
    app.mount()
    $('button').click()
    expect(app.get('n')).toEqual([1])
  })

  it('click() with a selector delegates and receives the item context', async () => {
    const app = setup(`<ul><li data-for="xs"><button class="rm">x</button></li></ul>`, { xs: ['a', 'b'] })
    app.mount()
    const off = app.click('.rm', (value, path) => {
      expect(value).toBe('b')
      app.delete(path)
    })
    app.push('xs', 'c') // rendered later, still delegated
    await tick()
    $$('.rm')[1].click()
    await tick()
    expect(app.get('xs')).toEqual(['a', 'c'])
    off()
  })

  it('click() ignores elements outside the app', () => {
    document.body.innerHTML = `<div id="a"><button class="rm"></button></div><div id="b"><button class="rm"></button></div>`
    const app = createApp()
    app.mount($('#a'))
    const fn = vi.fn()
    app.click('.rm', fn)
    $('#b .rm').click()
    expect(fn).not.toHaveBeenCalled()
    $('#a .rm').click()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('click(element) works outside the mounted root; selectors stop after unmount', () => {
    document.body.innerHTML = `<button id="save"></button><div id="app"><button class="rm"></button></div>`
    const app = createApp({ n: 1 })
    const unmount = app.mount($('#app'))
    const onSave = vi.fn()
    const onRm = vi.fn()
    app.click($('#save'), onSave)
    app.click('.rm', onRm)
    $('#save').click()
    $('.rm').click()
    unmount()
    $('.rm').click()
    expect(onSave).toHaveBeenCalledWith({ n: 1 }, '', expect.any(Event))
    expect(onRm).toHaveBeenCalledOnce()
  })

  it('a failed mount can be retried; a stale unmount does not unmount a later mount', async () => {
    const app = setup(`<button data-click="x.nope(1)"></button><span data-text="x"></span>`, { x: 1 })
    expect(() => app.mount()).toThrow(/unknown action/)
    $('button').setAttribute('data-click', 'x.set(2)')
    const un1 = app.mount()
    un1()
    app.mount()
    un1()
    expect(() => app.mount()).toThrow(/already mounted/)
    $('button').click()
    await tick()
    expect($('span').textContent).toBe('2')
  })

  it('bind(el, path) and on(path, fn)', async () => {
    const app = setup(`<input id="i"><span id="s"></span>`)
    app.mount()
    app.bind($('#i'), 'name')
    app.bind($('#s'), 'name')
    const fn = vi.fn()
    app.on('name', fn)
    type($('#i'), 'Ana')
    await tick()
    expect($('#s').textContent).toBe('Ana')
    expect(fn).toHaveBeenCalledWith('Ana')
  })

  it('post(path, url, init) sends JSON, also with extra headers', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const app = createApp({ form: { a: 1 } })
    await app.post('form', '/api', { headers: { authorization: 'Bearer t' } })
    const [url, init] = fetch.mock.calls[0]
    const headers = new Headers(init.headers)
    expect([url, init.method, init.body]).toEqual(['/api', 'POST', '{"a":1}'])
    expect([headers.get('content-type'), headers.get('authorization')]).toEqual(['application/json', 'Bearer t'])
    vi.unstubAllGlobals()
  })

  it('mount() returns an unmount that stops updates and events', async () => {
    const app = setup(`<span data-text="x"></span><input data-value="x"><button data-click="x.set(3)"></button>`, { x: 1 })
    const unmount = app.mount()
    unmount()
    app.set('x', 2)
    await tick()
    expect($('span').textContent).toBe('1')
    type($('input'), 'typed')
    $('button').click()
    expect(app.get('x')).toBe(2)
  })

  it('bind() returns an unbind that removes the input listener', () => {
    const app = setup(`<input>`)
    app.bind($('input'), 'x')()
    type($('input'), 'typed')
    expect(app.get('x')).toBeUndefined()
  })

  it('remounting adopts the rendered list; a second live mount throws', async () => {
    const app = setup(
      `<input data-value="d"><button data-click="xs.push(d) d.set('')">add</button><ul><li data-for="xs" data-text="."></li></ul>`,
      { xs: ['a'] },
    )
    app.mount()()
    app.mount()
    expect(() => app.mount(document.body)).toThrow(/already mounted/)
    expect(texts('li')).toEqual(['a'])
    type($('input'), 'b')
    $('button').click()
    await tick()
    expect(app.get('xs')).toEqual(['a', 'b'])
    expect(texts('li')).toEqual(['a', 'b'])
  })
})

describe('functions, blocks and composition', () => {
  it('template functions: pipes read, methods write', async () => {
    const app = setup(
      `<b data-text="n | plus(1)"></b><i data-text="price | money('USD')"></i>` +
        `<p data-show="status | eq('loading')">...</p><p data-show="!status | eq('loading')">ok</p>` +
        `<button id="inc" data-click="n.plus(1)">+</button><button id="tog" data-click="open.not()">t</button>`,
      { n: 1, price: 2.5, status: 'loading', open: false },
    )
    app.fn('plus', (v, k) => v + k)
    app.fn('eq', (v, x) => v === x)
    app.fn('not', (v) => !v)
    app.fn('money', (v, cur) => cur + ' ' + v.toFixed(2))
    app.mount()
    expect([$('b').textContent, $('i').textContent]).toEqual(['2', 'USD 2.50'])
    expect($$('p').map((p) => p.hidden)).toEqual([false, true])
    $('#inc').click()
    $('#tog').click()
    app.set('status', 'idle')
    await app.tick()
    expect(app.get()).toMatchObject({ n: 2, open: true })
    expect($('b').textContent).toBe('3')
    expect($$('p').map((p) => p.hidden)).toEqual([true, false])
  })

  it('a pipe re-renders when its value or a path argument changes (row selection)', async () => {
    const app = setup(`<ul><li data-for="r in rows" data-class-sel="r.id | eq(selected)" data-text="r.id"></li></ul>`, {
      rows: [{ id: 1 }, { id: 2 }],
      selected: 1,
    })
    app.fn('eq', (v, x) => v === x)
    app.mount()
    expect($$('li').map((li) => li.className)).toEqual(['sel', ''])
    app.set('selected', 2)
    await app.tick()
    expect($$('li').map((li) => li.className)).toEqual(['', 'sel'])
  })

  it('rejects operators, unknown functions and stray data-else loudly; warns on undefined action args', () => {
    expect(() => setup(`<p data-show="status == 'x'"></p>`).mount()).toThrow(/bad expression/)
    expect(() => setup(`<p data-text="n+1"></p>`).mount()).toThrow(/bad expression/)
    expect(() => setup(`<p data-text="n | nope"></p>`).mount()).toThrow(/unknown function "nope"/)
    expect(() => setup(`<p data-else>x</p>`).mount()).toThrow(/data-else without data-if/)
    expect(() => setup(`<div data-use="nope"></div>`).mount()).toThrow(/no <template id="nope">/)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = setup(`<button data-click="n.set(n+1)"></button>`, { n: 1 })
    app.mount()
    $('button').click()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"n+1" is undefined'))
    warn.mockRestore()
  })

  it('$event and event modifiers: keys, prevent, stop, once', () => {
    const app = setup(
      `<div data-click="log.push('outer')" data-on-keydown="log.push('div')">` +
        `<input data-on-keydown.enter="log.push($event.target.value)" data-on-keydown.escape.stop="log.push('esc')">` +
        `<a href="#x" data-click.prevent.stop.once="log.push('link')">l</a></div>`,
      { log: [] },
    )
    app.mount()
    const input = $('input') as HTMLInputElement
    input.value = 'typed'
    for (const key of ['a', 'Enter', 'Escape']) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    const click = () => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true })
      $('a').dispatchEvent(e)
      return e.defaultPrevented
    }
    expect([click(), click()]).toEqual([true, false])
    expect(app.get('log')).toEqual(['div', 'typed', 'div', 'esc', 'link', 'outer'])
  })

  it('unshift and splice actions', async () => {
    const app = setup(`<button id="u" data-click="xs.unshift('z')"></button><button id="s" data-click="xs.splice(1, 1)"></button>`, {
      xs: ['a', 'b'],
    })
    app.mount()
    $('#u').click()
    $('#s').click()
    expect(app.get('xs')).toEqual(['z', 'b'])
  })

  it('data-if mounts and unmounts its element; data-else-if / data-else follow it', async () => {
    const app = setup(
      `<div><p data-if="status | eq('loading')">loading</p> <p data-else-if="error" data-text="error"></p>` +
        `<ul data-else><li data-for="items" data-text="."></li></ul><i>end</i></div>`,
      { status: 'loading', items: ['a', 'b'] },
    )
    app.fn('eq', (v, x) => v === x)
    app.mount()
    const shown = () => [...$('div').children].filter((e) => e.localName !== 'template').map((e) => e.textContent)
    expect(shown()).toEqual(['loading', 'end'])
    app.set('status', 'idle')
    app.set('error', 'boom')
    await app.tick()
    expect(shown()).toEqual(['boom', 'end'])
    app.set('error', null)
    await app.tick()
    expect(shown()).toEqual(['ab', 'end'])
  })

  it('a data-if chain reads its conditions when it runs, so a stale branch is never rendered', async () => {
    const app = setup(`<p data-if="busy">busy</p><p data-else-if="q">result</p><p data-else>empty</p>`, { q: '', busy: false })
    app.on('q', (q) => app.set('busy', !!q)) // runs before the chain in the same flush
    app.mount()
    const added: string[] = []
    new MutationObserver((rs) => rs.forEach((r) => r.addedNodes.forEach((n) => added.push(n.textContent!)))).observe(document.body, {
      childList: true,
      subtree: true,
    })
    app.set('q', 'x')
    await tick()
    expect(added).toEqual(['busy'])
  })

  it('data-if disposes what it unmounts: components clean up, bindings stop', async () => {
    const app = setup(`<section data-if="open"><b data-component="chart" data-text="n"></b></section>`, { open: true, n: 1 })
    const cleanup = vi.fn()
    app.component('chart', () => cleanup)
    app.mount()
    const b = $('b')
    app.set('open', false)
    await app.tick()
    expect([cleanup.mock.calls.length, document.querySelector('section')]).toEqual([1, null])
    app.set('n', 2)
    await app.tick()
    expect(b.textContent).toBe('1')
    app.set('open', true)
    await app.tick()
    expect($('b').textContent).toBe('2')
  })

  it('data-for with data-if filters items in place', async () => {
    const app = setup(`<ul><li data-for="t in todos" data-if="!t.done" data-text="t.title"></li></ul>`, {
      todos: [{ title: 'a' }, { title: 'b', done: true }, { title: 'c' }],
    })
    app.mount()
    expect(texts('li')).toEqual(['a', 'c'])
    app.set('todos.1.done', false)
    app.set('todos.0.done', true)
    await app.tick()
    expect(texts('li')).toEqual(['b', 'c'])
  })

  it('data-class-*, data-style-* and data-prop-*', async () => {
    const app = setup(
      `<li class="item" data-class-done="t.done" data-class-todo="!t.done" data-style-width="t.pct" data-style---hue="t.hue"></li>` +
        `<input type="checkbox" data-prop-indeterminate="mixed">`,
      { t: { done: false, pct: '50%', hue: 120 }, mixed: true },
    )
    app.mount()
    const li = $('li')
    expect([li.className, li.style.width, li.style.getPropertyValue('--hue')]).toEqual(['item todo', '50%', '120'])
    expect(($('input') as HTMLInputElement).indeterminate).toBe(true)
    app.set('t', { done: true, pct: null })
    app.set('mixed', false)
    await app.tick()
    expect([li.className, li.style.width, li.style.getPropertyValue('--hue')]).toEqual(['item done', '', ''])
    expect(($('input') as HTMLInputElement).indeterminate).toBe(false)
  })

  it('data-key keeps items on their elements: removal and reordering move them, focus stays', async () => {
    const app = setup(`<ul><li data-for="t, i in todos" data-key="t.id"><input data-value="t.title"><b data-text="i"></b></li></ul>`, {
      todos: [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
        { id: 3, title: 'c' },
      ],
    })
    app.mount()
    const [, b, c] = $$('li')
    ;(b.querySelector('input') as HTMLInputElement).focus()
    app.delete('todos.0')
    await app.tick()
    expect($$('li')).toEqual([b, c])
    expect(document.activeElement).toBe(b.querySelector('input'))
    expect(texts('b')).toEqual(['0', '1']) // rebound to their new index
    app.set('todos', [app.get('todos.1'), app.get('todos.0')])
    await app.tick()
    expect($$('li')).toEqual([c, b])
    expect(($$('input') as HTMLInputElement[]).map((x) => x.value)).toEqual(['c', 'b'])
    type($$('input')[1], 'B')
    await app.tick()
    expect(app.get('todos.1.title')).toBe('B') // the moved item writes to its new path
  })

  it('an item made of a data-if chain moves and leaves whole', async () => {
    const app = setup(
      `<ul><template data-for="t in ts" data-key="t.id"><li data-if="t.done" data-text="t.id"></li><li data-else>-</li></template><li>end</li></ul>`,
      { ts: [{ id: 1, done: true }, { id: 2 }, { id: 3, done: true }], other: 1 },
    )
    app.mount()
    expect(texts('li')).toEqual(['1', '-', '3', 'end'])
    app.set('ts', [app.get('ts.2'), app.get('ts.1'), app.get('ts.0')])
    await app.tick()
    expect(texts('li')).toEqual(['3', '-', '1', 'end'])
    app.delete('ts.1')
    app.set('ts.0.done', false)
    await app.tick()
    expect(texts('li')).toEqual(['-', '1', 'end'])
    app.set('ts', [])
    await app.tick()
    expect(texts('li')).toEqual(['end'])
  })

  it('a keyed item that moves keeps its elements and bindings: its path follows it, its component stays', async () => {
    const paths: string[] = []
    const app = setup(
      `<ul><li data-for="t in ts" data-key="t.id" data-component="row" data-value="t"><b data-text="t.name"></b><button data-click="t.name.set('x')"></button></li></ul>`,
      { ts: [1, 2, 3, 4].map((id) => ({ id, name: 'n' + id })) },
    )
    app.component('row', (_, path) => void paths.push(path))
    app.mount()
    const [a, b, c, d] = $$('li')
    const [one, two] = app.get('ts')
    app.set('ts.1', app.get('ts.3'))
    app.set('ts.3', two)
    await app.tick()
    expect($$('li')).toEqual([a, d, c, b])
    expect(paths.map((p) => app.get(p).id)).toEqual([1, 2, 3, 4]) // not run again, and each path still reaches its item
    d.querySelector('button')!.click()
    app.delete('ts.0')
    await app.tick()
    expect(app.get('ts.0.name')).toBe('x')
    expect(texts('b')).toEqual(['x', 'n3', 'n2'])
    app.set('ts', [one, ...app.get('ts').map((t: any) => ({ ...t, name: t.name + '!' }))]) // the same keys, other objects
    await app.tick()
    expect($$('li').slice(1)).toEqual([d, c, b])
    expect(texts('b')).toEqual(['n1', 'x!', 'n3!', 'n2!'])
  })

  it('a keyed list that starts empty fills, is replaced and is cleared', async () => {
    const app = setup(`<ul><li data-for="t in ts" data-key="t.id" data-text="t.id"></li></ul>`, { ts: [] })
    app.mount()
    app.set('ts', [{ id: 1 }, { id: 2 }])
    await app.tick()
    expect(texts('li')).toEqual(['1', '2'])
    app.set('ts', [{ id: 3 }])
    await app.tick()
    expect(texts('li')).toEqual(['3'])
    app.set('ts', [])
    await app.tick()
    expect(texts('li')).toEqual([])
  })

  it('"a | eq(b)" renders the items whose a was or is b; a change of a, and an eq of its own, render too', async () => {
    const app = setup(
      `<ul><li data-for="r in rows" data-key="r.id" data-class-on="r.v | eq(sel)" data-attr-title="r.v | ne(sel) | then('off', 'on')"></li></ul>`,
      { rows: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }], sel: 'b' },
    )
    app.mount()
    const shown = () => $$('li').map((e) => (e.classList.contains('on') ? 'on' : '-') + e.title)
    expect(shown()).toEqual(['-off', 'onon', '-off'])
    app.set('sel', 'c')
    await app.tick()
    expect(shown()).toEqual(['-off', '-off', 'onon'])
    app.set('rows.0.v', 'c')
    await app.tick()
    expect(shown()).toEqual(['onon', '-off', 'onon'])
    app.fn('eq', () => true)
    app.set('sel', 'z')
    await app.tick()
    expect(shown()).toEqual(['onoff', 'onoff', 'onoff'])
  })

  it('leaves other data-click* attributes alone', () => {
    const app = setup(`<button data-clickable="go(1)" data-click="n.set(1)"></button>`)
    app.mount()
    $('button').click()
    expect(app.get('n')).toBe(1)
  })

  it('a <template data-for> repeats all its elements per item, keyed or not', async () => {
    const app = setup(
      `<dl id="a"><template data-for="x in xs"><dt data-text="x.k"></dt><dd data-text="x.v"></dd></template><dt>end</dt></dl>` +
        `<dl id="b"><template data-for="x in xs" data-key="x.k"><dt data-text="x.k"></dt><dd data-text="x.v"></dd></template></dl>`,
      { xs: [{ k: 'a', v: '1' }] },
    )
    app.mount()
    const shown = (id: string) => [...$(id).children].slice(1).map((e) => e.textContent)
    app.push('xs', { k: 'b', v: '2' })
    await app.tick()
    expect(shown('#a')).toEqual(['a', '1', 'b', '2', 'end'])
    app.set('xs', [app.get('xs.1'), app.get('xs.0')])
    await app.tick()
    expect(shown('#b')).toEqual(['b', '2', 'a', '1'])
    app.shift('xs')
    await app.tick()
    expect([shown('#a'), shown('#b')]).toEqual([
      ['a', '1', 'end'],
      ['a', '1'],
    ])
  })

  it('data-use stamps a <template id>, filling its slots; data-context is its props', async () => {
    const app = setup(
      `<template id="card"><h3 data-text=".name"></h3><slot name="actions"><i>no actions</i></slot><slot></slot></template>` +
        `<article data-use="card" data-context="user"><p>bio</p><button slot="actions" data-click=".name.set('Bia')">rename</button></article>` +
        `<article data-use="card" data-context="other"></article>`,
      { user: { name: 'Ana' }, other: { name: 'Caio' } },
    )
    app.mount()
    const [a, b] = $$('article')
    expect(a.innerHTML).toBe(`<h3 data-text=".name">Ana</h3><button slot="actions" data-click=".name.set('Bia')">rename</button><p>bio</p>`)
    expect(b.innerHTML).toBe('<h3 data-text=".name">Caio</h3><i>no actions</i>')
    a.querySelector('button')!.click()
    await app.tick()
    expect(a.querySelector('h3')!.textContent).toBe('Bia')
  })

  it('render(el, path) binds markup added later, e.g. by a component or a fetch', async () => {
    const app = setup(`<div data-component="card" data-value="user"></div><section id="later"></section>`, { user: { name: 'Ana' } })
    app.component('card', (el, path) => {
      el.innerHTML = '<b data-text=".name"></b>'
      return app.render(el.firstElementChild!, path)
    })
    app.mount()
    expect($('b').textContent).toBe('Ana')
    $('#later').innerHTML = '<i data-text="user.name"></i>'
    const off = app.render($('#later'))
    app.set('user.name', 'Bia')
    await app.tick()
    expect([$('b').textContent, $('i').textContent]).toEqual(['Bia', 'Bia'])
    off()
    app.set('user.name', 'Caio')
    await app.tick()
    expect($('i').textContent).toBe('Bia')
  })

  it('checkboxes bound to an array and <select multiple> hold their values in it', async () => {
    const app = setup(
      `<input type="checkbox" value="a" data-value="tags"><input type="checkbox" value="b" data-value="tags">` +
        `<select multiple data-value="tags"><option>a</option><option>b</option><option>c</option></select>`,
      { tags: ['b'] },
    )
    app.mount()
    const [a, b] = $$('input') as HTMLInputElement[]
    const select = $('select') as HTMLSelectElement
    const opts = () => [...select.options].map((o) => o.selected)
    expect([a.checked, b.checked, opts()]).toEqual([false, true, [false, true, false]])
    a.click()
    await app.tick()
    expect(app.get('tags')).toEqual(['b', 'a'])
    expect(opts()).toEqual([true, true, false])
    select.options[1].selected = false
    select.dispatchEvent(new Event('change'))
    await app.tick()
    expect(app.get('tags')).toEqual(['a'])
    expect([a.checked, b.checked]).toEqual([true, false])
  })

  it('#keys stay in the browser: post() leaves them out', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const app = createApp({ todos: [{ title: 'a', '#editing': true }] })
    await app.post('todos', '/api')
    expect(fetch.mock.calls[0][1].body).toBe('[{"title":"a"}]')
    vi.unstubAllGlobals()
  })

  it('createApp<State>() types paths and values', () => {
    const app = createApp<{ n: number; todos: { title: string }[] }>({ n: 1 })
    app.set('todos.0.title', 'a')
    // @ts-expect-error a string is not a number
    app.set('n', 'x')
    // @ts-expect-error not a path of the state
    app.get('todos.0.nope')
    expect(app.get('todos')).toEqual([{ title: 'a' }])
  })
})

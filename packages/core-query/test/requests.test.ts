// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'

const tick = () => new Promise((r) => setTimeout(r))
const $ = (sel: string) => document.querySelector(sel) as HTMLElement
const setup = (html: string, state?: object) => {
  document.body.innerHTML = html
  return createApp(state)
}
const res = (body: unknown, status = 200, statusText = '') => ({ ok: status < 300, status, statusText, json: async () => body }) as Response
/** Stubs fetch; returns the calls as [method, url, body, content-type]. */
const stub = (reply: (url: string, init: RequestInit) => unknown = () => res({})) => {
  const calls: unknown[][] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push([init.method, url, init.body, (init.headers as Headers).get('content-type')])
      return reply(url, init)
    }),
  )
  return calls
}
/** A fetch that answers when told to (and ignores the abort signal, like a response already on its way). */
const manual = () => {
  const pending: ((r: unknown) => void)[] = []
  vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => pending.push(r))))
  return pending
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('built-ins', () => {
  it('work with nothing registered, in reads and as actions; app.fn overrides', async () => {
    const app = setup(
      `<p data-if="status | eq('x')">x</p><button id="a" data-click="open.not()"></button><button id="b" data-click="n.add(1)"></button>`,
      { status: 'x', open: false, n: 1 },
    )
    app.mount()
    expect($('p').textContent).toBe('x')
    $('#a').click()
    $('#b').click()
    expect(app.get()).toMatchObject({ open: true, n: 2 })
    app.fn('add', (v, n) => v + n * 10)
    $('#b').click()
    expect(app.get('n')).toBe(12)
    app.set('status', 'y')
    await tick()
    expect($('p')).toBeNull()
  })
})

describe('request actions', () => {
  it('each verb sends its method, URL and body', async () => {
    const calls = stub()
    const app = setup(
      `<div data-context="item">
        <button id="get" data-click="list.get('/api/todos?q=', search)"></button>
        <button id="post" data-click=".post('/api/todos')"></button>
        <button id="put" data-click=".put('/api/todos/', .id)"></button>
        <button id="patch" data-click=".patch('/api/todos/', .id, '?x=', 1)"></button>
        <button id="del" data-click=".del('/api/todos/', .id)"></button>
      </div>`,
      { search: 'a b&c', item: { id: 'x/1', title: 't', '#ui': { open: true } } },
    )
    app.mount()
    const body = '{"id":"x/1","title":"t"}'
    for (const id of ['get', 'post', 'put', 'patch', 'del']) $('#' + id).click(), await tick()
    expect(calls).toEqual([
      ['GET', '/api/todos?q=a%20b%26c', undefined, null],
      ['POST', '/api/todos', body, 'application/json'],
      ['PUT', '/api/todos/x%2F1', body, 'application/json'],
      ['PATCH', '/api/todos/x%2F1?x=1', body, 'application/json'],
      ['DELETE', '/api/todos/x%2F1', undefined, null],
    ])
  })

  it('get stores the JSON; the others do not store the response', async () => {
    stub(() => res([{ id: 1 }]))
    const app = setup(`<button id="g" data-click="list.get('/l')"></button><button id="p" data-click="draft.post('/l')"></button><i data-for="list" data-text=".id"></i>`, {
      draft: { t: 1 },
    })
    app.mount()
    $('#g').click()
    $('#p').click()
    await tick()
    expect(app.get('list')).toEqual([{ id: 1 }])
    expect(app.get('draft')).toEqual({ t: 1 })
    expect($('i').textContent).toBe('1')
  })

  it('flags: loading while in flight, error null on success', async () => {
    const pending = manual()
    const app = setup(`<button data-click="a.list.get('/l')"></button><b data-if="a.#list.loading">…</b>`)
    app.mount()
    expect(app.get('a.#list')).toBeUndefined()
    $('button').click()
    expect(app.get('a.#list')).toEqual({ loading: true, error: null })
    await tick()
    expect($('b').textContent).toBe('…')
    pending[0](res([1]))
    await tick()
    expect(app.get('a')).toEqual({ list: [1], '#list': { loading: false, error: null } })
    expect($('b')).toBeNull()
  })

  it('flags: a non-2xx response and a network error set the error', async () => {
    stub((url) => {
      if (url === '/down') throw new TypeError('Failed to fetch')
      return res({ ignored: 1 }, 404, 'Not Found')
    })
    const app = setup(`<button id="a" data-click="list.get('/missing')"></button><button id="b" data-click="list.get('/down')"></button><p data-text="#list.error.message"></p>`, {
      list: [0],
    })
    app.mount()
    $('#a').click()
    await tick()
    expect(app.get('#list')).toEqual({ loading: false, error: { status: 404, message: 'Not Found' } })
    expect(app.get('list')).toEqual([0])
    expect($('p').textContent).toBe('Not Found')
    $('#b').click()
    expect(app.get('#list')).toEqual({ loading: true, error: null })
    await tick()
    expect(app.get('#list')).toEqual({ loading: false, error: { status: 0, message: 'Failed to fetch' } })
  })

  it('the empty path keeps its flags at "#"', async () => {
    stub(() => res({ a: 1 }))
    const app = setup(`<button data-click=".get('/state')"></button>`)
    app.mount()
    $('button').click()
    expect(app.get('#.loading')).toBe(true)
  })

  it('latest wins: the request in flight is aborted and its late response changes nothing', async () => {
    const pending = manual()
    const app = setup(`<button data-click="list.get('/l') done.set(true)"></button>`)
    app.mount()
    $('button').click()
    const first = (fetch as any).mock.calls[0][1].signal as AbortSignal
    $('button').click()
    expect(first.aborted).toBe(true)
    pending[0](res(['old']))
    await tick()
    expect(app.get()).toEqual({ '#list': { loading: true, error: null } }) // nothing stored, still loading, no error
    pending[1](res(['new']))
    await tick()
    expect(app.get()).toEqual({ list: ['new'], '#list': { loading: false, error: null }, done: true })
  })

  it('latest wins: an aborted fetch that rejects sets no error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init: RequestInit) => new Promise((ok, no) => (init.signal!.onabort = () => no(init.signal!.reason), setTimeout(ok, 5, res([1]))))),
    )
    const app = setup('')
    const a = app.send('list', 'GET', '/l')
    const b = app.send('list', 'GET', '/l')
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(app.get('#list')).toEqual({ loading: true, error: null })
    await b
    expect(app.get()).toEqual({ list: [1], '#list': { loading: false, error: null } })
  })

  it('a handler runs in order, each request awaited', async () => {
    const calls = stub((url, init) => res(init.method === 'GET' ? [{ title: 'a' }] : {}))
    const log: string[] = []
    const app = setup(`<button data-click="draft.post('/api/todos') list.get('/api/todos') draft.title.set('')"></button>`, { draft: { title: 'a' } })
    app.on('draft.title', (v) => log.push('title=' + v))
    app.on('list', (v) => log.push('list=' + v.length))
    app.mount()
    $('button').click()
    expect(app.get('draft.title')).toBe('a')
    await tick()
    expect(calls.map((c) => c[0])).toEqual(['POST', 'GET'])
    expect(calls[0][2]).toBe('{"title":"a"}')
    expect(app.get('draft.title')).toBe('')
    expect(log).toEqual(['list=1', 'title='])
  })

  it('a failed request skips the rest of the handler', async () => {
    const calls = stub(() => res({}, 500, 'Boom'))
    const app = setup(`<button data-click="n.set(1) draft.post('/api/todos') list.get('/api/todos') n.set(2)"></button>`, { draft: {} })
    app.mount()
    $('button').click()
    await tick()
    expect(calls.length).toBe(1)
    expect(app.get('n')).toBe(1)
    expect(app.get('#draft.error')).toEqual({ status: 500, message: 'Boom' })
  })

  it('handlers without a request stay synchronous, and so does what comes before one', () => {
    stub()
    const app = setup(`<button id="a" data-click="n.set(1) m.set(2)"></button><button id="b" data-click="n.set(3) x.get('/x') m.set(4)"></button>`)
    app.mount()
    $('#a').click()
    expect(app.get()).toMatchObject({ n: 1, m: 2 })
    $('#b').click()
    expect(app.get()).toMatchObject({ n: 3, m: 2 })
  })

  it('warns about an undefined URL argument; request verbs win over a function of the same name', async () => {
    const calls = stub()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = setup(`<button data-click="x.get('/x/', nope)"></button>`)
    app.fn('get', () => 'fn')
    app.mount()
    $('button').click()
    await tick()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"nope" is undefined'))
    expect(calls[0][1]).toBe('/x/')
    expect(app.get('x')).toEqual({})
    expect(() => setup(`<button data-click="x.fetch('/x')"></button>`).mount()).toThrow(/unknown action "fetch"/)
  })
})

describe('requests and a list that changes meanwhile', () => {
  const ids = (app: any) => app.get('todos').map((t: any) => t.id)
  const todos = (n: number) => ({ todos: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const LIST = (act: string) => `<ul><li data-for="t in todos" data-key="t.id"><button data-click="${act}"></button></li></ul>`

  it('the actions after a request follow their keyed item, not the index it had', async () => {
    const pending = manual()
    const app = setup(LIST(`t.del('/api/todos/', t.id) t.delete()`), todos(4))
    app.mount()
    const [a, b] = document.querySelectorAll('button')
    a.click()
    b.click()
    pending[0](res({}))
    pending[1](res({}))
    await tick()
    expect(ids(app)).toEqual([3, 4])
  })

  it('the actions after a request are skipped once the element left the page', async () => {
    const pending = manual()
    const app = setup(LIST(`t.del('/api/todos/', t.id) n.add(1)`), todos(2))
    app.mount()
    document.querySelector('button')!.click()
    app.delete('todos.0')
    await tick()
    pending[0](res({}))
    await tick()
    expect(app.get('n')).toBeUndefined()
  })

  it('a GET response is dropped when the value at its path was replaced: another item moved there, or none is left', async () => {
    const pending = manual()
    const app = setup(LIST(`t.get('/api/todos/', t.id)`), todos(3))
    app.mount()
    const [, two, three] = document.querySelectorAll('button')
    two.click()
    app.delete('todos.0')
    await tick()
    pending[0](res({ id: 2, fresh: true }))
    await tick()
    expect(app.get('todos.0')).toEqual({ id: 2 })
    expect(app.get('todos.1')).toEqual({ id: 3 })
    three.click() // todos.1 now
    app.set('todos', [{ id: 9 }])
    await tick()
    pending[1](res({ id: 3, fresh: true }))
    await tick()
    expect(JSON.stringify(app.get('todos'))).toBe('[{"id":9}]')
  })

  it('a "." or ".." value cannot be a path segment of the URL (the browser would resolve it away); in the query it can', async () => {
    const calls = stub()
    const app = setup(`<button id="a" data-click="t.del('/api/todos/', t.id) n.set(1)"></button><button id="b" data-click="x.get('/api?q=', t.id)"></button>`, { t: { id: '..' } })
    app.mount()
    expect(() => $('#a').click()).toThrow(`CoreQuery: ".." cannot be a URL path segment in "t.del('/api/todos/', t.id) n.set(1)"`)
    $('#b').click()
    await tick()
    expect(calls.map((c) => c[1])).toEqual(['/api?q=..'])
    expect(app.get('n')).toBeUndefined()
  })
})

describe('app.send', () => {
  it('takes the method in any case', async () => {
    const calls = stub(() => res({ a: 1 }))
    const app = setup('')
    await app.send('data', 'get', '/d')
    await app.send('data', 'post', '/d')
    expect(app.get('data')).toEqual({ a: 1 })
    expect(calls.map((c) => c.slice(0, 3))).toEqual([['GET', '/d', undefined], ['POST', '/d', '{"a":1}']])
  })

  it('GET stores the JSON and resolves with the response', async () => {
    const calls = stub(() => res({ a: 1 }))
    const app = setup('')
    const p = app.send('data', 'GET', '/d', { headers: { 'x-a': '1' } })
    expect(app.get('#data.loading')).toBe(true)
    expect((await p).status).toBe(200)
    expect(app.get()).toEqual({ data: { a: 1 }, '#data': { loading: false, error: null } })
    expect(calls[0].slice(0, 3)).toEqual(['GET', '/d', undefined])
    expect((fetch as any).mock.calls[0][1].headers.get('x-a')).toBe('1')
  })

  it('sends the JSON body, or init.body as given; rejects after setting the error', async () => {
    const calls = stub((url) => (url === '/bad' ? res({}, 422, 'Unprocessable') : res({})))
    const app = setup('', { form: { name: 'a', '#ui': 1 } })
    await app.send('form', 'PUT', '/ok')
    await app.send('form', 'POST', '/ok', { body: 'raw' })
    expect(calls).toEqual([
      ['PUT', '/ok', '{"name":"a"}', 'application/json'],
      ['POST', '/ok', 'raw', null],
    ])
    await expect(app.send('form', 'POST', '/bad')).rejects.toThrow('Unprocessable')
    expect(app.get('#form')).toEqual({ loading: false, error: { status: 422, message: 'Unprocessable' } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(app.send('form', 'POST', '/ok')).rejects.toThrow('offline')
    expect(app.get('#form.error')).toEqual({ status: 0, message: 'offline' })
  })

  it('post() is unchanged: no flags', async () => {
    const calls = stub()
    const app = setup('', { form: { a: 1 } })
    await app.post('form', '/p')
    expect(calls).toEqual([['POST', '/p', '{"a":1}', 'application/json']])
    expect(app.get('#form')).toBeUndefined()
  })
})

describe('data-on-mount', () => {
  it('runs once, in a microtask after mount, with no listener', async () => {
    const calls = stub(() => res([1, 2]))
    const app = setup(`<ul data-on-mount="list.get('/api/todos') n.add(1)"><li data-for="list" data-text="."></li></ul>`)
    app.mount()
    expect(calls.length).toBe(0)
    await tick()
    expect(calls).toEqual([['GET', '/api/todos', undefined, null]])
    expect(app.get('n')).toBe(1)
    expect(document.querySelectorAll('li').length).toBe(2)
    $('ul').dispatchEvent(new Event('mount'))
    await tick()
    expect(app.get('n')).toBe(1)
  })

  it('runs for items stamped later, once each', async () => {
    const app = setup(`<i data-for="xs" data-on-mount="log.push(.)"></i>`, { xs: ['a'], log: [] })
    app.mount()
    await tick()
    app.push('xs', 'b')
    await tick()
    expect(app.get('log')).toEqual(['a', 'b'])
  })

  it('does not run again for a keyed item that only moved to another index', async () => {
    const app = setup(`<ul><li data-for="t in todos" data-key="t.id" data-on-mount="t.log()"></li></ul>`, { todos: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    const calls: number[] = []
    app.fn('log', (t) => void calls.push(t.id))
    app.mount()
    await tick()
    app.delete('todos.0')
    await tick()
    expect(calls).toEqual([1, 2, 3])
  })

  it('does not run when unmounted before the microtask', async () => {
    const app = setup(`<i data-on-mount="n.set(1)"></i>`)
    app.mount()()
    await tick()
    expect(app.get('n')).toBeUndefined()
  })
})

describe('data-cloak', () => {
  it('is removed from the root, its subtree and items stamped later', async () => {
    const app = setup(`<div id="r" data-cloak><p data-cloak data-text="a"></p><i data-cloak data-for="xs"></i><b data-cloak data-if="on"></b></div>`, { a: 1, xs: [1] })
    const cloaked = () => document.querySelectorAll('[data-cloak]').length
    app.mount($('#r'))
    expect(cloaked()).toBe(0)
    app.push('xs', 2)
    app.set('on', true)
    await tick()
    expect(document.querySelectorAll('i,b').length).toBe(3)
    expect(cloaked()).toBe(0)
  })

  it('render() removes it too', () => {
    const app = setup(`<div data-cloak><p data-cloak></p></div>`)
    app.render($('div'))
    expect(document.querySelectorAll('[data-cloak]').length).toBe(0)
  })
})

// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createApp, route } from '../src/index'
import { renderToString } from '../src/server'

const tick = () => new Promise((r) => setTimeout(r))
const routes = { home: '/', user: '/users/:id', docs: '/docs/*' }
const PAGE = `<div id="app">
  <nav><a id="h" href="/">home</a> <a id="u" href="/users/7?tab=a">user</a> <a id="x" href="/other">other</a></nav>
  <h1 data-if="route.is.home">Home</h1>
  <h1 data-else-if="route.is.user">User <b data-text="route.params.id"></b> <i data-text="route.query.tab"></i></h1>
  <h1 data-else>Not found</h1>
</div>`

it('matches paths, params, the rest and the query', () => {
  expect(route('/', routes)).toEqual({ path: '/', query: {}, hash: '', name: 'home', params: {}, is: { home: true } })
  expect(route('/users/a%20b/?x=1&y=2#z', routes)).toMatchObject({ name: 'user', params: { id: 'a b' }, query: { x: '1', y: '2' }, hash: '#z' })
  expect(route('/docs/a/b', routes).params).toEqual({ '*': 'a/b' })
  expect(route('/docs', routes).name).toBe('docs')
  expect(route('/users', routes).name).toBeUndefined()
  expect(route('/users/1/2', routes).is).toEqual({})
  expect(route('/users/%E0%A4%A', routes).name).toBeUndefined() // malformed: a 404, not a throw
})

it('hydrates the server-rendered route without touching the DOM, then navigates in place', async () => {
  history.replaceState(null, '', '/users/7?tab=a')
  document.body.innerHTML = renderToString(PAGE, { route: route('/users/7?tab=a', routes) })
  expect(document.querySelector('h1')!.textContent).toBe('User 7 a')
  const before = document.body.innerHTML
  const h1 = document.querySelector('h1')

  const mutations: MutationRecord[] = []
  const mo = new MutationObserver((r) => mutations.push(...r))
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  const app = createApp()
  app.router(routes)
  const unmount = app.mount(document.querySelector('#app')!)
  await tick()
  mutations.push(...mo.takeRecords())
  mo.disconnect()
  expect(mutations).toEqual([])
  expect(document.body.innerHTML).toBe(before)
  expect(document.querySelector('h1')).toBe(h1)

  const click = (id: string, init?: MouseEventInit) => {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
    document.getElementById(id)!.dispatchEvent(e)
    return e.defaultPrevented
  }
  expect(click('h')).toBe(true)
  await tick()
  expect(location.pathname).toBe('/')
  expect(document.querySelector('h1')!.textContent).toBe('Home')

  expect(click('u', { ctrlKey: true })).toBe(false) // new tab: the browser's
  expect(click('x')).toBe(false) // not a route: a full page load

  app.go('/nope')
  await tick()
  expect(document.querySelector('h1')!.textContent).toBe('Not found')

  history.replaceState(null, '', '/users/9') // what back/forward do, then popstate
  dispatchEvent(new Event('popstate'))
  await tick()
  expect(document.querySelector('h1')!.textContent).toBe('User 9 ')

  unmount()
  expect(click('h')).toBe(false)
})

it('with base, routes are relative to it and links outside it are left to the browser', async () => {
  history.replaceState(null, '', '/app/users/7')
  document.body.innerHTML = `<div id="app"><a id="in" href="/app/">home</a> <a id="out" href="/users/7">out</a><b data-text="route.params.id"></b></div>`
  const app = createApp()
  app.router(routes, { base: '/app' })
  expect(app.get('route.name')).toBe('user')
  const unmount = app.mount(document.querySelector('#app')!)
  expect(document.querySelector('b')!.textContent).toBe('7')
  const click = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  expect(click('out')).toBe(true) // not prevented: outside the base, the browser's to follow
  expect(click('in')).toBe(false)
  expect(location.pathname).toBe('/app/')
  expect(app.get('route.is.home')).toBe(true)
  unmount()
})

// ---- pages: a template per route (fetched once, preloaded when idle) and a state per URL (asked for on every navigation) ----

/** The idle callbacks, run by hand: happy-dom has no requestIdleCallback, and the tests decide when the browser is idle. */
const idle: (() => void)[] = []
;(window as any).requestIdleCallback = (f: () => void) => idle.push(f)
const whenIdle = () => idle.splice(0).forEach((f) => f())

const site = { home: '/', user: '/users/:id', docs: '/docs/*' }
const templates: Record<string, string> = {
  home: `<h1>Home</h1><p data-for="users" data-text="."></p>`,
  user: `<h1 data-text="user.name"></h1><input data-value="note"><a href="/docs/a">docs</a>`,
  docs: `<h1>Docs</h1>`,
}
const layout = (page: string) =>
  `<body><div id="app"><nav data-state-menu='{"open": false}'><a id="h" href="/">home</a> <a id="u" href="/users/7">user</a> <a href="/users/8">8</a> ` +
  `<a href="/other">other</a> <a href="https://example.com/users/1">out</a> <i data-text="visits"></i><ul data-show="menu.open"></ul></nav><main data-page>${page}</main></div></body>`
const stateOf = (url: string) => {
  const r = route(url, site)
  return { route: r, ...(r.name === 'user' ? { user: { name: 'Ana ' + r.params.id } } : { users: ['a', 'b'] }) }
}
/** The first visit: the page rendered by the server. */
const visit = (url: string) => {
  history.replaceState(null, '', url)
  document.documentElement.innerHTML = renderToString(layout(templates[route(url, site).name!]), stateOf(url))
  idle.length = 0
  return document.querySelector('#app')!
}
/** The server: a template per route under /pages/, and the state of a URL when JSON is asked for. Returns what was fetched. */
const server = (answer?: (what: string) => unknown) => {
  const fetched: string[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url, location.href)
    const json = (init?.headers as Record<string, string>)?.accept === 'application/json'
    const what = (json ? 'state ' : '') + pathname
    fetched.push(what)
    // `answer` may give another response, or just take its time.
    return (await answer?.(what)) || (json ? { ok: true, json: async () => stateOf(url) } : { ok: true, text: async () => templates[pathname.slice(7, -5)] })
  }) as any
  return fetched
}
const pages = (name: string) => `/pages/${name}.html`
const click = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const ps = () => [...document.querySelectorAll('p')].map((p) => p.textContent)

it('with pages, navigating renders the template of the route, fetched once, with the state of the URL', async () => {
  const fetched = server()
  const root = visit('/')
  const nav = document.querySelector('nav')
  const app = createApp<any>({ visits: 1 }) // not in the server state: it survives the pages; the rest comes from it
  app.router(site, { pages })
  const unmount = app.mount(root)
  await tick()
  expect(ps()).toEqual(['a', 'b'])
  expect(fetched).toEqual([])

  click('u')
  await tick()
  await tick()
  expect(fetched).toEqual(['state /users/7', '/pages/user.html'])
  expect(location.pathname).toBe('/users/7')
  expect(document.querySelector('nav')).toBe(nav) // only the outlet changed: the layout is the one that was bound
  expect(document.querySelector('h1')!.textContent).toBe('Ana 7')
  expect(ps()).toEqual([])
  expect(app.get('route.params.id')).toBe('7')
  expect(document.querySelector('i')!.textContent).toBe('1')

  // The new page is live.
  app.set('user.name', 'Bia')
  await tick()
  const h1 = document.querySelector('h1')!
  expect(h1.textContent).toBe('Bia')

  // Another URL of the same route: only its state is fetched and the page stays, with what was typed in it.
  const input = document.querySelector('input')!
  input.value = 'typed'
  input.dispatchEvent(new Event('input'))
  await app.go('/users/8?tab=a')
  await tick()
  expect(fetched.slice(2)).toEqual(['state /users/8'])
  expect(document.querySelector('h1')).toBe(h1)
  expect(h1.textContent).toBe('Ana 8')
  expect(document.querySelector('input')).toBe(input)
  expect(app.get('note')).toBe('typed')
  expect(app.get('route.query.tab')).toBe('a')

  // The first page came rendered: its template is fetched when it is first needed, and no template twice.
  await app.go('/')
  await tick()
  expect(fetched.slice(3)).toEqual(['state /', '/pages/home.html'])
  expect(ps()).toEqual(['a', 'b'])
  await app.go('/users/7')
  await app.go('/')
  expect(fetched.slice(5)).toEqual(['state /users/7', 'state /'])
  expect(ps()).toEqual(['a', 'b'])

  history.replaceState(null, '', '/#x') // a hash is the same page
  dispatchEvent(new Event('popstate'))
  await tick()
  expect(fetched.length).toBe(7)
  expect(app.get('route.hash')).toBe('#x')
  unmount()
})

it('with pages, preloads when idle the templates of the routes the page links to', async () => {
  const fetched = server()
  const app = createApp()
  app.router(site, { pages })
  const unmount = app.mount(visit('/'))
  await tick()
  expect(fetched).toEqual([]) // not before the browser is idle
  whenIdle()
  expect(fetched).toEqual(['/pages/home.html', '/pages/user.html']) // one per route, not per link; no route, no template

  click('u')
  await tick()
  await tick()
  expect(fetched.slice(2)).toEqual(['state /users/7']) // the click only asks for the state
  expect(document.querySelector('h1')!.textContent).toBe('Ana 7')
  whenIdle()
  expect(fetched.slice(3)).toEqual(['/pages/docs.html']) // the new page links to another route

  unmount()
  app.mount(document.querySelector('#app')!)()
  whenIdle() // unmounted before the browser was idle: nothing to preload for
  expect(fetched.length).toBe(4)
})

it('a page that leaves takes the root # state along, as a full load would; another URL of its route keeps it', async () => {
  server()
  const app = createApp({ cart: [1] })
  app.router(site, { pages })
  const unmount = app.mount(visit('/'))
  app.set('#menu.open', true)
  await app.go('/users/7')
  expect(app.get('#menu')).toEqual({ open: false })
  expect(document.querySelector('ul')!.hidden).toBe(true)
  expect(app.get('cart')).toEqual([1])
  app.set('#menu.open', true)
  await app.go('/users/8')
  expect(app.get('#menu')).toEqual({ open: true })
  unmount()
})

it('a later navigation wins, and a hash change does not drop the page that is loading', async () => {
  const waiting: (() => void)[] = []
  const fetched = server((what) => what.startsWith('state') && new Promise<void>((r) => waiting.push(r)))
  const app = createApp()
  app.router(site, { pages })
  const unmount = app.mount(visit('/'))
  const h1 = () => document.querySelector('h1')!.textContent
  app.go('/users/7')
  app.go('/docs/a')
  waiting.splice(0).reverse().forEach((f) => f()) // the answer to the first one comes last
  await tick()
  expect(h1()).toBe('Docs')
  expect(fetched).toEqual(['state /users/7', '/pages/user.html', 'state /docs/a', '/pages/docs.html'])

  app.go('/users/9')
  history.replaceState(null, '', '/users/9#x')
  dispatchEvent(new Event('popstate'))
  waiting.splice(0).forEach((f) => f())
  await tick()
  expect(h1()).toBe('Ana 9')
  expect(app.get('route.hash')).toBe('#x')
  unmount()
})

it('what the router cannot show is left to the browser, which loads the URL', async () => {
  let fail = ''
  const fetched = server((what) => (what === fail ? { ok: false } : what === 'state /docs/html' ? { ok: true, json: async () => JSON.parse('<html>') } : undefined))
  const reload = vi.spyOn(location, 'reload').mockImplementation(() => {})
  const app = createApp()
  app.router(site, { pages })
  const unmount = app.mount(visit('/'))

  await app.go('/nope') // not a route: the server's 404
  expect(fetched).toEqual([])
  expect(reload).toHaveBeenCalledTimes(1)

  fail = '/pages/user.html' // a template that did not come is asked for again
  await app.go('/users/8')
  expect(reload).toHaveBeenCalledTimes(2)
  expect(document.querySelector('h1')!.textContent).toBe('Home')
  fail = ''
  await app.go('/users/9')
  expect(reload).toHaveBeenCalledTimes(2)
  expect(document.querySelector('h1')!.textContent).toBe('Ana 9')
  expect(fetched.filter((x) => x === '/pages/user.html').length).toBe(2)

  fail = 'state /users/7' // an error (or offline)
  await app.go('/users/7')
  expect(reload).toHaveBeenCalledTimes(3)

  await app.go('/docs/html') // a server that answers the page, not its state
  expect(reload).toHaveBeenCalledTimes(4)
  expect(document.querySelector('h1')!.textContent).toBe('Ana 9')
  unmount()

  // Without a data-page element there is nowhere to put a page.
  document.querySelector('main')!.removeAttribute('data-page')
  const unmount2 = app.mount(document.querySelector('#app')!)
  await app.go('/')
  expect(reload).toHaveBeenCalledTimes(5)
  unmount2()
  reload.mockRestore()
})

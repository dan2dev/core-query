// pnpm build && node examples/ssr.mjs → http://localhost:3000 (PORT=… for another port).
// The examples are one application (app.mjs): any of its URLs comes rendered from here, in layout.html, with the state
// of its page. From there the browser routes: a link to another page asks for that page's template (once, at
// /page/<name>) and for the state of its URL as JSON, and renders it without reloading.
// Some state lives here, so a reload shows the latest: the to-do list, the cart, the tracker's issues.
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { renderToString, route } from '../packages/core-query/dist/server.js'
import { modules, routes } from './app.mjs'
import * as routed from './routes.mjs'
import * as shop from './shop.mjs'
import tracker, { state as issues } from './tracker/server.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
/** The template of page `name`: its file (as its module shapes it), inside the layout of its folder if it has one. */
const template = (name) => {
  const html = read(`./${name}.html`)
  const page = modules[name]?.template?.(html) ?? html
  return (name.includes('/') ? read(`./${name.split('/')[0]}/layout.html`) : '<!-- page -->').replace('<!-- page -->', () => page)
}

let todo = [{ title: 'Rendered on the server', done: true }, { title: 'Hydrated in the browser' }]
let cart = []
let views = 0
// What declarative.html searches: /api/cities?q=…&state=… (accents ignored).
const cities = [
  ['São Paulo', 'SP', 11451999], ['Rio de Janeiro', 'RJ', 6211223], ['Salvador', 'BA', 2417678], ['Belo Horizonte', 'MG', 2315560],
  ['Guarulhos', 'SP', 1291771], ['Campinas', 'SP', 1139047], ['São Gonçalo', 'RJ', 896744], ['Uberlândia', 'MG', 713224],
  ['Feira de Santana', 'BA', 616272], ['Niterói', 'RJ', 481758], ['Santos', 'SP', 418608], ['Porto Seguro', 'BA', 168326],
].map(([name, state, pop]) => ({ name, state, pop, people: pop.toLocaleString('en-US') }))
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const search = (q, st) => cities.filter((c) => fold(c.name).includes(fold(q)) && (!st || c.state === st))

/** The state of the page at `r`: the one its module starts from, or what this server keeps; undefined: a 404. */
const state = (r) => {
  if (r.name?.startsWith('tracker/')) return issues(r)
  if (r.name?.startsWith('routes/')) return { ...routed.state(r), views: ++views }
  const own = {
    index: () => ({ title: 'Examples · core-query' }),
    todo: () => ({ title: 'TODO CoreQuery', draft: { title: '' }, list: todo }),
    declarative: () => ({ title: 'Declarative search · core-query', q: '', state: '', searches: 0, cities: search('', '') }),
    shop: () => ({ ...shop.state(), cart }),
  }[r.name]
  return own ? own() : modules[r.name]?.state(r)
}

const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript' }
const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))

/** Reads a posted JSON array into `save`. */
const receive = (req, res, save) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    try {
      const value = JSON.parse(body)
      if (Array.isArray(value)) save(value)
    } catch {}
    res.writeHead(204).end()
  })
}

createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost') // ".." segments resolved
  // The examples used to live at /examples/: the page that lists them is / now.
  if (pathname === '/examples' || pathname === '/examples/') return res.writeHead(301, { location: '/' }).end()
  // Files as they are: the styles, the modules the browser imports, the built library.
  if (/^\/(examples|packages\/core-query\/dist)\//.test(pathname))
    return readFile(new URL('..' + pathname, import.meta.url)).then(
      (body) => res.writeHead(200, { 'content-type': types[pathname.split('.').pop()] || 'application/octet-stream' }).end(body),
      () => res.writeHead(404).end('Not found'),
    )
  // The template of a page, for the router.
  if (pathname.startsWith('/page/')) {
    const name = pathname.slice(6)
    if (!Object.hasOwn(routes, name)) return res.writeHead(404).end('Not found')
    return res.writeHead(200, { 'content-type': types.html }).end(template(name))
  }
  // Answers after 400 ms, so the page's "loading" state shows; q=error fails, for its "error" state.
  if (pathname === '/api/cities') {
    const q = searchParams.get('q') || ''
    const found = search(q, searchParams.get('state'))
    return void setTimeout(() => (fold(q) === 'error' ? res.writeHead(503).end() : json(res, 200, found)), 400)
  }
  if (pathname.startsWith('/tracker/api/')) return tracker(req, res)
  if (req.method === 'POST' && pathname === '/list') return receive(req, res, (list) => (todo = list))
  if (req.method === 'POST' && pathname === '/shop/cart') return receive(req, res, (c) => (cart = c))
  // Any other URL is a page: rendered on a visit, its state as JSON when the router asks for it. No page is a 404.
  const r = route(req.url, routes)
  const found = r.name && state(r)
  const page = { ...(found || { title: 'Page not found · core-query' }), route: r }
  if (req.headers.accept === 'application/json') return json(res, found ? 200 : 404, page)
  const html = read('./layout.html').replace('<!-- page -->', () => template(found ? r.name : 'not-found'))
  res.writeHead(found ? 200 : 404, { 'content-type': types.html }).end(renderToString(html, page, (found && modules[r.name]?.fns) || {}))
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`))

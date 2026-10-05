// The tracker's server side: the issues (kept in memory: a restart brings the sample back), the state of each
// page (ssr.mjs renders it on a visit and sends it as JSON on a navigation) and a small JSON API for the changes.

const PEOPLE = ['Ana', 'Bia', 'Caio', 'Davi']
const LABELS = ['bug', 'feature', 'docs', 'question']
const PER_PAGE = 6
const ME = 'you' // nobody signs in here: every change is yours
/** Fixed dates, so the pages are the same on every start. */
const day = (n) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString()

// [title, labels, author, assignee, status, day, description, comments as [author, text]]
const issues = [
  ['Keyed list loses the typed text when an item moves', ['bug'], 'Bia', 'Ana', 'closed', 0, 'Reorder a keyed list while typing in one of its inputs: the text jumps to another row.', [['Ana', 'An item that moves is now rebound in place: the element stays, only its paths change.'], ['Bia', 'Confirmed, thanks!']]],
  ['Router: preload the route templates when the browser is idle', ['feature'], 'Caio', 'Ana', 'closed', 1, 'A click should not wait for the template: fetch the ones the page links to ahead of time.', [['Ana', 'Done with requestIdleCallback, and each template is only fetched once.']]],
  ['Document data-page in the README', ['docs'], 'Ana', 'Davi', 'closed', 2, '', []],
  ['SSR: an unclosed <p> should throw with its line', ['bug'], 'Davi', 'Caio', 'closed', 3, 'The server has no implied end tags, so it renders another tree than the browser builds. Better to fail loudly.', [['Caio', 'It throws now: "unclosed <p> before <div> (line 12)".']]],
  ['Add a .throttle modifier next to .debounce', ['feature'], 'Bia', '', 'closed', 4, 'For scroll and pointer handlers, where the first event matters and the rest can wait.', []],
  ['data-state on an item that is a string throws', ['question'], 'Davi', 'Ana', 'closed', 5, 'Is that expected? My list is an array of names.', [['Ana', 'Yes: the state lives at a # key of the item, and a string has nowhere to keep it. Make the items objects.']]],
  ['Select keeps the wrong option after its options change', ['bug'], 'Caio', 'Bia', 'open', 6, 'The options come from a request that answers after the value is set.', [['Bia', 'The value has to be applied again once the options are all there.']]],
  ['Hydration should adopt the server nodes without touching the DOM', ['feature'], 'Ana', 'Ana', 'closed', 7, '', []],
  ['A GET that answers HTML should count as an error', ['bug'], 'Bia', '', 'open', 8, 'A login redirect answers 200 with a page: the list becomes a string.', []],
  ['Transitions: wait for every animation before removing', ['feature'], 'Davi', 'Caio', 'open', 9, 'A leaving element with two transitions is removed after the first one ends.', [['Caio', 'getAnimations() gives all of them: wait for each to finish.'], ['Davi', 'And one that never ends keeps the element forever, which is fair.']]],
  ['How do I sort a list?', ['question'], 'Caio', '', 'open', 10, 'There is no orderBy in the templates.', [['Ana', 'Store the sorted array: an action function that returns it, like todos.byDate().']]],
  ['Template functions should see their path arguments change', ['bug'], 'Ana', 'Bia', 'open', 11, 'status | eq(selected) does not update when selected changes, only when status does.', []],
  ['Explain #keys in the requests section', ['docs'], 'Bia', 'Davi', 'open', 12, 'Where loading and error live, and why they are never posted.', []],
  ['Requests: abort the one in flight for the same path', ['feature'], 'Davi', 'Ana', 'open', 13, 'In a search box the latest answer must win, whatever the order they arrive in.', [['Ana', 'One AbortController per path does it.']]],
  ['data-on-mount runs twice after a remount', ['bug'], 'Caio', '', 'open', 14, '', []],
  ['Expose tick() so code can wait for the DOM', ['feature'], 'Ana', 'Caio', 'open', 15, 'To scroll a chat to its last message after pushing it.', []],
  ['Can a component own the content of its element?', ['question'], 'Bia', '', 'open', 16, 'I want to wrap a date picker that renders its own markup.', []],
  ['SVG: keep the case of viewBox in data-attr-*', ['bug'], 'Davi', 'Bia', 'open', 17, 'HTML lowercases attribute names, and SVG ones are case-sensitive.', [['Bia', 'The HTML parser can give the name its case back: parse "<svg viewbox>" and read the attribute.']]],
  ['Add an example of a routed app', ['docs', 'feature'], 'Ana', 'Ana', 'open', 18, 'One page per route, the state of each URL from the server, forms that post. This tracker, in fact.', []],
  ['The bundle is over the 8 kB budget', ['bug'], 'Caio', 'Ana', 'open', 19, 'The size check fails on main since the router landed.', []],
  ['Server: a data-if chain of rows inside a <table>', ['bug'], 'Bia', 'Caio', 'open', 20, 'The browser moves the <template>s out of the implied <tbody>.', []],
  ['Typed paths for createApp<State>()', ['feature', 'docs'], 'Davi', '', 'open', 21, 'app.set("todos.0.title", 1) should not compile when title is a string.', []],
].map(([title, labels, author, assignee, status, at, body, comments], i) => ({
  id: i + 1,
  title,
  body,
  status,
  labels,
  author,
  assignee,
  at: day(at),
  comments: comments.map(([author, body], j) => ({ id: j + 1, author, body, at: day(at + j + 1) })),
}))

const find = (id) => issues.find((i) => i.id === +id)
const counts = () => ({ open: issues.filter((i) => i.status === 'open').length, closed: issues.filter((i) => i.status === 'closed').length })

/** What the list shows for a query: the filters as understood, one page of the matching issues (newest first) and the page numbers. */
const list = (query) => {
  const status = ['closed', 'all'].includes(query.status) ? query.status : 'open'
  const label = LABELS.includes(query.label) ? query.label : ''
  // As typed, since the search box is bound to it: only the matching ignores case and outer spaces.
  const q = String(query.q ?? '').slice(0, 100)
  const text = q.trim().toLowerCase()
  const found = issues
    .filter((i) => (status === 'all' || i.status === status) && (!label || i.labels.includes(label)) && (!text || (i.title + '\n' + i.body).toLowerCase().includes(text)))
    .sort((a, b) => b.id - a.id)
  const last = Math.max(1, Math.ceil(found.length / PER_PAGE))
  const page = Math.min(last, Math.max(1, parseInt(query.page) || 1))
  return {
    filters: { status, label, q, page },
    total: found.length,
    issues: found.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(({ body, comments, ...i }) => ({ ...i, comments: comments.length })),
    pager: Array.from({ length: last }, (_, i) => i + 1),
  }
}

/** The state of the page at `r`, or undefined when there is none (no such issue): a 404. */
export const state = (r) => {
  const shared = { counts: counts(), labels: LABELS, people: PEOPLE }
  if (r.name === 'tracker/list') return { ...shared, title: 'Issues · Tracker', ...list(r.query) }
  if (r.name === 'tracker/new') return { ...shared, title: 'New issue · Tracker', draft: { title: '', body: '', labels: [], assignee: '' } }
  const issue = r.name === 'tracker/issue' && find(r.params.id)
  if (!issue) return
  const at = issues.indexOf(issue)
  return {
    ...shared,
    title: `Issue #${issue.id} · Tracker`,
    issue,
    reply: { body: '' },
    near: { older: issues[at - 1]?.id ?? null, newer: issues[at + 1]?.id ?? null },
  }
}

const send = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(body === undefined ? '' : JSON.stringify(body))

/** The JSON object a request carries, or undefined: anything else, or more than 100 kB, is no body at all. */
const receive = (req) =>
  new Promise((done) => {
    let text = ''
    req.on('data', (chunk) => (text += chunk).length > 1e5 && req.destroy())
    req.on('close', () => done())
    req.on('end', () => {
      try {
        const v = JSON.parse(text)
        done(v !== null && typeof v === 'object' && !Array.isArray(v) ? v : undefined)
      } catch {
        done()
      }
    })
  })

// What a client may send is checked here, whatever the forms already check in the browser.
const text = (v, max) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined)
const valid = {
  title: (v) => text(v, 120),
  body: (v) => (v === '' ? '' : text(v, 5000)),
  status: (v) => (v === 'open' || v === 'closed' ? v : undefined),
  assignee: (v) => (v === '' || PEOPLE.includes(v) ? v : undefined),
  labels: (v) => (Array.isArray(v) && v.every((l) => LABELS.includes(l)) ? [...new Set(v)] : undefined),
}
/** The fields `keys` of `input`, validated; undefined when one of them is missing or wrong. */
const pick = (input, keys) => {
  const out = {}
  for (const k of keys) if ((out[k] = valid[k](input?.[k])) === undefined) return
  return out
}

/** `path` is what follows /tracker/api: "/counts", "/issues", "/issues/3", "/issues/3/comments". */
const api = async (req, res, path) => {
  const [, kind, id, sub] = path.split('/')
  const issue = id && find(id)
  if (kind === 'counts' && req.method === 'GET') return send(res, 200, counts())
  if (kind !== 'issues' || (id && !issue)) return send(res, 404)
  if (req.method === 'GET' && issue && !sub) return send(res, 200, issue)
  if (req.method === 'POST' && !id) {
    const fields = pick(await receive(req), ['title', 'body', 'labels', 'assignee'])
    if (!fields || issues.length >= 200) return send(res, 422)
    const created = { id: issues[issues.length - 1].id + 1, ...fields, status: 'open', author: ME, at: new Date().toISOString(), comments: [] }
    issues.push(created)
    return send(res, 201, created)
  }
  if (req.method === 'PATCH' && issue && !sub) {
    // The page sends the whole issue back: only these fields are the client's to change.
    const fields = pick(await receive(req), ['title', 'status', 'labels', 'assignee'])
    if (!fields) return send(res, 422)
    Object.assign(issue, fields)
    return send(res, 204)
  }
  if (req.method === 'POST' && issue && sub === 'comments') {
    const fields = pick(await receive(req), ['body'])
    if (!fields?.body || issue.comments.length >= 100) return send(res, 422)
    issue.comments.push({ id: (issue.comments[issue.comments.length - 1]?.id || 0) + 1, author: ME, body: fields.body, at: new Date().toISOString() })
    return send(res, 201)
  }
  send(res, 405)
}

/** Everything under /tracker/api/. */
export default (req, res) => api(req, res, new URL(req.url, 'http://localhost').pathname.slice(12)).catch(() => send(res, 500))

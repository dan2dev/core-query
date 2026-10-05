// The examples are one application. ssr.mjs renders any of its URLs, and from there the browser routes (layout.html):
// a link to another page only asks for that page's template (once) and for the state of its URL, as JSON. The server
// and the browser share this file, so both find the same page for a URL and render it with the same functions.
import * as chat from './chat.mjs'
import * as components from './components.mjs'
import * as dashboard from './dashboard.mjs'
import * as firstComponents from './first-components.mjs'
import * as invoice from './invoice.mjs'
import * as kanban from './kanban.mjs'
import * as routed from './routes.mjs'
import * as search from './search.mjs'
import * as shop from './shop.mjs'
import * as signup from './signup.mjs'
import * as todomvc from './todomvc.mjs'
import * as tracker from './tracker/shared.mjs'
import * as users from './users.mjs'

/** Each page's route. The name is its template, the file `<name>.html` of this folder. */
export const routes = {
  index: '/',
  'first-components': '/first-components',
  todo: '/todo',
  components: '/components',
  signup: '/signup',
  chat: '/chat',
  todomvc: '/todomvc',
  users: '/users',
  kanban: '/kanban',
  search: '/search',
  declarative: '/declarative',
  shop: '/shop',
  invoice: '/invoice',
  dashboard: '/dashboard',
  'routes/home': '/routes',
  'routes/user': '/routes/users/:id',
  'routes/about': '/routes/about',
  'tracker/list': '/tracker',
  'tracker/new': '/tracker/new',
  'tracker/issue': '/tracker/issues/:id',
}

/**
 * The JavaScript of each page: its template functions (`fns`), its `components` and the `state` it starts from (the
 * server's to send). Pages of HTML alone (index, todo, declarative) have none.
 */
export const modules = {
  'first-components': firstComponents,
  components,
  signup,
  chat,
  todomvc,
  users,
  kanban,
  search,
  shop,
  invoice,
  dashboard,
  'routes/home': routed,
  'routes/user': routed,
  'routes/about': routed,
  'tracker/list': tracker,
  'tracker/new': tracker,
  'tracker/issue': tracker,
}

# core-query

HTML-first reactive templates over a single state tree (the **TreeModel** of the 2017 thesis), with server-side rendering and hydration. No dependencies, ~9 KB gzipped for the browser.

```html
<script src="https://unpkg.com/core-query"></script>

<form data-on-submit="list.push(draft) draft.title.set('')">
  <input data-value="draft.title" required />
  <button>ADD</button>
</form>
<ul>
  <li data-for="item in list">
    <input type="checkbox" data-value="item.done" />
    <span data-text="item.title"></span>
    <button type="button" data-click=".delete()">x</button>
  </li>
</ul>
```

That is the whole app: the script-tag build mounts `<body>` by itself, so, like the 2017 original, a page needs no JavaScript of its own.

## Install

```sh
pnpm add core-query
```

```js
import { createApp } from 'core-query'

const app = createApp({ list: [] })
app.mount(document.querySelector('#app')!)
app.push('list', { title: 'from JS' })
```

## Templates

| Attribute | Does |
| --- | --- |
| `data-text="expr"` | Sets the element's text. Objects render as JSON. |
| `data-value="path"` / `data-bind="path"` | Two-way binding for `input`, `textarea`, `select` (checkbox → boolean, radio → its value, number/range → number). A checkbox bound to an array, or a `<select multiple>`, keeps the checked values in it. Text binding on other elements. |
| `data-context="path"` | Sets the context of the subtree: `.x` inside means `path.x`. |
| `data-for="list"` | Repeats the element per array item. `.` is the item. On a `<template>`, repeats all its elements. |
| `data-for="item in list"`, `data-for="item, i in list"` | Same, with aliases: `item.x`, `i` (the index). Aliases are visible to nested loops. |
| `data-key="item.id"` | On a `data-for`: matches items by key instead of by index (see [Lists](#lists)). |
| `data-if="expr"`, `data-else-if="expr"`, `data-else` | Renders the element only while the condition holds; removing it disposes its bindings and components. `data-else-if`/`data-else` go on the elements right after. |
| `data-show="expr"` | Toggles the `hidden` attribute; the element stays bound. SVG ignores `hidden`: add `svg [hidden] { display: none }`. |
| `data-click="actions"`, `data-on-<event>="actions"` | Runs actions on the event (HTML lowercases attribute names, so lowercase event names only). `submit` is `preventDefault`ed. Modifiers follow the event: `.prevent`, `.stop`, `.once`, and any other is a key the event must have: `data-on-keydown.enter`, `data-on-keydown.escape.stop`, `data-click.prevent`. `.self` runs only when the element itself is the target, `.outside` only for events outside the element (`data-click.outside` closes a menu), `.window` and `.document` listen there instead of on the element (`data-on-keydown.escape.window`). `.debounce` runs once, with the last event, after 250 ms without another; `.throttle` runs at once and then ignores events for 250 ms; a number right after either is the delay (`data-on-input.debounce.300`), so a key filter goes before it (`data-on-keydown.1.debounce`), and `.debounce.0` falls back to the 250 ms default. `.outside` listens in the capture phase, so a `.stop` elsewhere does not hide the event from it. Only the actions wait: `.prevent` and `.stop` apply to every event as it comes. |
| `data-on-mount="actions"` | Runs the actions once the element and its subtree are bound (a microtask later), with no `$event`: `data-on-mount="list.get('/api/todos')"`. The client only (after hydration too), and again each time the element is bound anew: a remount, a page the [router](#one-page-per-route) puts in place. A keyed item that only moves to another index does not run it again. |
| `data-attr-<name>="expr"` | Sets attribute `<name>`; `null`/`false` remove it, `true` sets it empty. SVG names keep their case (`data-attr-viewBox`). Values are set as is: validate URLs from untrusted data before binding them to `href`/`src` (`javascript:`). |
| `data-class-<name>="expr"` | Toggles one class. Lowercase names. |
| `data-style-<prop>="expr"` | Sets one style property, custom properties too (`data-style---hue`); `null`/`false` remove it. |
| `data-prop-<name>="expr"` | Sets a DOM property (`data-prop-indeterminate`); dashes become camelCase (`data-prop-current-time` → `currentTime`). The client only: properties are not HTML. |
| `data-state-<name>='json'` | Declares state that belongs to the element, read through the alias `<name>` (see [Local state](#local-state)). |
| `data-let-<name>="path"` | The alias `<name>` for `path` on the element and inside it, like a loop alias: a named prop for a [reusable block](#reusable-markup). A path, not an expression (one throws when mounting). Names are lowercase, as HTML makes attribute names: `data-let-userName` is `username`. |
| `data-transition="name"` | On an element of a `data-if`/`data-for`: the classes `name-enter` and `name-leave` when it is added and removed (see [Transitions](#transitions)). |
| `data-cloak` | Removed when the element is bound: with `[data-cloak] { display: none }` in your CSS, the raw template never shows. The server keeps the attribute, so leave it out of server-rendered pages: their content would stay hidden until the script runs. |
| `data-use="id"` | Fills the element with a copy of `<template id="id">` (see [Reusable markup](#reusable-markup)). |
| `data-component="name"` | Calls the component registered under `name` (see `component()`). |
| `data-page` | Where the router puts the page of the current route (see [One page per route](#one-page-per-route)). |

Paths are dot-separated (`todos.0.title`, `list.length`). A path starting with `.` is relative to the context (`.` alone is the context itself); a path starting with an alias (a loop's, a `data-let` or `data-state` name) goes through it; anything else starts at the root.

An **expression** is a path, optionally negated and piped through [template functions](#template-functions): `!list.length`, `status | eq('loading')`, `!item.id | eq(selected)`, `list.length | gt(0) | then('items', 'empty')`, `price | money('USD')`. `!` negates the result. There are no operators: `a == 'b'` or `n+1` is rejected when mounting.

**Actions** are space-separated calls `path.method(args)`, where method is `set`, `push`, `unshift`, `pop`, `shift`, `splice`, `delete`, a [request](#requests) (`get`, `post`, `put`, `patch`, `del`) or a [template function](#template-functions); any other name throws when mounting. Arguments are paths or literals (`'text'`, `"text"`, `42`, `true`, `false`, `null`); object arguments are copied, so `list.push(draft)` does not keep a reference to the draft. `$event` is the event: `search.set($event.target.value)`. Without a path, the method applies to the context: `.delete()` inside a list removes that item. An argument path that reads `undefined` logs a warning, and what is not a call (`x.set(1`) throws when mounting.

Prefer `<template data-for="…">` (or `data-if`) over putting the attribute on a visible element: it stays inert until the script runs.

### Template functions

Templates call functions with the value at the path and the arguments. Since expressions have no operators, these are built in, in the browser and on the server:

- `eq(x)`, `ne(x)`: `value === x`, `value !== x` (strict: `2` is not `'2'`).
- `gt(x)`, `gte(x)`, `lt(x)`, `lte(x)`: `>`, `>=`, `<`, `<=`.
- `not`: `!value`.
- `and(x)`, `or(x)`: `value && x`, `value || x`, so `name | or('anon')` is a default.
- `then(a, b)`: `a` when the value is truthy, else `b` (nothing without a `b`).
- `add(n)`: `value + n`; a value that is not a number counts as 0, so `counter.add(1)` works on a missing key.

```html
<button data-click="counter.add(1)">+</button> <b data-text="counter"></b>
<button data-click="open.not()">menu</button>
<p data-if="status | eq('loading')">Loading…</p>
<span data-text="list.length | eq(1) | then('item', 'items')"></span>
<tr data-for="r in rows" data-key="r.id" data-class-danger="r.id | eq(selected)">…</tr>
```

Register your own before `mount`; one registered under a built-in's name replaces it:

```js
app.fn('money', (v, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(v))
app.fn('pending', (todos) => todos.filter((t) => !t.done).length)
```

```html
<span data-text="total | money('USD')"></span> · <span data-text="todos | pending"></span> left
```

In an expression, `path | fn(args)` shows `fn(value, ...args)`; it updates when the path (or anything inside it) or a path argument changes, so functions should only read their arguments. As an action, `path.fn(args)` stores the result at `path`, unless it is `undefined` (then `fn` is just called: `list.save()`). The request verbs come first: a function named `get`, `post`, `put`, `patch` or `del` can be piped, but not called as an action.

To filter a list, put the condition on the item: `<li data-for="t in todos" data-if="!t.done">`. To sort it, store the sorted array: `todos.byDate()`.

### Lists

Without `data-key`, items are matched by index: removing an item rebinds the following elements to the next values instead of moving them, which is fast and keeps the DOM stable, but focus, typed text or an open `<details>` stay at their position.

With `data-key="t.id"` (or `data-key="."` for the item object itself), every item keeps its elements: removed items leave, new ones are inserted where they belong, and reordering moves only the elements that are out of order (swapping two rows moves two). An item's path is `todos.@<n>` rather than `todos.<index>`: it stands for the item wherever it moves, and `get`, `set`, `on` and the other methods take it, so a moved item is not bound again and its components keep running. With an index alias (`t, i in todos`), an item whose index changes is rebound in place, so its components restart (cleanup, then run again on the same element).

`a | eq(b)` (or `ne`), followed by functions with literal arguments only, renders the items whose `a` was or is the value of `b` when `b` changes: selecting one row of a thousand renders two.

### Reusable markup

New to components? [`examples/first-components.html`](../../examples/first-components.html) builds them step by step.

```html
<template id="card">
  <h3 data-text=".name"></h3>
  <slot name="actions"><i>no actions</i></slot>
  <slot></slot>
</template>

<article data-use="card" data-context="user">
  <p>bio</p>
  <button slot="actions" data-click=".name.set('Bia')">rename</button>
</article>
```

`data-use` replaces the element's content with a copy of the template: `<slot name="x">` takes the children with `slot="x"`, `<slot>` the others, and a slot left empty keeps its own content. The element's `data-context` is the props: inside, `.name` is `user.name`. Since the result is plain HTML, the server renders it too; add `data-component` to the same element for behavior.

For more than one prop, or a prop read inside the block's own `data-for` (where `.` is the item), name them with `data-let`:

```html
<template id="pick">
  <label data-for="o in options"><input type="checkbox" data-attr-value="o" data-value="value" /> <span data-text="o"></span></label>
</template>

<fieldset data-use="pick" data-let-options="labels" data-let-value="draft.labels"></fieldset>
<fieldset data-use="pick" data-let-options="labels" data-let-value="issue.labels"></fieldset>
```

A block is then one element: `data-use` (markup), `data-let-*` (props), `data-state-*` (its own state) and `data-component` (behavior). Two copies in the same context that declare the same `data-state` share it; give each its own name and alias it to the one the template reads: `<div data-use="menu" data-state-sort='{"open": false}' data-let-menu="sort">`. Aliases apply in the order written, after `data-context`, so the element's own bindings see them too; a `data-for` or `data-if` on the element is read before them, as with `data-context`: put it on a wrapping `<template>`.

Keep a shared `<template id>` at the top level of the document (the layout of a [routed app](#one-page-per-route) shares it with every page), not inside a `data-if`, a `data-for` or another template: the browser only finds it there. A block may use itself inside a `data-if` or a `data-for`, which ends the recursion.

### Reusable logic

Template functions and components are plain records, so one module serves every page and the server:

```js
// shared.mjs
export const fns = { 'shop:money': (v, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(v) }
export const components = { 'ui:focus': (el) => el.focus() }
```

```js
app.fn(fns) // browser: a record, or one name and function
app.component(components)
renderToString(html, state, fns) // server: the same record
```

A `ns:` prefix keeps the names of different modules apart. Logic over the state is a function of the app and a path (see [TypeScript](#typescript)).

### UI state

Keys starting with `#` stay in the browser: `post()`, [requests](#requests) and the server-rendered state leave them out. `item.#editing` marks a row as being edited without sending the flag to the server.

### Local state

```html
<div data-state-menu='{"open": false}' data-click.outside="menu.open.set(false)">
  <button data-click="menu.open.not()">Menu</button>
  <ul data-if="menu.open">…</ul>
</div>
```

`data-state-<name>` declares state that belongs to an element. The JSON (an empty attribute is `{}`) is stored at `#<name>` in the element's context (here `#menu`; under `data-context="user"`, `user.#menu`), and `<name>` is an alias for it on the element and inside it, like a loop alias: there it hides a root key of the same name. Being a `#key`, it is never posted and never embedded by the server, which renders the element from the same initial value; hydration then starts from the attribute again.

In a `data-for` each item has its own (`todos.1.#ui`), which follows the item when a keyed list reorders. The attribute only gives the value while there is none, so a remount keeps the state too; when the context is replaced (`todos` set to a new array), the state starts from the attribute again. While the context is missing (`data-context="user"` with no `user` yet) nothing is created: the state appears once the context does.

Declare a state before the elements that read it where possible. One read earlier in the document (`<b data-show="#menu.open">` before the `data-state-menu` element) still renders right, but costs the server one more render of the template, and a client without server markup one more DOM update.

Limits: the context must be an object (items that are strings or numbers have nowhere to keep it: mounting throws); on the server, the JSON may only use the named references `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and `&nbsp;` (any other throws: write the character itself or a numeric reference); names are lowercase, as HTML makes attribute names; and two elements that declare the same name in the same context share one state, started from the first one's value (to keep them apart, see [Reusable markup](#reusable-markup)).

### Requests

```html
<main data-on-mount="todos.get('/api/todos')">
  <input type="search" data-value="q" data-on-input.debounce.300="todos.get('/api/todos?q=', q)" />
  <p data-if="#todos.loading">Loading…</p>
  <p data-else-if="#todos.error">Failed: <b data-text="#todos.error.message"></b></p>
  <ul data-else><li data-for="t in todos" data-text="t.title"></li></ul>
  <form data-on-submit="draft.post('/api/todos') todos.get('/api/todos') draft.title.set('')">…</form>
</main>
```

As actions, `path.get(url)` fetches JSON and stores it at `path`; `path.post(url)`, `path.put(url)` and `path.patch(url)` send the value at `path` as JSON, without its `#keys`, and do not store the response; `path.del(url)` sends a DELETE without a body (`delete` already removes a key). The URL is the arguments joined: literals as written, values read from paths (or `$event`) through `encodeURIComponent`, so `todos.get('/api/todos?q=', q)` is right for any `q`. A value that is exactly `.` or `..` throws when it would be a path segment (before any `?` or `#`): no encoding keeps the browser from resolving it, so `t.del('/api/todos/', t.id)` would hit the parent URL.

Each path has its flags next to it, at the `#` key of the same name (`todos` → `#todos`, `a.b.todos` → `a.b.#todos`): `loading`, and `error`, which is `null` or `{ status, message }`. A response that is not 2xx gives its status and status text (HTTP/2 has none: `message` is then empty), a network failure `status: 0` with the error's message; a GET whose body is not JSON fails too. A failed request leaves the value at the path as it was.

The actions after a request wait for it and are skipped when it fails: above, the list is reloaded and the draft cleared only once the POST succeeded. The actions before it still run at once. A new request for a path aborts the one in flight for that path, and the rest of that one's handler with it: the latest search wins.

A request's path is by index (a keyed item's too: its flags are at `todos.#2`), and a list can change while a request is in flight. So the actions after a request run in the scope their element has by then (a keyed item that moved is still that item) and are skipped when the element left the page; and a GET response is dropped when the value at its path was replaced meanwhile (another item moved there, the list was reloaded). A pending `.debounce` action is dropped too if its element is rebound or removed first, for example when a keyed list with an index alias reorders within the delay.

From JS, `app.send(path, method, url, init?)` does the same (`method` in any case: `'GET'`, `'get'`). It returns a promise of the response, rejected on a network error or a non-2xx response, after setting the flags. `init` goes to `fetch`; an `init.body` is sent as given. `post()` is unchanged and sets no flags.

[`examples/declarative.html`](../../examples/declarative.html) is a search page built from these, with no JavaScript of its own; its endpoint is in [`examples/ssr.mjs`](../../examples/ssr.mjs).

### Transitions

```html
<li data-for="t in todos" data-key="t.id" data-transition="fade">…</li>
```

```css
li { transition: opacity 0.2s; }
.fade-enter, .fade-leave { opacity: 0; }
```

`data-transition` goes on an element a `data-if` or `data-for` adds and removes (the element with that attribute, or a direct child of its `<template>`). When the block adds it, it comes with the class `fade-enter`, removed as soon as it is in the page, so a CSS transition runs from that state. When the block removes it, it gets `fade-leave` and stays in the page until the animations and transitions running on it have finished; with none, it is removed at once. Without a name the classes are `cq-enter` and `cq-leave`. Nothing is animated on the first render nor on hydration, and the server ignores the attribute.

A leaving element is already unbound (its bindings no longer update, its actions do nothing) and no longer counts as an item, but it is still in the page: in a `data-if`/`data-else` chain the next branch enters while the previous one leaves, so overlap them with CSS if they should not sit side by side. The wait is for every animation on the element itself: one that never ends (`animation: spin 1s infinite`) keeps it in the page for good, and the animations of its children are not waited for. `-enter` is only there for an instant: it is a starting point for a transition, not a place for `@keyframes`.

## API

`createApp(state?)` returns an app with the thesis API:

| Method | Does |
| --- | --- |
| `get(path?)` | Value at `path` (the whole state without one). |
| `set(path, value)` | Sets `path`, creating objects on the way (arrays for numeric keys). |
| `push(path, ...values)`, `unshift(path, ...values)`, `pop(path)`, `shift(path)`, `splice(path, start, count?, ...values)` | Array operations; `push`/`unshift` create the array. |
| `delete(path)` | Removes a key, or splices an array item. |
| `on(path, fn, { now }?)` | `fn(value)` after the value at `path`, or inside it, may have changed; with `now: true` also right away. Returns unsubscribe. |
| `tick()` | Resolves once the pending changes reached the DOM and the `on` listeners: `app.push('msgs', m); await app.tick(); chat.scrollTop = chat.scrollHeight`. |
| `post(path, url, init?)` | `fetch` POST of the value at `path` as JSON, without its `#keys`. |
| `send(path, method, url, init?)` | A [request](#requests) from JS: `'GET'` stores the JSON response at `path`, the other methods send its value; keeps `#<key>.loading` and `#<key>.error`, and a new one for the same path aborts the one in flight. Rejects on a network error or a non-2xx response. |
| `bind(el, path)` | `data-value` from JS. Returns unbind. |
| `click(elOrSelector, fn)` | `fn(value, path, event)` with the element's context. A selector is delegated, so it also covers list items added later; elements outside the mounted root are ignored. |
| `fn(name, fn)`, `fn(fns)` | Registers a [template function](#template-functions), or every one of a record. Register before `mount`. |
| `component(name, fn)`, `component(components)` | `fn(el, path, app)` for each `data-component="name"`, `path` being its `data-value`/`data-bind` path, resolved through the element's aliases (on a form control it is also bound; on any other element the component owns the content). Return a function to clean up when the element is removed (a list item, a `data-if`). Register before `mount`: an unknown name logs a warning. |
| `router(routes, { pages, base }?)` | Keeps the URL, matched against `routes`, at the `route` path; with `pages: (name) => url` each route is a page, its template fetched once from that URL and its state from the server on every navigation; with `base: '/app'` the patterns are relative to that prefix (see [Router](#router)). Call before `mount`. Returns the app. |
| `go(url, replace?)` | Navigates without reloading: pushes (or replaces) the history entry, loads the page (with `pages`) and updates `route`. Returns a promise, resolved once the page is in place. |
| `render(el, path?)` | Binds `el` and its subtree with `path` as its context: markup a component or a `fetch` added after mount. Returns unbind. |
| `mount(root = document.body)` | Binds the template under `root`, hydrating server markup. Returns unmount; mounting again later adopts the rendered DOM. One live mount per app (the script-tag build has already mounted `<body>`). |

Changes are batched: the DOM (and `on` listeners) update once per microtask, however many times the state changed.

The script-tag build exposes the app as `window.CoreQuery` (and `window.Corequery`, the legacy name), so `CoreQuery.set('name', 'Ana')` and `CoreQuery.fn('double', (n) => n * 2)` work in any inline script. On a server-rendered page, mounting (on `DOMContentLoaded`) applies the server state over its top-level keys, so make such writes in a `DOMContentLoaded` listener added after the library's.

### TypeScript

The state is typed from the value given to `createApp`; paths and values are then checked, and the editor completes them, at any depth:

```ts
type Todo = { id: number; title: string; done: boolean }
const app = createApp({ filter: 'all', todos: [] as Todo[], draft: { title: '', labels: [] }, user: null })

app.set('todos.0.done', true)
app.on('todos', (todos) => …) // todos: Todo[]
app.set(`todos.${i}.title`, 'x') // a template literal is checked too
app.set('filter', 1) // error: a number is not a string
app.get('todos.0.titel') // error: not '"todos.0.id" | "todos.0.title" | "todos.0.done" | …'
```

`[]`, `null`, `undefined` and `{}` are values to come and accept anything: write `[] as Todo[]` where the items have a type. The keys the runtime writes are typed too: `#todos.loading` and `#todos.error` ([request flags](#requests)) next to `todos`, and any other `#key` ([UI](#ui-state) and [local](#local-state) state) as `any` unless the state declares it. A path built at runtime (`'todos.' + i`) is a `string`, which is rejected: write a template literal. `bind()` and `render()` take one anyway (`app.bind(input, input.name)`), unchecked. A state given as `ssr ? {} : state()` is `{}` to TypeScript: name its type there.

When keys come later (the server's state, a page's), name the type and give what there is, or nothing: `createApp<State>({ filter: 'all' })`, with the late keys optional (`user?: User`) so reading them says they may be missing; `createApp<any>()` checks nothing.

Components get the app's type; annotate `el` or `path` to narrow them: `app.component('dialog', (el: HTMLDialogElement, path: 'modal', a) => a.on(path, (open) => …))`. A component shared between apps is typed by the part of the state it uses, and registers on any app that has that part: `const volume: Component<{ volume: number }> = (el, path: 'volume', a) => …`. Logic shared between paths is a function of the app and a path, checked where it is called:

```ts
import type { App, At, ValidPath } from 'core-query'

const undoable = <S, P extends string>(app: App<S>, path: ValidPath<S, P>) => {
  const past: At<S, P>[] = []
  app.on(path, (v) => void past.push(structuredClone(v)), { now: true })
  return () => past.length > 1 && (past.pop(), app.set(path, past.pop()!)) // the set pushes it back
}
undoable(app, 'todos') // 'todoz' is an error
```

## Server-side rendering and hydration

```js
import { renderToString } from 'core-query/server'

const html = renderToString(template, state, fns)
```

`fns` are your [template functions](#template-functions), the same the client registers (the built-ins are already there). The output is the template with every directive rendered and its `data-*` attributes kept, plus the state as JSON in a `<script type="application/json" data-cq-state>` (first in `<body>`, or at the end of a fragment). In the browser, `mount()` reads the state scripts inside its root (else the one right after the root, or directly in `<body>`, so `mount(#app)` works on a rendered page) and adopts the existing nodes: hydration makes no DOM changes. The script-tag build mounts `<body>`. Lists and conditionals render as `<template data-for="…" data-n="N">` (or `data-if`) followed by their `N` items; `data-use` elements come filled, and `data-state-*` elements are rendered from their initial value. `data-on-mount`, `data-transition`, `data-cloak` and `data-page` mean nothing to the server: it leaves them in place.

The server parser has no implied end tags: close your tags. The usual omissions throw, with the line, instead of rendering another tree than the browser builds: `CoreQuery: unclosed <li> before <li> (line 12)`. That covers an `<li>`, `<option>`, `<tr>`, `<td>`/`<th>` or `<dt>`/`<dd>` opened right inside an unclosed one, and a block element (`<div>`, `<ul>`, `<table>`, `<h1>`, another `<p>`…) inside an unclosed `<p>`. Anything else is still read leniently, for example an `<li>` after an unclosed `<p>`, or elements left open at the end of the input.

[`examples/ssr.mjs`](../../examples/ssr.mjs) is a complete server: it renders every page of the examples, each with the state and the template functions it shares with the browser (the shop's are in [`examples/shop.mjs`](../../examples/shop.mjs)), and keeps the to-do list, the cart and the tracker's issues that the pages send back. The pages, one per real use case, are listed in [`examples/index.html`](../../examples/index.html).

## Router

The URL is state. `router()` takes named patterns and keeps the current URL, matched against them, at the `route` path:

```js
const routes = { home: '/', user: '/users/:id', docs: '/docs/*' } as const
const app = createApp({ title: '' }).router(routes) // before mount; returns the app
```

```html
<nav><a href="/" data-class-active="route.is.home">Home</a> <a href="/users/7?tab=orders">Ana</a></nav>
<template data-if="route.is.home">…</template>
<template data-else-if="route.is.user">
  User <b data-text="route.params.id"></b>, tab <b data-text="route.query.tab"></b>
</template>
<template data-else>Not found</template>
```

At `/users/7?tab=orders#top`, `route` is `{ path: '/users/7', name: 'user', is: { user: true }, params: { id: '7' }, query: { tab: 'orders' }, hash: '#top' }`. The first pattern that matches wins; `:name` takes one segment, a last `*` the rest of the path (`route.params.*`), a trailing slash is ignored. When none matches, `name` is missing and `is` is empty: the `data-else` above is the 404.

Plain `<a href>` links inside the mounted root that lead to a route navigate in place (history entry, scroll to the top); links to anything else, `target`, `download` and modified clicks are left to the browser, and back/forward update `route`. From JS, `app.go('/users/7')`. To load data for a page, `app.on('route', (r) => …)`.

On the server, compute the same value with the same routes; the client then hydrates the page it finds without touching it:

```js
import { renderToString, route } from 'core-query/server'

const r = route(req.url, routes) // also exported by 'core-query'
res.writeHead(r.name ? 200 : 404).end(renderToString(template, { ...state, route: r }, fns))
```

When the app lives under a prefix, give it to both sides as the base instead of repeating it in every pattern:

```js
app.router(routes, { base: '/app' }) // browser
route(req.url, routes, '/app') // server
```

The patterns are then relative to it: `/app/users/7` is `user`, `/app` is `home`. `route.path` is still the full path, links and `app.go()` still take the full URL (`href="/app/users/7"`), and a URL outside the base matches no route, so a link to it is left to the browser. The pages of [`examples/routes/`](../../examples/routes) write the prefix in the patterns instead (`/routes/users/:id`), which works as before.

### One page per route

The template above keeps every page in one document. When each route is a page of its own, give the router the URL of each route's template and mark where the page goes with `data-page`:

```js
app.router(routes, { pages: (name) => `/pages/${name}.html` })
```

```html
<nav><a href="/">Home</a> <a href="/users/7">Ana</a></nav>
<main data-page><!-- page --></main>
```

A page is a template and a state, and they travel apart:

- The **template** belongs to the route: a static fragment (`/pages/user.html`), the same for every URL of the route. The browser fetches it once and keeps it. While it is idle it also fetches the templates of the routes the page links to, so a click finds them loaded.
- The **state** belongs to the URL: on every navigation the browser asks the server for it as JSON, with a request for that same URL carrying `Accept: application/json`.

```js
// server: a visit gets the page rendered, a navigation only its state
const r = route(req.url, routes)
const state = { ...(await stateOf(r)), route: r }
if (req.headers.accept === 'application/json') {
  res.writeHead(r.name ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(state))
} else {
  const html = layout.replace('<!-- page -->', pages[r.name || 'notFound'])
  res.writeHead(r.name ? 200 : 404).end(renderToString(html, state, fns))
}
```

The first page is hydrated as usual. Navigating to a route then renders its template in the `data-page` element, with the state of the URL merged over the current one. Only that element changes: what is around it (the layout) stays bound and follows the state like any template. Keys the server does not send, such as a cart, stay; the root `#` keys (local state, request flags) go with the page that leaves, as a full load of the new URL starts without them.

Between two URLs of the same route (`/users/7` to `/users/8`, `?tab=a` to `?tab=b`) the page stays where it is and only the state changes: an input keeps its focus, the `#` keys are kept and `data-on-mount` does not run again. Only the path and the query make a page: a hash change fetches nothing.

What the router cannot show is the browser's to load, as a visit to that URL: a URL that is no route (the server's 404 page), a template or a state that did not come (offline, an error status, a redirect to a login page, a server that answers HTML) or a document with no `data-page`. So a server that ignores the `Accept` header still works, with full page loads.

The state is requested with `cache: 'no-store'`, so the browser never finds that JSON when the same URL is loaded as a document (back from another site, a restored tab); a shared cache in front of the server needs `Vary: Accept` for the same reason. The templates are plain requests: let the browser cache them as long as you like.

`<head>` is not part of a page template, so the title is state like the rest: send it with each page's state (the server renders `<title data-text="title">` like any element) and keep the document's on it with `app.on('title', (t) => (document.title = t))`. A `<style>` in a page template comes and goes with the page. Scripts in a template do not run, so register every template function and component in what all pages share (the layout).

With TypeScript, `route` is typed from the routes given to `router()`, so take the app it returns: `route.is.home` and `route.params.id` are checked, and `if (r.name === 'user')` narrows `r.params` to `{ id: string }` (`r.is.user` does not narrow). Routes kept in a variable keep their params when written `as const`, as above; otherwise each route's params are `Record<string, string>`. On the server, `route(url, routes)` gives the same type. With an explicit state type, `route: Route<typeof routes>` is the field.

The examples are one application built this way: every page is a route of [`examples/app.mjs`](../../examples/app.mjs), and [`examples/layout.html`](../../examples/layout.html) has each name of a function or component call the one of the page showing, so two pages can each have their own `money`. [`examples/routes/`](../../examples/routes) is the router at its smallest, with a layout of its own around its pages. [`examples/tracker/`](../../examples/tracker) is a whole application built on it: filters, search and paging that live in the URL and update the page in place, forms that post to a JSON API and then ask for what they changed, and the server's own 404 for what is not there.

## Coming from the 2017 CoreQuery

The thesis's templates and API work as written, with two changes: the dotted loop forms (`data-for="list.i"`, `data-for="list.index.item"`) are ambiguous with nested paths and were replaced by `data-for="list"` (item is `.`) or `data-for="item, i in list"`; and `post(key, callback)`, which had no URL, is now `post(path, url, init?)` returning the `fetch` promise. The conditionals and server-side rendering the thesis planned are now built in.

## Development

```sh
pnpm install
pnpm --filter core-query test       # vitest + happy-dom
pnpm --filter core-query build      # tsup → dist/
pnpm --filter core-query size       # fails above 10 KB gzip (10240 B)
```

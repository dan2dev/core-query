# coreQuery

The new way to create dynamic web pages.

The library lives in [packages/core-query](packages/core-query): HTML-first reactive templates over a single state tree, with SSR, hydration and a router, ~9 KB gzipped.

```sh
pnpm install
pnpm test
pnpm build
```

[examples/](examples/) has one page per real use case, from the to-do list of the 2017 thesis to whole applications (TodoMVC, a data table, a sign-up form, two searches, a chat, a kanban board, UI components, a shop, an invoice editor, a dashboard with SVG charts, and two routed apps on a server: a small one and an issue tracker): build, run `node examples/ssr.mjs` and open http://localhost:3000. Every page comes rendered by the server, and from there the browser routes between them without reloading.

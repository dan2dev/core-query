// What the steps of first-components.html run: the JavaScript each step shows, as data and functions the server
// renders with too.
const esc = (s) => s.replace(/[&<>]/g, (c) => '&#' + c.charCodeAt(0) + ';')
const dedent = (s) => {
  const lines = s.split('\n')
  const n = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length))
  return lines.map((l) => l.slice(n)).join('\n')
}

/** The page's template with the source of each `.demo` above it, so the HTML on the page is the HTML that runs. */
// ponytail: a demo ends at the first </div> indented like its start; a parser if the demos stop being written that way.
export const template = (html) =>
  html.replace(/^( *)<div class="demo" data-code>\n([\s\S]*?)\n\1<\/div>/gm, (demo, indent, src) => `${indent}<pre data-lang="HTML">${esc(dedent(src))}</pre>\n${demo}`)

export const state = () => ({
  title: 'Your first components · core-query',
  ana: { name: 'Ana', job: 'Designer' },
  bia: { name: 'Bia', job: 'Developer' },
  people: [
    { name: 'Ana', job: 'Designer' },
    { name: 'Bia', job: 'Developer' },
  ],
  newcomer: { name: 'Caio', job: 'New here' },
  order: { apples: 1, pears: 0 },
  stock: { apples: 5, pears: 3 },
  faq: [
    { title: 'Do I need a build step?', answer: 'No: one script tag is enough.' },
    { title: 'Is it still HTML?', answer: 'Yes: a template and data-* attributes.' },
  ],
  showClock: true,
  modal: false,
  products: [
    { name: 'Coffee', price: 4.5, qty: 1, stock: 9 },
    { name: 'Bread', price: 2.25, qty: 2, stock: 4 },
  ],
})

export const fns = {
  money: (n) => '$' + n.toFixed(2),
  total: (products) => products.reduce((sum, p) => sum + p.price * p.qty, 0),
}

export const components = {
  clock: (el) => {
    const show = () => (el.textContent = new Date().toLocaleTimeString())
    show()
    const timer = setInterval(show, 1000)
    return () => clearInterval(timer) // the element left the page
  },
  // app.on returns its own cleanup: return it, and it stops listening when the dialog goes away.
  dialog: (el, path, app) => app.on(path, (open) => (open ? el.open || el.showModal() : el.close()), { now: true }),
}

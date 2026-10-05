// The invoices' state and functions (invoice.html). The "invoices" component keeps the undo history and saves every
// step in this browser, for as long as the page shows.
const KEY = 'cq-invoices'
/** "2026-10-04", `days` from today. */
const iso = (days = 0) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)
let id = Date.now()

// ---- amounts: each one a function of the data, so the page never stores a number it can work out ----
const amount = (it) => (+it.qty || 0) * (+it.price || 0)
const subtotal = (inv) => inv.items.reduce((s, it) => s + amount(it), 0)
const discount = (inv) => (subtotal(inv) * (+inv.discount || 0)) / 100
const tax = (inv) => ((subtotal(inv) - discount(inv)) * (+inv.tax || 0)) / 100
const total = (inv) => subtotal(inv) - discount(inv) + tax(inv)

const numbered = (invoices) => 'INV-' + String(Math.max(0, ...invoices.map((inv) => parseInt(inv.number.replace(/\D/g, '')) || 0)) + 1).padStart(4, '0')
const sample = () => [
  {
    id: id++, number: 'INV-0041', date: iso(-45), due: iso(-15), paid: false,
    client: { name: 'Acme Hosting', email: 'billing@acme.example', address: '500 Server Farm Rd\nPortland, OR' },
    items: [
      { id: id++, description: 'Design system audit', qty: 12, price: 140 },
      { id: id++, description: 'Component library, first batch', qty: 30, price: 120 },
      { id: id++, description: 'Accessibility review', qty: 6, price: 160 },
    ],
    discount: 5, tax: 8.5, notes: 'Payment by bank transfer within 30 days.',
  },
  {
    id: id++, number: 'INV-0042', date: iso(-12), due: iso(18), paid: false,
    client: { name: 'Blue Kettle Tea', email: 'hello@bluekettle.example', address: '12 Harbour St\nBristol' },
    items: [
      { id: id++, description: 'Online shop: product pages', qty: 22, price: 110 },
      { id: id++, description: 'Checkout with coupons', qty: 14, price: 110 },
    ],
    discount: 0, tax: 20, notes: '',
  },
  {
    id: id++, number: 'INV-0043', date: iso(-60), due: iso(-30), paid: true,
    client: { name: 'Northwind Bikes', email: 'accounts@northwind.example', address: '' },
    items: [{ id: id++, description: 'Maintenance, September', qty: 1, price: 900 }],
    discount: 0, tax: 0, notes: 'Thank you!',
  },
]

export const state = () => {
  const invoices = sample()
  return { title: 'Invoices · core-query', currencies: ['USD', 'EUR', 'GBP', 'BRL', 'JPY'], currency: 'USD', invoices, current: invoices[0].id }
}

/** The history of the page showing: set by the component. */
let history

export const fns = {
  amount,
  subtotal,
  discount,
  tax,
  total,
  money: (v, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v),
  outstanding: (invoices) => invoices.reduce((s, inv) => s + (inv.paid ? 0 : total(inv)), 0),
  status: (inv) => (inv.paid ? 'paid' : inv.due && inv.due < iso() ? 'overdue' : 'due'),
  lateDue: (inv) => !!inv.date && !!inv.due && inv.due < inv.date,
  isLast: (i, items) => i === items.length - 1,
  none: (invoices, current) => !invoices.some((inv) => inv.id === current),

  // ---- actions: they get the value at their path and return its new value ----
  addItem: (items) => [...items, { id: id++, description: '', qty: 1, price: 0 }],
  copyItem: (items, i) => [...items.slice(0, i + 1), { ...items[i], id: id++ }, ...items.slice(i + 1)],
  moveItem: (items, i, step) => {
    const next = [...items]
    ;[next[i], next[i + step]] = [next[i + step], next[i]]
    return next
  },
  newInvoice: (invoices) => [
    ...invoices,
    { id: id++, number: numbered(invoices), date: iso(), due: iso(30), paid: false, client: { name: '', email: '', address: '' }, items: [{ id: id++, description: '', qty: 1, price: 0 }], discount: 0, tax: 0, notes: '' },
  ],
  copyInvoice: (invoices, from) => {
    const inv = structuredClone(invoices.find((x) => x.id === from))
    return [...invoices, { ...inv, id: id++, number: numbered(invoices), date: iso(), due: iso(30), paid: false, items: inv.items.map((it) => ({ ...it, id: id++ })) }]
  },
  without: (invoices, gone) => invoices.filter((inv) => inv.id !== gone),
  latest: (_, invoices) => invoices[invoices.length - 1].id,
  firstOf: (_, invoices) => invoices[0]?.id ?? null,
  print: () => void print(),
  sample,
  // undo and redo return the invoices of the step they land on, and an action stores what its function returns.
  undo: () => history.undo(),
  redo: () => history.redo(),
}

export const components = {
  /**
   * The history and the saving: a snapshot after each burst of changes (half a second without one), so a typed word is
   * one step. Starts from the invoices saved in this browser, if any.
   */
  invoices: (_, __, app) => {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (stored) app.set('invoices', stored), app.set('current', stored[0]?.id ?? null)
    const snapshot = () => JSON.stringify(app.get('invoices'))
    const past = []
    const future = []
    let saved = snapshot()
    let timer
    /** Takes what changed since the last snapshot as one step, and saves it. */
    const commit = () => {
      clearTimeout(timer)
      const now = snapshot()
      if (now === saved) return
      if (past.push(saved) > 100) past.shift()
      future.length = 0
      localStorage.setItem(KEY, (saved = now))
    }
    const counts = () => app.set('#history', { undo: past.length, redo: future.length })
    /** One step from `from` to `to`: the invoices of the step it lands on, or undefined at the end of the line. */
    const travel = (from, to) => {
      commit()
      const step = from.pop()
      if (step) to.push(saved), localStorage.setItem(KEY, (saved = step))
      counts()
      return step && JSON.parse(step)
    }
    history = { undo: () => travel(past, future), redo: () => travel(future, past) }
    const off = app.on('invoices', () => {
      clearTimeout(timer)
      timer = setTimeout(() => (commit(), counts()), 500)
    })
    const keys = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault() // the page's history, not the field's own
      const step = e.shiftKey ? history.redo() : history.undo()
      if (step) app.set('invoices', step)
    }
    addEventListener('keydown', keys)
    counts()
    // The last burst is saved too: the store still has the invoices when the page leaves.
    return () => (commit(), off(), removeEventListener('keydown', keys))
  },
}

// The dashboard's state and functions (dashboard.html): the server renders the charts from the same `view`, and the
// "dashboard" component derives it again whenever the slice changes, for as long as the page shows.
const CHANNELS = [{ id: 'web', name: 'Web' }, { id: 'app', name: 'App' }, { id: 'partners', name: 'Partners' }]
const PRODUCTS = [['core-query T-shirt', 79.9], ['TreeModel hoodie', 189.9], ['SSR mug', 49.9], ['data-* stickers', 14.9], ['Hydration cap', 69.9], ['Template notebook', 39.9]]
// The plot inside the 720 × 260 viewBox: the y labels go to its left, the series names to its right, the dates below.
const W = 720
const [LEFT, RIGHT, TOP, BOTTOM] = [48, 640, 12, 228]

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const int = new Intl.NumberFormat('en-US')
const date = (iso, weekday) => new Date(iso + 'T00:00Z').toLocaleDateString('en-US', { weekday, month: 'short', day: 'numeric', timeZone: 'UTC' })
const sum = (xs) => xs.reduce((a, b) => a + b, 0)

// ---- the sample: orders of each product per day and channel, the same on every load (a seeded generator) ----
let seed = 7
const random = () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const BASE = { web: [9, 4, 7, 12, 3, 5], app: [5, 1.5, 3, 8, 2, 2.5], partners: [1.5, 1.2, 1, 2, 0.6, 1.5] }
const WEEK = { web: [1, 1.05, 1.05, 1, 1.1, 0.8, 0.75], app: [0.9, 0.95, 1, 1, 1.1, 1.3, 1.25], partners: [1.2, 1.2, 1.15, 1.1, 1, 0.3, 0.2] } // Monday first
const START = Date.UTC(2026, 3, 6)
/** Day `n`: a level per product, the channel's weekly rhythm, a slow growth and some noise. */
const day = (n) => {
  const d = new Date(START + n * 864e5)
  const sales = {}
  for (const { id } of CHANNELS) sales[id] = BASE[id].map((level) => Math.round(level * WEEK[id][(d.getUTCDay() + 6) % 7] * (1 + n / 400) * (0.8 + random() * 0.4)))
  return { date: d.toISOString().slice(0, 10), sales }
}

// ---- the view: everything the page shows for a slice of the data ----
const orders = (days, ids) => sum(days.map((d) => sum(ids.map((id) => sum(d.sales[id])))))
const revenue = (days, ids) => sum(days.map((d) => sum(ids.map((id) => sum(d.sales[id].map((n, p) => n * PRODUCTS[p][1]))))))
/** Round values from 0 up to at least `max`, in steps of 1, 2 or 5 × 10ⁿ: about five of them. */
const ticks = (max) => {
  const power = 10 ** Math.floor(Math.log10(max / 5))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= max / 5)
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

const view = (days, range, ids) => {
  const now = days.slice(-range)
  const before = days.slice(-2 * range, -range)
  const on = CHANNELS.filter((c) => ids.includes(c.id)) // in the channels' own order, whatever the order of the clicks
  const all = on.map((c) => c.id)

  /** A stat tile: the value of the period, its change against the one before, and its course in up to 12 points. */
  const tile = (id, label, of, format) => {
    const change = of(before) ? of(now) / of(before) - 1 : 0
    const n = Math.min(12, now.length)
    const parts = Array.from({ length: n }, (_, i) => of(now.slice(Math.floor((i * now.length) / n), Math.floor(((i + 1) * now.length) / n))))
    const [low, high] = [Math.min(...parts), Math.max(...parts)]
    const points = parts.map((v, i) => [4 + (i * 112) / (n - 1), 28 - ((v - low) / (high - low || 1)) * 24])
    return {
      id,
      label,
      value: format(of(now)),
      trend: change > 0.0005 ? 'up' : change < -0.0005 ? 'down' : 'flat',
      arrow: change > 0.0005 ? '▲' : change < -0.0005 ? '▼' : '–',
      delta: (change < 0 ? '−' : '+') + Math.abs(change * 100).toFixed(1) + '%',
      spark: points.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' '),
      end: { x: points[n - 1][0], y: points[n - 1][1] },
    }
  }

  // The line chart: a value per day and channel, on one scale that starts at 0.
  const values = on.map((c) => now.map((d) => revenue([d], [c.id])))
  const scale = ticks(Math.max(1, ...values.flat()))
  const top = scale[scale.length - 1]
  const x = (i) => LEFT + (i * (RIGHT - LEFT)) / (now.length - 1)
  const y = (v) => BOTTOM - (v / top) * (BOTTOM - TOP)
  const every = Math.ceil(now.length / 6)
  const series = on.map((c, s) => ({
    ...c,
    d: values[s].map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(''),
    end: { x: RIGHT, y: y(values[s][now.length - 1]) },
  }))
  // A name at the end of its line, unless another one already sits there: then the legend and the tooltip tell.
  const named = []
  for (const s of [...series].sort((a, b) => a.end.y - b.end.y)) if ((s.label = named.every((n) => Math.abs(n - s.end.y) > 14))) named.push(s.end.y)

  // The bars: one per product, the best seller first.
  const products = PRODUCTS.map(([name, price], p) => {
    const n = sum(now.map((d) => sum(all.map((id) => d.sales[id][p]))))
    return { name, orders: n, revenue: n * price }
  }).sort((a, b) => b.revenue - a.revenue)
  const total = sum(products.map((p) => p.revenue)) || 1

  return {
    tiles: [
      tile('revenue', 'Revenue', (ds) => revenue(ds, all), compact.format),
      tile('orders', 'Orders', (ds) => orders(ds, all), int.format),
      tile('average', 'Average order value', (ds) => (orders(ds, all) ? revenue(ds, all) / orders(ds, all) : 0), usd.format),
    ],
    top,
    series,
    yTicks: scale.map((v) => ({ y: y(v), label: '$' + int.format(v) })),
    // About six dates, counted back from the last day so that one is always named.
    xTicks: now.map((d, i) => ({ x: x(i), label: date(d.date) })).filter((_, i) => (now.length - 1 - i) % every === 0),
    rows: now.map((d, i) => ({ x: x(i), label: date(d.date), long: date(d.date, 'short'), values: values.map((v) => v[i]), total: sum(values.map((v) => v[i])) })),
    bars: products.map((p) => ({ ...p, ratio: p.revenue / (products[0].revenue || 1), share: Math.round((p.revenue / total) * 100) + '%' })),
  }
}

// ---- the crosshair ----
/** What the crosshair and the tooltip show for day `i` of view `v`: its x, its date and every series' value there. */
const hit = (v, i) => {
  const row = v.rows[(i = Math.max(0, Math.min(v.rows.length - 1, i)))]
  return {
    i,
    x: row.x,
    left: (row.x / W) * 100 + '%',
    label: row.long,
    rows: v.series.map((s, k) => ({ id: s.id, name: s.name, value: row.values[k], y: BOTTOM - (row.values[k] / v.top) * (BOTTOM - TOP) })),
  }
}

export const state = () => {
  seed = 7 // the same sample on every visit
  const days = Array.from({ length: 180 }, (_, n) => day(n))
  const channels = CHANNELS.map((c) => c.id)
  return { title: 'Dashboard · core-query', ranges: [7, 30, 90], channelList: CHANNELS, range: 30, channels, live: false, days, view: view(days, 30, channels) }
}

export const fns = {
  money: (v) => usd.format(v),
  compact: (v) => compact.format(v),
  count: (v) => int.format(v),
  at: (_, e, v) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * W
    return hit(v, Math.round(((x - LEFT) / (RIGHT - LEFT)) * (v.rows.length - 1)))
  },
  move: (hover, step, v) => hit(v, hover ? hover.i + step : Infinity),
}

export const components = {
  dashboard: (_, __, app) => {
    // The view is state too, derived here: whatever changes the slice recomputes it once, and every tile, chart
    // and table reads the same numbers from it. A crosshair that is showing follows.
    const update = () => {
      app.set('view', view(app.get('days'), +app.get('range'), app.get('channels')))
      if (app.get('#hover')) app.set('#hover', hit(app.get('view'), app.get('#hover.i')))
    }
    // Live: a new day comes in and the oldest one leaves.
    let next = app.get('days').length
    let timer
    const offs = [
      ...['days', 'range', 'channels'].map((path) => app.on(path, update)),
      app.on('live', (live) => {
        clearInterval(timer)
        if (live) timer = setInterval(() => (app.shift('days'), app.push('days', day(next++))), 1500)
      }),
    ]
    return () => (offs.forEach((off) => off()), clearInterval(timer))
  },
}

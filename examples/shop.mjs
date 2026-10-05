// The shop's state and functions (shop.html). The cart lives on the server (ssr.mjs), which renders the page with it;
// the "cart" component posts it back on every change.
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const SHIPPING = 19.9
const FREE_SHIPPING = 200
const COUPONS = { WELCOME10: 0.1, CQ20: 0.2 }

const count = (cart) => cart.reduce((n, l) => n + l.qty, 0)
const subtotal = (cart) => cart.reduce((s, l) => s + l.price * l.qty, 0)
const discount = (coupon) => COUPONS[coupon.trim().toUpperCase()] || 0
const shipping = (cart) => (!cart.length || subtotal(cart) >= FREE_SHIPPING ? 0 : SHIPPING)
const total = (cart, coupon) => subtotal(cart) * (1 - discount(coupon)) + shipping(cart)

export const fns = {
  money: (v) => usd.format(v),
  times: (v, x) => v * x,
  more: (n, max) => Math.min(n + 1, max),
  less: (n) => Math.max(1, n - 1),
  inCategory: (p, category) => category === 'All' || p.category === category,
  stock: (n) => (!n ? 'Sold out' : n < 5 ? `Only ${n} left` : 'In stock'),
  addToCart: (cart, p) =>
    cart.some((l) => l.id === p.id)
      ? cart.map((l) => (l.id === p.id ? { ...l, qty: Math.min(l.qty + 1, p.stock) } : l))
      : [...cart, { id: p.id, name: p.name, price: p.price, stock: p.stock, qty: 1 }],
  count,
  subtotal,
  discount,
  discountAmount: (cart, coupon) => subtotal(cart) * discount(coupon),
  shipping,
  total,
  shippingProgress: (cart) => Math.min(100, (subtotal(cart) / FREE_SHIPPING) * 100) + '%',
  shippingHint: (cart) => {
    const missing = FREE_SHIPPING - subtotal(cart)
    return missing > 0 ? `${usd.format(missing)} away from free shipping.` : 'You got free shipping!'
  },
  checkout: (_, cart, coupon) => ({ number: String(Date.now()).slice(-6), items: count(cart), total: total(cart, coupon) }),
}

export const state = () => ({
  title: 'Shop · core-query',
  category: 'All',
  categories: ['All', 'Clothing', 'Home', 'Accessories'],
  products: [
    { id: 1, name: 'core-query T-shirt', category: 'Clothing', price: 79.9, stock: 12, color: '#0969da' },
    { id: 2, name: 'TreeModel hoodie', category: 'Clothing', price: 189.9, oldPrice: 229.9, sale: true, stock: 3, color: '#8250df' },
    { id: 3, name: 'SSR mug', category: 'Home', price: 49.9, stock: 30, color: '#bf3989' },
    { id: 4, name: 'data-* stickers', category: 'Accessories', price: 14.9, stock: 100, color: '#1a7f37' },
    { id: 5, name: 'Hydration cap', category: 'Accessories', price: 69.9, stock: 0, color: '#9a6700' },
    { id: 6, name: 'Microtask bottle', category: 'Home', price: 99.9, oldPrice: 119.9, sale: true, stock: 7, color: '#cf222e' },
    { id: 7, name: 'Pipe socks', category: 'Clothing', price: 29.9, stock: 4, color: '#0550ae' },
    { id: 8, name: 'Template notebook', category: 'Accessories', price: 39.9, stock: 15, color: '#57606a' },
  ],
  cart: [],
  coupon: '',
  order: null,
})

export const components = {
  cart: (_, __, app) => app.on('cart', () => app.post('cart', '/shop/cart')),
}

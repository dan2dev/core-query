// The users table's state and functions (users.html).
/** Lowercase and without accents: "João" is found by "joao". */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const matches = (u, q) => !q.trim() || [u.name, u.email, u.team].some((x) => fold(x).includes(fold(q.trim())))
const visible = (users, q) => users.filter((u) => matches(u, q))
const ids = (users) => users.map((u) => String(u.id)) // checkbox values are strings

const names = [
  'Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Alves', 'Elisa Rocha', 'Fábio Nunes', 'Gabriela Reis', 'Heitor Melo',
  'Isabela Costa', 'João Pedro Silva', 'Karina Lopes', 'Lucas Martins', 'Mariana Freitas', 'Nicolas Araújo', 'Olívia Barros',
  'Paulo Teixeira', 'Raquel Ramos', 'Rafael Cardoso', 'Sofia Moreira', 'Tiago Ribeiro', 'Úrsula Pinto', 'Vinícius Gomes',
  'Wesley Castro', 'Yasmin Farias', 'Zeca Mendes',
]
const teams = ['Design', 'Engineering', 'Product', 'Sales', 'Support']

export const state = () => ({
  title: 'Users · core-query',
  users: names.map((name, i) => ({ id: i + 1, name, email: fold(name).replace(/ /g, '.') + '@example.com', team: teams[i % 5], active: i % 4 > 0 })),
  q: '',
  selected: [],
  order: null,
  current: null,
})

export const fns = {
  matches,
  none: (users, q) => !visible(users, q).length,
  count: (users, q) => `${visible(users, q).length} of ${users.length} users`,
  allChecked: (users, q, selected) => {
    const v = ids(visible(users, q))
    return v.length > 0 && v.every((id) => selected.includes(id))
  },
  checkVisible: (selected, users, q, on) => {
    const v = ids(visible(users, q))
    return on ? [...new Set([...selected, ...v])] : selected.filter((id) => !v.includes(id))
  },
  withoutIds: (users, selected) => users.filter((u) => !selected.includes(String(u.id))),
  by: (order, col) => ({ col, dir: order?.col === col ? -order.dir : 1 }),
  sort: (users, { col, dir }) => [...users].sort((a, b) => a[col].localeCompare(b[col]) * dir),
  arrow: (order, col) => (order?.col === col ? (order.dir > 0 ? '▲' : '▼') : ''),
}

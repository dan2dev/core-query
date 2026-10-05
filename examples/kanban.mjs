// The board's state and functions (kanban.html).
let id = Date.now() // past the ids the server gives
/** The board with card `ki` of column `from` moved to the end of column `to`. */
const move = (columns, from, ki, to) => {
  const card = columns[from].cards[ki]
  return columns.map((c, i) => (i === from ? { ...c, cards: c.cards.filter((_, j) => j !== ki) } : i === to ? { ...c, cards: [...c.cards, card] } : c))
}

export const state = () => ({
  title: 'Kanban · core-query',
  columns: [
    { id: 1, title: 'To do', cards: [{ id: 1, text: 'Write the examples' }, { id: 2, text: 'Review the README' }, { id: 3, text: 'Measure the bundle' }] },
    { id: 2, title: 'Doing', cards: [{ id: 4, text: 'Keyed lists' }] },
    { id: 3, title: 'Done', cards: [{ id: 5, text: 'SSR and hydration' }] },
  ],
})

export const fns = {
  isLast: (ci, columns) => ci === columns.length - 1,
  addCard: (cards, text) => ((text = text.trim()) ? [...cards, { id: ++id, text }] : undefined),
  move: (columns, ci, ki, step) => move(columns, ci, ki, ci + step),
  from: (_, ci, ki, e) => {
    e.dataTransfer.setData('text/plain', '') // Firefox only starts a drag with some data
    return { ci, ki }
  },
  drop: (columns, from, to) => (from && from.ci !== to ? move(columns, from.ci, from.ki, to) : undefined),
}

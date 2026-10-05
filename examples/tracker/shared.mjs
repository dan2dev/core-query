// The tracker's template functions and components, shared by the browser (layout.html) and the server (server.mjs):
// both render with the same functions, so hydration finds the page the server rendered.

/** The list's URL with one filter changed. Filters are links: the router asks the server for the state of that URL. */
const to = (query, key, value) => {
  const q = new URLSearchParams({ ...query, [key]: value })
  // Another filter starts at the first page; the first page and an empty filter need no parameter.
  if (key !== 'page' || value == 1) q.delete('page')
  for (const [k, v] of [...q]) if (!v) q.delete(k)
  const s = q.toString()
  return '/tracker' + (s && '?' + s)
}
const issueUrl = (id) => '/tracker/issues/' + id

export const fns = {
  to,
  issueUrl,
  /** "Sep 3, 2026", in UTC: the server and every browser write the same text. */
  date: (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  plural: (n, one, many) => `${n} ${n === 1 ? one : many}`,
  /** As an action: `.status.flip()`. */
  flip: (status) => (status === 'open' ? 'closed' : 'open'),

  // Actions that navigate. Only the browser runs actions: the server never calls these.
  /** A filter is the list's URL with one parameter changed; it replaces the history entry: the same view, refined. */
  filter: (value, query, key) => void CoreQuery.go(to(query, key, value), true),
  /** Posts the draft from JS to read the answer: the new issue, whose page comes next. A failure is at #draft.error. */
  create: () =>
    void CoreQuery.send('draft', 'POST', '/tracker/api/issues')
      .then((r) => r.json())
      .then((issue) => CoreQuery.go(issueUrl(issue.id)), () => {}),
}

export const components = {
  focus: (el) => el.focus(),
}

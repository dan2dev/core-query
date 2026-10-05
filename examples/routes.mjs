// The routes example's template functions and sample data (routes/*.html), shared by the browser and the server
// (ssr.mjs, which adds the page count).
export const fns = {
  link: (id) => '/routes/users/' + id,
}

const users = [
  { id: 1, name: 'Ana' },
  { id: 2, name: 'Bia' },
  { id: 3, name: 'Caio' },
]

/** State of the page at `route` (server only): each page gets just the data it shows, its title included. */
export const state = (route) =>
  ({
    'routes/home': () => ({ title: 'Users', users }),
    'routes/user': () => {
      const user = users.find((u) => u.id === +route.params.id) || null
      return { title: user?.name ?? 'Unknown user', user }
    },
    'routes/about': () => ({ title: 'About' }),
  })[route.name]()

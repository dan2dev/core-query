// The city search's state and functions (search.html). The server renders the first page for ?q=…; from there the
// "search" component is the API: an asynchronous one of your own, with a latency and a failure you control.
const PER_PAGE = 5
const CITIES = [
  ['São Paulo', 'SP', 11451999], ['Rio de Janeiro', 'RJ', 6211223], ['Brasília', 'DF', 2817381], ['Fortaleza', 'CE', 2428708],
  ['Salvador', 'BA', 2417678], ['Belo Horizonte', 'MG', 2315560], ['Manaus', 'AM', 2063689], ['Curitiba', 'PR', 1773718],
  ['Recife', 'PE', 1488920], ['Goiânia', 'GO', 1437366], ['Porto Alegre', 'RS', 1332845], ['Belém', 'PA', 1303403],
  ['Guarulhos', 'SP', 1291771], ['Campinas', 'SP', 1139047], ['São Luís', 'MA', 1037775], ['Maceió', 'AL', 957916],
  ['Campo Grande', 'MS', 898100], ['São Gonçalo', 'RJ', 896744], ['Teresina', 'PI', 866300], ['João Pessoa', 'PB', 833932],
  ['São Bernardo do Campo', 'SP', 810729], ['Duque de Caxias', 'RJ', 808152], ['Nova Iguaçu', 'RJ', 785882], ['Natal', 'RN', 751300],
  ['Santo André', 'SP', 748919], ['Osasco', 'SP', 728615], ['Sorocaba', 'SP', 723682], ['Uberlândia', 'MG', 713224],
  ['Ribeirão Preto', 'SP', 698642], ['São José dos Campos', 'SP', 697054], ['Cuiabá', 'MT', 650877], ['Jaboatão dos Guararapes', 'PE', 643759],
  ['Contagem', 'MG', 621863], ['Joinville', 'SC', 616317], ['Feira de Santana', 'BA', 616272], ['Aracaju', 'SE', 602757],
  ['Londrina', 'PR', 555937], ['Juiz de Fora', 'MG', 540756], ['Florianópolis', 'SC', 537211], ['Porto Velho', 'RO', 460434],
  ['Niterói', 'RJ', 481758], ['Caxias do Sul', 'RS', 463338], ['Macapá', 'AP', 442933], ['São João de Meriti', 'RJ', 440962],
  ['Santos', 'SP', 418608], ['Boa Vista', 'RR', 413486], ['Rio Branco', 'AC', 364756], ['São Vicente', 'SP', 329911],
  ['Vitória', 'ES', 322869], ['Palmas', 'TO', 302692], ['São José', 'SC', 270295], ['Porto Seguro', 'BA', 168326],
  ['Rio Grande', 'RS', 191900], ['Rio Verde', 'GO', 225696], ['Rio Claro', 'SP', 201418],
].map(([name, state, pop]) => ({ name, state, pop }))
/** Lowercase and without accents: "São Paulo" is found by "sao". */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
/** One page of the cities matching `q`, and how many match. */
const find = (q, page) => {
  const found = CITIES.filter((c) => fold(c.name).includes(fold(q)))
  return { items: found.slice(page * PER_PAGE, (page + 1) * PER_PAGE), total: found.length }
}

export const state = (route) => {
  const q = route.query.q || ''
  const { items, total } = q.trim() ? find(q, 0) : { items: [], total: 0 }
  return { title: 'Search · core-query', q, latency: 600, fail: false, status: 'ok', error: '', results: items, total, page: 0, retries: 0, loadingMore: false }
}

export const fns = {
  blank: (q) => !q.trim(),
  hasMore: (results, total) => results.length < total,
  found: (n) => (n === 1 ? '1 city found' : `${n} cities found`),
  people: (n) => 'pop. ' + n.toLocaleString('en-US'),
}

export const components = {
  search: (_, __, app) => {
    // A server stand-in: answers after `latency` ms, or fails; an aborted request never answers.
    const api = (q, page, signal) =>
      new Promise((ok, fail) => {
        const t = setTimeout(() => (app.get('fail') ? fail(new Error('server unavailable (503)')) : ok(find(q, page))), app.get('latency'))
        signal.addEventListener('abort', () => (clearTimeout(t), fail(new DOMException('aborted', 'AbortError'))))
      })

    let request
    const search = async (page) => {
      request?.abort()
      const q = app.get('q')
      if (!q.trim()) return app.set('status', 'ok'), app.set('results', []), app.set('total', 0)
      const current = (request = new AbortController())
      if (page) app.set('loadingMore', true)
      else app.set('status', 'loading')
      try {
        const { items, total } = await api(q, page, current.signal)
        page ? app.push('results', ...items) : app.set('results', items)
        app.set('total', total)
        app.set('status', 'ok')
      } catch (e) {
        if (e.name === 'AbortError') return // a newer search took over
        app.set('error', e.message)
        app.set('status', 'error')
      } finally {
        if (request === current) app.set('loadingMore', false)
      }
    }

    // A listener also runs once when the page arrives, with the values the server rendered: only a change searches.
    let { q, retries } = app.get()
    let timer
    const offs = [
      // Debounce: a new search 300 ms after the last keystroke, but "searching" right away,
      // so "nothing found" never flashes while the user is still typing.
      app.on('q', (v) => {
        if (v === q) return
        q = v
        clearTimeout(timer)
        app.set('page', 0)
        app.set('status', v.trim() ? 'loading' : 'ok')
        timer = setTimeout(() => search(0), 300)
      }),
      app.on('page', (p) => p && search(p)),
      app.on('retries', (r) => r !== retries && ((retries = r), search(0))),
    ]
    return () => {
      offs.forEach((off) => off())
      clearTimeout(timer)
      request?.abort()
    }
  },
}

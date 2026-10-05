import { describe, expect, it, vi } from 'vitest'
import { createStore, itemScope, parseFor, resolve, text, type Store } from '../src/core'

const tick = () => new Promise((r) => setTimeout(r))

describe('store', () => {
  it('gets and sets nested paths, creating arrays for numeric keys', () => {
    const s = createStore()
    s.set('person.name', 'Ana')
    s.set('list.0.title', 'a')
    expect(s.get()).toEqual({ person: { name: 'Ana' }, list: [{ title: 'a' }] })
    expect(s.get('person.name')).toBe('Ana')
    expect(s.get('nothing.here')).toBeUndefined()
    expect(s.get('list.length')).toBe(1)
  })

  it('push / pop / shift / delete like the thesis API', () => {
    const s = createStore({ list: ['a'] })
    s.push('list', 'b', 'c')
    expect(s.shift('list')).toBe('a')
    expect(s.pop('list')).toBe('c')
    expect(s.get('list')).toEqual(['b'])
    s.push('created', 1)
    expect(s.get('created')).toEqual([1])
    expect(s.pop('empty')).toBeUndefined()
    s.set('o', { a: 1, b: 2 })
    s.delete('o.a')
    s.delete('created.0')
    s.delete('created.length') // non-index key on an array is ignored
    expect(s.get()).toEqual({ list: ['b'], created: [], o: { b: 2 } })
  })

  it('notifies the path, its ancestors and its descendants, once per tick', async () => {
    const s = createStore({ a: { b: { c: 1 } }, x: 1 })
    const seen: string[] = []
    for (const p of ['', 'a', 'a.b', 'a.b.c', 'x']) s.on(p, () => seen.push(p))
    s.set('a.b', { c: 2 })
    s.set('a.b.c', 3)
    expect(seen).toEqual([]) // batched
    await tick()
    expect(seen.sort()).toEqual(['', 'a', 'a.b', 'a.b.c'])
  })

  it('only notifies the array items that changed', async () => {
    const s = createStore({ xs: ['a', 'b', 'c'] })
    const seen: string[] = []
    for (const p of ['xs', 'xs.0', 'xs.1', 'xs.2', 'xs.3']) s.on(p, (v) => seen.push(p + '=' + v))
    s.push('xs', 'd')
    await tick()
    expect(seen.splice(0).filter((x) => x.startsWith('xs.'))).toEqual(['xs.3=d'])
    s.pop('xs')
    await tick()
    expect(seen.splice(0).filter((x) => x.startsWith('xs.'))).toEqual(['xs.3=undefined'])
    s.delete('xs.1')
    await tick()
    expect(seen.splice(0).filter((x) => x.startsWith('xs.'))).toEqual(['xs.1=c', 'xs.2=undefined', 'xs.3=undefined'])
    s.shift('xs')
    s.push('xs', 'e') // the lowest changed index wins within a batch
    await tick()
    expect(seen.filter((x) => x.startsWith('xs.'))).toEqual(['xs.0=c', 'xs.1=e', 'xs.2=undefined', 'xs.3=undefined'])
  })

  it('notifies length and moved indices when set() grows or shrinks an array', async () => {
    const s = createStore({ xs: ['a', 'b'] })
    const seen: string[] = []
    for (const p of ['xs.length', 'xs.0', 'xs.1', 'xs.2', 'todos.length']) s.on(p, (v) => seen.push(p + '=' + v))
    s.set('xs.2', 'c')
    await tick()
    expect(seen.splice(0).sort()).toEqual(['xs.2=c', 'xs.length=3'])
    s.set('xs.length', 0)
    await tick()
    expect(seen.splice(0).sort()).toEqual(['xs.0=undefined', 'xs.1=undefined', 'xs.2=undefined', 'xs.length=0'])
    s.set('todos.0.title', 'x') // containers created on the way
    await tick()
    expect(seen.splice(0)).toEqual(['todos.length=1'])
    s.set('xs.0', undefined) // grows the array although the "value" did not change
    await tick()
    expect(seen.sort()).toEqual(['xs.0=undefined', 'xs.1=undefined', 'xs.2=undefined', 'xs.length=1'])
  })

  it('settles when a listener writes into its own path', async () => {
    const s = createStore({ cart: { items: [{ price: 2 }], total: 0 } })
    let runs = 0
    s.on('cart', (c) => {
      if (++runs > 50) throw Error('loop')
      s.set('cart.total', c.items.reduce((t: number, i: { price: number }) => t + i.price, 0))
    })
    s.push('cart.items', { price: 3 })
    await tick()
    expect(s.get('cart.total')).toBe(5)
    expect(runs).toBeLessThan(5)
  })

  it('passes the current value and stops after unsubscribe', async () => {
    const s = createStore()
    const fn = vi.fn()
    const off = s.on('n', fn)
    s.set('n', 1)
    await tick()
    expect(fn).toHaveBeenLastCalledWith(1)
    s.set('n', 2)
    off() // also drops the queued call
    await tick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('keeps updating after a listener throws', async () => {
    const s = createStore({ user: { name: 'x' }, a: 0 })
    const errors: unknown[] = []
    vi.stubGlobal('queueMicrotask', (f: () => void) =>
      Promise.resolve().then(() => {
        try {
          f()
        } catch (e) {
          errors.push(e)
        }
      }),
    )
    const seen: number[] = []
    s.on('user', (u) => u.name)
    s.on('a', (a) => seen.push(a))
    s.set('user', null)
    s.set('a', 1)
    await tick()
    s.set('a', 2)
    await tick()
    vi.unstubAllGlobals()
    expect(errors).toHaveLength(1)
    expect(seen).toEqual([1, 2])
  })

  it('unshift / splice notify from the first index that moved', async () => {
    const s = createStore({ xs: ['a', 'b', 'c'] })
    const seen: string[] = []
    for (const p of ['xs.0', 'xs.1', 'xs.2', 'xs.3']) s.on(p, (v) => seen.push(p + '=' + v))
    expect(s.splice('xs', 1, 1, 'B')).toEqual(['b'])
    await s.tick()
    expect(seen.splice(0)).toEqual(['xs.1=B', 'xs.2=c', 'xs.3=undefined'])
    s.unshift('xs', 'z')
    await s.tick()
    expect(seen.splice(0)).toEqual(['xs.0=z', 'xs.1=a', 'xs.2=B', 'xs.3=c'])
    expect(s.splice('xs', -1)).toEqual(['c'])
    s.unshift('created', 1)
    expect(s.get()).toMatchObject({ xs: ['z', 'a', 'B'], created: [1] })
  })

  it('on(path, fn, { now }) runs right away; tick() waits for the flushes listeners start', async () => {
    const s = createStore({ n: 1 })
    const seen: number[] = []
    s.on('n', (n) => seen.push(n), { now: true })
    s.on('n', (n) => s.set('double', n * 2))
    s.on('double', (d) => seen.push(d))
    expect(seen).toEqual([1])
    s.set('n', 2)
    await s.tick()
    expect(seen).toEqual([1, 2, 4])
  })

  it('types paths and values for a typed state', () => {
    type S = { todos: { title: string; done?: boolean }[]; user: { name: string } }
    const s: Store<S> = createStore({ todos: [{ title: 'a' }], user: { name: 'Ana' } })
    const title: string = s.get('todos.0.title')
    s.set('user.name', 'Bia')
    s.push('todos', { title: 'b' })
    // @ts-expect-error not a path of S
    s.get('todos.0.nope')
    // @ts-expect-error a number is not a string
    s.push('todos', 1)
    expect([title, s.get('todos.length')]).toEqual(['a', 3])
  })

  it('refuses prototype keys', () => {
    const s = createStore()
    expect(() => s.set('__proto__.polluted', 1)).toThrow()
    expect(() => s.set('a.constructor.prototype.polluted', 1)).toThrow()
    s.set('xs', ['x'])
    s.set('o', {})
    expect(() => s.push('xs.__proto__', 'polluted')).toThrow()
    expect(() => s.delete('o.__proto__.hasOwnProperty')).toThrow()
    expect(({} as any).polluted).toBeUndefined()
    expect(([] as any)[0]).toBeUndefined()
    expect({}.hasOwnProperty).toBeTypeOf('function')
  })
})

describe('template paths', () => {
  const root = { p: '' }
  it('resolves absolute, relative and aliased paths', () => {
    const ctx = { p: 'person' }
    expect(resolve('list', ctx)).toBe('list')
    expect(resolve('.name', ctx)).toBe('person.name')
    expect(resolve('.', ctx)).toBe('person')
    expect(resolve('', ctx)).toBe('person')
    expect(resolve('.', root)).toBe('')
    const item = itemScope(root, 'tasks', 2, 'item', 'i')
    expect(resolve('item', item)).toBe('tasks.2')
    expect(resolve('item.name', item)).toBe('tasks.2.name')
    expect(resolve('i', item)).toBe(2)
    expect(resolve('.', item)).toBe('tasks.2')
    const inner = itemScope(item, 'tasks.2.tags', 0, 'tag')
    expect(resolve('tag.x', inner)).toBe('tasks.2.tags.0.x')
    expect(resolve('i', inner)).toBe(2) // outer alias still visible
    expect(resolve('constructor', item)).toBe('constructor') // aliases have no prototype
  })

  it('parses data-for forms', () => {
    expect(parseFor('list')).toEqual([undefined, undefined, 'list'])
    expect(parseFor('item in tasks')).toEqual(['item', undefined, 'tasks'])
    expect(parseFor(' item , i in a.b ')).toEqual(['item', 'i', 'a.b'])
    expect(() => parseFor('item of tasks')).toThrow()
  })

  it('renders values as text', () => {
    expect([null, undefined, 0, false, 'a', [1], { a: 1 }].map(text)).toEqual(['', '', '0', 'false', 'a', '[1]', '{"a":1}'])
  })
})

import { describe, expect, it } from 'vitest'
import { builtins, evaluate, route } from '../src/core'

describe('builtins', () => {
  const state: Record<string, any> = { n: 2, s: 'x', on: true, off: false, name: '', lim: 3, txt: '5' }
  const val = (src: string) => evaluate(src, { p: '' }, (p) => state[p], builtins)[0]

  it('has exactly the documented functions, on a null prototype', () => {
    expect(Object.getPrototypeOf(builtins)).toBeNull()
    expect(Object.keys(builtins).sort()).toEqual(['add', 'and', 'eq', 'gt', 'gte', 'lt', 'lte', 'ne', 'not', 'or', 'then'])
  })

  it('compares', () => {
    expect(val("s | eq('x')")).toBe(true)
    expect(val('n | eq("2")')).toBe(false) // strict
    expect(val("s | ne('x')")).toBe(false)
    expect(val("s | ne('y')")).toBe(true)
    expect([val('n | gt(1)'), val('n | gt(2)'), val('n | gte(2)'), val('n | gte(3)')]).toEqual([true, false, true, false])
    expect([val('n | lt(3)'), val('n | lt(2)'), val('n | lte(2)'), val('n | lte(1)')]).toEqual([true, false, true, false])
    expect(val('n | lt(lim)')).toBe(true) // an argument can be a path
  })

  it('combines, defaults and picks', () => {
    expect([val('on | not'), val('off | not'), val('missing | not')]).toEqual([false, true, true])
    expect([val('on | and(off)'), val('on | and(n)'), val('off | or(on)')]).toEqual([false, 2, true])
    expect(val("name | or('anon')")).toBe('anon')
    expect(val("s | eq('x') | then('Yes', 'No')")).toBe('Yes')
    expect(val("s | eq('y') | then('Yes', 'No')")).toBe('No')
    expect(val("off | then('Yes')")).toBeUndefined()
  })

  it('adds, counting anything that is not a number as 0', () => {
    expect([val('n | add(1)'), val('n | add(-1)'), val('missing | add(1)'), val('txt | add(1)'), val('s | add(2)')]).toEqual([3, 1, 1, 6, 2])
  })
})

describe('route with a base', () => {
  const routes = { home: '/', user: '/users/:id', docs: '/docs/*' }

  it('matches the patterns under the base and keeps the full path', () => {
    expect(route('/app/users/7?x=1', routes, '/app')).toEqual({ path: '/app/users/7', query: { x: '1' }, hash: '', name: 'user', params: { id: '7' }, is: { user: true } })
    expect(route('/app', routes, '/app').name).toBe('home')
    expect(route('/app/', routes, '/app').name).toBe('home')
    expect(route('/app/docs/a/b', routes, '/app').params).toEqual({ '*': 'a/b' })
    expect(route('/a/b/users/7', routes, '/a/b').name).toBe('user')
  })

  it('matches nothing outside the base', () => {
    for (const url of ['/', '/users/7', '/application', '/application/users/7', '/x/app/users/7'])
      expect(route(url, routes, '/app')).toMatchObject({ path: url.split('?')[0], params: {}, is: {} })
    expect(route('/users/7', routes, '/app').name).toBeUndefined()
  })

  it('tolerates a trailing slash on the base, and none is the old behaviour', () => {
    expect(route('/app/users/7', routes, '/app/').name).toBe('user')
    expect(route('/app', routes, '/app/').name).toBe('home')
    expect(route('/users/7', routes)).toEqual(route('/users/7', routes, ''))
    expect(route('/users/7', routes).name).toBe('user')
    expect(route('/app/users/7', routes).name).toBeUndefined()
  })
})

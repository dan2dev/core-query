// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'

it('script-tag build exposes CoreQuery and auto-mounts <body>', async () => {
  document.body.innerHTML = `<input data-value="name"><span data-text="name"></span>`
  await import('../src/global')
  const app = (globalThis as any).CoreQuery
  expect((globalThis as any).Corequery).toBe(app)
  app.set('name', 'Ana')
  await new Promise((r) => setTimeout(r))
  expect(document.querySelector('span')!.textContent).toBe('Ana')
  expect((document.querySelector('input') as HTMLInputElement).value).toBe('Ana')
})

it('script-tag build waits for DOMContentLoaded while the document is loading', async () => {
  vi.resetModules()
  Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
  document.body.innerHTML = `<b data-text="n"></b>`
  await import('../src/global')
  delete (document as any).readyState
  const app = (globalThis as any).CoreQuery
  app.set('n', 1)
  await new Promise((r) => setTimeout(r))
  expect(document.querySelector('b')!.textContent).toBe('')
  document.dispatchEvent(new Event('DOMContentLoaded'))
  expect(document.querySelector('b')!.textContent).toBe('1')
})

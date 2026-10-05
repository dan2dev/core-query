import { describe, expect, it } from 'vitest'
import { renderToString } from '../src/server'

const STATE = '<script type="application/json" data-cq-state>'
const strip = (html: string) => html.slice(0, html.indexOf(STATE))

describe('renderToString', () => {
  it('renders text, values and context', () => {
    const html = renderToString(
      `<div data-context="person"><input type="text" data-value=".name"><span data-text=".name">old</span></div>`,
      { person: { name: 'Ana' } },
    )
    expect(strip(html)).toBe(
      `<div data-context="person"><input type="text" data-value=".name" value="Ana"><span data-text=".name">Ana</span></div>`,
    )
  })

  it('expands data-for into a template plus rendered items', () => {
    const html = renderToString(`<ul><li data-for="item, i in xs"><b data-text="i"></b><i data-text="item.n"></i></li><li>end</li></ul>`, {
      xs: [{ n: 'a' }, { n: 'b' }],
    })
    expect(strip(html)).toBe(
      '<ul><template data-for="item, i in xs" data-n="2"><li><b data-text="i"></b><i data-text="item.n"></i></li></template>' +
        '<li><b data-text="i">0</b><i data-text="item.n">a</i></li><li><b data-text="i">1</b><i data-text="item.n">b</i></li><li>end</li></ul>',
    )
  })

  it('keeps authored <template data-for> attributes and renders nested lists', () => {
    const html = renderToString(`<template data-for="g in gs" id="t"><p><span data-for="g.xs" data-text="."></span></p></template>`, {
      gs: [{ xs: [1, 2] }],
    })
    expect(strip(html)).toBe(
      '<template data-for="g in gs" id="t" data-n="1"><p><span data-for="g.xs" data-text="."></span></p></template>' +
        '<p><template data-for="g.xs" data-n="2"><span data-text="."></span></template><span data-text=".">1</span><span data-text=".">2</span></p>',
    )
  })

  it('adds the <tbody> browsers imply, so rows stay after their template', () => {
    const rows = { rows: ['r1', 'r2'] }
    const tbody = '<tbody><template data-for="rows" data-n="2"><tr><td data-text="."></td></tr></template><tr><td data-text=".">r1</td></tr><tr><td data-text=".">r2</td></tr></tbody>'
    expect(strip(renderToString(`<table><tr data-for="rows"><td data-text="."></td></tr></table>`, rows))).toBe(`<table>${tbody}</table>`)
    expect(strip(renderToString(`<table><thead><tr><th>h</th></tr></thead><tr data-for="rows"><td data-text="."></td></tr></table>`, rows))).toBe(
      `<table><thead><tr><th>h</th></tr></thead>${tbody}</table>`,
    )
    expect(strip(renderToString(`<table>${tbody.replace(/<tr><td data-text=".">r\d<\/td><\/tr>/g, '')}</table>`, rows))).toBe(`<table>${tbody}</table>`)
    // each row list gets its own <tbody>, after other table sections too
    expect(strip(renderToString(`<table><tr data-for="rows"><td data-text="."></td></tr><tbody><tr><td>sep</td></tr></tbody><template data-for="rows"><tr><td data-text="."></td></tr></template></table>`, rows))).toBe(
      `<table>${tbody}<tbody><tr><td>sep</td></tr></tbody>${tbody}</table>`,
    )
    // a list of nested row lists, and a list of <col>s
    expect(strip(renderToString(`<table><template data-for="g in groups"><template data-for="g.rows"><tr><td data-text="."></td></tr></template></template></table>`, { groups: [rows] }))).toMatch(
      /^<table><tbody><template data-for="g in groups" data-n="1">.*<\/tr><\/tbody><\/table>$/,
    )
    expect(strip(renderToString(`<table><col data-for="c in cols" data-attr-class="c"><tr><td>x</td></tr></table>`, { cols: ['a'] }))).toBe(
      '<table><colgroup><template data-for="c in cols" data-n="1"><col data-attr-class="c"></template><col data-attr-class="c" class="a"></colgroup><tr><td>x</td></tr></table>',
    )
    // lists of row groups are not wrapped
    expect(strip(renderToString(`<table><template data-for="rows"><tbody><tr><td data-text="."></td></tr></tbody></template></table>`, rows))).toBe(
      '<table><template data-for="rows" data-n="2"><tbody><tr><td data-text="."></td></tr></tbody></template>' +
        '<tbody><tr><td data-text=".">r1</td></tr></tbody><tbody><tr><td data-text=".">r2</td></tr></tbody></table>',
    )
  })

  it('renders form controls, data-show and data-attr-*', () => {
    const html = renderToString(
      `<input type="checkbox" data-value="ok"><input type="radio" value="a" data-value="r" checked><input type="radio" value="b" data-value="r">` +
        `<select data-value="s"><option selected>x</option><optgroup><option value="y">Y</option></optgroup></select>` +
        `<textarea data-value="t">old</textarea><p data-show="!ok" hidden>no</p><p data-show="ok">yes</p>` +
        `<a href="/old" data-attr-href="link" data-attr-title="none">l</a>`,
      { ok: true, r: 'b', s: 'y', t: 'new', link: '/new' },
    )
    expect(strip(html)).toBe(
      `<input type="checkbox" data-value="ok" checked=""><input type="radio" value="a" data-value="r"><input type="radio" value="b" data-value="r" checked="">` +
        `<select data-value="s"><option>x</option><optgroup><option value="y" selected="">Y</option></optgroup></select>` +
        `<textarea data-value="t">new</textarea><p data-show="!ok" hidden="">no</p><p data-show="ok">yes</p>` +
        `<a href="/new" data-attr-href="link" data-attr-title="none">l</a>`,
    )
  })

  it('renders what the client hydrates from (JSON values)', () => {
    expect(strip(renderToString(`<p data-text="d"></p><p data-text="n"></p>`, { d: new Date(0), n: NaN }))).toBe(
      `<p data-text="d">1970-01-01T00:00:00.000Z</p><p data-text="n"></p>`,
    )
  })

  it('selects the option whose rendered value or text matches', () => {
    const html = renderToString(
      `<select data-value="s"><option data-for="o in os" data-attr-value="o.v" data-text="o.l"></option></select>` +
        `<select data-value="l"><option data-for="os" data-text=".l"></option></select>`,
      { s: 'b', l: 'A', os: [{ v: 'a', l: 'A' }, { v: 'b', l: 'B' }] },
    )
    expect(html.match(/<option[^>]*>/g)).toEqual([
      '<option data-attr-value="o.v" data-text="o.l">', // template content stays raw
      '<option data-attr-value="o.v" data-text="o.l" value="a">',
      '<option data-attr-value="o.v" data-text="o.l" value="b" selected="">',
      '<option data-text=".l">',
      '<option data-text=".l" selected="">',
      '<option data-text=".l">',
    ])
  })

  it('matches options like the browser: data-bind labels, entities, NBSP', () => {
    const selected = (tpl: string, state: object) => renderToString(tpl, state).match(/<option[^>]*selected[^>]*>[^<]*/g)
    expect(selected(`<select data-value="s"><option data-for="os" data-bind="."></option></select>`, { s: 'y', os: ['x', 'y'] })).toEqual([
      '<option data-bind="." selected="">y',
    ])
    expect(selected(`<select data-value="s"><option>x</option><option value="Tom &amp; Jerry">t</option></select>`, { s: 'Tom & Jerry' })).toEqual([
      '<option value="Tom &amp; Jerry" selected="">t',
    ])
    expect(selected(`<select data-value="s"><option>x</option><option> Tom &amp;\n Jerry </option></select>`, { s: 'Tom & Jerry' })).toEqual([
      '<option selected=""> Tom &amp;\n Jerry ',
    ])
    expect(selected(`<select data-value="s"><option data-for="os" data-text="."></option></select>`, { s: '\u00a0\u00a0child', os: ['top', '\u00a0\u00a0child'] })).toEqual([
      '<option data-text="." selected="">\u00a0\u00a0child',
    ])
  })

  it('selects only the first matching option, as the client does', () => {
    const html = renderToString(`<select data-value="who"><option value="">Choose</option><option value="a">Ana</option><option value="">Nobody</option></select>`, {
      who: '',
    })
    expect(html.match(/<option[^>]*>/g)).toEqual(['<option value="" selected="">', '<option value="a">', '<option value="">'])
  })

  it('keeps a leading newline in <pre> and <textarea>, and CRs everywhere', () => {
    expect(strip(renderToString(`<pre data-text="c"></pre><textarea data-value="c"></textarea><p data-text="c"></p>`, { c: '\nfoo' }))).toBe(
      `<pre data-text="c">\n\nfoo</pre><textarea data-value="c">\n\nfoo</textarea><p data-text="c">\nfoo</p>`,
    )
    expect(strip(renderToString(`<pre data-text="c"></pre><input data-value="c">`, { c: '\r\nfoo' }))).toBe(
      `<pre data-text="c">&#13;\nfoo</pre><input data-value="c" value="&#13;\nfoo">`,
    )
  })

  it('checks radios and checkboxes from the rendered type and value', () => {
    const html = strip(
      renderToString(
        `<label data-for="o in opts"><input type="radio" name="c" data-attr-value="o" data-value="choice"></label>` +
          `<input type="radio" value="R&amp;D" data-value="dept"><input data-attr-type="t" data-value="ok">`,
        { opts: ['a', 'b'], choice: 'b', dept: 'R&D', t: 'checkbox', ok: true },
      ),
    )
    expect(html.match(/<input[^>]*>/g)!.slice(1)).toEqual([
      '<input type="radio" name="c" data-attr-value="o" data-value="choice" value="a">',
      '<input type="radio" name="c" data-attr-value="o" data-value="choice" value="b" checked="">',
      '<input type="radio" value="R&amp;D" data-value="dept" checked="">',
      '<input data-attr-type="t" data-value="ok" type="checkbox" checked="">',
    ])
  })

  it('leaves a non-form component element to its component', () => {
    expect(strip(renderToString(`<div data-component="badge" data-value="user">x</div>`, { user: { name: 'Ana' } }))).toBe(
      `<div data-component="badge" data-value="user">x</div>`,
    )
  })

  it('renders data-text into <script>/<style> as raw text', () => {
    const ld = { '@type': 'Thing', name: 'A & B </script><b>' }
    const html = strip(renderToString(`<script type="application/ld+json" data-text="ld"></script><style data-text="css"></style>`, { ld, css: 'a > b { font-family: "X" }' }))
    expect(html).toBe(
      `<script type="application/ld+json" data-text="ld">{"@type":"Thing","name":"A & B \\u003c/script>\\u003cb>"}</script><style data-text="css">a > b { font-family: "X" }</style>`,
    )
    expect(JSON.parse(html.slice(html.indexOf('>') + 1, html.indexOf('</script>')))).toEqual(ld)
  })

  it('escapes data-text in <style>/<script> inside <svg> and <math>, which are not raw text there', () => {
    const evil = '</style><img src=x onerror=alert(1)>'
    const html = strip(
      renderToString(`<svg><style data-text="x"></style><g data-for="xs"><script data-text="."></script></g></svg><math><style data-text="x"></style></math>`, {
        x: evil,
        xs: [evil],
      }),
    )
    expect(html).not.toMatch(/<img|<\\?\/style><img/)
    expect(html).toContain('<style data-text="x">&#60;/style&#62;&#60;img src=x onerror=alert(1)&#62;</style>')
  })

  it('keeps <!-- and <script> in raw text from swallowing the page', () => {
    const body = 'Comments open with <!-- and scripts with <script>.'
    const html = strip(renderToString(`<script type="application/ld+json" data-text="ld"></script><script data-text="js"></script>`, { ld: { body }, js: body }))
    expect(html).not.toMatch(/<!--|<script>\./)
    expect(html).toContain('"Comments open with \\u003c!-- and scripts with \\u003cscript>."')
    expect(html).toContain('Comments open with <\\!-- and scripts with <\\script>.')
  })

  it('reads unquoted attribute values the way browsers do', () => {
    expect(strip(renderToString(`<div><a href=/search?q=x data-text="t">old</a><p data-text="t"></p></div><span>after</span>`, { t: 'T' }))).toBe(
      `<div><a href=/search?q=x data-text="t">T</a><p data-text="t">T</p></div><span>after</span>`,
    )
  })

  it('escapes values and the embedded state', () => {
    const evil = `"><script>alert(1)</script>`
    const html = renderToString(`<p data-text="x"></p><a data-attr-title="x"></a>`, { x: evil })
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('<p data-text="x">&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62;</p>')
    const json = html.slice(html.indexOf(STATE) + STATE.length, html.lastIndexOf('</script>'))
    expect(json).not.toContain('<')
    expect(JSON.parse(json)).toEqual({ x: evil })
  })

  it('renders pipes with the template functions the client registers', () => {
    const fns = { eq: (v: unknown, x: unknown) => v === x, money: (v: number) => '$' + v.toFixed(2) }
    const html = renderToString(
      `<b data-text="price | money"></b><li data-class-sel="id | eq(sel)" class="row"></li><p data-show="!ok | eq(true)">x</p>`,
      { price: 2, id: 1, sel: 1, ok: true },
      fns,
    )
    expect(strip(html)).toBe(
      `<b data-text="price | money">$2.00</b><li data-class-sel="id | eq(sel)" class="row sel"></li><p data-show="!ok | eq(true)" hidden="">x</p>`,
    )
  })

  it('renders data-if chains as blocks of 0 or 1 item; the rows of a chain share one <tbody>', () => {
    expect(strip(renderToString(`<p data-if="a">A</p> <p data-else-if="b">B</p> <p data-else>C</p>`, { b: 1 }))).toBe(
      '<template data-if="a" data-n="0"><p>A</p></template> <template data-else-if="b" data-n="1"><p>B</p></template><p>B</p> ' +
        '<template data-else="" data-n="0"><p>C</p></template>',
    )
    expect(strip(renderToString(`<table><tr data-if="a"><td>A</td></tr><tr data-else><td>B</td></tr></table>`, {}))).toBe(
      '<table><tbody><template data-if="a" data-n="0"><tr><td>A</td></tr></template>' +
        '<template data-else="" data-n="1"><tr><td>B</td></tr></template><tr><td>B</td></tr></tbody></table>',
    )
    expect(() => renderToString(`<p data-else>x</p>`)).toThrow(/data-else without data-if/)
    // data-for first, as on the client: the data-if is each item's condition
    expect(strip(renderToString(`<ul><li data-for="t in ts" data-if="t.ok" data-text="t.n"></li></ul>`, { ts: [{ n: 'a', ok: 1 }, { n: 'b' }] }))).toBe(
      '<ul><template data-for="t in ts" data-n="2"><li data-if="t.ok" data-text="t.n"></li></template>' +
        '<template data-if="t.ok" data-n="1"><li data-text="t.n"></li></template><li data-text="t.n">a</li>' +
        '<template data-if="t.ok" data-n="0"><li data-text="t.n"></li></template></ul>',
    )
  })

  it('stamps data-use templates with their slots, and moves data-key onto the list template', () => {
    const html = renderToString(
      `<template id="card"><b data-text=".name"></b><slot><i>none</i></slot></template>` +
        `<div data-use="card" data-context="u"><p>bio</p></div><div data-use="card" data-context="u"></div>` +
        `<ul><li data-for="t in ts" data-key="t.id" data-text="t.id"></li></ul>`,
      { u: { name: 'Ana' }, ts: [{ id: 7 }] },
    )
    expect(strip(html)).toBe(
      `<template id="card"><b data-text=".name"></b><slot><i>none</i></slot></template>` +
        `<div data-context="u"><b data-text=".name">Ana</b><p>bio</p></div><div data-context="u"><b data-text=".name">Ana</b><i>none</i></div>` +
        `<ul><template data-for="t in ts" data-key="t.id" data-n="1"><li data-text="t.id"></li></template><li data-text="t.id">7</li></ul>`,
    )
  })

  it('renders class and style toggles, <select multiple> and checkbox groups, and leaves #keys out', () => {
    const html = renderToString(
      `<i class="a done" data-class-done="d" data-class-new="!d" data-style-width="w" data-style-color="none"></i>` +
        `<select multiple data-value="tags"><option>a</option><option>b</option></select><input type="checkbox" value="b" data-value="tags">` +
        `<p data-text="#draft"></p>`,
      { d: false, w: '50%', tags: ['a', 'b'], '#draft': 'x' },
    )
    expect(strip(html)).toBe(
      `<i class="a new" data-class-done="d" data-class-new="!d" data-style-width="w" data-style-color="none" style="width: 50%"></i>` +
        `<select multiple data-value="tags"><option selected="">a</option><option selected="">b</option></select>` +
        `<input type="checkbox" value="b" data-value="tags" checked=""><p data-text="#draft"></p>`,
    )
    expect(html).toContain('{"d":false,"w":"50%","tags":["a","b"]}')
  })

  it('passes through doctype, comments, raw text and void/self-closed tags', () => {
    const src =
      `<!DOCTYPE html><html><head><title>a < b</title><style>p>b{}</style></head>` +
      `<body><!-- <p data-text="x"> --><script>if (a<b && c>d) "</p>"</script><br><svg><path d="M0"/><circle r=4 /></svg>` +
      `<img alt='it"s' src=x.png><p data-text="x"></p></body></html>`
    expect(renderToString(src, { x: 1 })).toBe(
      `<!DOCTYPE html><html><head><title>a < b</title><style>p>b{}</style></head>` +
        `<body>${STATE}{"x":1}</script><!-- <p data-text="x"> --><script>if (a<b && c>d) "</p>"</script><br><svg><path d="M0" /><circle r=4 /></svg>` +
        `<img alt='it"s' src=x.png><p data-text="x">1</p></body></html>`,
    )
  })
})

describe('built-in functions', () => {
  it('are available without registering, and a user fn overrides one', () => {
    const tpl = `<b data-text="s | eq('x') | then('Yes', 'No')"></b><i data-show="n | gt(1)"></i><u data-text="name | or('anon')"></u><s data-text="n | add(1)"></s>`
    expect(strip(renderToString(tpl, { s: 'x', n: 1 }))).toBe(
      `<b data-text="s | eq('x') | then('Yes', 'No')">Yes</b><i data-show="n | gt(1)" hidden=""></i><u data-text="name | or('anon')">anon</u><s data-text="n | add(1)">2</s>`,
    )
    expect(strip(renderToString(`<s data-text="n | add(1)"></s><b data-text="n | up | not"></b>`, { n: 1 }, { add: (v, n) => v + n * 10, up: (v) => v - 1 }))).toBe(
      `<s data-text="n | add(1)">11</s><b data-text="n | up | not">true</b>`,
    )
  })
})

describe('data-state on the server', () => {
  it('renders the subtree from the initial state, and keeps it out of the embedded state', () => {
    const html = renderToString(
      `<nav data-state-menu='{"open": false, "label": "Menu"}' data-class-on="menu.open"><b data-text="menu.label"></b><ul data-show="menu.open"></ul></nav><i data-text="menu.label"></i>`,
      { a: 1 },
    )
    expect(html).toBe(
      `<nav data-state-menu='{"open": false, "label": "Menu"}' data-class-on="menu.open"><b data-text="menu.label">Menu</b><ul data-show="menu.open" hidden=""></ul></nav>` +
        `<i data-text="menu.label"></i>${STATE}{"a":1}</script>`, // the alias ends with the element
    )
  })

  it('decodes entities, defaults to {}, takes several per element and keeps a value the state already has', () => {
    expect(strip(renderToString(`<p data-state-a="{&quot;n&quot;: 1}" data-state-b data-text="a.n"><b data-text="b"></b><i data-text="#a.n"></i></p>`))).toBe(
      `<p data-state-a="{&quot;n&quot;: 1}" data-state-b data-text="a.n">1</p>`,
    )
    expect(strip(renderToString(`<p data-state-a='{"n": 1}' data-state-b><b data-text="b"></b><i data-text="#a.n"></i></p>`))).toBe(
      `<p data-state-a='{"n": 1}' data-state-b><b data-text="b">{}</b><i data-text="#a.n">1</i></p>`,
    )
    // "#keys" never survive the JSON round trip of the state, so the attribute always wins on the server; a second element sharing the name reuses the first's.
    expect(strip(renderToString(`<p data-state-a='{"n": 1}'></p><p data-state-a='{"n": 2}' data-text="a.n"></p>`, { '#a': { n: 9 } }))).toBe(
      `<p data-state-a='{"n": 1}'></p><p data-state-a='{"n": 2}' data-text="a.n">1</p>`,
    )
  })

  it('lives in the context: one per data-for item, and under data-context (left alone while that is missing)', () => {
    const html = renderToString(
      `<ul><li data-for="t in todos" data-state-ui='{"open": true}'><b data-text="t.n"></b><i data-show="ui.open" data-text=".#ui.open"></i></li></ul>` +
        `<div data-context="x.y" data-state-m='{"v": 1}'><b data-text="m.v"></b><i data-text=".#m.v"></i></div><div data-context="u" data-state-m='{"v": 1}'><b data-text="m.v"></b></div>`,
      { todos: [{ n: 'a' }, { n: 'b' }], x: { y: {} } },
    )
    const item = (n: string) => `<li data-state-ui='{"open": true}'><b data-text="t.n">${n}</b><i data-show="ui.open" data-text=".#ui.open">true</i></li>`
    expect(html).toBe(
      `<ul><template data-for="t in todos" data-n="2"><li data-state-ui='{"open": true}'><b data-text="t.n"></b><i data-show="ui.open" data-text=".#ui.open"></i></li></template>${item('a')}${item('b')}</ul>` +
        `<div data-context="x.y" data-state-m='{"v": 1}'><b data-text="m.v">1</b><i data-text=".#m.v">1</i></div><div data-context="u" data-state-m='{"v": 1}'><b data-text="m.v"></b></div>` +
        `${STATE}{"todos":[{"n":"a"},{"n":"b"}],"x":{"y":{}}}</script>`,
    )
  })

  it('renders with data-if on the same element and keeps outer loop aliases', () => {
    expect(strip(renderToString(`<p data-for="x, i in xs"><b data-if="x.on" data-state-s='{"k": "v"}' data-text="s.k"></b><i data-state-s data-text="i"></i></p>`, { xs: [{ on: true }] }))).toBe(
      `<template data-for="x, i in xs" data-n="1"><p><b data-if="x.on" data-state-s='{"k": "v"}' data-text="s.k"></b><i data-state-s data-text="i"></i></p></template>` +
        `<p><template data-if="x.on" data-n="1"><b data-state-s='{"k": "v"}' data-text="s.k"></b></template><b data-state-s='{"k": "v"}' data-text="s.k">v</b><i data-state-s data-text="i">0</i></p>`,
    )
  })

  it('a state read before the element that declares it is rendered from it too', () => {
    expect(strip(renderToString(`<b data-show="#menu.open">open</b><div data-state-menu='{"open": true}'></div>`))).toBe(
      `<b data-show="#menu.open">open</b><div data-state-menu='{"open": true}'></div>`,
    )
  })

  it('throws on a named entity it cannot decode like the browser', () => {
    expect(() => renderToString(`<p data-state-m='{"t": "caf&eacute;"}'></p>`)).toThrow(
      'CoreQuery: data-state-m has "&eacute;": write the character itself or a numeric reference (&#233;)',
    )
    expect(strip(renderToString(`<p data-state-m='{"t": "caf&#233; &amp; cr&#xe8;me"}' data-text="m.t"></p>`))).toContain('>café &#38; crème</p>')
  })

  it('throws on bad JSON and on a context that is not an object', () => {
    expect(() => renderToString(`<p data-state-menu="{open: false}"></p>`)).toThrow('CoreQuery: bad data-state-menu {open: false}')
    expect(() => renderToString(`<p data-context="n" data-state-menu></p>`, { n: 5 })).toThrow('CoreQuery: data-state-menu needs an object context, "n" is not')
    expect(() => renderToString(`<li data-for="xs" data-state-menu></li>`, { xs: ['a'] })).toThrow('CoreQuery: data-state-menu needs an object context, "xs.0" is not')
  })
})

describe('malformed templates', () => {
  it.each([
    ['<ul><li>a<li>b</ul>', 'unclosed <li> before <li> (line 1)'],
    ['<div>\n<p>a\n<div>b</div></div>', 'unclosed <p> before <div> (line 3)'],
    ['<p>a<p>b', 'unclosed <p> before <p>'],
    ['<p><b>a</b><span><ul></ul></span></p>', 'unclosed <p> before <ul>'],
    ['<P>a<H2>b</H2>', 'unclosed <p> before <H2>'],
    ['<p>a<table></table>', 'unclosed <p> before <table>'],
    ['<p>a<section></section>', 'unclosed <p> before <section>'],
    ['<select><option>a<option>b</select>', 'unclosed <option> before <option>'],
    ['<table><tr><td>a</td><tr><td>b</td></tr></table>', 'unclosed <tr> before <tr>'],
    ['<table><tr><td>a<td>b</tr></table>', 'unclosed <td> before <td>'],
    ['<table><tr><th>a<td>b</tr></table>', 'unclosed <th> before <td>'],
    ['<dl><dt>a<dd>b</dl>', 'unclosed <dt> before <dd>'],
    ['<dl><dd>a<dd>b</dl>', 'unclosed <dd> before <dd>'],
  ])('%s throws', (src, msg) => {
    expect(() => renderToString(src)).toThrow('CoreQuery: ' + msg)
  })

  it.each([
    '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>',
    '<ul><li><div><ol><li>a</li></ol></div></li></ul>',
    '<div><p>a <b>b</b><br><img src=x></p><p>c</p><div>d</div></div>',
    '<p>a</p><h1>b</h1><pre>c</pre>',
    '<div><p>a</div><section>b</section>', // the parent's end tag closes the <p>, as in the browser
    '<p><button><div>a</div></button><template id="t"><div>b</div></template></p>',
    '<p><svg><foreignObject><div>a</div></foreignObject></svg></p>',
    '<p><svg><desc><div>a</div></desc></svg><math><mtext><div>a</div></mtext></math></p>',
    '<p><marquee><div>a</div></marquee><noscript><div>a</div></noscript><applet><div>a</div></applet></p>',
    '<select><option>a</option><optgroup><option>b</option></optgroup></select>',
    '<table><tr><td>a</td><th>b</th></tr><tr><td><table><tr><td>c</td></tr></table></td></tr></table>',
    '<dl><dt>a</dt><dd>b<dl><dt>c</dt><dd>d</dd></dl></dd></dl>',
    '<script>"<p><div><li><li>"</script><!-- <p><div> --><textarea><p><div></textarea>',
    '<html><body><main><p>open at the end',
  ])('%s is fine', (src) => {
    expect(() => renderToString(src)).not.toThrow()
  })
})

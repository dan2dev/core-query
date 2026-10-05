// <script src="core-query.global.js"> build: like the legacy, the page works with
// no JavaScript of its own. Exposes the app as window.CoreQuery (and the legacy
// window.Corequery) and mounts <body> once the DOM is parsed.
import { createApp } from './index'

const app = createApp()
Object.assign(globalThis, { CoreQuery: app, Corequery: app })
const start = () => app.mount()
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()

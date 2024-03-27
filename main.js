const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor
function random4() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
}
function generateId() {
    return random4() + random4() + random4()
}
function extractTemplates(htmlString) {
    const template = document.createElement('template')
    template.innerHTML = htmlString.trim()
    return template.content.querySelectorAll('template')
}
class Store {
    constructor(data) {
        if (!data) data = {}
        this._data = data
        this._stage = {}
        this._subscriptions = {}
    }
    async get(key) {
        const path = key.split('.')
        let current = this._data
        for (const pathKey of path) {
            if (typeof current === 'object') {
                current = current[pathKey]
                continue
            }
            break
        }
        return current
    }
    async set(key, value) {
        const path = key.split('.')
        let current = this._data
        let pathKey = path[0]
        const callbacks = []
        for (let i = 1; i < path.length; i++) {
            current = current[pathKey]
            pathKey = path[i]
            const partial = path.slice(0, i)
            const partialKey = partial.join('.')
            callbacks.push(...Object.values(this._subscriptions[partialKey] || {}))
        }
        current[pathKey] = value
        callbacks.push(...Object.values(this._subscriptions[key] || {}))
        for (const callback of callbacks) {
            Promise.resolve(callback(key, value))
        }
    }
    async delete(key) {
        const path = key.split('.')
        const last = path.length - 1
        let current = this._data
        let pathKey = key
        for (const i = 0; i < last; i++) {
            pathKey = path[i]
            current = current[pathKey]
        }
        delete current[pathKey]
    }
    async stage(key, value) {
        this._stage[key] = value
    }
    async commit() {
        for (const key in this._stage) {
            if (this._stage.hasOwnProperty(key)) {
                const value = this._stage[key]
                delete this._stage[key]
                this.set(key, value)
            }
        }
    }
    async subscribe(key, componentId, callback) {
        if (!this._subscriptions.hasOwnProperty(key)) {
            this._subscriptions[key] = {}
        }
        this._subscriptions[key][componentId] = callback
        const currentVal = await this.get(key)
        if (currentVal !== undefined) callback(key, currentVal)
    }
    async unsubscribe(key, componentId) {
        delete this._subscriptions[key][componentId]
    }
}
class App {
    constructor(componentUrls, data, version) {
        this.store = new Store(data)
        this.componentUrls = componentUrls
        this.version = version
        this.loadComponents()
    }
    async loadComponents() {
        let templateStr
        if (this.version) {
            const cacheKey = `components-${this.version}`
            const fromCache = localStorage.getItem(cacheKey)
            if (fromCache) {
                templateStr = fromCache
            } else {
                templateStr = await this.fetchTemplateStr()
                localStorage.setItem(cacheKey, templateStr)
            }
        } else {
            templateStr = await this.fetchTemplateStr()
        }
        const templateEls = extractTemplates(templateStr)
        for (let templateEl of templateEls) {
            this.defineComponent(templateEl)
        }
    }
    async fetchTemplateStr() {
        const promises = []
        for (const url of this.componentUrls) {
            const promise = await fetch(url)
            promises.push(promise)
        }
        let templateStr = ''
        for (const response of await Promise.all(promises)) {
            if (response.ok) templateStr = templateStr + await response.text()
        }
        return templateStr
    }
    async defineComponent(templateEl) {
        let app = this
        let scriptText = ''
        for (const scriptEl of templateEl.content.querySelectorAll('script')) {
            scriptText = scriptText + scriptEl.textContent
            scriptEl.remove()
        }
        const init = new AsyncFunction('self', scriptText)
        customElements.define(
            templateEl.id,
            class extends HTMLElement {
                static get observedAttributes() {
                    return templateEl.getAttributeNames()
                }
                constructor() {
                    super()
                    const shadowRoot = this.attachShadow({ mode: 'open' })
                    const newEl = templateEl.content.cloneNode(true)
                    shadowRoot.appendChild(newEl)
                    this.app = app
                    this.componentId = generateId()
                    this.subscribe = async (key, callback) => {
                        this.app.store.subscribe(key, this.componentId, callback)
                    }
                    this.unsubsribe = async (key) => {
                        this.app.store.unsubscribe(key, this.componentId)
                    }
                    this.connected = false
                }
                attributeChangedCallback(name, oldVal, newVal) {
                    try {
                        return this.handleAttributeChanged(name, oldVal, newVal)
                    } catch (TypeError) { }
                }
                connectedCallback() {
                    if (!this.connected) {
                        init(this)
                        this.connected = true
                    }
                    try {
                        return this.handleConnected()
                    } catch (TypeError) { }
                }
                disconnectedCallback() {
                    try {
                        return this.handleDisconnected()
                    } catch (TypeError) { }
                }
                adoptedCallback() {
                    try {
                        return this.handleAdopted()
                    } catch (TypeError) { }
                }
            }
        )
    }
}
export { App, Store }

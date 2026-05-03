import { render } from 'solid-js/web'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app'

registerSW({ immediate: true })

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  render(() => <App />, rootElement)
}

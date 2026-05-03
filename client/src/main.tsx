import { render } from 'solid-js/web'
import { registerSW } from 'virtual:pwa-register'
import './pwa-install'
import { App } from './app'

registerSW({ immediate: true })

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  render(() => <App />, rootElement)
}

import { render } from 'solid-js/web'
import { App } from './app'

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  render(() => <App />, rootElement)
}

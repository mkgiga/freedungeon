import { Outlet, createRootRoute, Link } from '@tanstack/solid-router'
import { MetaProvider } from '@solidjs/meta'

import '../styles.css'
import { MdFillChat, MdFillHouse, MdFillNote, MdFillPerson, MdFillSettings } from 'solid-icons/md'
import { ModalProvider } from '../components/Modal'
import { ToastProvider } from '../components/Toast'
import { DrawerProvider } from '../components/Drawer'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <MetaProvider>
      <ModalProvider>
        <DrawerProvider>
          <ToastProvider>
            <main>
              <Outlet />
            </main>
            <menu id='main-nav'>
              <Link to="/" ><MdFillHouse size={32} /></Link>
              <Link to="/actors"><MdFillPerson size={32} /></Link>
              <Link to="/chat"><MdFillChat size={32} /></Link>
              <Link to="/notes"><MdFillNote size={32} /></Link>
              <Link to="/preferences"><MdFillSettings size={32} /></Link>
            </menu>
          </ToastProvider>
        </DrawerProvider>
      </ModalProvider>
    </MetaProvider>
  )
}

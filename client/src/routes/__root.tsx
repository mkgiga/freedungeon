import { Outlet, createRootRoute } from '@tanstack/solid-router'
import '../styles.css'

export const Route = createRootRoute({
  component: () => <Outlet />,
})

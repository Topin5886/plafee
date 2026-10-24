import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Les polices, servies avec le site (pas de requête chez Google) : seules les
// graisses utilisées, et chaque alphabet n'est chargé que s'il sert.
import '@fontsource/silkscreen/700.css'
import '@fontsource/press-start-2p/400.css'
import '@fontsource/vt323/400.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './index.css'
import './styles/layout.css'
import './features/scopa/scopa.css'
import './features/puissance4/puissance4.css'
import './features/uno/uno.css'
import './features/account/account.css'
import './features/social/social.css'
import './features/social/casino.css'
import './features/rooms/rooms.css'
import './styles/arcade.css'
import './styles/plafee-v2.css'
import './styles/looks.css'
import './styles/cosmetics-base.css'
import './styles/cosmetics-frames.css'
import './styles/cosmetics-effects.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

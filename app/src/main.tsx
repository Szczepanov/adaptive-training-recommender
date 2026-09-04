import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AccountScopedApp } from './AccountScopedApp.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AccountScopedApp />
    </AuthProvider>
  </StrictMode>,
)

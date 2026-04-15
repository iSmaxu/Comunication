// ============================================================
// SecureTeam — App Principal
// Routing y control de sesión
// ============================================================

import { useEffect } from 'react';
import { useAppStore } from './stores/appStore.js';
import LoginPage from './pages/LoginPage.js';
import ChatPage from './pages/ChatPage.js';

export default function App() {
  const { isAuthenticated, isLoading, restoreSession } = useAppStore();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div style={{ textAlign: 'center' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
          <p className="text-muted">Cargando SecureTeam...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <ChatPage />;
}

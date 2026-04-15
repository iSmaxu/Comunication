import { useState } from 'react';
import { useAppStore } from '../stores/appStore.js';

export default function LoginPage() {
  const { login } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  const API_URL = import.meta.env.VITE_API_URL || '/api';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await login(email.trim(), password.trim());
    } catch (err: any) {
      const msg = err?.message || JSON.stringify(err) || 'Error desconocido';
      setError(msg);
      alert('Login error: ' + msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const testConnection = async () => {
    setDebugInfo('Probando conexión...');
    const url = `${API_URL}/health`;
    
    // Check if on native Capacitor
    const Cap = (window as any).Capacitor;
    const isNative = Cap?.isNativePlatform?.() === true;
    
    if (isNative) {
      // Use CapacitorHttp directly
      try {
        setDebugInfo(`CapacitorHttp GET: ${url}`);
        const { CapacitorHttp } = await import('@capacitor/core');
        const resp = await CapacitorHttp.request({
          url,
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        const info = `✅ CapacitorHttp OK!\nStatus: ${resp.status}\nData: ${JSON.stringify(resp.data)}`;
        setDebugInfo(info);
        alert(info);
      } catch (err: any) {
        const msg = `❌ CapacitorHttp falló: ${err?.message || JSON.stringify(err)}\nURL: ${url}`;
        setDebugInfo(msg);
        alert(msg);
      }
    } else {
      // Web: use fetch
      try {
        setDebugInfo(`Fetch GET: ${url}`);
        const resp = await fetch(url);
        const data = await resp.json();
        const info = `✅ Fetch OK!\nStatus: ${resp.status}\nData: ${JSON.stringify(data)}`;
        setDebugInfo(info);
        alert(info);
      } catch (err: any) {
        const msg = `❌ Fetch falló: ${err?.message}\nURL: ${url}`;
        setDebugInfo(msg);
        alert(msg);
      }
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🔒</div>
          <h1>SecureTeam</h1>
          <p>Mensajería cifrada de extremo a extremo</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">
              Correo electrónico
            </label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              placeholder="tu@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">
              Contraseña
            </label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              placeholder="Tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(255, 107, 107, 0.1)',
                border: '1px solid rgba(255, 107, 107, 0.3)',
                borderRadius: '8px',
                color: 'var(--color-danger)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting || !email.trim() || !password.trim()}
          >
            {isSubmitting ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="loading-spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
                Conectando...
              </span>
            ) : (
              'Iniciar Sesión Segura'
            )}
          </button>

          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <span className="security-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Cifrado E2E activado
            </span>
          </div>
        </form>

        {/* DEBUG: Test connection button */}
        <button
          onClick={testConnection}
          style={{
            marginTop: '16px',
            width: '100%',
            padding: '10px',
            background: 'rgba(0,206,201,0.15)',
            border: '1px solid rgba(0,206,201,0.3)',
            borderRadius: '8px',
            color: '#00cec9',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          🔧 Test Conexión (Debug)
        </button>

        {debugInfo && (
          <pre style={{
            marginTop: '10px',
            padding: '10px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#ddd',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '200px',
            overflow: 'auto',
          }}>
            {debugInfo}
          </pre>
        )}
      </div>
    </div>
  );
}

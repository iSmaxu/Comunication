// ============================================================
// SecureTeam — Panel de Administración
// Gestión de usuarios, sesiones remotas, y auditoría de claves
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api/client.js';

interface AdminPanelProps {
  onBack: () => void;
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  publicIdentityKey: string | null;
  _count: { sessions: number };
}

interface SessionInfo {
  id: string;
  deviceInfo: string;
  isRevoked: boolean;
  createdAt: string;
  expiresAt: string;
}

interface KeyVerificationResult {
  userId: string;
  displayName: string;
  status: 'verified' | 'changed' | 'no_keys';
  lastVerified: string | null;
  fingerprint: string | null;
}

export default function AdminPanel({ onBack }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [keyVerification, setKeyVerification] = useState<KeyVerificationResult[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'security'>('users');
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const response = await api.getAdminUsers();
      setUsers(response.data);
    } catch (error) {
      console.error('Error cargando usuarios:', error);
    }
  }, []);

  const loadKeyVerification = useCallback(async () => {
    try {
      const response = await api.getKeyVerification();
      setKeyVerification(response.data);
    } catch (error) {
      console.error('Error cargando verificación:', error);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadUsers(), loadKeyVerification()]);
      setLoading(false);
    };
    init();
  }, [loadUsers, loadKeyVerification]);

  const loadSessions = async (userId: string) => {
    setSelectedUserId(userId);
    try {
      const response = await api.getUserSessions(userId);
      setSessions(response.data);
    } catch (error) {
      console.error('Error cargando sesiones:', error);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!selectedUserId) return;
    if (!confirm('¿Estás seguro de revocar esta sesión? El usuario será desconectado.')) return;

    try {
      const response = await api.revokeSession(sessionId, selectedUserId) as any;
      setActionMessage(response.message || 'Sesión revocada');
      await loadSessions(selectedUserId);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (error: any) {
      setActionMessage(`Error: ${error.message}`);
    }
  };

  const handleRevokeAll = async (userId: string) => {
    if (!confirm('¿Revocar TODAS las sesiones de este usuario? Será desconectado de todos los dispositivos.')) return;

    try {
      const response = await api.revokeAllSessions(userId) as any;
      setActionMessage(response.message || 'Todas las sesiones revocadas');
      await loadUsers();
      if (selectedUserId === userId) await loadSessions(userId);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (error: any) {
      setActionMessage(`Error: ${error.message}`);
    }
  };

  const handleToggleActive = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    const action = user?.isActive ? 'desactivar' : 'activar';
    if (!confirm(`¿${action} este usuario?`)) return;

    try {
      const response = await api.toggleUserActive(userId) as any;
      setActionMessage(response.message || `Usuario ${action}do`);
      await loadUsers();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (error: any) {
      setActionMessage(`Error: ${error.message}`);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="admin-panel">
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      {/* Header */}
      <div className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <button
              onClick={onBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                marginBottom: '8px',
                borderRadius: '6px',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-muted)',
                transition: 'background 0.15s',
              }}
            >
              ← Volver al chat
            </button>
            <h2>🛡️ Panel de Administración</h2>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            className={`btn-sm ${activeTab === 'users' ? 'btn-secondary' : ''}`}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              background: activeTab === 'users' ? 'rgba(108, 92, 231, 0.2)' : 'transparent',
              color: activeTab === 'users' ? 'var(--color-accent-light)' : 'var(--color-text-muted)',
              fontWeight: activeTab === 'users' ? 600 : 400,
            }}
            onClick={() => setActiveTab('users')}
          >
            👥 Usuarios y Sesiones
          </button>
          <button
            className={`btn-sm ${activeTab === 'security' ? 'btn-secondary' : ''}`}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              background: activeTab === 'security' ? 'rgba(108, 92, 231, 0.2)' : 'transparent',
              color: activeTab === 'security' ? 'var(--color-accent-light)' : 'var(--color-text-muted)',
              fontWeight: activeTab === 'security' ? 600 : 400,
            }}
            onClick={() => setActiveTab('security')}
          >
            🔐 Auditoría de Seguridad
          </button>
        </div>
      </div>

      {/* Action Message Toast */}
      {actionMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 20px',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-accent)',
          borderRadius: '10px',
          boxShadow: 'var(--shadow-md)',
          zIndex: 200,
          animation: 'fadeInUp 0.3s both',
          fontSize: 'var(--font-size-sm)',
          backdropFilter: 'blur(16px)',
        }}>
          {actionMessage}
        </div>
      )}

      <div className="admin-content">
        {/* ===== TAB: USUARIOS Y SESIONES ===== */}
        {activeTab === 'users' && (
          <div>
            <div className="admin-section">
              <h3>Usuarios del Equipo ({users.length})</h3>

              {users.map((user, index) => (
                <div
                  key={user.id}
                  className="admin-card"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <div className="admin-card-info">
                    <div
                      className="conversation-avatar"
                      style={{
                        width: '40px',
                        height: '40px',
                        fontSize: '14px',
                        opacity: user.isActive ? 1 : 0.4,
                      }}
                    >
                      {user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {user.displayName}
                        {user.role === 'ADMIN' && (
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>
                            👑 Admin
                          </span>
                        )}
                        {!user.isActive && (
                          <span style={{
                            fontSize: 'var(--font-size-xs)',
                            padding: '1px 6px',
                            background: 'rgba(255, 107, 107, 0.15)',
                            borderRadius: '4px',
                            color: 'var(--color-danger)',
                          }}>
                            Desactivado
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        {user.email} · {user._count.sessions} sesión(es) activa(s)
                        {user.lastSeenAt && ` · Último acceso: ${formatDate(user.lastSeenAt)}`}
                      </div>
                    </div>
                  </div>

                  <div className="admin-card-actions">
                    <button
                      className="btn-sm btn-secondary"
                      onClick={() => loadSessions(user.id)}
                    >
                      Ver sesiones
                    </button>
                    <button
                      className="btn-sm btn-danger"
                      onClick={() => handleRevokeAll(user.id)}
                      title="Revocar todas las sesiones"
                    >
                      Revocar todo
                    </button>
                    <button
                      className="btn-sm"
                      style={{
                        background: user.isActive ? 'rgba(255, 107, 107, 0.1)' : 'rgba(0, 206, 201, 0.1)',
                        color: user.isActive ? 'var(--color-danger)' : 'var(--color-success)',
                        border: `1px solid ${user.isActive ? 'rgba(255, 107, 107, 0.3)' : 'rgba(0, 206, 201, 0.3)'}`,
                      }}
                      onClick={() => handleToggleActive(user.id)}
                    >
                      {user.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Sesiones del usuario seleccionado */}
            {selectedUserId && (
              <div className="admin-section" style={{ animation: 'fadeInUp 0.3s both' }}>
                <h3>
                  Sesiones de {users.find(u => u.id === selectedUserId)?.displayName}
                  <button
                    onClick={() => setSelectedUserId(null)}
                    style={{ float: 'right', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
                  >
                    Cerrar ✕
                  </button>
                </h3>

                {sessions.length === 0 ? (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                    No hay sesiones activas
                  </p>
                ) : (
                  sessions.map((session, index) => (
                    <div
                      key={session.id}
                      className="admin-card"
                      style={{
                        animationDelay: `${index * 40}ms`,
                        opacity: session.isRevoked ? 0.4 : 1,
                      }}
                    >
                      <div className="admin-card-info">
                        <div style={{ fontSize: '1.5rem' }}>
                          {session.deviceInfo.includes('Mobile') || session.deviceInfo.includes('Android')
                            ? '📱'
                            : '💻'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                            {session.deviceInfo.length > 60
                              ? session.deviceInfo.slice(0, 60) + '...'
                              : session.deviceInfo}
                          </div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                            Creada: {formatDate(session.createdAt)}
                            · Expira: {formatDate(session.expiresAt)}
                          </div>
                          {session.isRevoked && (
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
                              ❌ Revocada
                            </span>
                          )}
                        </div>
                      </div>

                      {!session.isRevoked && (
                        <button
                          className="btn-sm btn-danger"
                          onClick={() => handleRevokeSession(session.id)}
                        >
                          Revocar
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== TAB: AUDITORÍA DE SEGURIDAD ===== */}
        {activeTab === 'security' && (
          <div>
            <div className="admin-section">
              <h3>🔍 Verificación de Integridad de Claves</h3>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
                Verifica que las claves de cifrado de los usuarios no hayan sido alteradas por terceros.
              </p>

              {keyVerification.map((result, index) => (
                <div
                  key={result.userId}
                  className="admin-card"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <div className="admin-card-info">
                    <div style={{ fontSize: '1.5rem' }}>
                      {result.status === 'verified' ? '✅' : result.status === 'changed' ? '⚠️' : '❓'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {result.displayName}
                        <span className={`security-badge ${result.status === 'changed' ? 'warning' : ''}`}>
                          {result.status === 'verified'
                            ? '🔒 Conexión Segura Verificada'
                            : result.status === 'changed'
                              ? '⚠️ Clave Modificada'
                              : '❓ Sin Claves'}
                        </span>
                      </div>
                      {result.fingerprint && (
                        <div style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--color-text-muted)',
                          fontFamily: 'monospace',
                          marginTop: '4px',
                        }}>
                          Huella: {result.fingerprint}
                        </div>
                      )}
                      {result.lastVerified && (
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                          Última verificación: {formatDate(result.lastVerified)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {keyVerification.length === 0 && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: '20px' }}>
                  No hay datos de verificación. Los usuarios deben iniciar sesión primero.
                </p>
              )}
            </div>

            {/* Resumen de seguridad */}
            <div className="admin-section">
              <h3>📊 Resumen de Seguridad</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div className="admin-card" style={{ flexDirection: 'column', alignItems: 'center', padding: '20px' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>
                    {keyVerification.filter(k => k.status === 'verified').length}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-success)' }}>
                    Claves Verificadas ✅
                  </div>
                </div>
                <div className="admin-card" style={{ flexDirection: 'column', alignItems: 'center', padding: '20px' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>
                    {keyVerification.filter(k => k.status === 'changed').length}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                    Claves Modificadas ⚠️
                  </div>
                </div>
                <div className="admin-card" style={{ flexDirection: 'column', alignItems: 'center', padding: '20px' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>
                    {users.reduce((sum, u) => sum + u._count.sessions, 0)}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-info)' }}>
                    Sesiones Activas 📱
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

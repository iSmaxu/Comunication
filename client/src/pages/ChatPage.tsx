// ============================================================
// SecureTeam — Página Principal de Chat
// Layout: Sidebar + Área de Chat
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore.js';
import AdminPanel from './AdminPanel.js';
import HandshakeModal from './HandshakeModal.js';

// -------------------------------------------------------
// Icons (SVG inline para no necesitar dependencias)
// -------------------------------------------------------

const IconSend = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const IconMenu = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const IconShield = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const IconPlus = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconAdmin = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconReply = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="9 17 4 12 9 7" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconLogout = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// -------------------------------------------------------
// Chat Page Component
// -------------------------------------------------------

export default function ChatPage() {
  const {
    user,
    conversations,
    activeConversationId,
    messages,
    sidebarOpen,
    typingUsers,
    onlineUsers,
    replyingTo,
    setActiveConversation,
    sendMessage,
    deleteMessage,
    toggleSidebar,
    setReplyingTo,
    logout,
    loadConversations,
  } = useAppStore();

  const [inputText, setInputText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const activeMessages = activeConversationId ? messages[activeConversationId] || [] : [];
  const activeTyping = activeConversationId ? typingUsers[activeConversationId] || [] : [];

  // Auto-scroll a mensajes nuevos
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length]);

  // Enviar mensaje
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !activeConversationId) return;

    setInputText('');
    try {
      await sendMessage(activeConversationId, text);
    } catch (error) {
      console.error('Error enviando:', error);
    }
    inputRef.current?.focus();
  }, [inputText, activeConversationId, sendMessage]);

  // Manejar Enter para enviar
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Obtener nombre de conversación
  const getConversationName = (conv: typeof conversations[0]) => {
    if (conv.name) return conv.name;
    if (conv.type === 'DIRECT') {
      const other = conv.members?.find((m) => m.userId !== user?.id);
      return other?.user?.displayName || 'Chat directo';
    }
    return 'Grupo';
  };

  // Obtener iniciales para avatar
  const getInitials = (name: string) => {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  // Formatear hora
  const formatTime = (date: string) => {
    return new Date(date).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  };

  if (showAdmin && user?.role === 'ADMIN') {
    return <AdminPanel onBack={() => setShowAdmin(false)} />;
  }

  return (
    <div className="app-layout">
      {showNewChat && <HandshakeModal onClose={() => setShowNewChat(false)} />}
      
      {/* Overlay para móvil */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={toggleSidebar} style={{ display: 'none' }} />
      )}

      {/* ===== SIDEBAR ===== */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="url(#grad)" strokeWidth="2.5">
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--color-accent-light)" />
                  <stop offset="100%" stopColor="var(--color-success)" />
                </linearGradient>
              </defs>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            SecureTeam
          </h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            {user?.role === 'ADMIN' && (
              <button
                onClick={() => setShowAdmin(true)}
                style={{ padding: '6px', borderRadius: '8px', transition: 'background 0.15s' }}
                title="Panel de Administración"
              >
                <IconAdmin />
              </button>
            )}
            <button
              onClick={logout}
              style={{ padding: '6px', borderRadius: '8px', color: 'var(--color-text-muted)' }}
              title="Cerrar sesión"
            >
              <IconLogout />
            </button>
          </div>
        </div>

        {/* Info del usuario */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-divider)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <div className="conversation-avatar" style={{ width: '36px', height: '36px', fontSize: '13px' }}>
            {getInitials(user?.displayName || 'U')}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
              {user?.displayName}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {user?.role === 'ADMIN' ? '👑 Administrador' : 'Usuario'}
            </div>
          </div>
        </div>

        {/* Lista de conversaciones */}
        <div className="sidebar-content">
          {/* Botón nueva conversación */}
          <button
            onClick={() => setShowNewChat(!showNewChat)}
            style={{
              width: '100%',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              borderRadius: '8px',
              marginBottom: '8px',
              color: 'var(--color-accent-light)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 500,
              transition: 'background 0.15s',
            }}
          >
            <IconPlus /> Nueva conversación
          </button>

          {conversations.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <p style={{ fontSize: 'var(--font-size-sm)' }}>
                No hay conversaciones aún.
                <br />Crea una para empezar.
              </p>
            </div>
          )}

          {conversations.map((conv, index) => {
            const name = getConversationName(conv);
            const isActive = conv.id === activeConversationId;
            const otherMember = conv.type === 'DIRECT'
              ? conv.members?.find(m => m.userId !== user?.id)
              : null;
            const isOnline = otherMember ? onlineUsers.has(otherMember.userId) : false;

            return (
              <div
                key={conv.id}
                className={`conversation-item ${isActive ? 'active' : ''}`}
                style={{ '--index': index } as React.CSSProperties}
                onClick={() => {
                  setActiveConversation(conv.id);
                  if (window.innerWidth < 768) toggleSidebar();
                }}
              >
                <div className={`conversation-avatar ${conv.type === 'GROUP' ? 'group' : conv.type === 'ANNOUNCEMENT' ? 'announcement' : ''}`}>
                  {conv.type === 'ANNOUNCEMENT' ? '📢' : getInitials(name)}
                  {isOnline && <div className="online-dot" />}
                </div>
                <div className="conversation-info">
                  <div className="conversation-name">{name}</div>
                  <div className="conversation-last-message">
                    {conv.lastMessage
                      ? conv.lastMessage.isDeleted
                        ? '🚫 Mensaje eliminado'
                        : `${conv.lastMessage.senderName}: Mensaje cifrado`
                      : conv.type === 'ANNOUNCEMENT'
                        ? 'Canal de anuncios'
                        : 'Sin mensajes'}
                  </div>
                </div>
                {conv.lastMessage && (
                  <span className="conversation-time">
                    {formatTime(conv.lastMessage.createdAt)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ===== CHAT AREA ===== */}
      <main className="chat-area">
        {!activeConversation ? (
          /* Empty State */
          <div className="empty-state">
            <div className="empty-state-icon">🔐</div>
            <h2>SecureTeam</h2>
            <p className="text-muted">
              Selecciona una conversación o crea una nueva para empezar a chatear de forma segura.
            </p>
            <span className="security-badge" style={{ marginTop: '8px' }}>
              <IconShield /> Cifrado de extremo a extremo
            </span>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="chat-header">
              <button
                onClick={toggleSidebar}
                style={{ padding: '6px', borderRadius: '8px', display: 'none' }}
                className="mobile-menu-btn"
              >
                <IconMenu />
              </button>

              <div className={`conversation-avatar ${activeConversation.type === 'GROUP' ? 'group' : activeConversation.type === 'ANNOUNCEMENT' ? 'announcement' : ''}`}
                style={{ width: '38px', height: '38px', fontSize: '13px' }}>
                {activeConversation.type === 'ANNOUNCEMENT'
                  ? '📢'
                  : getInitials(getConversationName(activeConversation))}
              </div>

              <div className="chat-header-info">
                <div className="chat-header-name">
                  {getConversationName(activeConversation)}
                </div>
                <div className="chat-header-status">
                  <span className="verified">
                    <IconShield />
                  </span>
                  <span>Conexión segura verificada</span>
                  {activeConversation.type === 'GROUP' && (
                    <span> · {activeConversation.members?.length} miembros</span>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="messages-container">
              {activeMessages.length === 0 && (
                <div className="empty-state" style={{ padding: '40px' }}>
                  <div style={{ fontSize: '2rem' }}>🔒</div>
                  <p className="text-muted text-sm">
                    Los mensajes en esta conversación están cifrados de extremo a extremo.
                    Nadie, ni siquiera SecureTeam, puede leerlos.
                  </p>
                </div>
              )}

              {activeMessages.map((msg) => {
                const isMine = msg.senderId === user?.id;
                return (
                  <div
                    key={msg.id}
                    className={`message-wrapper ${isMine ? 'sent' : 'received'}`}
                  >
                    {/* Reply Preview */}
                    {msg.replyTo && (
                      <div className="message-reply">
                        <div className="message-reply-name">
                          {(msg.replyTo as any)?.sender?.displayName || 'Usuario'}
                        </div>
                        <span>Mensaje citado</span>
                      </div>
                    )}

                    <div className="message-bubble">
                      {/* Sender name (in groups) */}
                      {!isMine && activeConversation.type !== 'DIRECT' && (
                        <div className="message-sender">
                          {msg.sender?.displayName}
                        </div>
                      )}

                      {/* Message content */}
                      {msg.isDeleted || msg.deletedForAll ? (
                        <span className="message-deleted">🚫 Mensaje eliminado</span>
                      ) : (
                        <div className="message-text">{msg.encryptedContent}</div>
                      )}

                      {/* Meta info */}
                      <div className="message-meta">
                        <span>{formatTime(msg.createdAt)}</span>
                        {isMine && <span>✓✓</span>}
                      </div>
                    </div>

                    {/* Message actions (on hover/tap) */}
                    {!msg.isDeleted && (
                      <div style={{
                        display: 'flex',
                        gap: '4px',
                        marginTop: '2px',
                        opacity: 0.5,
                        transition: 'opacity 0.15s',
                      }}>
                        <button
                          onClick={() => setReplyingTo(msg)}
                          style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}
                          title="Responder"
                        >
                          <IconReply />
                        </button>
                        {(isMine || user?.role === 'ADMIN') && (
                          <button
                            onClick={() => deleteMessage(msg.id, msg.conversationId)}
                            style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--color-danger)' }}
                            title="Eliminar para todos"
                          >
                            <IconTrash />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Typing indicator (solo admin) */}
              {activeTyping.length > 0 && user?.role === 'ADMIN' && (
                <div className="typing-indicator">
                  <div className="typing-dots">
                    <span /><span /><span />
                  </div>
                  <span>Escribiendo...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            {(activeConversation.type !== 'ANNOUNCEMENT' ||
              activeConversation.members?.find(m => m.userId === user?.id)?.canWrite) && (
              <div className="message-input-container">
                {/* Reply Preview */}
                {replyingTo && (
                  <div className="reply-preview">
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--color-accent-light)', fontSize: 'var(--font-size-xs)' }}>
                        Respondiendo a {replyingTo.sender?.displayName}
                      </span>
                    </div>
                    <button className="reply-preview-close" onClick={() => setReplyingTo(null)}>
                      <IconClose />
                    </button>
                  </div>
                )}

                <div className="message-input-row">
                  <textarea
                    ref={inputRef}
                    className="message-input"
                    placeholder="Escribe un mensaje seguro..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    style={{ height: 'auto', minHeight: 'var(--input-height)' }}
                  />
                  <button
                    className="send-button"
                    onClick={handleSend}
                    disabled={!inputText.trim()}
                    title="Enviar"
                  >
                    <IconSend />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <style>{`
        @media (max-width: 768px) {
          .mobile-menu-btn { display: flex !important; }
          .sidebar-overlay { display: block !important; }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// SecureTeam — Store de Estado Global (Zustand)
// Gestiona autenticación, conversaciones, mensajes, y UI
// ============================================================

import { create } from 'zustand';
import { api } from '../services/api/client.js';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket/client.js';
import { initializeUserKeys, destroyAllKeys } from '../services/crypto/encrypt.js';

// -------------------------------------------------------
// Tipos locales
// -------------------------------------------------------

interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  publicIdentityKey: string | null;
  publicCode: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
}

interface Conversation {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'ANNOUNCEMENT';
  name: string | null;
  members: Array<{
    userId: string;
    memberRole: string;
    canWrite: boolean;
    user: User;
  }>;
  lastMessage?: {
    id: string;
    senderId: string;
    isDeleted: boolean;
    createdAt: string;
    senderName: string;
  } | null;
  createdAt: string;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  encryptedContent: string;
  iv: string;
  senderEphemeralPublicKey: string | null;
  replyToId: string | null;
  replyTo?: {
    id: string;
    senderName: string;
  } | null;
  isDeleted: boolean;
  deletedForAll: boolean;
  createdAt: string;
  sender: { id: string; displayName: string; role: string };
  // Descifrado en el cliente:
  decryptedContent?: string;
}

// -------------------------------------------------------
// Interface del Store
// -------------------------------------------------------

interface AppState {
  // Auth
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;

  // Messages (por conversación)
  messages: Record<string, Message[]>;

  // UI
  sidebarOpen: boolean;
  typingUsers: Record<string, string[]>; // conversationId -> userIds
  onlineUsers: Set<string>;
  replyingTo: Message | null;

  // Actions - Auth
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;

  // Actions - Conversations
  loadConversations: () => Promise<void>;
  createDirectConversation: (userId: string) => Promise<string>;
  createGroupConversation: (name: string, memberIds: string[]) => Promise<string>;
  setActiveConversation: (id: string | null) => void;

  // Actions - Messages
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, plaintext: string) => Promise<void>;
  deleteMessage: (messageId: string, conversationId: string) => Promise<void>;

  // Actions - UI
  toggleSidebar: () => void;
  setReplyingTo: (message: Message | null) => void;
}

// -------------------------------------------------------
// Store
// -------------------------------------------------------

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  conversations: [],
  activeConversationId: null,
  messages: {},
  sidebarOpen: true,
  typingUsers: {},
  onlineUsers: new Set(),
  replyingTo: null,

  // -------------------------------------------------------
  // AUTH
  // -------------------------------------------------------

  login: async (email: string, password: string) => {
    try {
      set({ isLoading: true });

      const deviceInfo = navigator.userAgent;

      const response = await api.login(email, password, deviceInfo);
      const { token, user } = response.data;

      api.setToken(token);
      localStorage.setItem('secureteam_token', token);

      // Inicializar claves de cifrado
      const keys = await initializeUserKeys();

      // Subir claves públicas al servidor (si son nuevas)
      if (!user.publicIdentityKey) {
        await api.updateKeys(keys);
      }

      // Conectar WebSocket
      const socket = connectSocket(token);
      setupSocketListeners(socket, set, get);

      set({
        user: { ...user, role: user.role as 'ADMIN' | 'USER' } as User,
        token,
        isAuthenticated: true,
        isLoading: false,
      });

      // Cargar conversaciones
      await get().loadConversations();
    } catch (error) {
      console.error('Error en login:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // Ignorar error si el servidor no responde
    }

    await destroyAllKeys();
    api.clearToken();
    disconnectSocket();
    localStorage.removeItem('secureteam_token');

    set({
      user: null,
      token: null,
      isAuthenticated: false,
      conversations: [],
      activeConversationId: null,
      messages: {},
      typingUsers: {},
      onlineUsers: new Set(),
    });
  },

  restoreSession: async () => {
    const token = localStorage.getItem('secureteam_token');
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      api.setToken(token);
      const response = await api.getMe();
      const user = response.data;

      const socket = connectSocket(token);
      setupSocketListeners(socket, set, get);

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
      });

      await get().loadConversations();
    } catch {
      localStorage.removeItem('secureteam_token');
      api.clearToken();
      set({ isLoading: false });
    }
  },

  // -------------------------------------------------------
  // CONVERSATIONS
  // -------------------------------------------------------

  loadConversations: async () => {
    try {
      const response = await api.getConversations();
      set({ conversations: response.data });
    } catch (error) {
      console.error('Error cargando conversaciones:', error);
    }
  },

  createDirectConversation: async (userId: string) => {
    const response = await api.createConversation('DIRECT', [userId]);
    await get().loadConversations();
    return response.data.id;
  },

  createGroupConversation: async (name: string, memberIds: string[]) => {
    const response = await api.createConversation('GROUP', memberIds, name);
    await get().loadConversations();
    return response.data.id;
  },

  setActiveConversation: (id: string | null) => {
    set({ activeConversationId: id, replyingTo: null });
    if (id) {
      get().loadMessages(id);
    }
  },

  // -------------------------------------------------------
  // MESSAGES
  // -------------------------------------------------------

  loadMessages: async (conversationId: string) => {
    try {
      const response = await api.getMessages(conversationId);
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: response.data,
        },
      }));
    } catch (error) {
      console.error('Error cargando mensajes:', error);
    }
  },

  sendMessage: async (conversationId: string, plaintext: string) => {
    try {
      const { replyingTo } = get();

      // TODO: Cifrar con el módulo crypto antes de enviar
      // Por ahora enviamos como texto para pruebas iniciales
      const socket = getSocket();
      if (socket) {
        socket.emit('message:send', {
          conversationId,
          encryptedContent: plaintext, // TODO: reemplazar con cifrado real
          iv: 'pending', // TODO: IV real del cifrado
          senderEphemeralPublicKey: null,
          replyToId: replyingTo?.id || null,
          tempId: `temp_${Date.now()}`,
        });
      }

      set({ replyingTo: null });
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      throw error;
    }
  },

  deleteMessage: async (messageId: string, conversationId: string) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('message:delete', { messageId, conversationId });
    }
  },

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setReplyingTo: (message: Message | null) => set({ replyingTo: message }),
}));

// -------------------------------------------------------
// WebSocket Event Listeners
// -------------------------------------------------------

function setupSocketListeners(
  socket: any,
  set: any,
  get: () => AppState
) {
  // Nuevo mensaje recibido
  socket.on('message:new', (data: { message: Message }) => {
    set((state: AppState) => {
      const convId = data.message.conversationId;
      const existing = state.messages[convId] || [];
      return {
        messages: {
          ...state.messages,
          [convId]: [...existing, data.message],
        },
      };
    });
  });

  // Mensaje enviado confirmado
  socket.on('message:sent', (data: { tempId: string; message: Message }) => {
    set((state: AppState) => {
      const convId = data.message.conversationId;
      const existing = state.messages[convId] || [];
      return {
        messages: {
          ...state.messages,
          [convId]: [...existing, data.message],
        },
      };
    });
  });

  // Mensaje borrado
  socket.on('message:deleted', (data: { messageId: string; conversationId: string }) => {
    set((state: AppState) => {
      const convId = data.conversationId;
      const existing = state.messages[convId] || [];
      return {
        messages: {
          ...state.messages,
          [convId]: existing.map((m) =>
            m.id === data.messageId
              ? { ...m, isDeleted: true, deletedForAll: true, encryptedContent: '[ELIMINADO]' }
              : m
          ),
        },
      };
    });
  });

  // Indicador de escritura
  socket.on('typing:user', (data: { userId: string; conversationId: string; isTyping: boolean }) => {
    // Solo mostrar si el usuario actual es ADMIN
    const currentUser = get().user;
    if (currentUser?.role !== 'ADMIN') return;

    set((state: AppState) => {
      const current = state.typingUsers[data.conversationId] || [];
      const updated = data.isTyping
        ? [...new Set([...current, data.userId])]
        : current.filter((id) => id !== data.userId);

      return {
        typingUsers: {
          ...state.typingUsers,
          [data.conversationId]: updated,
        },
      };
    });
  });

  // Confirmación de lectura (solo admin)
  socket.on('message:read_ack', (data: { messageId: string; userId: string; readAt: string }) => {
    const currentUser = get().user;
    if (currentUser?.role !== 'ADMIN') return;
    // TODO: actualizar receipts en el store
  });

  // Usuario online/offline
  socket.on('user:online', (data: { userId: string }) => {
    set((state: AppState) => ({
      onlineUsers: new Set([...state.onlineUsers, data.userId]),
    }));
  });

  socket.on('user:offline', (data: { userId: string }) => {
    set((state: AppState) => {
      const updated = new Set(state.onlineUsers);
      updated.delete(data.userId);
      return { onlineUsers: updated };
    });
  });

  // Cierre de sesión forzado (por admin)
  socket.on('session:force_logout', () => {
    alert('Tu sesión ha sido cerrada por un administrador.');
    get().logout();
  });
}

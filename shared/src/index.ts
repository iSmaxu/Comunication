// ============================================================
// SecureTeam — Tipos compartidos entre cliente y servidor
// ============================================================

// --- Enums ---

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum ConversationType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
}

export enum MemberRole {
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN',
}

// --- User ---

export interface IUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  ssoSubjectId: string;
  publicIdentityKey: string | null;
  signedPrekey: string | null;
  signedPrekeySignature: string | null;
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface IUserPublic {
  id: string;
  displayName: string;
  role: UserRole;
  publicIdentityKey: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
}

// --- Session ---

export interface ISession {
  id: string;
  userId: string;
  deviceInfo: string;
  isRevoked: boolean;
  createdAt: string;
  expiresAt: string;
}

// --- Conversation ---

export interface IConversation {
  id: string;
  type: ConversationType;
  name: string | null;
  createdBy: string;
  maxMembers: number;
  createdAt: string;
  members?: IConversationMember[];
  lastMessage?: IMessagePreview | null;
}

export interface IConversationMember {
  conversationId: string;
  userId: string;
  memberRole: MemberRole;
  canWrite: boolean;
  joinedAt: string;
  user?: IUserPublic;
}

// --- Message ---

export interface IMessage {
  id: string;
  conversationId: string;
  senderId: string;
  encryptedContent: string;
  iv: string;
  senderEphemeralPublicKey: string | null;
  replyToId: string | null;
  replyTo?: IMessagePreview | null;
  isDeleted: boolean;
  deletedForAll: boolean;
  autoDestructAt: string | null;
  createdAt: string;
  sender?: IUserPublic;
  receipts?: IMessageReceipt[];
}

export interface IMessagePreview {
  id: string;
  senderId: string;
  isDeleted: boolean;
  createdAt: string;
  senderName?: string;
}

export interface IMessageReceipt {
  messageId: string;
  userId: string;
  deliveredAt: string | null;
  readAt: string | null;
}

// --- Crypto / PreKey Bundle ---

export interface IPreKeyBundle {
  id: string;
  userId: string;
  oneTimePrekeyPublic: string;
  isUsed: boolean;
  createdAt: string;
}

export interface IKeyBundle {
  identityKey: string;
  signedPrekey: string;
  signedPrekeySignature: string;
  oneTimePrekey?: string;
}

export interface IKeyVerification {
  id: string;
  userId: string;
  identityKeyFingerprint: string;
  isCurrent: boolean;
  verifiedAt: string;
}

// --- WebSocket Events ---

export enum SocketEvent {
  // Connection
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  AUTHENTICATE = 'authenticate',
  AUTHENTICATED = 'authenticated',
  AUTH_ERROR = 'auth_error',

  // Messages
  SEND_MESSAGE = 'message:send',
  NEW_MESSAGE = 'message:new',
  DELETE_MESSAGE = 'message:delete',
  MESSAGE_DELETED = 'message:deleted',

  // Receipts (admin only)
  TYPING_START = 'typing:start',
  TYPING_STOP = 'typing:stop',
  USER_TYPING = 'typing:user',
  MESSAGE_READ = 'message:read',
  MESSAGE_READ_ACK = 'message:read_ack',
  MESSAGE_DELIVERED = 'message:delivered',
  MESSAGE_DELIVERED_ACK = 'message:delivered_ack',

  // Conversations
  CONVERSATION_CREATED = 'conversation:created',
  CONVERSATION_UPDATED = 'conversation:updated',
  MEMBER_ADDED = 'conversation:member_added',
  MEMBER_REMOVED = 'conversation:member_removed',

  // Admin
  SESSION_REVOKED = 'session:revoked',
  FORCE_LOGOUT = 'session:force_logout',
  KEY_VERIFICATION_UPDATE = 'key:verification_update',

  // User presence
  USER_ONLINE = 'user:online',
  USER_OFFLINE = 'user:offline',
}

// --- API Payloads ---

export interface SendMessagePayload {
  conversationId: string;
  encryptedContent: string;
  iv: string;
  senderEphemeralPublicKey: string | null;
  replyToId?: string;
  autoDestructMinutes?: number;
}

export interface CreateConversationPayload {
  type: ConversationType;
  name?: string;
  memberIds: string[];
}

export interface RevokeSessionPayload {
  sessionId: string;
  userId: string;
}

// --- API Responses ---

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}

// --- Auto-destruct agreement ---

export interface AutoDestructAgreement {
  conversationId: string;
  proposedBy: string;
  acceptedBy: string | null;
  minutes: number;
  isActive: boolean;
}

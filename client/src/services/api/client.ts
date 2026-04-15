// ============================================================
// SecureTeam — Cliente API (HTTP)
// Todas las llamadas REST al servidor
// ============================================================

const API_BASE = import.meta.env.VITE_API_URL || '/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Detect Capacitor native platform
    const Capacitor = (window as any).Capacitor;
    const isNative = Capacitor?.isNativePlatform?.() === true;

    if (isNative) {
      // Use Capacitor's native HTTP directly — only way to do cross-origin on Android
      return this.capacitorRequest<T>(method, url, headers, body);
    }

    // Web: use standard fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Error ${response.status}`);
      }

      return data;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error(`Timeout: servidor no respondió en 15s`);
      }
      throw fetchError;
    }
  }

  private async capacitorRequest<T>(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown
  ): Promise<T> {
    // Dynamically import CapacitorHttp from @capacitor/core
    const { CapacitorHttp } = await import('@capacitor/core');

    const options: any = {
      url,
      method,
      headers,
    };

    if (body) {
      options.data = body; // CapacitorHttp takes raw object, not JSON string
    }

    const response = await CapacitorHttp.request(options);

    let data: any;
    try {
      data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    } catch {
      throw new Error(`Respuesta inválida (status ${response.status})`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(data?.error || `Error ${response.status}`);
    }

    return data;
  }

  // --- Auth ---

  async login(email: string, password: string, deviceInfo: string) {
    return this.request<{
      success: boolean;
      data: {
        token: string;
        sessionId: string;
        user: {
          id: string;
          email: string;
          displayName: string;
          role: string;
          publicIdentityKey: string | null;
        };
      };
    }>('POST', '/auth/login', { email, password, deviceInfo });
  }

  async logout() {
    return this.request('POST', '/auth/logout');
  }

  async getMe() {
    return this.request<{ success: boolean; data: any }>('GET', '/auth/me');
  }

  async updateKeys(keys: {
    publicIdentityKey: string;
    signedPrekey: string;
    signedPrekeySignature: string;
    oneTimePrekeys: string[];
  }) {
    return this.request<{ success: boolean; data: { fingerprint: string } }>(
      'PUT',
      '/auth/keys',
      keys
    );
  }

  // --- Users ---

  async getUsers() {
    return this.request<{ success: boolean; data: any[] }>('GET', '/users');
  }

  async getUserKeyBundle(userId: string) {
    return this.request<{
      success: boolean;
      data: {
        identityKey: string;
        signedPrekey: string;
        signedPrekeySignature: string;
        oneTimePrekey: string | null;
      };
    }>('GET', `/users/${userId}/keybundle`);
  }

  // --- Conversations ---

  async getConversations() {
    return this.request<{ success: boolean; data: any[] }>('GET', '/conversations');
  }

  async createConversation(type: string, memberIds: string[], name?: string) {
    return this.request<{ success: boolean; data: any }>(
      'POST',
      '/conversations',
      { type, memberIds, name }
    );
  }

  async getConversation(id: string) {
    return this.request<{ success: boolean; data: any }>('GET', `/conversations/${id}`);
  }

  // --- Messages ---

  async getMessages(conversationId: string, cursor?: string, limit?: number) {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    const query = params.toString() ? `?${params}` : '';

    return this.request<{ success: boolean; data: any[]; hasMore: boolean }>(
      'GET',
      `/messages/${conversationId}${query}`
    );
  }

  async sendMessage(data: {
    conversationId: string;
    encryptedContent: string;
    iv: string;
    senderEphemeralPublicKey: string | null;
    replyToId?: string;
  }) {
    return this.request<{ success: boolean; data: any }>('POST', '/messages', data);
  }

  async deleteMessage(messageId: string) {
    return this.request('DELETE', `/messages/${messageId}`);
  }

  async markAsRead(messageId: string) {
    return this.request('POST', `/messages/${messageId}/read`);
  }

  // --- Admin ---

  async getAdminUsers() {
    return this.request<{ success: boolean; data: any[] }>('GET', '/admin/users');
  }

  async getUserSessions(userId: string) {
    return this.request<{ success: boolean; data: any[] }>(
      'GET',
      `/admin/users/${userId}/sessions`
    );
  }

  async revokeSession(sessionId: string, userId: string) {
    return this.request('POST', '/admin/sessions/revoke', { sessionId, userId });
  }

  async revokeAllSessions(userId: string) {
    return this.request('POST', '/admin/sessions/revoke-all', { userId });
  }

  async toggleUserActive(userId: string) {
    return this.request('PUT', `/admin/users/${userId}/toggle-active`);
  }

  async getKeyVerification() {
    return this.request<{ success: boolean; data: any[] }>('GET', '/admin/key-verification');
  }

  async registerUser(data: { email: string; password: string; displayName: string }) {
    return this.request<{ success: boolean; data: any }>('POST', '/admin/users/register', data);
  }

  async deleteUser(userId: string) {
    return this.request<{ success: boolean; message: string }>('DELETE', `/admin/users/${userId}`);
  }

  // --- Handshakes ---

  async sendHandshakeRequest(targetPublicCode: string) {
    return this.request<{ success: boolean; requestId: string; message: string }>(
      'POST',
      '/handshakes/request',
      { targetPublicCode }
    );
  }

  async acceptHandshake(requestId: string, senderConfirmPin: string) {
    return this.request<{ success: boolean; conversationId: string }>(
      'POST',
      '/handshakes/accept',
      { requestId, senderConfirmPin }
    );
  }

  async getPendingHandshakes() {
    return this.request<{ success: boolean; data: any[] }>('GET', '/handshakes/pending');
  }
}

export const api = new ApiClient();

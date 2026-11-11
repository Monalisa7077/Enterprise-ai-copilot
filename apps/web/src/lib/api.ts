import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'USER';
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface RetryableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const refreshTokenKey = 'enterprise-ai-refresh-token';
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api/v1';

export const api = axios.create({ baseURL: apiBaseUrl });

let accessToken: string | null = null;
let refreshPromise: Promise<AuthResponse> | null = null;

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(refreshTokenKey);
}

export function saveAuthTokens(tokens: Pick<AuthResponse, 'accessToken' | 'refreshToken'>): void {
  sessionStorage.setItem(refreshTokenKey, tokens.refreshToken);
  accessToken = tokens.accessToken;
}

export function clearAuthTokens(): void {
  accessToken = null;
  sessionStorage.removeItem(refreshTokenKey);
}

function expireAuthSession(): void {
  clearAuthTokens();
  window.dispatchEvent(new Event('auth:expired'));
}

async function performRefreshAuthSession(): Promise<AuthResponse> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token is available');
  }

  try {
    const response = await axios.post<ApiResponse<AuthResponse>>(
      `${apiBaseUrl}/auth/refresh`,
      { refreshToken },
    );
    const auth = response.data.data;
    saveAuthTokens(auth);
    return auth;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      expireAuthSession();
    }
    throw error;
  }
}

export function refreshAuthSession(): Promise<AuthResponse> {
  refreshPromise ??= performRefreshAuthSession().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as RetryableRequest | undefined;
    const isAuthAction = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'].some(
      (path) => request?.url?.endsWith(path),
    );

    if (
      error.response?.status !== 401 ||
      !request ||
      request._retry ||
      isAuthAction ||
      !getRefreshToken()
    ) {
      return Promise.reject(error);
    }

    request._retry = true;
    try {
      const auth = await refreshAuthSession();
      request.headers.set('Authorization', `Bearer ${auth.accessToken}`);
      return api(request);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  },
);

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string' && message.trim()) {
      if (message === 'Invalid credentials') {
        return 'The email or password you entered is incorrect.';
      }
      if (message === 'User already exists') {
        return 'An account with this email already exists. Try signing in instead.';
      }
      return message;
    }
    if (!error.response) {
      return 'Unable to connect to the server. Check your connection and try again.';
    }
  }
  return fallback;
}

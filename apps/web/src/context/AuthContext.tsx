import axios from 'axios';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  api,
  clearAuthTokens,
  getApiErrorMessage,
  getRefreshToken,
  refreshAuthSession,
  saveAuthTokens,
  type AuthResponse,
  type AuthUser,
} from '../lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  sessionError: string | null;
  login: (values: { email: string; password: string }) => Promise<void>;
  register: (values: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

interface AuthApiResponse {
  success: boolean;
  data: AuthResponse;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const handleExpiredSession = () => {
      if (active) {
        setUser(null);
      }
    };

    window.addEventListener('auth:expired', handleExpiredSession);

    async function restoreSession() {
      if (!getRefreshToken()) {
        setIsLoading(false);
        return;
      }

      try {
        const auth = await refreshAuthSession();
        if (active) {
          setUser(auth.user);
        }
      } catch (error) {
        if (active && !(axios.isAxiosError(error) && error.response?.status === 401)) {
          setSessionError(getApiErrorMessage(error, 'Could not restore your sign-in session.'));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void restoreSession();
    return () => {
      active = false;
      window.removeEventListener('auth:expired', handleExpiredSession);
    };
  }, []);

  async function completeAuthentication(request: Promise<{ data: AuthApiResponse }>) {
    const response = await request;
    saveAuthTokens(response.data.data);
    setUser(response.data.data.user);
    setSessionError(null);
  }

  async function login(values: { email: string; password: string }) {
    await completeAuthentication(api.post<AuthApiResponse>('/auth/login', values));
  }

  async function register(values: { name: string; email: string; password: string }) {
    await completeAuthentication(api.post<AuthApiResponse>('/auth/register', values));
  }

  async function logout() {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) {
        await api.post('/auth/logout', { refreshToken });
      }
    } finally {
      clearAuthTokens();
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, sessionError, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

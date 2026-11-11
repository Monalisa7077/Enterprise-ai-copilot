import { Link, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatPage from './pages/ChatPage';
import { useState } from 'react';
import { getApiErrorMessage } from './lib/api';
import { useAuth } from './context/AuthContext';

function Layout() {
  const { user, isLoading, sessionError, logout } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setLogoutError(null);
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      setLogoutError(getApiErrorMessage(error, 'Could not contact the server to end your session.'));
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-semibold text-white">
            Enterprise Knowledge Copilot
          </Link>
          <div className="flex items-center gap-4">
            {isLoading ? (
              <span className="text-sm text-slate-400" role="status">Restoring session...</span>
            ) : user ? (
              <>
                <span className="hidden text-sm text-slate-300 sm:inline">Signed in as {user.name}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoggingOut ? 'Signing out...' : 'Sign out'}
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-slate-300 hover:text-white">
                  Login
                </Link>
                <Link to="/register" className="text-slate-300 hover:text-white">
                  Register
                </Link>
              </>
            )}
            <Link to="/dashboard" className="rounded bg-primary-600 px-4 py-2 text-white hover:bg-primary-500">
              Dashboard
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {(sessionError || logoutError) && (
          <p className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
            {logoutError ?? sessionError}
          </p>
        )}
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return <Layout />;
}

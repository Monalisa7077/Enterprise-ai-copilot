import { Link, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-semibold text-white">
            Enterprise Knowledge Copilot
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-slate-300 hover:text-white">
              Login
            </Link>
            <Link to="/register" className="text-slate-300 hover:text-white">
              Register
            </Link>
            <Link to="/dashboard" className="rounded bg-primary-600 px-4 py-2 text-white hover:bg-primary-500">
              Dashboard
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return <Layout />;
}

import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../state/authContext.jsx';

export default function LoginPage() {
  const { login, loading, error, token, setError: setAuthError } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState('');

  if (token) {
    return <Navigate to="/cases" replace />;
  }

  const displayedError = fieldError || error;

  async function handleSubmit(e) {
    e.preventDefault();
    setFieldError('');
    setAuthError?.(null);

    if (!username.trim() || !password) {
      setFieldError('Username and password are required.');
      return;
    }

    const ok = await login(username.trim(), password);
    if (ok) {
      navigate('/cases', { replace: true });
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Auth card — ex-auth-form-card chrome */}
        <div
          className="bg-white rounded-xl px-8 py-8"
          style={{
            boxShadow:
              '0 0 0 1px rgba(0,0,0,0.08), 0px 1px 1px rgba(0,0,0,0.02), 0px 2px 2px rgba(0,0,0,0.04), 0px 8px 16px -4px rgba(0,0,0,0.04)',
          }}
        >
          {/* Eyebrow */}
          <p className="font-mono text-xs text-[#888888] uppercase tracking-wide">
            Trace-X
          </p>

          {/* Headline */}
          <h1 className="mt-3 text-2xl font-semibold leading-8 tracking-[-0.96px] text-[#171717]">
            Sign in to investigate.
          </h1>
          <p className="mt-2 text-sm leading-5 tracking-[-0.28px] text-[#4d4d4d]">
            Access your investigation dashboard with your investigator account.
          </p>

          {/* Error banner */}
          {displayedError && (
            <div
              className="mt-4 rounded-md bg-[#f7d4d6] px-3 py-2 text-sm text-[#c50000]"
              role="alert"
            >
              {displayedError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-sm font-medium text-[#171717]">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                placeholder="Enter your username"
                className="h-10 rounded-md border border-[#ebebeb] bg-white px-3 text-sm text-[#171717] placeholder:text-[#888888] outline-none focus:border-[#a1a1a1] disabled:opacity-60"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-[#171717]">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="Enter your password"
                className="h-10 rounded-md border border-[#ebebeb] bg-white px-3 text-sm text-[#171717] placeholder:text-[#888888] outline-none focus:border-[#a1a1a1] disabled:opacity-60"
              />
            </div>

            {/* Primary CTA */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full rounded-md bg-[#171717] text-sm font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/40 border-t-white" />
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center font-mono text-xs text-[#888888]">
          Secured with JWT authentication
        </p>
      </div>
    </div>
  );
}

import { createContext, useContext, useState, useCallback } from 'react';
import apiClient from '../api/apiClient.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('auth_token'));
  const [user, setUser] = useState(() => {
    const stored = sessionStorage.getItem('auth_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.post('/auth/login', { username, password });

      // Backend envelope: { success: true, data: { token }, error: null }
      const jwt = res.data?.data?.token;
      if (!res.data?.success || !jwt) {
        throw new Error('Login failed. Please try again.');
      }

      const authedUser = { username: username.toLowerCase().trim() };
      sessionStorage.setItem('auth_token', jwt);
      sessionStorage.setItem('auth_user', JSON.stringify(authedUser));
      setToken(jwt);
      setUser(authedUser);
      return true;
    } catch (err) {
      let message;
      if (err.response) {
        // Backend responded with an error envelope
        message =
          err.response.data?.error?.message ||
          (err.response.status === 401
            ? 'Invalid username or password.'
            : 'Login failed. Please try again.');
      } else if (err.request) {
        // Request sent but no response received
        message =
          'Cannot reach the server. Please check that the backend is running and try again.';
      } else {
        message = err.message || 'Login failed. Please try again.';
      }
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

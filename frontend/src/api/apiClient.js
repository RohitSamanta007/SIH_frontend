import axios from 'axios';

/**
 * Centralized API client.
 * Single source of truth for the backend base URL.
 * Configure via VITE_API_BASE_URL in .env (see .env.example).
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the stored JWT to every outgoing request
apiClient.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Clear stale credentials when the backend rejects a token
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && sessionStorage.getItem('auth_token')) {
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_user');
    }
    return Promise.reject(error);
  }
);

export default apiClient;

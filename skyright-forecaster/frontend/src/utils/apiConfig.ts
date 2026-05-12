/**
 * Centralized API configuration
 * Uses VITE_API_URL environment variable with fallback to localhost
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const createApiUrl = (endpoint: string): string => {
  return `${API_BASE_URL}${endpoint}`;
};

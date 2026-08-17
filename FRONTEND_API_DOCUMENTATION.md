# Frontend API Documentation - Admin Dashboard

## Table of Contents
1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
4. [Frontend Integration Examples](#frontend-integration-examples)
5. [Error Handling](#error-handling)
6. [Token Management](#token-management)

---

## Overview

This documentation provides everything you need to integrate the Admin API into your frontend dashboard. The API uses JWT (JSON Web Tokens) for authentication with access tokens and refresh tokens.

**Base URL:** `http://localhost:4005/api/admin` (development)

---

## Authentication

### Authentication Flow

1. **Login** → Get `accessToken` and `refreshToken`
2. **Store tokens** → Save in localStorage/sessionStorage or httpOnly cookies
3. **Include token** → Add to every request: `Authorization: Bearer <accessToken>`
4. **Refresh token** → When access token expires, use refresh token to get new access token
5. **Logout** → Remove tokens from client

### Token Types

- **Access Token**: Short-lived (15 minutes default), used for API requests
- **Refresh Token**: Long-lived (7 days default), used to get new access tokens

---

## API Endpoints

### Authentication Endpoints

#### 1. Admin Login

**Endpoint:** `POST /api/admin/auth/login`

**Request:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "admin": {
      "id": 1,
      "username": "admin",
      "email": "admin@example.com",
      "full_name": "Admin User"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Response (Error - 401):**
```json
{
  "success": false,
  "message": "Invalid username or password"
}
```

---

#### 2. Admin Register

**Endpoint:** `POST /api/admin/auth/register`

**Request:**
```json
{
  "username": "newadmin",
  "email": "newadmin@example.com",
  "password": "secure-password",
  "full_name": "New Admin User"
}
```

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Admin user created successfully",
  "data": {
    "admin": {
      "id": 2,
      "username": "newadmin",
      "email": "newadmin@example.com",
      "full_name": "New Admin User",
      "created_at": "2025-01-27T00:00:00.000Z"
    }
  }
}
```

---

#### 3. Refresh Access Token

**Endpoint:** `POST /api/admin/auth/refresh`

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

#### 4. Get Current Admin

**Endpoint:** `GET /api/admin/auth/me`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "admin": {
      "id": 1,
      "username": "admin",
      "email": "admin@example.com",
      "full_name": "Admin User",
      "is_active": 1,
      "last_login": "2025-01-27T10:00:00.000Z",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  }
}
```

---

#### 5. Logout

**Endpoint:** `POST /api/admin/auth/logout`

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Logout successful"
}
```

---

### Admin Management Endpoints

All admin management endpoints require the `Authorization: Bearer <accessToken>` header.

#### User Management

- `POST /api/admin/users/:userId/activate` - Activate user
- `POST /api/admin/users/:userId/deactivate` - Deactivate user
- `POST /api/admin/users/:userId/suspend` - Suspend user
- `POST /api/admin/users/:userId/unsuspend` - Unsuspend user
- `GET /api/admin/users/:userId/details` - Get user details

#### Subscription Management

- `POST /api/admin/subscriptions/:subscriptionId/mark-unpaid` - Mark as unpaid
- `POST /api/admin/subscriptions/:subscriptionId/mark-paid` - Mark as paid
- `POST /api/admin/subscriptions/:subscriptionId/extend` - Extend subscription

#### Audit Log

- `GET /api/admin/audit-log` - Get audit log (with pagination and filters)

**See `ADMIN_API_DETAILED_DOCUMENTATION.md` for complete endpoint documentation.**

---

## Frontend Integration Examples

### React/TypeScript Example

#### 1. API Service Setup

```typescript
// src/services/api.ts
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4005/api/admin';

class ApiService {
  private getAccessToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem('refreshToken');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getAccessToken();
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token expired, try to refresh
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        // Retry request with new token
        return this.request<T>(endpoint, options);
      } else {
        // Refresh failed, redirect to login
        this.logout();
        throw new Error('Session expired');
      }
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Request failed');
    }

    return response.json();
  }

  async login(username: string, password: string) {
    const response = await this.request<{
      success: boolean;
      data: {
        admin: any;
        accessToken: string;
        refreshToken: string;
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (response.success) {
      localStorage.setItem('accessToken', response.data.accessToken);
      localStorage.setItem('refreshToken', response.data.refreshToken);
      localStorage.setItem('admin', JSON.stringify(response.data.admin));
    }

    return response;
  }

  async refreshAccessToken(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('accessToken', data.data.accessToken);
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    return false;
  }

  async getCurrentAdmin() {
    return this.request<{ success: boolean; data: { admin: any } }>('/auth/me');
  }

  async logout() {
    try {
      await this.request('/auth/logout');
    } catch (error) {
      // Ignore errors on logout
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('admin');
    }
  }

  // User Management
  async activateUser(userId: number, reason?: string) {
    return this.request(`/users/${userId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async deactivateUser(userId: number, reason?: string) {
    return this.request(`/users/${userId}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async suspendUser(userId: number, reason?: string) {
    return this.request(`/users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async unsuspendUser(userId: number, reason?: string) {
    return this.request(`/users/${userId}/unsuspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async getUserDetails(userId: number) {
    return this.request(`/users/${userId}/details`);
  }

  // Subscription Management
  async markSubscriptionUnpaid(subscriptionId: number, reason?: string) {
    return this.request(`/subscriptions/${subscriptionId}/mark-unpaid`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async markSubscriptionPaid(subscriptionId: number, reason?: string) {
    return this.request(`/subscriptions/${subscriptionId}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async extendSubscription(subscriptionId: number, days: number, reason?: string) {
    return this.request(`/subscriptions/${subscriptionId}/extend`, {
      method: 'POST',
      body: JSON.stringify({ days, reason }),
    });
  }

  // Audit Log
  async getAuditLog(params?: {
    page?: number;
    limit?: number;
    userId?: number;
    action?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.userId) queryParams.append('userId', params.userId.toString());
    if (params?.action) queryParams.append('action', params.action);

    const query = queryParams.toString();
    return this.request(`/audit-log${query ? `?${query}` : ''}`);
  }
}

export const apiService = new ApiService();
```

#### 2. Auth Context/Hook

```typescript
// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiService } from '../services/api';

interface AuthContextType {
  admin: any | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in on mount
    const checkAuth = async () => {
      const storedAdmin = localStorage.getItem('admin');
      if (storedAdmin) {
        try {
          const response = await apiService.getCurrentAdmin();
          if (response.success) {
            setAdmin(response.data.admin);
          } else {
            localStorage.removeItem('admin');
          }
        } catch (error) {
          localStorage.removeItem('admin');
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (username: string, password: string) => {
    const response = await apiService.login(username, password);
    if (response.success) {
      setAdmin(response.data.admin);
    } else {
      throw new Error(response.message || 'Login failed');
    }
  };

  const logout = async () => {
    await apiService.logout();
    setAdmin(null);
  };

  return (
    <AuthContext.Provider
      value={{
        admin,
        isAuthenticated: !!admin,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

#### 3. Login Component Example

```typescript
// src/components/Login.tsx
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <form onSubmit={handleSubmit}>
        <h2>Admin Login</h2>
        {error && <div className="error">{error}</div>}
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}
```

#### 4. Protected Route Component

```typescript
// src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

---

### Vue.js Example

```javascript
// src/services/api.js
import axios from 'axios';

const API_BASE_URL = process.env.VUE_APP_API_URL || 'http://localhost:4005/api/admin';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        localStorage.setItem('accessToken', response.data.data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${response.data.data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
```

---

### Vanilla JavaScript Example

```javascript
// api.js
const API_BASE_URL = 'http://localhost:4005/api/admin';

class AdminAPI {
  constructor() {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (response.status === 401) {
        // Try to refresh token
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry with new token
          headers.Authorization = `Bearer ${this.accessToken}`;
          return fetch(url, { ...options, headers });
        } else {
          // Redirect to login
          window.location.href = '/login.html';
          throw new Error('Session expired');
        }
      }

      return response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  async login(username, password) {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (response.success) {
      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;
      localStorage.setItem('accessToken', this.accessToken);
      localStorage.setItem('refreshToken', this.refreshToken);
      localStorage.setItem('admin', JSON.stringify(response.data.admin));
    }

    return response;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) return false;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        this.accessToken = data.data.accessToken;
        localStorage.setItem('accessToken', this.accessToken);
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    return false;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch (error) {
      // Ignore errors
    } finally {
      this.accessToken = null;
      this.refreshToken = null;
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('admin');
    }
  }

  // User management methods
  async activateUser(userId, reason) {
    return this.request(`/users/${userId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // ... other methods
}

const adminAPI = new AdminAPI();
```

---

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error (optional)"
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (account deactivated)
- `404` - Not Found
- `409` - Conflict (duplicate username/email)
- `500` - Internal Server Error

### Error Handling Example

```typescript
try {
  const response = await apiService.activateUser(1, 'Payment received');
  if (response.success) {
    // Show success message
    console.log('User activated');
  }
} catch (error: any) {
  if (error.message === 'Session expired') {
    // Redirect to login
    navigate('/login');
  } else {
    // Show error message
    alert(error.message || 'An error occurred');
  }
}
```

---

## Token Management

### Storing Tokens

**Option 1: localStorage (Simple, but vulnerable to XSS)**
```javascript
localStorage.setItem('accessToken', token);
localStorage.setItem('refreshToken', refreshToken);
```

**Option 2: httpOnly Cookies (More secure, requires backend setup)**
```javascript
// Backend sets cookies, frontend doesn't need to handle tokens
```

**Option 3: sessionStorage (Cleared on tab close)**
```javascript
sessionStorage.setItem('accessToken', token);
```

### Token Refresh Strategy

1. **Automatic Refresh on 401**: Intercept 401 responses and refresh token
2. **Proactive Refresh**: Refresh token before it expires (e.g., 1 minute before)
3. **Background Refresh**: Periodically refresh token in background

### Example: Proactive Token Refresh

```typescript
// Refresh token 1 minute before expiration
function setupTokenRefresh() {
  const token = localStorage.getItem('accessToken');
  if (!token) return;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresAt = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    const refreshTime = timeUntilExpiry - 60000; // 1 minute before expiry

    if (refreshTime > 0) {
      setTimeout(async () => {
        await apiService.refreshAccessToken();
        setupTokenRefresh(); // Schedule next refresh
      }, refreshTime);
    }
  } catch (error) {
    console.error('Failed to parse token:', error);
  }
}
```

---

## Environment Variables

Create a `.env` file in your frontend project:

```env
REACT_APP_API_URL=http://localhost:4005/api/admin
# or
VUE_APP_API_URL=http://localhost:4005/api/admin
# or
NEXT_PUBLIC_API_URL=http://localhost:4005/api/admin
```

---

## Complete Example: React Dashboard

See the React examples above for a complete implementation including:
- API service with automatic token refresh
- Auth context for state management
- Login component
- Protected routes
- Error handling

---

## Security Best Practices

1. **Never commit tokens to version control**
2. **Use HTTPS in production**
3. **Implement CSRF protection**
4. **Validate and sanitize all inputs**
5. **Use httpOnly cookies for tokens (if possible)**
6. **Implement rate limiting on login**
7. **Log security events**
8. **Use Content Security Policy (CSP)**

---

## Support

For issues or questions, please contact the development team.

**Last Updated:** 2025-01-27


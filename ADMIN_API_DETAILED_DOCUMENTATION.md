# Admin API - Detailed Documentation

## Table of Contents
1. [Authentication](#authentication)
2. [Authentication Endpoints](#authentication-endpoints)
3. [User Management Endpoints](#user-management-endpoints)
4. [Subscription Management Endpoints](#subscription-management-endpoints)
5. [Audit Log Endpoints](#audit-log-endpoints)
6. [Error Handling](#error-handling)
7. [Request/Response Schemas](#requestresponse-schemas)

---

## Authentication

All admin endpoints (except auth endpoints) require authentication via JWT (JSON Web Tokens).

### Authentication Flow

1. **Login** → Get `accessToken` and `refreshToken`
2. **Include Token** → Add to every request: `Authorization: Bearer <accessToken>`
3. **Refresh Token** → When access token expires, use refresh token to get new access token
4. **Logout** → Remove tokens (handled client-side)

### Authentication Method

All protected endpoints require the following header:

```
Authorization: Bearer <accessToken>
```

### Token Types

- **Access Token**: Short-lived (15 minutes default), used for API requests
- **Refresh Token**: Long-lived (7 days default), used to get new access tokens

### Configuration

Set in `.env` file:
```env
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d
```

**Important:** Use strong, randomly generated secrets in production!

---

## User Management Endpoints

### 1. Activate User

Activates a user's subscription by setting it to `ACTIVE` status.

**Endpoint:** `POST /api/admin/users/:userId/activate`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | integer | Yes | The ID of the user to activate |

**Request Headers:**
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body (Optional):**
```json
{
  "reason": "Payment received manually"
}
```

**Request Body Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for activation (stored in audit log) |

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "User subscription activated successfully",
  "subscription": {
    "id": 123,
    "status": "ACTIVE"
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `message` | string | Success message |
| `subscription.id` | integer | Subscription ID that was activated |
| `subscription.status` | string | New status (`ACTIVE`) |

**cURL Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/activate \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Payment received via bank transfer"
  }'
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/users/1/activate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <accessToken>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Payment received via bank transfer'
  })
});

const data = await response.json();
console.log(data);
```

**Python Example:**
```python
import requests

url = "http://localhost:4005/api/admin/users/1/activate"
headers = {
    "Authorization": "Bearer <accessToken>",
    "Content-Type": "application/json"
}
data = {
    "reason": "Payment received via bank transfer"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

**Error Responses:**
- `400 Bad Request`: Invalid user ID
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: User or subscription not found
- `500 Internal Server Error`: Server error

---

### 2. Deactivate User

Deactivates a user's subscription by setting it to `EXPIRED` status.

**Endpoint:** `POST /api/admin/users/:userId/deactivate`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | integer | Yes | The ID of the user to deactivate |

**Request Headers:**
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body (Optional):**
```json
{
  "reason": "Payment not received"
}
```

**Request Body Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for deactivation (stored in audit log) |

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "User subscription deactivated successfully",
  "subscription": {
    "id": 123,
    "status": "EXPIRED"
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `message` | string | Success message |
| `subscription.id` | integer | Subscription ID that was deactivated |
| `subscription.status` | string | New status (`EXPIRED`) |

**cURL Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/deactivate \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Payment overdue - 30 days"
  }'
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/users/1/deactivate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <accessToken>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Payment overdue - 30 days'
  })
});

const data = await response.json();
console.log(data);
```

**Error Responses:**
- `400 Bad Request`: Invalid user ID
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: User or subscription not found
- `500 Internal Server Error`: Server error

---

### 3. Suspend User

Suspends a user by removing their Telegram group access and marking access as removed.

**Endpoint:** `POST /api/admin/users/:userId/suspend`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | integer | Yes | The ID of the user to suspend |

**Request Headers:**
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body (Optional):**
```json
{
  "reason": "Violation of terms of service"
}
```

**Request Body Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for suspension (stored in audit log) |

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "User suspended successfully",
  "user": {
    "id": 1,
    "telegramAccessRemoved": true
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `message` | string | Success message |
| `user.id` | integer | User ID that was suspended |
| `user.telegramAccessRemoved` | boolean | Confirmation that access was removed |

**cURL Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/suspend \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Spam detected in group"
  }'
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/users/1/suspend', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <accessToken>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Spam detected in group'
  })
});

const data = await response.json();
console.log(data);
```

**Error Responses:**
- `400 Bad Request`: Invalid user ID
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: User not found
- `500 Internal Server Error`: Server error

---

### 4. Unsuspend User

Restores a suspended user's access to the Telegram group.

**Endpoint:** `POST /api/admin/users/:userId/unsuspend`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | integer | Yes | The ID of the user to unsuspend |

**Request Headers:**
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body (Optional):**
```json
{
  "reason": "Issue resolved"
}
```

**Request Body Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for unsuspension (stored in audit log) |

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "User unsuspended successfully",
  "user": {
    "id": 1,
    "telegramAccessRestored": true
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `message` | string | Success message |
| `user.id` | integer | User ID that was unsuspended |
| `user.telegramAccessRestored` | boolean | Confirmation that access was restored |

**cURL Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/unsuspend \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "False positive - issue resolved"
  }'
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/users/1/unsuspend', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <accessToken>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'False positive - issue resolved'
  })
});

const data = await response.json();
console.log(data);
```

**Error Responses:**
- `400 Bad Request`: Invalid user ID
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: User not found
- `500 Internal Server Error`: Server error

---

### 5. Get User Details

Retrieves comprehensive information about a user including subscriptions, Telegram access, and audit log.

**Endpoint:** `GET /api/admin/users/:userId/details`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | integer | Yes | The ID of the user |

**Request Headers:**
```
Authorization: Bearer <accessToken>
```

**Response (Success - 200):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "phone": "+1234567890",
    "telegram_user_id": 123456789,
    "telegram_username": "username",
    "created_at": "2025-01-01T00:00:00.000Z",
    "subscriptions": [
      {
        "id": 123,
        "user_id": 1,
        "plan": "MONTHLY_30",
        "status": "ACTIVE",
        "stripe_customer_id": "cus_abc123",
        "stripe_subscription_id": "sub_xyz789",
        "current_period_end": "2025-02-01T00:00:00.000Z",
        "cancel_at_period_end": 0,
        "created_at": "2025-01-01T00:00:00.000Z",
        "updated_at": "2025-01-01T00:00:00.000Z"
      }
    ],
    "telegramAccess": [
      {
        "id": 1,
        "user_id": 1,
        "chat_id": -1001234567890,
        "invite_link": "https://t.me/+abc123def456",
        "joined_at": "2025-01-01T00:00:00.000Z",
        "removed_at": null,
        "last_verified_at": "2025-01-01T00:00:00.000Z",
        "created_at": "2025-01-01T00:00:00.000Z"
      }
    ],
    "auditLog": [
      {
        "id": 1,
        "user_id": 1,
        "action": "USER_ACTIVATED",
        "reason": "Payment received",
        "meta": "{\"subscriptionId\": 123}",
        "created_at": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `user` | object | User object with full details |
| `user.id` | integer | User ID |
| `user.email` | string \| null | User email |
| `user.phone` | string \| null | User phone |
| `user.telegram_user_id` | integer \| null | Telegram user ID |
| `user.telegram_username` | string \| null | Telegram username |
| `user.created_at` | string | User creation timestamp (ISO 8601) |
| `user.subscriptions` | array | Array of subscription objects |
| `user.telegramAccess` | array | Array of Telegram access records |
| `user.auditLog` | array | Array of audit log entries (last 50) |

**cURL Example:**
```bash
curl -X GET \
  http://localhost:4005/api/admin/users/1/details \
  -H "Authorization: Bearer <accessToken>"
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/users/1/details', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer <accessToken>'
  }
});

const data = await response.json();
console.log(data);
```

**Error Responses:**
- `400 Bad Request`: Invalid user ID
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: User not found
- `500 Internal Server Error`: Server error

---

## Subscription Management Endpoints

### 6. Mark Subscription as Unpaid

Marks a subscription as unpaid/not received by setting status to `PENDING`.

**Endpoint:** `POST /api/admin/subscriptions/:subscriptionId/mark-unpaid`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subscriptionId` | integer | Yes | The ID of the subscription |

**Request Headers:**
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body (Optional):**
```json
{
  "reason": "Payment not received"
}
```

**Request Body Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for marking as unpaid (stored in audit log) |

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Subscription marked as unpaid successfully",
  "subscription": {
    "id": 123,
    "status": "PENDING"
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `message` | string | Success message |
| `subscription.id` | integer | Subscription ID |
| `subscription.status` | string | New status (`PENDING`) |

**cURL Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/mark-unpaid \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Payment not received after 7 days"
  }'
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/subscriptions/123/mark-unpaid', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <accessToken>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Payment not received after 7 days'
  })
});

const data = await response.json();
console.log(data);
```

**Error Responses:**
- `400 Bad Request`: Invalid subscription ID
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: Subscription not found
- `500 Internal Server Error`: Server error

---

### 7. Mark Subscription as Paid

Marks a subscription as paid by setting status to `ACTIVE`.

**Endpoint:** `POST /api/admin/subscriptions/:subscriptionId/mark-paid`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subscriptionId` | integer | Yes | The ID of the subscription |

**Request Headers:**
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body (Optional):**
```json
{
  "reason": "Payment received manually"
}
```

**Request Body Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for marking as paid (stored in audit log) |

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Subscription marked as paid successfully",
  "subscription": {
    "id": 123,
    "status": "ACTIVE"
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `message` | string | Success message |
| `subscription.id` | integer | Subscription ID |
| `subscription.status` | string | New status (`ACTIVE`) |

**cURL Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/mark-paid \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Bank transfer received and verified"
  }'
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/subscriptions/123/mark-paid', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <accessToken>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    reason: 'Bank transfer received and verified'
  })
});

const data = await response.json();
console.log(data);
```

**Error Responses:**
- `400 Bad Request`: Invalid subscription ID
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: Subscription not found
- `500 Internal Server Error`: Server error

---

### 8. Extend Subscription

Extends a subscription's period by a specified number of days.

**Endpoint:** `POST /api/admin/subscriptions/:subscriptionId/extend`

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subscriptionId` | integer | Yes | The ID of the subscription |

**Request Headers:**
```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body (Required):**
```json
{
  "days": 30,
  "reason": "Compensation for service issue"
}
```

**Request Body Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `days` | integer | Yes | Number of days to extend (must be positive) |
| `reason` | string | No | Reason for extension (stored in audit log) |

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Subscription extended by 30 days successfully",
  "subscription": {
    "id": 123,
    "current_period_end": "2025-03-01T00:00:00.000Z",
    "status": "ACTIVE"
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `message` | string | Success message with days extended |
| `subscription.id` | integer | Subscription ID |
| `subscription.current_period_end` | string | New period end date (ISO 8601) |
| `subscription.status` | string | Status (set to `ACTIVE`) |

**cURL Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/extend \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "days": 30,
    "reason": "Service downtime compensation"
  }'
```

**JavaScript/Fetch Example:**
```javascript
const response = await fetch('http://localhost:4005/api/admin/subscriptions/123/extend', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <accessToken>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    days: 30,
    reason: 'Service downtime compensation'
  })
});

const data = await response.json();
console.log(data);
```

**Python Example:**
```python
import requests

url = "http://localhost:4005/api/admin/subscriptions/123/extend"
headers = {
    "Authorization": "Bearer <accessToken>",
    "Content-Type": "application/json"
}
data = {
    "days": 30,
    "reason": "Service downtime compensation"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

**Error Responses:**
- `400 Bad Request`: Invalid subscription ID or days (must be positive)
- `401 Unauthorized`: Missing or invalid/expired token
- `404 Not Found`: Subscription not found
- `500 Internal Server Error`: Server error

---

## Audit Log Endpoints

### 9. Get Audit Log

Retrieves the audit log of all admin actions with optional filtering and pagination.

**Endpoint:** `GET /api/admin/audit-log`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer | No | Page number (default: 1) |
| `limit` | integer | No | Items per page (default: 50, max: 100) |
| `userId` | integer | No | Filter by user ID |
| `action` | string | No | Filter by action type |

**Request Headers:**
```
Authorization: Bearer <accessToken>
```

**Response (Success - 200):**
```json
{
  "success": true,
  "auditLog": [
    {
      "id": 1,
      "user_id": 1,
      "action": "USER_ACTIVATED",
      "reason": "Payment received",
      "meta": "{\"subscriptionId\": 123}",
      "created_at": "2025-01-01T00:00:00.000Z"
    },
    {
      "id": 2,
      "user_id": 2,
      "action": "SUBSCRIPTION_EXTENDED",
      "reason": "Service compensation",
      "meta": "{\"subscriptionId\": 456, \"daysAdded\": 7}",
      "created_at": "2025-01-02T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

**Response Schema:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `auditLog` | array | Array of audit log entries |
| `auditLog[].id` | integer | Audit log entry ID |
| `auditLog[].user_id` | integer \| null | User ID (null for system actions) |
| `auditLog[].action` | string | Action type (see below) |
| `auditLog[].reason` | string \| null | Reason for action |
| `auditLog[].meta` | string \| null | JSON string with additional metadata |
| `auditLog[].created_at` | string | Timestamp (ISO 8601) |
| `pagination.page` | integer | Current page number |
| `pagination.limit` | integer | Items per page |
| `pagination.total` | integer | Total number of entries |
| `pagination.totalPages` | integer | Total number of pages |

**Action Types:**
- `USER_ACTIVATED` - User subscription activated
- `USER_DEACTIVATED` - User subscription deactivated
- `USER_SUSPENDED` - User suspended
- `USER_UNSUSPENDED` - User unsuspended
- `SUBSCRIPTION_MARKED_UNPAID` - Subscription marked as unpaid
- `SUBSCRIPTION_MARKED_PAID` - Subscription marked as paid
- `SUBSCRIPTION_EXTENDED` - Subscription period extended

**cURL Examples:**
```bash
# Get all audit logs (first page)
curl -X GET \
  http://localhost:4005/api/admin/audit-log \
  -H "Authorization: Bearer <accessToken>"

# Get audit logs for a specific user
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?userId=1" \
  -H "Authorization: Bearer <accessToken>"

# Get audit logs for a specific action
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?action=USER_ACTIVATED" \
  -H "Authorization: Bearer <accessToken>"

# Paginated results
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?page=2&limit=20" \
  -H "Authorization: Bearer <accessToken>"

# Combined filters
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?userId=1&action=USER_ACTIVATED&page=1&limit=10" \
  -H "Authorization: Bearer <accessToken>"
```

**JavaScript/Fetch Example:**
```javascript
// Get all audit logs
const response = await fetch('http://localhost:4005/api/admin/audit-log?page=1&limit=50', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer <accessToken>'
  }
});

const data = await response.json();
console.log(data);

// Get audit logs for specific user
const userAuditLog = await fetch('http://localhost:4005/api/admin/audit-log?userId=1', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer <accessToken>'
  }
});

const userData = await userAuditLog.json();
console.log(userData);
```

**Error Responses:**
- `400 Bad Request`: Invalid query parameters
- `401 Unauthorized`: Missing or invalid/expired token
- `500 Internal Server Error`: Server error

---

## Error Handling

All endpoints return errors in a consistent format:

### Error Response Format
```json
{
  "success": false,
  "message": "Error message describing what went wrong",
  "error": "Detailed error message (optional, for debugging)"
}
```

### HTTP Status Codes

| Status Code | Description | Common Causes |
|-------------|-------------|---------------|
| `400` | Bad Request | Invalid parameters, missing required fields |
| `401` | Unauthorized | Missing, invalid, or expired token |
| `404` | Not Found | Resource (user/subscription) doesn't exist |
| `500` | Internal Server Error | Server-side error, database issue |

### Example Error Responses

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Authorization token required. Provide it via 'Authorization: Bearer <token>' header."
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "message": "User not found"
}
```

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Invalid user ID"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Failed to activate user",
  "error": "Database connection timeout"
}
```

---

## Request/Response Schemas

### Common Request Headers
```
Authorization: Bearer <accessToken> (required)
Content-Type: application/json (required for POST requests)
```

### Common Response Fields
```typescript
{
  success: boolean;
  message?: string;
  error?: string;
}
```

### User Object Schema
```typescript
{
  id: number;
  email: string | null;
  phone: string | null;
  telegram_user_id: number | null;
  telegram_username: string | null;
  created_at: string; // ISO 8601 timestamp
}
```

### Subscription Object Schema
```typescript
{
  id: number;
  user_id: number;
  plan: "MONTHLY_20" | "MONTHLY_30" | "YEARLY_280";
  status: "PENDING" | "ACTIVE" | "CANCELED" | "EXPIRED";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null; // ISO 8601 datetime
  cancel_at_period_end: 0 | 1;
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}
```

### Audit Log Entry Schema
```typescript
{
  id: number;
  user_id: number | null;
  action: string;
  reason: string | null;
  meta: string | null; // JSON string
  created_at: string; // ISO 8601 timestamp
}
```

---

## Complete Workflow Examples

### Example 1: Manual Payment Processing

```bash
# Step 1: Check user details
curl -X GET \
  http://localhost:4005/api/admin/users/1/details \
  -H "Authorization: Bearer <accessToken>"

# Step 2: Mark subscription as paid
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/mark-paid \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Bank transfer received - Transaction ID: TXN123456"
  }'

# Step 3: Verify in audit log
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?userId=1&action=SUBSCRIPTION_MARKED_PAID" \
  -H "Authorization: Bearer <accessToken>"
```

### Example 2: User Violation Handling

```bash
# Step 1: Login to get access token
LOGIN_RESPONSE=$(curl -X POST \
  http://localhost:4005/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-password"
  }')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.accessToken')

# Step 2: Suspend user
curl -X POST \
  http://localhost:4005/api/admin/users/1/suspend \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Spam detected - multiple violations"
  }'

# Step 3: Later, unsuspend after review
curl -X POST \
  http://localhost:4005/api/admin/users/1/unsuspend \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "False positive - user reinstated after review"
  }'
```

### Example 3: Service Compensation

```bash
# Step 1: Login to get access token
LOGIN_RESPONSE=$(curl -X POST \
  http://localhost:4005/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-password"
  }')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.accessToken')

# Step 2: Extend subscription by 7 days as compensation
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/extend \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "days": 7,
    "reason": "Service downtime on 2025-01-15 - 2 hours"
  }'
```

---

## Testing with Postman

### Import Collection

1. Create a new collection in Postman
2. Set collection variable: `base_url` = `http://localhost:4005`
3. Set collection variable: `access_token` = `your-access-token-here`
4. Add header to collection: `Authorization` = `Bearer {{access_token}}`

### Example Postman Request

**Request:**
- Method: `POST`
- URL: `{{base_url}}/api/admin/users/1/activate`
- Headers:
  - `Authorization`: `Bearer {{access_token}}`
  - `Content-Type`: `application/json`
- Body (raw JSON):
```json
{
  "reason": "Payment verified"
}
```

---

## Security Best Practices

1. **Never commit tokens or secrets to version control**
2. **Use HTTPS in production**
3. **Store tokens securely** (consider httpOnly cookies for refresh tokens)
4. **Implement token refresh before expiry**
5. **Limit access to admin endpoints**
6. **Monitor audit logs for suspicious activity**
7. **Use strong, randomly generated JWT secrets**
8. **Implement rate limiting on login endpoint**
9. **Log all admin API access**
10. **Clear tokens on logout**

---

## Support

For issues or questions about the Admin API, please contact the development team.

**Base URL:** `http://localhost:4005` (development)  
**API Version:** 1.0  
**Last Updated:** 2025-01-27


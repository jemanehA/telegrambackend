# Admin API Documentation

## Overview

The Admin API provides endpoints for managing users, subscriptions, and system operations. All admin endpoints require authentication via an API key.

## Authentication

All admin endpoints require authentication using one of the following methods:

### Method 1: Header (Recommended)
```
x-admin-api-key: your-admin-api-key
```

### Method 2: Authorization Header
```
Authorization: Bearer your-admin-api-key
```

**Note:** Set the `ADMIN_API_KEY` environment variable to configure the admin API key. Default is `admin-secret-key-change-in-production` (change in production!).

---

## Base URL

All endpoints are prefixed with `/api/admin`

---

## User Management Endpoints

### 1. Activate User

Activate a user's subscription (set to ACTIVE status).

**Endpoint:** `POST /api/admin/users/:userId/activate`

**Parameters:**
- `userId` (path, required): The user ID to activate

**Request Body (optional):**
```json
{
  "reason": "Payment received manually"
}
```

**Response:**
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

**Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/activate \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Payment verified"}'
```

---

### 2. Deactivate User

Deactivate a user's subscription (set to EXPIRED status).

**Endpoint:** `POST /api/admin/users/:userId/deactivate`

**Parameters:**
- `userId` (path, required): The user ID to deactivate

**Request Body (optional):**
```json
{
  "reason": "Payment not received"
}
```

**Response:**
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

**Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/deactivate \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Payment overdue"}'
```

---

### 3. Suspend User

Suspend a user (remove from Telegram group and mark access as removed).

**Endpoint:** `POST /api/admin/users/:userId/suspend`

**Parameters:**
- `userId` (path, required): The user ID to suspend

**Request Body (optional):**
```json
{
  "reason": "Violation of terms"
}
```

**Response:**
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

**Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/suspend \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Terms violation"}'
```

---

### 4. Unsuspend User

Restore a suspended user's access.

**Endpoint:** `POST /api/admin/users/:userId/unsuspend`

**Parameters:**
- `userId` (path, required): The user ID to unsuspend

**Request Body (optional):**
```json
{
  "reason": "Issue resolved"
}
```

**Response:**
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

**Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/users/1/unsuspend \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Issue resolved"}'
```

---

### 5. Get User Details

Get comprehensive details about a user including subscriptions, Telegram access, and audit log.

**Endpoint:** `GET /api/admin/users/:userId/details`

**Parameters:**
- `userId` (path, required): The user ID

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "telegram_user_id": 123456789,
    "email": "user@example.com",
    "phone": null,
    "created_at": "2025-01-01T00:00:00.000Z",
    "subscriptions": [
      {
        "id": 123,
        "plan": "MONTHLY_30",
        "status": "ACTIVE",
        "current_period_end": "2025-02-01T00:00:00.000Z",
        ...
      }
    ],
    "telegramAccess": [
      {
        "id": 1,
        "chat_id": -1001234567890,
        "invite_link": "https://t.me/+...",
        "joined_at": "2025-01-01T00:00:00.000Z",
        ...
      }
    ],
    "auditLog": [
      {
        "id": 1,
        "action": "USER_ACTIVATED",
        "reason": "Payment verified",
        "created_at": "2025-01-01T00:00:00.000Z",
        ...
      }
    ]
  }
}
```

**Example:**
```bash
curl -X GET \
  http://localhost:4005/api/admin/users/1/details \
  -H "x-admin-api-key: your-admin-api-key"
```

---

## Subscription Management Endpoints

### 6. Mark Subscription as Unpaid

Mark a subscription as unpaid/not received (set status to PENDING).

**Endpoint:** `POST /api/admin/subscriptions/:subscriptionId/mark-unpaid`

**Parameters:**
- `subscriptionId` (path, required): The subscription ID

**Request Body (optional):**
```json
{
  "reason": "Payment not received"
}
```

**Response:**
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

**Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/mark-unpaid \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Payment not received"}'
```

---

### 7. Mark Subscription as Paid

Mark a subscription as paid (set status to ACTIVE).

**Endpoint:** `POST /api/admin/subscriptions/:subscriptionId/mark-paid`

**Parameters:**
- `subscriptionId` (path, required): The subscription ID

**Request Body (optional):**
```json
{
  "reason": "Payment received manually"
}
```

**Response:**
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

**Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/mark-paid \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Payment verified"}'
```

---

### 8. Extend Subscription

Extend a subscription's period by a specified number of days.

**Endpoint:** `POST /api/admin/subscriptions/:subscriptionId/extend`

**Parameters:**
- `subscriptionId` (path, required): The subscription ID

**Request Body:**
```json
{
  "days": 30,
  "reason": "Compensation for service issue"
}
```

**Response:**
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

**Example:**
```bash
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/extend \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"days": 30, "reason": "Service compensation"}'
```

---

## Audit Log Endpoints

### 9. Get Audit Log

Retrieve the audit log of admin actions.

**Endpoint:** `GET /api/admin/audit-log`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50)
- `userId` (optional): Filter by user ID
- `action` (optional): Filter by action type

**Response:**
```json
{
  "success": true,
  "auditLog": [
    {
      "id": 1,
      "user_id": 1,
      "action": "USER_ACTIVATED",
      "reason": "Payment verified",
      "meta": "{\"subscriptionId\": 123}",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "totalPages": 2
  }
}
```

**Example:**
```bash
# Get all audit logs
curl -X GET \
  http://localhost:4005/api/admin/audit-log \
  -H "x-admin-api-key: your-admin-api-key"

# Get audit logs for a specific user
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?userId=1" \
  -H "x-admin-api-key: your-admin-api-key"

# Get audit logs for a specific action
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?action=USER_ACTIVATED" \
  -H "x-admin-api-key: your-admin-api-key"

# Paginated results
curl -X GET \
  "http://localhost:4005/api/admin/audit-log?page=2&limit=20" \
  -H "x-admin-api-key: your-admin-api-key"
```

---

## Action Types

The following action types are logged in the audit log:

- `USER_ACTIVATED` - User subscription activated
- `USER_DEACTIVATED` - User subscription deactivated
- `USER_SUSPENDED` - User suspended
- `USER_UNSUSPENDED` - User unsuspended
- `SUBSCRIPTION_MARKED_UNPAID` - Subscription marked as unpaid
- `SUBSCRIPTION_MARKED_PAID` - Subscription marked as paid
- `SUBSCRIPTION_EXTENDED` - Subscription period extended

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "message": "Error message here",
  "error": "Detailed error message (optional)"
}
```

### Common HTTP Status Codes

- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing or invalid API key)
- `403` - Forbidden (invalid API key)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

---

## Environment Configuration

Add the following to your `.env` file:

```env
ADMIN_API_KEY=your-secure-admin-api-key-here
```

**Important:** Change the default API key in production!

---

## Security Notes

1. **Never commit your API key to version control**
2. **Use HTTPS in production**
3. **Rotate your API key regularly**
4. **Limit access to admin endpoints**
5. **Monitor the audit log for suspicious activity**

---

## Example Use Cases

### Use Case 1: Manual Payment Processing
```bash
# Mark subscription as paid after receiving manual payment
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/mark-paid \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Bank transfer received"}'
```

### Use Case 2: User Violation Handling
```bash
# Suspend user for terms violation
curl -X POST \
  http://localhost:4005/api/admin/users/1/suspend \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Spam detected"}'

# Later, unsuspend after issue resolved
curl -X POST \
  http://localhost:4005/api/admin/users/1/unsuspend \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Issue resolved"}'
```

### Use Case 3: Service Compensation
```bash
# Extend subscription by 7 days as compensation
curl -X POST \
  http://localhost:4005/api/admin/subscriptions/123/extend \
  -H "x-admin-api-key: your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"days": 7, "reason": "Service downtime compensation"}'
```

---

## Support

For issues or questions, please contact the development team.


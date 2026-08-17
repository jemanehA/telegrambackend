# Admin Authentication Setup Guide

## Prerequisites

1. Node.js and npm installed
2. MySQL database running
3. Environment variables configured

## Step 1: Install Dependencies

```bash
npm install
```

This will install:
- `jsonwebtoken` - JWT token generation and verification
- `bcryptjs` - Password hashing
- `@types/jsonwebtoken` - TypeScript types
- `@types/bcryptjs` - TypeScript types

## Step 2: Create Admin Users Table

Run the SQL script to create the admin_users table:

```bash
mysql -u your_username -p your_database < admin_users_schema.sql
```

Or execute the SQL directly in your MySQL client:

```sql
CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `username` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_login` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_username` (`username`),
  UNIQUE KEY `uniq_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Step 3: Configure Environment Variables

Add the following to your `.env` file:

```env
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d

# Optional: Keep API key for backward compatibility
ADMIN_API_KEY=admin-secret-key-change-in-production
```

**Important:** 
- Use strong, randomly generated secrets in production
- Never commit `.env` file to version control
- Use different secrets for JWT_SECRET and JWT_REFRESH_SECRET

## Step 4: Create Your First Admin User

Use the provided script to create an admin user:

```bash
ts-node src/scripts/create-admin.ts <username> <email> <password> [full_name]
```

**Example:**
```bash
ts-node src/scripts/create-admin.ts admin admin@example.com MySecurePassword123 "Admin User"
```

Or use the register endpoint:

```bash
curl -X POST http://localhost:4005/api/admin/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "email": "admin@example.com",
    "password": "MySecurePassword123",
    "full_name": "Admin User"
  }'
```

## Step 5: Test Authentication

### Login Test

```bash
curl -X POST http://localhost:4005/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "MySecurePassword123"
  }'
```

**Expected Response:**
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

### Test Protected Endpoint

```bash
# Save the accessToken from login response
ACCESS_TOKEN="your-access-token-here"

curl -X GET http://localhost:4005/api/admin/auth/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Step 6: Frontend Integration

See `FRONTEND_API_DOCUMENTATION.md` for complete frontend integration examples.

### Quick Start (React)

1. Install axios or use fetch API
2. Store tokens in localStorage
3. Add Authorization header to all requests
4. Implement token refresh on 401 errors

See the documentation for complete examples.

## API Endpoints Summary

### Authentication (Public)
- `POST /api/admin/auth/login` - Login
- `POST /api/admin/auth/register` - Register new admin
- `POST /api/admin/auth/refresh` - Refresh access token

### Authentication (Protected)
- `GET /api/admin/auth/me` - Get current admin info
- `POST /api/admin/auth/logout` - Logout

### Admin Management (Protected)
- All endpoints in `/api/admin/*` require JWT authentication

## Security Notes

1. **Token Storage**: 
   - localStorage: Simple but vulnerable to XSS
   - httpOnly Cookies: More secure (requires backend cookie setup)
   - sessionStorage: Cleared on tab close

2. **Token Expiry**:
   - Access tokens: Short-lived (15 minutes default)
   - Refresh tokens: Long-lived (7 days default)

3. **Best Practices**:
   - Always use HTTPS in production
   - Implement token refresh before expiry
   - Clear tokens on logout
   - Validate tokens on every request
   - Monitor for suspicious activity

## Troubleshooting

### "Invalid or expired token" Error
- Check if token is expired (access tokens expire in 15 minutes)
- Use refresh token to get new access token
- Re-login if refresh token is expired

### "Admin account is deactivated" Error
- Admin account has `is_active = 0` in database
- Update `is_active` to `1` in database

### "Invalid username or password" Error
- Verify username/email and password are correct
- Check if admin account exists in database
- Verify password hash is correct (use create-admin script)

## Next Steps

1. Integrate with your frontend dashboard
2. Implement proper error handling
3. Add token refresh logic
4. Set up proper logging
5. Configure CORS for your frontend domain
6. Set up rate limiting for login endpoint

## Support

For issues or questions, please contact the development team.


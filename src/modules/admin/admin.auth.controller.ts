import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../config/db";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, JWTPayload } from "../../utils/jwt";

// Validation schemas
const loginSchema = z.object({
  username: z.string().min(3).max(255),
  password: z.string().min(6),
});

const registerSchema = z.object({
  username: z.string().min(3).max(255),
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// POST /api/admin/auth/login - Admin login
export async function adminLogin(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten(),
      });
    }

    const { username, password } = parsed.data;

    // Find admin user
    const [rows]: any = await db.query(
      `SELECT id, username, email, password_hash, full_name, is_active 
       FROM admin_users 
       WHERE username = ? OR email = ? LIMIT 1`,
      [username, username]
    );

    const admin = rows?.[0];
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // Check if admin is active
    if (!admin.is_active) {
      return res.status(403).json({
        success: false,
        message: "Admin account is deactivated",
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // Update last login
    await db.query(`UPDATE admin_users SET last_login = NOW() WHERE id = ?`, [admin.id]);

    // Generate tokens
    const payload: JWTPayload = {
      adminId: admin.id,
      username: admin.username,
      email: admin.email,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    return res.json({
      success: true,
      message: "Login successful",
      data: {
        admin: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          full_name: admin.full_name,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (err: any) {
    console.error("adminLogin error:", err);
    return res.status(500).json({
      success: false,
      message: "Login failed",
      error: err.message,
    });
  }
}

// POST /api/admin/auth/register - Register new admin (optional, can be restricted)
export async function adminRegister(req: Request, res: Response) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten(),
      });
    }

    const { username, email, password, full_name } = parsed.data;

    // Check if username or email already exists
    const [existing]: any = await db.query(
      `SELECT id FROM admin_users WHERE username = ? OR email = ? LIMIT 1`,
      [username, email]
    );

    if (existing?.[0]) {
      return res.status(409).json({
        success: false,
        message: "Username or email already exists",
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin user
    const [result]: any = await db.query(
      `INSERT INTO admin_users (username, email, password_hash, full_name) 
       VALUES (?, ?, ?, ?)`,
      [username, email, passwordHash, full_name || null]
    );

    const [created]: any = await db.query(
      `SELECT id, username, email, full_name, created_at 
       FROM admin_users WHERE id = ? LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: "Admin user created successfully",
      data: {
        admin: created[0],
      },
    });
  } catch (err: any) {
    console.error("adminRegister error:", err);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
      error: err.message,
    });
  }
}

// POST /api/admin/auth/refresh - Refresh access token
export async function refreshToken(req: Request, res: Response) {
  try {
    const parsed = refreshTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten(),
      });
    }

    const { refreshToken } = parsed.data;

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);

    // Check if admin still exists and is active
    const [rows]: any = await db.query(
      `SELECT id, username, email, is_active FROM admin_users WHERE id = ? LIMIT 1`,
      [payload.adminId]
    );

    const admin = rows?.[0];
    if (!admin || !admin.is_active) {
      return res.status(401).json({
        success: false,
        message: "Admin account not found or deactivated",
      });
    }

    // Generate new access token
    const newPayload: JWTPayload = {
      adminId: admin.id,
      username: admin.username,
      email: admin.email,
    };

    const newAccessToken = generateAccessToken(newPayload);

    return res.json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      message: err.message || "Invalid refresh token",
    });
  }
}

// GET /api/admin/auth/me - Get current admin info
export async function getCurrentAdmin(req: Request, res: Response) {
  try {
    // Admin info is attached by middleware
    const adminId = (req as any).adminId;

    const [rows]: any = await db.query(
      `SELECT id, username, email, full_name, is_active, last_login, created_at 
       FROM admin_users WHERE id = ? LIMIT 1`,
      [adminId]
    );

    if (!rows?.[0]) {
      return res.status(404).json({
        success: false,
        message: "Admin user not found",
      });
    }

    return res.json({
      success: true,
      data: {
        admin: rows[0],
      },
    });
  } catch (err: any) {
    console.error("getCurrentAdmin error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to get admin info",
      error: err.message,
    });
  }
}

// POST /api/admin/auth/logout - Logout (client-side token removal, but we can log it)
export async function adminLogout(req: Request, res: Response) {
  // In JWT, logout is typically handled client-side by removing tokens
  // But we can log the action for audit purposes
  try {
    const adminId = (req as any).adminId;

    // Log logout action (optional)
    await db.query(
      `INSERT INTO audit_log (user_id, action, reason) VALUES (?, ?, ?)`,
      [adminId, "ADMIN_LOGOUT", "Admin logged out"]
    );

    return res.json({
      success: true,
      message: "Logout successful",
    });
  } catch (err: any) {
    console.error("adminLogout error:", err);
    return res.status(500).json({
      success: false,
      message: "Logout failed",
      error: err.message,
    });
  }
}


import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../../utils/jwt";

// JWT-based authentication middleware
export function adminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers["authorization"];
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token required. Provide it via 'Authorization: Bearer <token>' header.",
      });
    }

    const token = authHeader.replace("Bearer ", "");

    try {
      const payload = verifyAccessToken(token);
      
      // Attach admin info to request
      (req as any).adminId = payload.adminId;
      (req as any).adminUsername = payload.username;
      (req as any).adminEmail = payload.email;

      next();
    } catch (err: any) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
        error: err.message,
      });
    }
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      message: "Authentication failed",
      error: err.message,
    });
  }
}

// Optional: Keep API key auth for backward compatibility or specific use cases
export function adminApiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const { env } = require("../../config/env");
  const apiKey = req.headers["x-admin-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: "Admin API key is required. Provide it via 'x-admin-api-key' header or 'Authorization: Bearer <key>' header.",
    });
  }

  if (apiKey !== env.admin.apiKey) {
    return res.status(403).json({
      success: false,
      message: "Invalid admin API key.",
    });
  }

  next();
}


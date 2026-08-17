import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface JWTPayload {
  adminId: number;
  username: string;
  email: string;
}

export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.accessTokenExpiry || "15m",
  });
}

export function generateRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTokenExpiry || "7d",
  });
}

export function verifyAccessToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, env.jwt.secret) as JWTPayload;
  } catch (err) {
    throw new Error("Invalid or expired access token");
  }
}

export function verifyRefreshToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, env.jwt.refreshSecret) as JWTPayload;
  } catch (err) {
    throw new Error("Invalid or expired refresh token");
  }
}


import { Router } from "express";
import {
  adminLogin,
  adminRegister,
  refreshToken,
  getCurrentAdmin,
  adminLogout,
} from "./admin.auth.controller";
import { adminAuth } from "./admin.middleware";
import { asyncHandler } from "../../utils/asyncHandler";

const r = Router();

// Public routes (no authentication required)
r.post("/login", asyncHandler(adminLogin));
r.post("/register", asyncHandler(adminRegister));
r.post("/refresh", asyncHandler(refreshToken));

// Protected routes (require authentication)
r.get("/me", adminAuth, asyncHandler(getCurrentAdmin));
r.post("/logout", adminAuth, asyncHandler(adminLogout));

export default r;


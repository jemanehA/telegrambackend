import { Router } from "express";
import { registerOrGetUser } from "./auth.controller";
import { asyncHandler } from "../../utils/asyncHandler";

const r = Router();
r.post("/register", asyncHandler(registerOrGetUser));

export default r;

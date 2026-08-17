import { Router } from "express";
import { getUser, listUsers, getUserStats } from "./users.controller";
import { asyncHandler } from "../../utils/asyncHandler";

const r = Router();

r.get("/stats", asyncHandler(getUserStats));
r.get("/:userId", asyncHandler(getUser));
r.get("/", asyncHandler(listUsers));

export default r;


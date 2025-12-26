import { Router } from "express";
import { createCheckoutSession, getInviteLink } from "./billing.controller";
import { asyncHandler } from "../../utils/asyncHandler";

const r = Router();
r.post("/checkout", asyncHandler(createCheckoutSession));
r.post("/invite-link", asyncHandler(getInviteLink));
export default r;
import { Router } from "express";
import {
  getSubscription,
  getUserSubscriptions,
  listSubscriptions,
  cancelSubscription,
  getSubscriptionStats,
} from "./subscriptions.controller";
import { asyncHandler } from "../../utils/asyncHandler";

const r = Router();

r.get("/stats", asyncHandler(getSubscriptionStats));
r.get("/user/:userId", asyncHandler(getUserSubscriptions));
r.post("/:subscriptionId/cancel", asyncHandler(cancelSubscription));
r.get("/:subscriptionId", asyncHandler(getSubscription));
r.get("/", asyncHandler(listSubscriptions));

export default r;


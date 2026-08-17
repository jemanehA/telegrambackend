import { Router } from "express";
import {
  activateUser,
  deactivateUser,
  suspendUser,
  unsuspendUser,
  getUserDetails,
  markSubscriptionUnpaid,
  markSubscriptionPaid,
  extendSubscription,
  getAuditLog,
} from "./admin.controller";
import { adminAuth } from "./admin.middleware";
import { asyncHandler } from "../../utils/asyncHandler";

const r = Router();

// All admin routes require authentication
r.use(adminAuth);

// User management
r.post("/users/:userId/activate", asyncHandler(activateUser));
r.post("/users/:userId/deactivate", asyncHandler(deactivateUser));
r.post("/users/:userId/suspend", asyncHandler(suspendUser));
r.post("/users/:userId/unsuspend", asyncHandler(unsuspendUser));
r.get("/users/:userId/details", asyncHandler(getUserDetails));

// Subscription management
r.post("/subscriptions/:subscriptionId/mark-unpaid", asyncHandler(markSubscriptionUnpaid));
r.post("/subscriptions/:subscriptionId/mark-paid", asyncHandler(markSubscriptionPaid));
r.post("/subscriptions/:subscriptionId/extend", asyncHandler(extendSubscription));

// Audit log
r.get("/audit-log", asyncHandler(getAuditLog));

export default r;


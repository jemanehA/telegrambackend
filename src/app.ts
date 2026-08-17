import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./modules/auth/auth.routes";
import billingRoutes from "./modules/billing/billing.routes";
import usersRoutes from "./modules/users/users.routes";
import subscriptionsRoutes from "./modules/subscriptions/subscriptions.routes";
import paymentsRoutes from "./modules/payments/payments.routes";
import adminRoutes from "./modules/admin/admin.routes";
import adminAuthRoutes from "./modules/admin/admin.auth.routes";
import cryptoPayRoutes from "./modules/crypto/crypto-pay.routes";
import { errorHandler } from "./utils/error";
import { stripeWebhook } from "./modules/billing/billing.controller";
import { asyncHandler } from "./utils/asyncHandler";
import telegramLinkRoutes from "./modules/auth/telegramLink.routes";
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(helmet());
  app.use(morgan("dev"));

  // Stripe webhook must read raw body (before express.json())
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), asyncHandler(stripeWebhook));

  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/auth", telegramLinkRoutes);
  app.use("/api/billing", billingRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/subscriptions", subscriptionsRoutes);
  app.use("/api/payments", paymentsRoutes);
  app.use("/api/crypto-pay", cryptoPayRoutes);
  app.use("/api/admin/auth", adminAuthRoutes);
  app.use("/api/admin", adminRoutes);

  // Error handler must be last
  app.use(errorHandler);

  return app;
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./modules/auth/auth.routes";
import billingRoutes from "./modules/billing/billing.routes";
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

  // Error handler must be last
  app.use(errorHandler);

  return app;
}

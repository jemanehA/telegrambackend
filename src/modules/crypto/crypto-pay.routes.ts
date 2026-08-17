import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { cryptoPayWebhook } from "./crypto-pay.controller";

const r = Router();

// Webhook URL should be configured in @CryptoBot as:
// https://<YOUR_DOMAIN>/api/crypto-pay/webhook/<CRYPTO_PAY_WEBHOOK_SECRET>
r.post("/webhook/:secret", asyncHandler(cryptoPayWebhook));

export default r;



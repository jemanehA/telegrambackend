import { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";
import { db } from "../../config/db";
import { getInvoice } from "./crypto-pay.service";
import { processPaidCryptoInvoice } from "./crypto-pay.processor";

/**
 * Crypto Pay webhook.
 * We secure this primarily by:
 * 1) Secret path param (recommended by Crypto Pay docs)
 * 2) Server-side verification by calling Crypto Pay API (getInvoice) before activating anything
 */
export async function cryptoPayWebhook(req: Request, res: Response) {
  const secret = req.params.secret;
  const configuredSecret = env.cryptoPay.webhookSecret;

  if (configuredSecret && secret !== configuredSecret) {
    logger.warn(`🚫 CryptoPay webhook rejected (bad secret). got=${secret ? "set" : "missing"}`);
    return res.status(401).json({ ok: false });
  }

  const body: any = req.body || {};
  const updateType = body.update_type || body.updateType;
  const payload = body.payload || {};
  const invoiceIdRaw = payload.invoice_id ?? payload.invoiceId;
  const invoiceId = Number(invoiceIdRaw);

  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("📥 CryptoPay WEBHOOK received", {
    update_id: body.update_id,
    update_type: updateType,
    invoice_id: invoiceIdRaw,
  });

  // Always ack quickly; but we still do our processing before responding
  if (!updateType) {
    logger.warn("⚠️ CryptoPay webhook missing update_type");
    return res.json({ ok: true });
  }

  // We only care about invoice paid (others are ignored)
  if (updateType !== "invoice_paid") {
    logger.info(`ℹ️ CryptoPay webhook ignored update_type=${updateType}`);
    return res.json({ ok: true });
  }

  if (!invoiceId || Number.isNaN(invoiceId)) {
    logger.warn("⚠️ CryptoPay webhook missing/invalid invoice_id", { invoice_id: invoiceIdRaw });
    return res.json({ ok: true });
  }

  // Ensure we have a DB row for this invoice
  const [rows]: any = await db.query(
    `SELECT id, status FROM crypto_payments WHERE invoice_id = ? LIMIT 1`,
    [invoiceId]
  );
  if (!rows?.[0]) {
    logger.warn(`⚠️ CryptoPay webhook: invoice not found in DB. invoice_id=${invoiceId}`);
    return res.json({ ok: true });
  }

  // Verify with Crypto Pay API (prevents fake webhooks)
  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    logger.warn(`⚠️ CryptoPay webhook: invoice not found in API. invoice_id=${invoiceId}`);
    return res.json({ ok: true });
  }

  logger.info("🔍 CryptoPay invoice verified", {
    invoiceId: invoice.invoiceId,
    status: invoice.status,
    asset: invoice.asset,
    amount: invoice.amount,
  });

  if (invoice.status !== "paid") {
    logger.info(`⏳ CryptoPay webhook: invoice not paid yet. invoice_id=${invoiceId} status=${invoice.status}`);
    return res.json({ ok: true });
  }

  // Process paid invoice (idempotent)
  const result = await processPaidCryptoInvoice({ invoiceId, invoice });
  logger.info("✅ CryptoPay webhook processed", { invoiceId, result });

  return res.json({ ok: true });
}



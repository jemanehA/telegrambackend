import { db } from "../../config/db";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { bot, createSingleUseInviteLink } from "../telegram/telegram.service";
import { Markup } from "telegraf";

/**
 * Marks a crypto invoice as paid in DB, activates a subscription, and notifies the user with an invite link.
 * This is shared by BOTH:
 * - Webhook handler (automatic)
 * - Telegram "Check Payment Status" button (manual fallback)
 */
export async function processPaidCryptoInvoice(params: {
  invoiceId: number;
  invoice: any; // Crypto Pay SDK invoice model (camelCase)
}) {
  const { invoiceId, invoice } = params;

  // Find payment record
  const [paymentRows]: any = await db.query(
    `SELECT * FROM crypto_payments WHERE invoice_id = ? LIMIT 1`,
    [invoiceId]
  );
  const payment = paymentRows?.[0];
  if (!payment) {
    logger.warn(`⚠️ CryptoPay: invoice paid but no matching crypto_payments row. invoice_id=${invoiceId}`);
    return { ok: false, reason: "payment_row_not_found" as const };
  }

  // Idempotency: if already paid, do nothing
  if (payment.status === "PAID") {
    logger.info(`ℹ️ CryptoPay: invoice already processed. invoice_id=${invoiceId} user_id=${payment.user_id}`);
    return { ok: true, alreadyProcessed: true as const };
  }

  // Mark payment as PAID
  await db.query(
    `UPDATE crypto_payments
     SET status='PAID', paid_at=NOW()
     WHERE invoice_id=?`,
    [invoiceId]
  );

  // Activate subscription (monthly/yearly based on stored plan)
  const isMonthly = String(payment.plan || "").includes("MONTHLY");
  const periodEnd = new Date();
  if (isMonthly) {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }

  await db.query(
    `INSERT INTO subscriptions (user_id, plan, status, current_period_end, cancel_at_period_end)
     VALUES (?, ?, 'ACTIVE', ?, 0)`,
    [payment.user_id, payment.plan, periodEnd]
  );

  // Generate invite link & upsert telegram_access
  let inviteLink: string | null = null;
  try {
    inviteLink = await createSingleUseInviteLink();
    const [existing]: any = await db.query(
      `SELECT id FROM telegram_access WHERE user_id=? AND chat_id=? LIMIT 1`,
      [payment.user_id, env.telegram.groupChatId]
    );
    if (existing?.[0]) {
      await db.query(
        `UPDATE telegram_access
         SET invite_link=?, last_verified_at=NOW(), removed_at=NULL
         WHERE user_id=? AND chat_id=?`,
        [inviteLink, payment.user_id, env.telegram.groupChatId]
      );
    } else {
      await db.query(
        `INSERT INTO telegram_access (user_id, chat_id, invite_link, joined_at, last_verified_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [payment.user_id, env.telegram.groupChatId, inviteLink]
      );
    }
  } catch (err: any) {
    logger.error(`❌ CryptoPay: failed to generate/store invite link. invoice_id=${invoiceId}`, err?.message);
  }

  // Notify user
  if (payment.telegram_user_id) {
    try {
      const planName = String(payment.plan || "").replace(/_/g, " ");
      const amountStr = `${payment.amount} ${payment.asset || "USDT"}`;
      const msg =
        `🎉 *Crypto Payment Successful!*\\n\\n` +
        `━━━━━━━━━━━━━━━━━━━━\\n\\n` +
        `✅ Your subscription is now active!\\n` +
        `💰 *Amount Paid:* ${amountStr}\\n` +
        `📦 *Plan:* ${planName}\\n\\n` +
        `━━━━━━━━━━━━━━━━━━━━\\n\\n` +
        (inviteLink ? `🚪 Click below to join the premium group!` : `Use *Check Status* to get your invite link.`);

      const keyboard = inviteLink
        ? Markup.inlineKeyboard([
            [Markup.button.url("🚪 Join Premium Group", inviteLink)],
            [Markup.button.callback("📊 Check Status", "check_status")],
          ])
        : Markup.inlineKeyboard([[Markup.button.callback("📊 Check Status", "check_status")]]);

      await bot.telegram.sendMessage(payment.telegram_user_id, msg, {
        parse_mode: "Markdown",
        ...keyboard,
      });
    } catch (notifyErr: any) {
      logger.error(`❌ CryptoPay: failed to notify user. invoice_id=${invoiceId}`, notifyErr?.message);
    }
  }

  logger.info(
    `✅ CryptoPay: processed paid invoice. invoice_id=${invoiceId} user_id=${payment.user_id} plan=${payment.plan}`
  );
  return { ok: true, alreadyProcessed: false as const };
}



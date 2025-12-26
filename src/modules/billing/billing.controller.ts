import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { stripe } from "./stripe.service";
import { db } from "../../config/db";
import Stripe from "stripe";
import { hasActiveSubscription } from "../subscriptions/subscriptions.repo";
import { createSingleUseInviteLink } from "../telegram/telegram.service";

const checkoutSchema = z.object({
  userId: z.number(),
  plan: z.enum(["MONTHLY", "YEARLY"]),
  earlyAccess: z.boolean().optional().default(false),
});

function pickPriceId(plan: "MONTHLY" | "YEARLY", earlyAccess: boolean) {
  if (plan === "YEARLY") return env.stripe.priceYearly280;
  return earlyAccess ? env.stripe.priceMonthly20 : env.stripe.priceMonthly20;
}

export async function createCheckoutSession(req: Request, res: Response) {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.flatten() });

  const { userId, plan, earlyAccess } = parsed.data;

  const priceId = pickPriceId(plan, earlyAccess);

  // Validate price ID format (should start with 'price_')
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`Invalid price ID: ${priceId}. Price IDs must start with 'price_'`);
    return res.status(500).json({ 
      success: false, 
      message: "Configuration error: Invalid price ID. Please contact support." 
    });
  }

  // Create stripe customer (or reuse later in phase 2)
  const customer = await stripe.customers.create({
    metadata: { userId: String(userId) },
  });

  // Create checkout session for subscription
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.baseUrl}/cancel`,
    metadata: { userId: String(userId), plan, earlyAccess: String(earlyAccess) },
  });

  // Store PENDING subscription record
  await db.query(
    `INSERT INTO subscriptions (user_id, plan, status, stripe_customer_id)
     VALUES (?, ?, 'PENDING', ?)`,
    [
      userId,
      earlyAccess && plan === "MONTHLY" ? "MONTHLY_20" : (plan === "MONTHLY" ? "MONTHLY_30" : "YEARLY_280"),
      customer.id
    ]
  );

  return res.json({ success: true, checkoutUrl: session.url });
}

export async function stripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.stripe.webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send("Webhook signature verification failed");
  }

  console.log(`Received webhook event: ${event.type}`);

  try {
    // Handle checkout session completed (initial payment)
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      // Only process subscription checkouts
      if (session.mode !== "subscription") {
        return res.json({ received: true });
      }

      const userId = Number(session.metadata?.userId);
      const telegramUserId = session.metadata?.telegramUserId
        ? Number(session.metadata.telegramUserId)
        : null;

      if (!userId) {
        console.error("Missing userId in checkout session metadata");
        return res.json({ received: true });
      }

      // Get subscription id from session
      const stripeSubId = String(session.subscription);
      const stripeCustomerId = String(session.customer);

      // Fetch subscription to get current_period_end
      const sub = await stripe.subscriptions.retrieve(stripeSubId);
      const periodEnd = new Date(sub.current_period_end * 1000);

      // Update subscription to ACTIVE
      await db.query(
        `UPDATE subscriptions
         SET status='ACTIVE',
             stripe_subscription_id=?,
             stripe_customer_id=?,
             current_period_end=?,
             cancel_at_period_end=0
         WHERE user_id=? AND status='PENDING' ORDER BY id DESC LIMIT 1`,
        [stripeSubId, stripeCustomerId, periodEnd, userId]
      );

      // Notify user via Telegram bot and send invite link if telegramUserId is available
      if (telegramUserId) {
        try {
          const { bot } = await import("../telegram/telegram.service");
          const { createSingleUseInviteLink } = await import("../telegram/telegram.service");
          const periodEndStr = periodEnd.toLocaleDateString();

          // Generate invite link automatically
          let inviteLink: string | null = null;
          try {
            inviteLink = await createSingleUseInviteLink();
            
            // Store invite link in telegram_access (upsert)
            const [existing]: any = await db.query(
              `SELECT id FROM telegram_access WHERE user_id=? AND chat_id=? LIMIT 1`,
              [userId, env.telegram.groupChatId]
            );
            
            if (existing?.[0]) {
              await db.query(
                `UPDATE telegram_access
                 SET invite_link=?, last_verified_at=NOW(), removed_at=NULL
                 WHERE user_id=? AND chat_id=?`,
                [inviteLink, userId, env.telegram.groupChatId]
              );
            } else {
              await db.query(
                `INSERT INTO telegram_access (user_id, chat_id, invite_link, joined_at, last_verified_at)
                 VALUES (?, ?, ?, NOW(), NOW())`,
                [userId, env.telegram.groupChatId, inviteLink]
              );
            }
          } catch (inviteErr: any) {
            console.error("Failed to generate invite link:", inviteErr);
            // Continue without invite link, user can request it later
          }

          // Send success message with invite link
          const message = inviteLink
            ? `✅ Payment Successful!\n\n` +
              `Your subscription is now active.\n` +
              `Renews on: ${periodEndStr}\n\n` +
              `🚪 Join the group now:\n` +
              `${inviteLink}\n\n` +
              `⚠️ This link can only be used once.`
            : `✅ Payment Successful!\n\n` +
              `Your subscription is now active.\n` +
              `Renews on: ${periodEndStr}\n\n` +
              `Use the "Join Group" button to get your invite link.`;

          await bot.telegram.sendMessage(
            telegramUserId,
            message,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "📅 Subscribe Monthly", callback_data: "subscribe_monthly" },
                    { text: "📅 Subscribe Yearly", callback_data: "subscribe_yearly" },
                  ],
                  [{ text: "✅ Check Status", callback_data: "check_status" }],
                  [{ text: "🚪 Join Group", callback_data: "join_group" }],
                ],
              },
            }
          );
        } catch (err: any) {
          console.error("Failed to notify user via Telegram:", err);
        }
      }
    }

    // Handle invoice payment succeeded (renewals and initial payments)
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      
      if (invoice.subscription) {
        const stripeSubId = String(invoice.subscription);
        const stripeCustomerId = String(invoice.customer);

        // Find subscription in our DB
        const [rows]: any = await db.query(
          `SELECT user_id, status FROM subscriptions 
           WHERE stripe_subscription_id = ? LIMIT 1`,
          [stripeSubId]
        );

        if (rows?.[0]) {
          const userId = rows[0].user_id;
          
          // Get subscription from Stripe to get period end
          const sub = await stripe.subscriptions.retrieve(stripeSubId);
          const periodEnd = new Date(sub.current_period_end * 1000);

          // Update subscription period
          await db.query(
            `UPDATE subscriptions
             SET current_period_end=?,
                 status='ACTIVE',
                 cancel_at_period_end=0
             WHERE stripe_subscription_id=?`,
            [periodEnd, stripeSubId]
          );

          // Notify user about renewal
          const [userRows]: any = await db.query(
            `SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1`,
            [userId]
          );

          if (userRows?.[0]?.telegram_user_id) {
            try {
              const { bot } = await import("../telegram/telegram.service");
              await bot.telegram.sendMessage(
                userRows[0].telegram_user_id,
                `✅ Subscription Renewed!\n\n` +
                  `Your subscription has been renewed.\n` +
                  `Next renewal: ${periodEnd.toLocaleDateString()}`
              );
            } catch (err) {
              console.error("Failed to notify user about renewal:", err);
            }
          }
        }
      }
    }

    // Handle invoice payment failed
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      
      if (invoice.subscription) {
        const stripeSubId = String(invoice.subscription);

        // Find subscription and user
        const [rows]: any = await db.query(
          `SELECT s.user_id, u.telegram_user_id 
           FROM subscriptions s
           INNER JOIN users u ON s.user_id = u.id
           WHERE s.stripe_subscription_id = ? LIMIT 1`,
          [stripeSubId]
        );

        if (rows?.[0]) {
          const { user_id, telegram_user_id } = rows[0];

          // Notify user about payment failure
          if (telegram_user_id) {
            try {
              const { bot } = await import("../telegram/telegram.service");
              await bot.telegram.sendMessage(
                telegram_user_id,
                `⚠️ Payment Failed\n\n` +
                  `We couldn't process your payment. Please update your payment method.\n\n` +
                  `Your subscription may be cancelled if payment is not received.`
              );
            } catch (err) {
              console.error("Failed to notify user about payment failure:", err);
            }
          }
        }
      }
    }

    // Handle subscription updates (cancellations, renewals)
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const stripeCustomerId = String(subscription.customer);

      // Find user by stripe_customer_id
      const [rows]: any = await db.query(
        `SELECT user_id FROM subscriptions WHERE stripe_customer_id = ? ORDER BY id DESC LIMIT 1`,
        [stripeCustomerId]
      );

      if (rows?.[0]) {
        const userId = rows[0].user_id;
        const periodEnd = new Date(subscription.current_period_end * 1000);
        const cancelAtPeriodEnd = subscription.cancel_at_period_end;

        await db.query(
          `UPDATE subscriptions
           SET current_period_end=?,
               cancel_at_period_end=?,
               status=?
           WHERE user_id=? AND stripe_subscription_id=?`,
          [
            periodEnd,
            cancelAtPeriodEnd ? 1 : 0,
            subscription.status === "active" ? "ACTIVE" : "CANCELED",
            userId,
            subscription.id,
          ]
        );
      }
    }

    // Handle subscription deletions
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const stripeCustomerId = String(subscription.customer);

      const [rows]: any = await db.query(
        `SELECT user_id FROM subscriptions WHERE stripe_customer_id = ? ORDER BY id DESC LIMIT 1`,
        [stripeCustomerId]
      );

      if (rows?.[0]) {
        const userId = rows[0].user_id;
        await db.query(
          `UPDATE subscriptions
           SET status='CANCELED'
           WHERE user_id=? AND stripe_subscription_id=?`,
          [userId, subscription.id]
        );

        // Notify user
        const [userRows]: any = await db.query(
          `SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1`,
          [userId]
        );

        if (userRows?.[0]?.telegram_user_id) {
          try {
            const { bot } = await import("../telegram/telegram.service");
            await bot.telegram.sendMessage(
              userRows[0].telegram_user_id,
              `❌ Subscription Cancelled\n\n` +
                `Your subscription has been cancelled. You will lose access at the end of your current period.`
            );
          } catch (err) {
            console.error("Failed to notify user about cancellation:", err);
          }
        }
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}
export async function getInviteLink(req: Request, res: Response) {
  const userId = Number(req.body?.userId);
  if (!userId) return res.status(400).json({ success: false, message: "userId required" });

  const ok = await hasActiveSubscription(userId);
  if (!ok) return res.status(403).json({ success: false, message: "No active subscription" });

  const invite = await createSingleUseInviteLink();
  return res.json({ success: true, invite });
}

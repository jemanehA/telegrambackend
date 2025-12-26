import { bot } from "./telegram.service";
import { db } from "../../config/db";
import { env } from "../../config/env";
import { stripe } from "../billing/stripe.service";
import { hasActiveSubscription } from "../subscriptions/subscriptions.repo";
import { createSingleUseInviteLink } from "./telegram.service";
import { Markup } from "telegraf";

// Helper to get or create user by telegram_user_id
async function getOrCreateUser(telegramUserId: number) {
  // Try to find existing user
  const [rows]: any = await db.query(
    `SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1`,
    [telegramUserId]
  );

  if (rows?.[0]) {
    return rows[0];
  }

  // Create new user
  const [result]: any = await db.query(
    `INSERT INTO users (telegram_user_id) VALUES (?)`,
    [telegramUserId]
  );

  const [created]: any = await db.query(
    `SELECT * FROM users WHERE id = ? LIMIT 1`,
    [result.insertId]
  );

  return created[0];
}

// Helper to get or create Stripe customer
async function getOrCreateStripeCustomer(userId: number, telegramUserId: number) {
  // Check if user already has a Stripe customer
  const [rows]: any = await db.query(
    `SELECT stripe_customer_id FROM subscriptions 
     WHERE user_id = ? AND stripe_customer_id IS NOT NULL 
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  if (rows?.[0]?.stripe_customer_id) {
    // Retrieve existing customer to verify it still exists
    try {
      const customer = await stripe.customers.retrieve(rows[0].stripe_customer_id);
      if (customer && !customer.deleted) {
        return customer.id;
      }
    } catch (err) {
      // Customer doesn't exist, create new one
    }
  }

  // Create new customer
  const customer = await stripe.customers.create({
    metadata: { userId: String(userId), telegramUserId: String(telegramUserId) },
  });

  return customer.id;
}

// Helper to create main menu keyboard
function getMainKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📅 Subscribe Monthly", "subscribe_monthly"),
      Markup.button.callback("📅 Subscribe Yearly", "subscribe_yearly"),
    ],
    [Markup.button.callback("✅ Check Status", "check_status")],
    [Markup.button.callback("🚪 Join Group", "join_group")],
  ]);
}

// Helper to get subscription status message
async function getStatusMessage(userId: number) {
  const [rows]: any = await db.query(
    `SELECT status, plan, current_period_end, cancel_at_period_end
     FROM subscriptions
     WHERE user_id = ?
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  const sub = rows?.[0];
  if (!sub || sub.status !== "ACTIVE") {
    return "❌ No active subscription.\n\nPlease subscribe to get access to the group.";
  }

  const periodEnd = new Date(sub.current_period_end);
  const isExpired = periodEnd.getTime() < Date.now();
  const willCancel = sub.cancel_at_period_end === 1;

  if (isExpired) {
    return "❌ Your subscription has expired.\n\nPlease renew to continue access.";
  }

  let message = `✅ Active Subscription\n\n`;
  message += `Plan: ${sub.plan}\n`;
  message += `Renews: ${periodEnd.toLocaleDateString()}\n`;
  if (willCancel) {
    message += `⚠️ Will cancel at period end\n`;
  }

  return message;
}

// /start command - creates/updates user and shows menu
bot.start(async (ctx) => {
  try {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      return ctx.reply("❌ Unable to detect your Telegram user ID.");
    }

    const user = await getOrCreateUser(telegramUserId);

    const startParam = ctx.message.text?.split(" ")[1];

    if (startParam === "payment_success") {
      const hasActive = await hasActiveSubscription(user.id);
      
      if (hasActive) {
        // Check if user already has an invite link
        const [accessRows]: any = await db.query(
          `SELECT invite_link FROM telegram_access 
           WHERE user_id=? AND chat_id=? AND removed_at IS NULL 
           ORDER BY id DESC LIMIT 1`,
          [user.id, env.telegram.groupChatId]
        );
        
        const inviteLink = accessRows?.[0]?.invite_link;
        
        if (inviteLink) {
          return ctx.reply(
            "✅ Payment successful! Your subscription is now active.\n\n" +
            `🚪 Your group invite link:\n${inviteLink}\n\n` +
            `⚠️ This link can only be used once.`,
            getMainKeyboard()
          );
        } else {
          return ctx.reply(
            "✅ Payment successful! Your subscription is now active.\n\n" +
            "Check your messages for the invite link, or use the 'Join Group' button to get a new one.",
            getMainKeyboard()
          );
        }
      } else {
        return ctx.reply(
          "⏳ Payment received! Your subscription is being processed.\n\n" +
          "You'll receive a notification with your invite link when it's activated.",
          getMainKeyboard()
        );
      }
    }

    if (startParam === "payment_cancel") {
      return ctx.reply(
        "❌ Payment was cancelled.\n\n" +
        "You can try subscribing again using the buttons below.",
        getMainKeyboard()
      );
    }

    // Normal start flow
    const welcomeMessage =
      `👋 Welcome!\n\n` +
      `Your account has been registered.\n` +
      `User ID: ${user.id}\n\n` +
      `Use the buttons below to manage your subscription:`;

    await ctx.reply(welcomeMessage, getMainKeyboard());
  } catch (err: any) {
    console.error("start command error:", err);
    await ctx.reply("❌ Failed to initialize. Please try again.");
  }
});

// Handle button callbacks
bot.action("subscribe_monthly", async (ctx) => {
  try {
    await ctx.answerCbQuery("Creating checkout session...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      return ctx.reply(
        "✅ You already have an active subscription.\n\nUse 'Check Status' to see details.",
        getMainKeyboard()
      );
    }

    // Determine if early access pricing applies
    const earlyAccessDeadline = env.earlyAccessDeadline
      ? new Date(env.earlyAccessDeadline)
      : null;
    const isEarlyAccess =
      earlyAccessDeadline && new Date() < earlyAccessDeadline;

    const priceId = isEarlyAccess
      ? env.stripe.priceMonthly20
      : env.stripe.priceMonthly30;

    // Validate price ID format (should start with 'price_')
    if (!priceId || !priceId.startsWith('price_')) {
      console.error(`Invalid price ID: ${priceId}. Price IDs must start with 'price_'`);
      return ctx.reply(
        "❌ Configuration error: Invalid price ID. Please contact support.",
        getMainKeyboard()
      );
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(user.id, telegramUserId);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://t.me/${ctx.botInfo.username}?start=payment_success`,
      cancel_url: `https://t.me/${ctx.botInfo.username}?start=payment_cancel`,
      metadata: {
        userId: String(user.id),
        telegramUserId: String(telegramUserId),
        plan: "MONTHLY",
        earlyAccess: String(isEarlyAccess),
      },
      payment_method_types: ["card"],
      allow_promotion_codes: true,
    });

    // Store PENDING subscription
    const plan = isEarlyAccess ? "MONTHLY_20" : "MONTHLY_30";
    await db.query(
      `INSERT INTO subscriptions (user_id, plan, status, stripe_customer_id)
       VALUES (?, ?, 'PENDING', ?)`,
      [user.id, plan, customerId]
    );

    await ctx.reply(
      `💳 Monthly Subscription\n\n` +
        `Price: ${isEarlyAccess ? '$20' : '$30'}/month\n\n` +
        `Click the link below to complete payment:\n\n` +
        `${session.url}\n\n` +
        `After payment, your subscription will be activated automatically.`,
      getMainKeyboard()
    );
  } catch (err: any) {
    console.error("subscribe_monthly error:", err);
    await ctx.reply("❌ Failed to create checkout session. Please try again.", getMainKeyboard());
  }
});

bot.action("subscribe_yearly", async (ctx) => {
  try {
    await ctx.answerCbQuery("Creating checkout session...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      return ctx.reply(
        "✅ You already have an active subscription.\n\nUse 'Check Status' to see details.",
        getMainKeyboard()
      );
    }

    // Validate price ID format
    if (!env.stripe.priceYearly280 || !env.stripe.priceYearly280.startsWith('price_')) {
      console.error(`Invalid price ID: ${env.stripe.priceYearly280}. Price IDs must start with 'price_'`);
      return ctx.reply(
        "❌ Configuration error: Invalid price ID. Please contact support.",
        getMainKeyboard()
      );
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(user.id, telegramUserId);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: env.stripe.priceYearly280, quantity: 1 }],
      success_url: `https://t.me/${ctx.botInfo.username}?start=payment_success`,
      cancel_url: `https://t.me/${ctx.botInfo.username}?start=payment_cancel`,
      metadata: {
        userId: String(user.id),
        telegramUserId: String(telegramUserId),
        plan: "YEARLY",
        earlyAccess: "false",
      },
      payment_method_types: ["card"],
      allow_promotion_codes: true,
    });

    // Store PENDING subscription
    await db.query(
      `INSERT INTO subscriptions (user_id, plan, status, stripe_customer_id)
       VALUES (?, ?, 'PENDING', ?)`,
      [user.id, "YEARLY_280", customerId]
    );

    await ctx.reply(
      `💳 Yearly Subscription\n\n` +
        `Price: $280/year\n\n` +
        `Click the link below to complete payment:\n\n` +
        `${session.url}\n\n` +
        `After payment, your subscription will be activated automatically.`,
      getMainKeyboard()
    );
  } catch (err: any) {
    console.error("subscribe_yearly error:", err);
    await ctx.reply("❌ Failed to create checkout session. Please try again.", getMainKeyboard());
  }
});

bot.action("check_status", async (ctx) => {
  try {
    await ctx.answerCbQuery("Checking status...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);
    const statusMessage = await getStatusMessage(user.id);

    await ctx.reply(statusMessage, getMainKeyboard());
  } catch (err: any) {
    console.error("check_status error:", err);
    await ctx.reply("❌ Failed to check status. Please try again.", getMainKeyboard());
  }
});

bot.action("join_group", async (ctx) => {
  try {
    await ctx.answerCbQuery("Checking subscription...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (!hasActive) {
      return ctx.reply(
        "❌ No active subscription.\n\nPlease subscribe first to get access to the group.",
        getMainKeyboard()
      );
    }

    // Generate invite link
    const inviteLink = await createSingleUseInviteLink();

    // Store invite link in telegram_access (upsert)
    const [existing]: any = await db.query(
      `SELECT id FROM telegram_access WHERE user_id=? AND chat_id=? LIMIT 1`,
      [user.id, env.telegram.groupChatId]
    );
    
    if (existing?.[0]) {
      await db.query(
        `UPDATE telegram_access
         SET invite_link=?, last_verified_at=NOW()
         WHERE user_id=? AND chat_id=?`,
        [inviteLink, user.id, env.telegram.groupChatId]
      );
    } else {
      await db.query(
        `INSERT INTO telegram_access (user_id, chat_id, invite_link, joined_at, last_verified_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [user.id, env.telegram.groupChatId, inviteLink]
      );
    }

    await ctx.reply(
      `🚪 Group Invite Link\n\n` +
        `Click the link below to join:\n\n` +
        `${inviteLink}\n\n` +
        `⚠️ This link can only be used once.`,
      getMainKeyboard()
    );
  } catch (err: any) {
    console.error("join_group error:", err);
    await ctx.reply(
      "❌ Failed to generate invite link. Make sure you have an active subscription.",
      getMainKeyboard()
    );
  }
});

// When a new member joins the group - verify and kick if needed
bot.on("new_chat_members", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId !== env.telegram.groupChatId) return;

  const members = ctx.message.new_chat_members;
  for (const m of members) {
    const telegramUserId = m.id;

    // Skip if it's the bot itself
    if (m.is_bot && m.id === ctx.botInfo.id) continue;

    try {
      // Find user by telegram_user_id
      const [urows]: any = await db.query(
        `SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1`,
        [telegramUserId]
      );

      // If not found → kick
      if (!urows?.[0]) {
        await ctx.kickChatMember(telegramUserId);
        continue;
      }

      const userId = urows[0].id;

      // Check active subscription
      const hasActive = await hasActiveSubscription(userId);
      if (!hasActive) {
        await ctx.kickChatMember(telegramUserId);
        continue;
      }

      // Update telegram_access record (upsert)
      const [existing]: any = await db.query(
        `SELECT id FROM telegram_access WHERE user_id=? AND chat_id=? LIMIT 1`,
        [userId, chatId]
      );
      
      if (existing?.[0]) {
        await db.query(
          `UPDATE telegram_access
           SET last_verified_at=NOW(), removed_at=NULL
           WHERE user_id=? AND chat_id=?`,
          [userId, chatId]
        );
      } else {
        await db.query(
          `INSERT INTO telegram_access (user_id, chat_id, joined_at, last_verified_at)
           VALUES (?, ?, NOW(), NOW())`,
          [userId, chatId]
        );
      }
    } catch (err: any) {
      console.error("new_chat_members error:", err);
      // On error, kick to be safe
      try {
        await ctx.kickChatMember(telegramUserId);
      } catch {}
    }
  }
});

// Start bot
bot.launch()
  .then(() => console.log("✅ Telegram bot running"))
  .catch((err) => console.error("❌ Bot launch failed:", err));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

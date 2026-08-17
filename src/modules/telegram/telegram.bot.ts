import { bot } from "./telegram.service";
import { db } from "../../config/db";
import { env } from "../../config/env";
import { stripe } from "../billing/stripe.service";
import { hasActiveSubscription } from "../subscriptions/subscriptions.repo";
import { createSingleUseInviteLink } from "./telegram.service";
import { createInvoice, getInvoice } from "../crypto/crypto-pay.service";
import { processPaidCryptoInvoice } from "../crypto/crypto-pay.processor";
import { Markup } from "telegraf";
import { logger } from "../../utils/logger";

// Cache bot username to avoid repeated API calls
let cachedBotUsername: string | null = null;

// Helper to get bot username
async function getBotUsername(ctx?: any): Promise<string> {
  try {
    // Try to get from context first
    if (ctx?.botInfo?.username) {
      cachedBotUsername = ctx.botInfo.username;
      return ctx.botInfo.username;
    }
    
    // Use cached value if available
    if (cachedBotUsername) {
      return cachedBotUsername;
    }
    
    // Fetch from Telegram API
    const botInfo = await bot.telegram.getMe();
    cachedBotUsername = botInfo.username;
    return botInfo.username;
  } catch (err) {
    logger.error("Failed to get bot username:", err);
    // Return cached value even if API call fails
    if (cachedBotUsername) {
      return cachedBotUsername;
    }
    throw new Error("Unable to retrieve bot username");
  }
}

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

// Track users waiting for promo code input
const waitingForPromoCode = new Map<number, boolean>();

// Helper to create main menu keyboard
function getMainKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("💎 Monthly Plan", "subscribe_monthly"),
      Markup.button.callback("⭐ Yearly Plan", "subscribe_yearly"),
    ],
    [Markup.button.callback("📊 Check Status", "check_status")],
    [Markup.button.callback("🎟️ Promo Code", "enter_promo_code")],
  ]);
}

// Helper to create payment method selection keyboard
function getPaymentMethodKeyboard(plan: "MONTHLY" | "YEARLY") {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("💳 Stripe", `payment_stripe_${plan.toLowerCase()}`),
      Markup.button.callback("₿ Crypto", `payment_crypto_${plan.toLowerCase()}`),
    ],
    [Markup.button.callback("🔙 Back to Plans", "back_to_plans")],
  ]);
}

// Helper to create package details keyboard
function getPackageDetailsKeyboard(plan: "MONTHLY" | "YEARLY") {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💳 Continue Payment", `continue_payment_${plan.toLowerCase()}`)],
    [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
  ]);
}

// Helper to safely edit or reply with message
async function safeEditOrReply(ctx: any, text: string, keyboard: any) {
  try {
    await ctx.editMessageText(text, keyboard);
  } catch (err: any) {
    // If edit fails (e.g., message too old), send a new message
    await ctx.reply(text, keyboard);
  }
}

// Helper to get subscription status message with invite link
async function getStatusMessage(userId: number) {
  logger.info(`🔍 getStatusMessage called for user_id: ${userId}`);
  
  // Get subscription details first
  const [rows]: any = await db.query(
    `SELECT status, plan, current_period_end, cancel_at_period_end, stripe_subscription_id
     FROM subscriptions
     WHERE user_id = ?
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  const sub = rows?.[0];
  
  // If subscription exists but current_period_end is null, try to fetch from Stripe
  if (sub && sub.status === "ACTIVE" && !sub.current_period_end && sub.stripe_subscription_id) {
    logger.info(`🔄 Subscription has ACTIVE status but null current_period_end. Fetching from Stripe...`);
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const periodEnd = new Date(stripeSub.current_period_end * 1000);
      
      // Get the subscription ID first
      const [subRows]: any = await db.query(
        `SELECT id FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1`,
        [userId]
      );
      const subId = subRows?.[0]?.id;
      
      if (subId) {
        // Update database with correct period_end
        await db.query(
          `UPDATE subscriptions SET current_period_end=? WHERE id=?`,
          [periodEnd, subId]
        );
        
        logger.info(`✅ Updated current_period_end from Stripe: ${periodEnd.toISOString()}`);
        sub.current_period_end = periodEnd;
      }
    } catch (stripeErr: any) {
      logger.error(`❌ Failed to fetch subscription from Stripe:`, stripeErr.message);
    }
  }
  
  // Use the exact same function as join_group to check subscription
  const isActive = await hasActiveSubscription(userId);
  
  logger.info(`✅ hasActiveSubscription result for user_id ${userId}: ${isActive}`, {
    status: sub?.status,
    current_period_end: sub?.current_period_end,
    hasStripeId: !!sub?.stripe_subscription_id
  });
  
  if (!isActive) {
    logger.warn(`⚠️ User ${userId} does not have active subscription.`, {
      found: !!sub,
      status: sub?.status,
      current_period_end: sub?.current_period_end,
      now: new Date().toISOString(),
      periodEndTime: sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null,
      nowTime: Date.now(),
      isFuture: sub?.current_period_end ? new Date(sub.current_period_end).getTime() > Date.now() : false
    });
    
    return {
      text: "❌ *No Active Subscription*\n\n" +
            "━━━━━━━━━━━━━━━━━━━━\n\n" +
            "Please subscribe to get access to the premium group.\n\n" +
            "Choose a plan from the menu below! 💎",
      options: { parse_mode: "Markdown" as const },
      keyboard: null
    };
  }

  const periodEnd = new Date(sub.current_period_end);
  const willCancel = sub.cancel_at_period_end === 1;
  const planName = sub.plan.replace(/_/g, " ");
  
  // Check if it's a "forever" subscription (year 2099)
  const isForever = periodEnd.getFullYear() >= 2099;
  const renewDate = isForever 
    ? "Forever" 
    : periodEnd.toLocaleDateString("en-US", { 
        year: "numeric", 
        month: "long", 
        day: "numeric" 
      });

  // Try to get existing invite link
  const [accessRows]: any = await db.query(
    `SELECT invite_link FROM telegram_access 
     WHERE user_id=? AND chat_id=? AND removed_at IS NULL 
     ORDER BY id DESC LIMIT 1`,
    [userId, env.telegram.groupChatId]
  );

  let inviteLink = accessRows?.[0]?.invite_link;

  // If no invite link exists, generate one
  if (!inviteLink) {
    try {
      logger.info(`🔗 Generating new invite link for user ${userId} (check status)`);
      inviteLink = await createSingleUseInviteLink();
      
      // Store invite link
      const [existing]: any = await db.query(
        `SELECT id FROM telegram_access WHERE user_id=? AND chat_id=? LIMIT 1`,
        [userId, env.telegram.groupChatId]
      );
      
      if (existing?.[0]) {
        await db.query(
          `UPDATE telegram_access
           SET invite_link=?, last_verified_at=NOW()
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
      logger.info(`✅ Invite link generated and stored: ${inviteLink}`);
    } catch (inviteErr: any) {
      logger.error(`❌ Failed to generate invite link for user ${userId}:`, inviteErr.message);
      // If we can't generate link, show error message
      // Get plan name for error message
      const errorPlanName = sub?.plan?.replace(/_/g, " ") || "Unknown";
      const errorPeriodEnd = sub?.current_period_end ? new Date(sub.current_period_end) : null;
      const errorIsForever = errorPeriodEnd && errorPeriodEnd.getFullYear() >= 2099;
      const errorRenewDate = errorIsForever 
        ? "Forever" 
        : (errorPeriodEnd ? errorPeriodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Unknown");
      
      return {
        text: "✅ *Active Subscription*\n\n" +
              "━━━━━━━━━━━━━━━━━━━━\n\n" +
              `📦 *Plan:* ${errorPlanName}\n` +
              (errorIsForever ? `⏰ *Status:* Active Forever 🎉\n` : `🔄 *Renews:* ${errorRenewDate}\n`) +
              (willCancel && !errorIsForever ? `\n⚠️ *Note:* Will cancel at period end\n` : "") +
              `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
              "❌ *Error:* Could not generate invite link.\n\n" +
              "Please try again later or contact support.\n\n" +
              "━━━━━━━━━━━━━━━━━━━━",
        options: { parse_mode: "Markdown" as const },
        keyboard: Markup.inlineKeyboard([
          [Markup.button.callback("🔄 Try Again", "join_group")],
          [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
        ])
      };
    }
  }

  let message = `✅ *Active Subscription*\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `📦 *Plan:* ${planName}\n`;
  if (isForever) {
    message += `⏰ *Status:* Active Forever 🎉\n`;
  } else {
    message += `🔄 *Renews:* ${renewDate}\n`;
  }
  if (willCancel && !isForever) {
    message += `\n⚠️ *Note:* Will cancel at period end\n`;
  }
  message += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `✨ Your subscription is active and working!`;
  message += `\n\n🚪 Click below to join the premium group!`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url("🚪 Join Premium Group", inviteLink)],
    [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
  ]);

  return {
    text: message,
    options: { parse_mode: "Markdown" as const },
    keyboard: keyboard
  };
}

// NOTE: crypto payment activation is handled by shared processor:
// processPaidCryptoInvoice({ invoiceId, invoice })

// Logging middleware - Log all incoming updates (must be before handlers)
bot.use(async (ctx, next) => {
  const updateType = ctx.updateType;
  const updateId = ctx.update.update_id;
  const timestamp = new Date().toISOString();
  
  // Extract user info
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "N/A";
  const firstName = ctx.from?.first_name || "N/A";
  const lastName = ctx.from?.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  
  // Extract chat info
  const chatId = ctx.chat?.id;
  const chatType = ctx.chat?.type || "N/A";
  const chatTitle = (ctx.chat as any)?.title || "N/A";
  
  // Extract message/query info
  let actionInfo = "";
  if (updateType === "message") {
    const text = (ctx.message as any)?.text || "";
    const command = text.startsWith("/") ? text.split(" ")[0] : "";
    actionInfo = command ? `Command: ${command}` : `Message: ${text.substring(0, 50)}${text.length > 50 ? "..." : ""}`;
  } else if (updateType === "callback_query") {
    const data = (ctx.callbackQuery as any)?.data || "";
    actionInfo = `Callback: ${data}`;
  } else if (updateType === "new_chat_members") {
    const members = (ctx.message as any)?.new_chat_members || [];
    actionInfo = `New members: ${members.map((m: any) => m.username || m.first_name).join(", ")}`;
  }
  
  // Log incoming update
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info(`📥 INCOMING UPDATE [${updateId}] - ${updateType.toUpperCase()}`);
  logger.info(`⏰ Time: ${timestamp}`);
  logger.info(`👤 User: ${fullName} (@${username}) [ID: ${userId}]`);
  logger.info(`💬 Chat: ${chatTitle} [${chatType}] [ID: ${chatId}]`);
  if (actionInfo) {
    logger.info(`📝 Action: ${actionInfo}`);
  }
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  try {
    await next();
    
    // Log successful processing
    logger.info(`✅ Processed update [${updateId}] successfully`);
  } catch (err: any) {
    logger.error(`❌ Error processing update [${updateId}]:`, err.message);
    logger.error("Error details:", err);
    throw err;
  }
});

// /chatid command - helps find the group chat ID
bot.command("chatid", async (ctx) => {
  try {
    logger.info(`📋 /chatid command from user ${ctx.from?.id} in chat ${ctx.chat?.id}`);
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type; // 'private', 'group', 'supergroup', 'channel'
    const chatTitle = (ctx.chat as any)?.title || "Private Chat";
    const threadId = (ctx.message as any)?.message_thread_id;

    let message = `📋 *Chat Information*\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `🆔 *Chat ID:* \`${chatId}\`\n`;
    message += `📝 *Chat Type:* ${chatType}\n`;
    message += `📛 *Chat Title:* ${chatTitle}\n`;
    
    if (threadId) {
      message += `🧵 *Thread ID:* \`${threadId}\`\n`;
    } else {
      message += `🧵 *Thread ID:* none\n`;
    }
    
    message += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `💡 *Use the Chat ID in your code*\n`;
    message += `(This is the group chat ID, not the bot ID)`;

    await ctx.reply(message, { parse_mode: "Markdown" });
    logger.info(`✅ Sent chat ID info: ${chatId}`);
  } catch (err: any) {
    logger.error("❌ chatid command error:", err);
    await ctx.reply(
      `❌ Error getting chat ID\n\nChat ID: ${ctx.chat?.id || "Unknown"}`,
      { parse_mode: "Markdown" }
    );
  }
});

// /start command - creates/updates user and shows menu
bot.start(async (ctx) => {
  try {
    const telegramUserId = ctx.from?.id;
    const username = ctx.from?.username || "N/A";
    logger.info(`🚀 /start command from user ${telegramUserId} (@${username})`);
    
    if (!telegramUserId) {
      logger.warn("⚠️ Unable to detect Telegram user ID in /start command");
      return ctx.reply("❌ Unable to detect your Telegram user ID.");
    }

    // Clear promo code waiting flag if set
    waitingForPromoCode.delete(telegramUserId);

    const user = await getOrCreateUser(telegramUserId);
    logger.info(`👤 User ${telegramUserId} - DB ID: ${user.id} (${user.id ? "existing" : "new"})`);

    const startParam = ctx.message.text?.split(" ")[1];
    
    if (startParam) {
      logger.info(`📌 Start parameter: ${startParam}`);
    }

    if (startParam === "payment_success") {
      logger.info(`💳 Payment success callback for user ${user.id}`);
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
            "🎉 *Payment Successful!*\n\n" +
            "━━━━━━━━━━━━━━━━━━━━\n\n" +
            "✅ Your subscription is now active!\n\n" +
            "Click the button below to join the premium group!\n\n" +
            "⚠️ *Important:* This link can only be used once.\n\n" +
            "━━━━━━━━━━━━━━━━━━━━\n\n" +
            "Welcome to the premium group! 🎊",
            {
              parse_mode: "Markdown",
              ...Markup.inlineKeyboard([
                [Markup.button.url("🚪 Join Premium Group", inviteLink)],
                [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
              ])
            }
          );
        } else {
          return ctx.reply(
            "🎉 *Payment Successful!*\n\n" +
            "━━━━━━━━━━━━━━━━━━━━\n\n" +
            "✅ Your subscription is now active!\n\n" +
            "Check your messages for the invite link, or use 'Check Status' to get a new one.\n\n" +
            "━━━━━━━━━━━━━━━━━━━━",
            { parse_mode: "Markdown", ...getMainKeyboard() }
          );
        }
      } else {
        return ctx.reply(
          "⏳ *Payment Received*\n\n" +
          "━━━━━━━━━━━━━━━━━━━━\n\n" +
          "Your payment has been received and is being processed.\n\n" +
          "You'll receive a notification with your invite link when it's activated. ✨\n\n" +
          "━━━━━━━━━━━━━━━━━━━━",
          { parse_mode: "Markdown", ...getMainKeyboard() }
        );
      }
    }

    if (startParam === "payment_cancel") {
      logger.info(`❌ Payment cancel callback for user ${user.id}`);
      return ctx.reply(
        "❌ *Payment Cancelled*\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Your payment was cancelled.\n\n" +
        "You can try subscribing again using the buttons below. 🔄\n\n" +
        "━━━━━━━━━━━━━━━━━━━━",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

    // Normal start flow
    const welcomeMessage =
      `✨ *Welcome to Premium Access!*\n\n` +
      `🎯 Your account has been successfully registered\n` +
      `🆔 Account ID: \`${user.id}\`\n\n` +
      `💎 *Choose your subscription plan below:*\n\n` +
      `📅 *Monthly Plan* - Flexible monthly billing\n` +
      `⭐ *Yearly Plan* - Best value with annual savings\n\n` +
      `Use the buttons below to get started! 🚀`;

    await ctx.reply(welcomeMessage, { parse_mode: "Markdown", ...getMainKeyboard() });
  } catch (err: any) {
    logger.error(`❌ start command error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await ctx.reply("❌ Failed to initialize. Please try again.");
  }
});

// Handle promo code entry
bot.action("enter_promo_code", async (ctx) => {
  try {
    logger.info(`🎟️ Promo code button clicked by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Enter your promo code...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      return ctx.reply(
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

    // Set flag to wait for promo code input
    waitingForPromoCode.set(telegramUserId, true);

    await ctx.reply(
      "🎟️ *Enter Promo Code*\n\n" +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      "Please enter your promo code below:\n\n" +
      "💡 *Tip:* Type your promo code and send it as a message.\n\n" +
      "━━━━━━━━━━━━━━━━━━━━",
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Cancel", "back_to_menu")],
        ])
      }
    );
  } catch (err: any) {
    logger.error(`❌ enter_promo_code error for user ${ctx.from?.id}:`, err.message);
    waitingForPromoCode.delete(ctx.from?.id || 0);
    await ctx.reply("❌ Failed to start promo code entry. Please try again.", getMainKeyboard());
  }
});

// Handle text messages - check if user is entering promo code
bot.on("text", async (ctx) => {
  try {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    // Skip if message is a command (commands are handled separately)
    const text = ctx.message.text?.trim() || "";
    if (text.startsWith("/")) {
      return; // Commands are handled by command handlers
    }

    // Check if user is waiting for promo code
    if (!waitingForPromoCode.get(telegramUserId)) {
      return; // Not waiting for promo code, ignore this message
    }

    // Remove flag
    waitingForPromoCode.delete(telegramUserId);

    const promoCode = text;
    logger.info(`🎟️ Promo code entered by user ${telegramUserId}: ${promoCode}`);

    // Validate promo code
    if (promoCode !== "121212") {
      return ctx.reply(
        "❌ *Invalid Promo Code*\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "The promo code you entered is invalid.\n\n" +
        "Please check and try again, or choose a subscription plan.\n\n" +
        "━━━━━━━━━━━━━━━━━━━━",
        {
          parse_mode: "Markdown",
          ...getMainKeyboard()
        }
      );
    }

    // Valid promo code - activate subscription
    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      return ctx.reply(
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

    // Create forever subscription (set expiration to year 2099)
    const foreverDate = new Date("2099-12-31T23:59:59Z");
    
    await db.query(
      `INSERT INTO subscriptions (user_id, plan, status, current_period_end)
       VALUES (?, 'YEARLY_280', 'ACTIVE', ?)`,
      [user.id, foreverDate]
    );

    logger.info(`✅ Promo code subscription activated for user ${user.id}`);

    // Generate invite link
    let inviteLink: string | null = null;
    try {
      logger.info(`🔗 Generating invite link for user ${user.id} (promo code)`);
      inviteLink = await createSingleUseInviteLink();
      
      // Store invite link
      const [existing]: any = await db.query(
        `SELECT id FROM telegram_access WHERE user_id=? AND chat_id=? LIMIT 1`,
        [user.id, env.telegram.groupChatId]
      );
      
      if (existing?.[0]) {
        await db.query(
          `UPDATE telegram_access
           SET invite_link=?, last_verified_at=NOW(), removed_at=NULL
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
      logger.info(`✅ Invite link generated and stored: ${inviteLink}`);
    } catch (inviteErr: any) {
      logger.error(`❌ Failed to generate invite link for user ${user.id}:`, inviteErr.message);
    }

    // Send success message
    const successMessage = inviteLink
      ? `🎉 *Promo Code Activated!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ Your subscription has been activated!\n` +
        `🎟️ *Promo Code:* ${promoCode}\n` +
        `⏰ *Status:* Active Forever\n\n` +
        `🚪 Click below to join the premium group!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Welcome to the premium group! 🎊`
      : `🎉 *Promo Code Activated!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ Your subscription has been activated!\n` +
        `🎟️ *Promo Code:* ${promoCode}\n` +
        `⏰ *Status:* Active Forever\n\n` +
        `Use 'Check Status' to get your invite link.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

    const keyboard = inviteLink
      ? Markup.inlineKeyboard([
          [Markup.button.url("🚪 Join Premium Group", inviteLink)],
          [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
        ])
      : Markup.inlineKeyboard([
          [Markup.button.callback("📊 Check Status", "check_status")],
          [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
        ]);

    await ctx.reply(successMessage, {
      parse_mode: "Markdown",
      ...keyboard
    });
  } catch (err: any) {
    logger.error(`❌ Promo code text handler error for user ${ctx.from?.id}:`, err.message);
    waitingForPromoCode.delete(ctx.from?.id || 0);
    await ctx.reply(
      "❌ *Error*\n\nFailed to process promo code. Please try again.",
      { parse_mode: "Markdown", ...getMainKeyboard() }
    );
  }
});

// Handle button callbacks
bot.action("subscribe_monthly", async (ctx) => {
  try {
    logger.info(`💎 Monthly plan button clicked by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Loading monthly plan...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      return ctx.reply(
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

    // Determine if early access pricing applies
    const earlyAccessDeadline = env.earlyAccessDeadline
      ? new Date(env.earlyAccessDeadline)
      : null;
    const isEarlyAccess =
      earlyAccessDeadline && new Date() < earlyAccessDeadline;

    const price = isEarlyAccess ? '$20' : '$30';
    const savings = isEarlyAccess ? '🎁 Early Access Special!' : '';

    const packageMessage =
      `💎 *Monthly Subscription Plan*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 *Price:* ${price}/month\n` +
      `📅 *Billing:* Monthly recurring\n` +
      `✨ *Features:*\n` +
      `  • Full access to premium group\n` +
      `  • Monthly renewal\n` +
      `  • Cancel anytime\n\n` +
      `${savings}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💳 *Ready to proceed?*\n` +
      `Click below to continue with payment:`;

    await safeEditOrReply(ctx, packageMessage, {
      parse_mode: "Markdown",
      ...getPackageDetailsKeyboard("MONTHLY")
    });
  } catch (err: any) {
    logger.error(`❌ subscribe_monthly error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await ctx.reply("❌ Failed to load plan details. Please try again.", getMainKeyboard());
  }
});

bot.action("subscribe_yearly", async (ctx) => {
  try {
    logger.info(`⭐ Yearly plan button clicked by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Loading yearly plan...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      return ctx.reply(
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

    const monthlyEquivalent = (280 / 12).toFixed(2);
    const savings = ((30 - parseFloat(monthlyEquivalent)) * 12).toFixed(0);

    const packageMessage =
      `⭐ *Yearly Subscription Plan*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 *Price:* $280/year\n` +
      `💵 *Monthly Equivalent:* ~$${monthlyEquivalent}/month\n` +
      `💸 *You Save:* $${savings} per year!\n\n` +
      `✨ *Features:*\n` +
      `  • Full access to premium group\n` +
      `  • Annual billing (best value)\n` +
      `  • Cancel anytime\n` +
      `  • 🎁 Maximum savings\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💳 *Ready to proceed?*\n` +
      `Click below to continue with payment:`;

    await safeEditOrReply(ctx, packageMessage, {
      parse_mode: "Markdown",
      ...getPackageDetailsKeyboard("YEARLY")
    });
  } catch (err: any) {
    logger.error(`❌ subscribe_yearly error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await ctx.reply("❌ Failed to load plan details. Please try again.", getMainKeyboard());
  }
});

// Handle continue payment - show payment method selection
bot.action("continue_payment_monthly", async (ctx) => {
  try {
    logger.info(`💳 Continue payment (monthly) clicked by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Selecting payment method...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      await safeEditOrReply(ctx,
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      return;
    }

    // Determine if early access pricing applies
    const earlyAccessDeadline = env.earlyAccessDeadline
      ? new Date(env.earlyAccessDeadline)
      : null;
    const isEarlyAccess =
      earlyAccessDeadline && new Date() < earlyAccessDeadline;
    const price = isEarlyAccess ? '$20' : '$30';

    const paymentMessage =
      `💳 *Select Payment Method*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 *Plan:* Monthly Subscription\n` +
      `💰 *Amount:* ${price}/month\n\n` +
      `Choose your preferred payment method:\n\n` +
      `💳 *Stripe* - Credit/Debit Card\n` +
      `₿ *Crypto* - Cryptocurrency (Coming Soon)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    await safeEditOrReply(ctx, paymentMessage, {
      parse_mode: "Markdown",
      ...getPaymentMethodKeyboard("MONTHLY")
    });
  } catch (err: any) {
    logger.error(`❌ continue_payment_monthly error for user ${ctx.from?.id}:`, err.message);
    await ctx.reply("❌ Failed to load payment options. Please try again.", getMainKeyboard());
  }
});

bot.action("continue_payment_yearly", async (ctx) => {
  try {
    logger.info(`💳 Continue payment (yearly) clicked by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Selecting payment method...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      await safeEditOrReply(ctx,
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      return;
    }

    const paymentMessage =
      `💳 *Select Payment Method*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 *Plan:* Yearly Subscription\n` +
      `💰 *Amount:* $280/year\n\n` +
      `Choose your preferred payment method:\n\n` +
      `💳 *Stripe* - Credit/Debit Card\n` +
      `₿ *Crypto* - Cryptocurrency (Coming Soon)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    await safeEditOrReply(ctx, paymentMessage, {
      parse_mode: "Markdown",
      ...getPaymentMethodKeyboard("YEARLY")
    });
  } catch (err: any) {
    logger.error(`❌ continue_payment_yearly error for user ${ctx.from?.id}:`, err.message);
    await ctx.reply("❌ Failed to load payment options. Please try again.", getMainKeyboard());
  }
});

// Handle Stripe payment
bot.action("payment_stripe_monthly", async (ctx) => {
  try {
    logger.info(`💳 Stripe payment (monthly) selected by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Processing Stripe payment...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      await safeEditOrReply(ctx,
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      return;
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
      logger.error(`Invalid price ID: ${priceId}. Price IDs must start with 'price_'`);
      await safeEditOrReply(ctx,
        "❌ *Configuration Error*\n\nInvalid price ID. Please contact support.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      return;
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(user.id, telegramUserId);

    // Get bot username for redirect URLs
    const botUsername = await getBotUsername(ctx);

    // Create checkout session
    logger.info(`🔗 Creating Stripe checkout session for user ${user.id} (monthly, ${isEarlyAccess ? "$20" : "$30"})`);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://t.me/${botUsername}?start=payment_success`,
      cancel_url: `https://t.me/${botUsername}?start=payment_cancel`,
      metadata: {
        userId: String(user.id),
        telegramUserId: String(telegramUserId),
        plan: "MONTHLY",
        earlyAccess: String(isEarlyAccess),
      },
      payment_method_types: ["card"],
      allow_promotion_codes: true,
    });
    logger.info(`✅ Stripe checkout session created: ${session.id} | URL: ${session.url}`);

    // Store PENDING subscription
    const plan = isEarlyAccess ? "MONTHLY_20" : "MONTHLY_30";
    await db.query(
      `INSERT INTO subscriptions (user_id, plan, status, stripe_customer_id)
       VALUES (?, ?, 'PENDING', ?)`,
      [user.id, plan, customerId]
    );

    const price = isEarlyAccess ? '$20' : '$30';
    const paymentMessage =
      `💳 *Stripe Payment - Monthly Plan*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 *Amount:* ${price}/month\n\n` +
      `🔒 *Secure Payment via Stripe*\n\n` +
      `Click the button below to complete your payment:\n\n` +
      `After payment, your subscription will be activated automatically. ✨\n\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    await safeEditOrReply(ctx, paymentMessage, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.url("💳 Pay with Stripe", session.url)],
        [Markup.button.callback("🔙 Back", "back_to_menu")],
      ])
    });
  } catch (err: any) {
    logger.error(`❌ payment_stripe_monthly error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await safeEditOrReply(ctx,
      "❌ *Payment Error*\n\nFailed to create checkout session. Please try again.",
      { parse_mode: "Markdown", ...getMainKeyboard() }
    );
  }
});

bot.action("payment_stripe_yearly", async (ctx) => {
  try {
    logger.info(`💳 Stripe payment (yearly) selected by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Processing Stripe payment...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      await safeEditOrReply(ctx,
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      return;
    }

    // Validate price ID format
    if (!env.stripe.priceYearly280 || !env.stripe.priceYearly280.startsWith('price_')) {
      logger.error(`Invalid price ID: ${env.stripe.priceYearly280}. Price IDs must start with 'price_'`);
      await safeEditOrReply(ctx,
        "❌ *Configuration Error*\n\nInvalid price ID. Please contact support.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      return;
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(user.id, telegramUserId);

    // Get bot username for redirect URLs
    const botUsername = await getBotUsername(ctx);

    // Create checkout session
    logger.info(`🔗 Creating Stripe checkout session for user ${user.id} (yearly, $280)`);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: env.stripe.priceYearly280, quantity: 1 }],
      success_url: `https://t.me/${botUsername}?start=payment_success`,
      cancel_url: `https://t.me/${botUsername}?start=payment_cancel`,
      metadata: {
        userId: String(user.id),
        telegramUserId: String(telegramUserId),
        plan: "YEARLY",
        earlyAccess: "false",
      },
      payment_method_types: ["card"],
      allow_promotion_codes: true,
    });
    logger.info(`✅ Stripe checkout session created: ${session.id} | URL: ${session.url}`);

    // Store PENDING subscription
    await db.query(
      `INSERT INTO subscriptions (user_id, plan, status, stripe_customer_id)
       VALUES (?, ?, 'PENDING', ?)`,
      [user.id, "YEARLY_280", customerId]
    );

    const paymentMessage =
      `💳 *Stripe Payment - Yearly Plan*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 *Amount:* $280/year\n\n` +
      `🔒 *Secure Payment via Stripe*\n\n` +
      `Click the button below to complete your payment:\n\n` +
      `After payment, your subscription will be activated automatically. ✨\n\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    await safeEditOrReply(ctx, paymentMessage, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.url("💳 Pay with Stripe", session.url)],
        [Markup.button.callback("🔙 Back", "back_to_menu")],
      ])
    });
  } catch (err: any) {
    logger.error(`❌ payment_stripe_yearly error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await safeEditOrReply(ctx,
      "❌ *Payment Error*\n\nFailed to create checkout session. Please try again.",
      { parse_mode: "Markdown", ...getMainKeyboard() }
    );
  }
});

// Handle Crypto payment (coming soon)
bot.action(/^payment_crypto_(monthly|yearly)$/, async (ctx) => {
  try {
    const plan = ctx.match[1].toUpperCase() as "MONTHLY" | "YEARLY";
    logger.info(`₿ Crypto payment (${plan}) selected by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Creating payment invoice...");
    
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Check if already has active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (hasActive) {
      await safeEditOrReply(ctx,
        "✅ *You already have an active subscription*\n\n" +
        "Use 'Check Status' to see your subscription details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      return;
    }

    // Calculate amount based on plan
    const amount = plan === "MONTHLY" ? "30.00" : "280.00"; // USD amount
    const asset = "USDT"; // Using USDT TRC20

    // Create unique payload to identify this payment
    const payload = `user_${user.id}_plan_${plan}_${Date.now()}`;

    // Get bot username for callback URL
    const botUsername = await getBotUsername(ctx);

    // Create invoice
    const invoice = await createInvoice({
      asset: asset,
      amount: amount,
      description: `${plan === "MONTHLY" ? "Monthly" : "Yearly"} Premium Subscription`,
      payload: payload,
    });

    // Store payment record in database
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour from now
    await db.query(
      `INSERT INTO crypto_payments 
       (user_id, telegram_user_id, invoice_id, plan, amount, asset, status, invoice_hash, pay_url, payload, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
      [
        user.id,
        telegramUserId,
        invoice.invoiceId,
        plan === "MONTHLY" ? "MONTHLY_30" : "YEARLY_280",
        amount,
        asset,
        invoice.hash,
        invoice.payUrl,
        payload,
        expiresAt
      ]
    );

    logger.info(`✅ Crypto invoice created for user ${user.id}: invoice_id=${invoice.invoiceId}`);

    const cryptoMessage =
      `₿ *Cryptocurrency Payment*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 *Plan:* ${plan === "MONTHLY" ? "Monthly" : "Yearly"} Subscription\n` +
      `💰 *Amount:* ${amount} ${asset}\n\n` +
      `🔒 *Secure Payment via Telegram Crypto Pay*\n\n` +
      `Click the button below to complete your payment:\n\n` +
      `⏰ *Expires in:* 1 hour\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `After payment, your subscription will be activated automatically. ✨`;

    await safeEditOrReply(ctx, cryptoMessage, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.url("💳 Pay with Crypto", invoice.payUrl)],
        [Markup.button.callback("🔄 Check Payment Status", `check_crypto_${invoice.invoiceId}`)],
        [Markup.button.callback("🔙 Back", "back_to_menu")],
      ])
    });
  } catch (err: any) {
    logger.error(`❌ payment_crypto error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await safeEditOrReply(ctx,
      "❌ *Payment Error*\n\nFailed to create payment invoice. Please try again.",
      { parse_mode: "Markdown", ...getMainKeyboard() }
    );
  }
});

// Check crypto payment status
bot.action(/^check_crypto_(\d+)$/, async (ctx) => {
  try {
    const invoiceId = Number(ctx.match[1]);
    logger.info(`🔍 Checking crypto payment status: invoice_id=${invoiceId}`);
    
    await ctx.answerCbQuery("Checking payment status...");
    
    // Get invoice status
    const invoice = await getInvoice(invoiceId);
    
    if (!invoice) {
      return ctx.reply(
        "❌ *Invoice Not Found*\n\n" +
        "The payment invoice could not be found.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

    // Check database record
    const [paymentRows]: any = await db.query(
      `SELECT * FROM crypto_payments WHERE invoice_id = ? LIMIT 1`,
      [invoiceId]
    );
    
    const payment = paymentRows?.[0];
    
    if (invoice.status === 'paid' && payment && payment.status === 'PENDING') {
      // Payment confirmed - activate subscription + notify user (shared logic)
      await processPaidCryptoInvoice({ invoiceId, invoice });
      
      return ctx.reply(
        "✅ *Payment Confirmed!*\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Your subscription has been activated!\n\n" +
        "Check your messages for the invite link, or use 'Check Status' to get it.\n\n" +
        "━━━━━━━━━━━━━━━━━━━━",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    } else if (invoice.status === 'paid') {
      return ctx.reply(
        "✅ *Payment Already Processed*\n\n" +
        "Your subscription is already active! Use 'Check Status' to see details.",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    } else {
      return ctx.reply(
        "⏳ *Payment Pending*\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Your payment is still being processed. Please wait a moment and try again.\n\n" +
        "💡 *Tip:* After completing payment, click 'Check Payment Status' again.\n\n" +
        "━━━━━━━━━━━━━━━━━━━━",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }
  } catch (err: any) {
    logger.error(`❌ check_crypto error:`, err.message);
    logger.error("Error details:", err);
    await ctx.reply("❌ Failed to check payment status.", getMainKeyboard());
  }
});

// Handle back to plans
bot.action("back_to_plans", async (ctx) => {
  try {
    await ctx.answerCbQuery("Loading plans...");
    const plansMessage =
      `✨ *Choose Your Subscription Plan*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💎 *Monthly Plan*\n` +
      `  • Flexible monthly billing\n` +
      `  • Cancel anytime\n\n` +
      `⭐ *Yearly Plan*\n` +
      `  • Best value with annual savings\n` +
      `  • Maximum discount\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Select a plan to see details:`;

    await safeEditOrReply(ctx, plansMessage, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("💎 Monthly Plan", "subscribe_monthly"),
          Markup.button.callback("⭐ Yearly Plan", "subscribe_yearly"),
        ],
        [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
      ])
    });
  } catch (err: any) {
    logger.error(`❌ back_to_plans error for user ${ctx.from?.id}:`, err.message);
    await ctx.reply("❌ An error occurred. Please try again.", getMainKeyboard());
  }
});

// Handle back to menu
bot.action("back_to_menu", async (ctx) => {
  try {
    await ctx.answerCbQuery("Loading menu...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    // Clear promo code waiting flag if set
    waitingForPromoCode.delete(telegramUserId);

    const user = await getOrCreateUser(telegramUserId);
    const welcomeMessage =
      `✨ *Welcome to Premium Access!*\n\n` +
      `🎯 Your account has been successfully registered\n` +
      `🆔 Account ID: \`${user.id}\`\n\n` +
      `💎 *Choose your subscription plan below:*\n\n` +
      `📅 *Monthly Plan* - Flexible monthly billing\n` +
      `⭐ *Yearly Plan* - Best value with annual savings\n\n` +
      `Use the buttons below to get started! 🚀`;

    await safeEditOrReply(ctx, welcomeMessage, {
      parse_mode: "Markdown",
      ...getMainKeyboard()
    });
  } catch (err: any) {
    logger.error(`❌ back_to_menu error for user ${ctx.from?.id}:`, err.message);
    await ctx.reply("❌ An error occurred. Please try again.", getMainKeyboard());
  }
});

bot.action("check_status", async (ctx) => {
  try {
    logger.info(`📊 Check status clicked by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Checking status...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);
    logger.info(`👤 User lookup result:`, {
      telegramUserId: telegramUserId,
      userId: user.id,
      userRecord: user
    });
    
    const statusResult = await getStatusMessage(user.id);

    // Use custom keyboard if provided (with invite link), otherwise use main keyboard
    const keyboard = statusResult.keyboard || getMainKeyboard();

    await safeEditOrReply(ctx, statusResult.text, { 
      ...statusResult.options, 
      ...keyboard 
    });
  } catch (err: any) {
    logger.error(`❌ check_status error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await safeEditOrReply(ctx,
      "❌ *Error*\n\nFailed to check status. Please try again.",
      { parse_mode: "Markdown", ...getMainKeyboard() }
    );
  }
});

bot.action("join_group", async (ctx) => {
  try {
    logger.info(`🚪 Join group clicked by user ${ctx.from?.id}`);
    await ctx.answerCbQuery("Checking subscription...");
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    const user = await getOrCreateUser(telegramUserId);

    // Fix current_period_end if missing (same logic as getStatusMessage)
    const [subRows]: any = await db.query(
      `SELECT status, stripe_subscription_id FROM subscriptions
       WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [user.id]
    );
    const sub = subRows?.[0];
    
    if (sub && sub.status === "ACTIVE" && sub.stripe_subscription_id) {
      const [checkRows]: any = await db.query(
        `SELECT current_period_end FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1`,
        [user.id]
      );
      if (!checkRows?.[0]?.current_period_end) {
        logger.info(`🔄 Fixing missing current_period_end for user ${user.id} in join_group`);
        try {
          const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
          const periodEnd = new Date(stripeSub.current_period_end * 1000);
          const [subIdRows]: any = await db.query(
            `SELECT id FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1`,
            [user.id]
          );
          if (subIdRows?.[0]?.id) {
            await db.query(
              `UPDATE subscriptions SET current_period_end=? WHERE id=?`,
              [periodEnd, subIdRows[0].id]
            );
            logger.info(`✅ Fixed current_period_end from Stripe: ${periodEnd.toISOString()}`);
          }
        } catch (stripeErr: any) {
          logger.error(`❌ Failed to fetch subscription from Stripe in join_group:`, stripeErr.message);
        }
      }
    }

    // Check active subscription
    const hasActive = await hasActiveSubscription(user.id);
    if (!hasActive) {
      return ctx.reply(
        "❌ *No Active Subscription*\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Please subscribe first to get access to the premium group.\n\n" +
        "Choose a plan from the menu below! 💎\n\n" +
        "━━━━━━━━━━━━━━━━━━━━",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

    // Generate invite link
    logger.info(`🔗 Generating invite link for user ${user.id}`);
    let inviteLink: string;
    try {
      inviteLink = await createSingleUseInviteLink();
      logger.info(`✅ Invite link generated: ${inviteLink}`);
    } catch (inviteErr: any) {
      logger.error(`❌ Failed to generate invite link for user ${user.id}:`, inviteErr.message);
      // Check if it's a permission error
      if (inviteErr.message?.includes("not enough rights") || inviteErr.message?.includes("permission")) {
        return ctx.reply(
          "❌ *Permission Error*\n\n" +
          "━━━━━━━━━━━━━━━━━━━━\n\n" +
          "The bot doesn't have permission to create invite links.\n\n" +
          "Please contact the administrator to fix this issue.\n\n" +
          "━━━━━━━━━━━━━━━━━━━━",
          { parse_mode: "Markdown", ...getMainKeyboard() }
        );
      }
      // Generic error
      return ctx.reply(
        "❌ *Error Generating Invite Link*\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Failed to generate invite link. Please try again later.\n\n" +
        `Error: ${inviteErr.message || "Unknown error"}\n\n` +
        "━━━━━━━━━━━━━━━━━━━━",
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
    }

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
      `🚪 *Join Premium Group*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Click the button below to join the premium group!\n\n` +
      `⚠️ *Important:* This link can only be used once.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `See you inside! 🎉`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.url("🚪 Join Premium Group", inviteLink)],
          [Markup.button.callback("🔙 Back to Menu", "back_to_menu")],
        ])
      }
    );
  } catch (err: any) {
    logger.error(`❌ join_group error for user ${ctx.from?.id}:`, err.message);
    logger.error("Error details:", err);
    await ctx.reply(
      "❌ *Unexpected Error*\n\n" +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      "An unexpected error occurred. Please try again.\n\n" +
      `Error: ${err.message || "Unknown error"}\n\n` +
      "━━━━━━━━━━━━━━━━━━━━",
      { parse_mode: "Markdown", ...getMainKeyboard() }
    );
  }
});

// When a new member joins the group - verify and kick if needed
bot.on("new_chat_members", async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId !== env.telegram.groupChatId) return;

  const members = ctx.message.new_chat_members;
  logger.info(`👥 New chat members event: ${members.length} member(s) joining chat ${chatId}`);
  
  for (const m of members) {
    const telegramUserId = m.id;
    logger.info(`🔍 Verifying member ${telegramUserId} (${m.first_name} ${m.username ? "@" + m.username : ""})`);

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
        logger.warn(`⚠️ User ${telegramUserId} not found in database - kicking from group`);
        await ctx.kickChatMember(telegramUserId);
        continue;
      }

      const userId = urows[0].id;

      // Check active subscription
      const hasActive = await hasActiveSubscription(userId);
      if (!hasActive) {
        logger.warn(`⚠️ User ${telegramUserId} (DB ID: ${userId}) has no active subscription - kicking from group`);
        await ctx.kickChatMember(telegramUserId);
        continue;
      }
      
      logger.info(`✅ User ${telegramUserId} (DB ID: ${userId}) verified - allowing access to group`);

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
      logger.error(`❌ new_chat_members error for user ${telegramUserId}:`, err.message);
      logger.error("Error details:", err);
      // On error, kick to be safe
      try {
        await ctx.kickChatMember(telegramUserId);
      } catch {}
    }
  }
});

// Start bot
bot.launch()
  .then(() => {
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("✅ Telegram bot is running and ready!");
    logger.info(`🤖 Bot username: @${bot.botInfo?.username || "loading..."}`);
    logger.info("📋 Listening for incoming updates...");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  })
  .catch((err) => {
    logger.error("❌ Bot launch failed:", err);
    process.exit(1);
  });

process.once("SIGINT", () => {
  logger.info("🛑 Received SIGINT, shutting down gracefully...");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  logger.info("🛑 Received SIGTERM, shutting down gracefully...");
  bot.stop("SIGTERM");
});

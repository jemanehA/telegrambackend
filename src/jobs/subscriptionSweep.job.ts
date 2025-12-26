import { db } from "../config/db";
import { bot } from "../modules/telegram/telegram.service";
import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Sweep job to check for expired subscriptions and kick users from Telegram group
 * Should be run periodically (e.g., every hour via cron)
 */
export async function subscriptionSweep() {
  try {
    logger.info("Starting subscription sweep...");

    // Find all users with expired subscriptions that are still in the group
    const [rows]: any = await db.query(
      `SELECT DISTINCT u.id as user_id, u.telegram_user_id, ta.chat_id
       FROM users u
       INNER JOIN subscriptions s ON u.id = s.user_id
       INNER JOIN telegram_access ta ON u.id = ta.user_id
       WHERE s.status = 'ACTIVE'
         AND s.current_period_end < NOW()
         AND ta.removed_at IS NULL
         AND u.telegram_user_id IS NOT NULL`
    );

    let kickedCount = 0;
    let expiredCount = 0;

    for (const row of rows) {
      try {
        const { user_id, telegram_user_id, chat_id } = row;

        // Mark subscription as expired
        await db.query(
          `UPDATE subscriptions
           SET status = 'EXPIRED'
           WHERE user_id = ? AND status = 'ACTIVE' AND current_period_end < NOW()`,
          [user_id]
        );
        expiredCount++;

        // Kick user from Telegram group
        if (chat_id === env.telegram.groupChatId && telegram_user_id) {
          try {
            await bot.telegram.kickChatMember(chat_id, telegram_user_id);
            await db.query(
              `UPDATE telegram_access
               SET removed_at = NOW()
               WHERE user_id = ? AND chat_id = ?`,
              [user_id, chat_id]
            );
            kickedCount++;

            // Notify user
            try {
              await bot.telegram.sendMessage(
                telegram_user_id,
                `❌ Subscription Expired\n\n` +
                  `Your subscription has expired. Please renew to regain access to the group.\n\n` +
                  `Use /start to manage your subscription.`
              );
            } catch (notifyErr) {
              logger.warn(`Failed to notify user ${telegram_user_id}:`, notifyErr);
            }
          } catch (kickErr: any) {
            logger.warn(`Failed to kick user ${telegram_user_id} from chat ${chat_id}:`, kickErr);
          }
        }
      } catch (err: any) {
        logger.error(`Error processing user ${row.user_id}:`, err);
      }
    }

    logger.info(
      `Subscription sweep completed: ${expiredCount} expired, ${kickedCount} kicked`
    );
  } catch (err: any) {
    logger.error("Subscription sweep error:", err);
    throw err;
  }
}

// If run directly, execute the sweep
if (require.main === module) {
  subscriptionSweep()
    .then(() => {
      console.log("Sweep completed");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Sweep failed:", err);
      process.exit(1);
    });
}


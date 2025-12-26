import { db } from "../../config/db";

export async function hasActiveSubscription(userId: number) {
  const [rows]: any = await db.query(
    `SELECT status, current_period_end
     FROM subscriptions
     WHERE user_id=? ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  const sub = rows?.[0];
  if (!sub) return false;
  if (sub.status !== "ACTIVE") return false;
  if (!sub.current_period_end) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

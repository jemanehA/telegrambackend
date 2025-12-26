import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../config/db";

// user requests a code to link (we store user_id, later bind the code to telegram_user_id via bot)
const requestSchema = z.object({
  userId: z.number(),
});

export async function requestLinkCode(req: Request, res: Response) {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.flatten() });
    }
  const { userId } = parsed.data;

  // Check user exists
  const [urows]: any = await db.query(`SELECT id, telegram_user_id FROM users WHERE id=? LIMIT 1`, [userId]);
  const user = urows?.[0];
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  if (user.telegram_user_id) {
    return res.json({ success: true, message: "Already linked", telegram_user_id: user.telegram_user_id });
  }

  // Create a short "request id" token for UI flow (optional)
  // For simplicity, UI will just instruct user to message bot "/link <userId>"
  return res.json({
    success: true,
    message: "Open the bot and send: /link " + userId,
  });
}

const confirmSchema = z.object({
  userId: z.number(),
  code: z.string().min(4).max(12),
});

export async function confirmLinkCode(req: Request, res: Response) {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.flatten() });
  }
  const { userId, code } = parsed.data;

  // Find un-used code
  const [rows]: any = await db.query(
    `SELECT id, telegram_user_id, expires_at, used_at
     FROM telegram_link_codes
     WHERE user_id=? AND code=? LIMIT 1`,
    [userId, code]
  );

  const row = rows?.[0];
  if (!row) return res.status(400).json({ success: false, message: "Invalid code" });
  if (row.used_at) return res.status(400).json({ success: false, message: "Code already used" });

  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() > expiresAt) {
    return res.status(400).json({ success: false, message: "Code expired" });
  }

  // Link user to telegram_user_id
  await db.query(`UPDATE users SET telegram_user_id=? WHERE id=?`, [row.telegram_user_id, userId]);

  // Mark code used
  await db.query(`UPDATE telegram_link_codes SET used_at=NOW() WHERE id=?`, [row.id]);

  return res.json({ success: true, message: "Telegram linked successfully", telegram_user_id: row.telegram_user_id });
}

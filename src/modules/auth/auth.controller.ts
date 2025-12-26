import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../config/db";

const schema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(7).optional(),
}).refine((v) => v.email || v.phone, "email or phone is required");

export async function registerOrGetUser(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.flatten() });
  }
  const { email, phone } = parsed.data;

  // find
  const [rows]: any = await db.query(
    `SELECT * FROM users WHERE (email = ? AND ? IS NOT NULL) OR (phone = ? AND ? IS NOT NULL) LIMIT 1`,
    [email ?? null, email ?? null, phone ?? null, phone ?? null]
  );
  if (rows?.[0]) return res.json({ success: true, user: rows[0] });

  // insert
  const [result]: any = await db.query(
    `INSERT INTO users (email, phone) VALUES (?, ?)`,
    [email ?? null, phone ?? null]
  );

  const [created]: any = await db.query(`SELECT * FROM users WHERE id = ? LIMIT 1`, [result.insertId]);
  return res.json({ success: true, user: created[0] });
}

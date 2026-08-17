import { Request, Response } from "express";
import { db } from "../../config/db";

// GET /api/users/:userId - Get user details
export async function getUser(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  const [rows]: any = await db.query(
    `SELECT 
      id, 
      telegram_user_id, 
      email, 
      phone, 
      created_at, 
      updated_at
     FROM users 
     WHERE id = ? LIMIT 1`,
    [userId]
  );

  if (!rows?.[0]) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  // Get subscription info
  const [subRows]: any = await db.query(
    `SELECT 
      id,
      plan,
      status,
      current_period_end,
      cancel_at_period_end,
      created_at
     FROM subscriptions 
     WHERE user_id = ? 
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  // Get telegram access info
  const [accessRows]: any = await db.query(
    `SELECT 
      chat_id,
      joined_at,
      removed_at,
      last_verified_at
     FROM telegram_access 
     WHERE user_id = ? 
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  return res.json({
    success: true,
    user: {
      ...rows[0],
      subscription: subRows?.[0] || null,
      telegramAccess: accessRows?.[0] || null,
    },
  });
}

// GET /api/users - List all users with pagination
export async function listUsers(req: Request, res: Response) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const status = req.query.status as string | undefined; // 'active', 'inactive', 'all'

  let whereClause = "";
  let queryParams: any[] = [];

  if (status === "active") {
    whereClause = `WHERE EXISTS (
      SELECT 1 FROM subscriptions s 
      WHERE s.user_id = u.id 
      AND s.status = 'ACTIVE' 
      AND s.current_period_end > NOW()
    )`;
  } else if (status === "inactive") {
    whereClause = `WHERE NOT EXISTS (
      SELECT 1 FROM subscriptions s 
      WHERE s.user_id = u.id 
      AND s.status = 'ACTIVE' 
      AND s.current_period_end > NOW()
    )`;
  }

  // Get total count
  const [countRows]: any = await db.query(
    `SELECT COUNT(*) as total FROM users u ${whereClause}`,
    queryParams
  );
  const total = countRows?.[0]?.total || 0;

  // Get users
  const [rows]: any = await db.query(
    `SELECT 
      u.id,
      u.telegram_user_id,
      u.email,
      u.phone,
      u.created_at,
      (SELECT COUNT(*) FROM subscriptions WHERE user_id = u.id) as subscription_count,
      (SELECT status FROM subscriptions WHERE user_id = u.id ORDER BY id DESC LIMIT 1) as latest_subscription_status
     FROM users u
     ${whereClause}
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset]
  );

  return res.json({
    success: true,
    users: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// GET /api/users/stats - Get user statistics
export async function getUserStats(req: Request, res: Response) {
  const [totalUsers]: any = await db.query(`SELECT COUNT(*) as total FROM users`);
  const [activeSubs]: any = await db.query(
    `SELECT COUNT(DISTINCT user_id) as total 
     FROM subscriptions 
     WHERE status = 'ACTIVE' AND current_period_end > NOW()`
  );
  const [newUsersToday]: any = await db.query(
    `SELECT COUNT(*) as total 
     FROM users 
     WHERE DATE(created_at) = CURDATE()`
  );
  const [newUsersThisMonth]: any = await db.query(
    `SELECT COUNT(*) as total 
     FROM users 
     WHERE MONTH(created_at) = MONTH(CURDATE()) 
     AND YEAR(created_at) = YEAR(CURDATE())`
  );

  return res.json({
    success: true,
    stats: {
      totalUsers: totalUsers[0]?.total || 0,
      activeSubscribers: activeSubs[0]?.total || 0,
      newUsersToday: newUsersToday[0]?.total || 0,
      newUsersThisMonth: newUsersThisMonth[0]?.total || 0,
    },
  });
}


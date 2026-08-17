import { Request, Response } from "express";
import { db } from "../../config/db";
import { stripe } from "../billing/stripe.service";
import { bot } from "../telegram/telegram.service";

// Helper to log admin actions
async function logAdminAction(userId: number | null, action: string, reason: string | null, meta: any = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, action, reason, meta) VALUES (?, ?, ?, ?)`,
      [userId, action, reason, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error("Failed to log admin action:", err);
  }
}

// POST /api/admin/users/:userId/activate - Activate user subscription
export async function activateUser(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  try {
    // Get user's latest subscription
    const [subRows]: any = await db.query(
      `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId]
    );

    if (!subRows?.[0]) {
      return res.status(404).json({ success: false, message: "No subscription found for this user" });
    }

    const subscription = subRows[0];

    // Update subscription to ACTIVE
    await db.query(
      `UPDATE subscriptions 
       SET status = 'ACTIVE', cancel_at_period_end = 0 
       WHERE id = ?`,
      [subscription.id]
    );

    // If subscription has Stripe subscription ID, update it there too
    if (subscription.stripe_subscription_id) {
      try {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: false,
        });
      } catch (err) {
        console.error("Failed to update Stripe subscription:", err);
      }
    }

    await logAdminAction(userId, "USER_ACTIVATED", req.body.reason || "Manually activated by admin", {
      subscriptionId: subscription.id,
    });

    return res.json({
      success: true,
      message: "User subscription activated successfully",
      subscription: {
        id: subscription.id,
        status: "ACTIVE",
      },
    });
  } catch (err: any) {
    console.error("activateUser error:", err);
    return res.status(500).json({ success: false, message: "Failed to activate user", error: err.message });
  }
}

// POST /api/admin/users/:userId/deactivate - Deactivate user subscription
export async function deactivateUser(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  try {
    // Get user's latest subscription
    const [subRows]: any = await db.query(
      `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId]
    );

    if (!subRows?.[0]) {
      return res.status(404).json({ success: false, message: "No subscription found for this user" });
    }

    const subscription = subRows[0];

    // Update subscription to EXPIRED
    await db.query(
      `UPDATE subscriptions 
       SET status = 'EXPIRED', cancel_at_period_end = 1 
       WHERE id = ?`,
      [subscription.id]
    );

    // If subscription has Stripe subscription ID, cancel it
    if (subscription.stripe_subscription_id) {
      try {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      } catch (err) {
        console.error("Failed to update Stripe subscription:", err);
      }
    }

    await logAdminAction(userId, "USER_DEACTIVATED", req.body.reason || "Manually deactivated by admin", {
      subscriptionId: subscription.id,
    });

    return res.json({
      success: true,
      message: "User subscription deactivated successfully",
      subscription: {
        id: subscription.id,
        status: "EXPIRED",
      },
    });
  } catch (err: any) {
    console.error("deactivateUser error:", err);
    return res.status(500).json({ success: false, message: "Failed to deactivate user", error: err.message });
  }
}

// POST /api/admin/subscriptions/:subscriptionId/mark-unpaid - Mark subscription as unpaid/not received
export async function markSubscriptionUnpaid(req: Request, res: Response) {
  const subscriptionId = Number(req.params.subscriptionId);
  if (!subscriptionId) {
    return res.status(400).json({ success: false, message: "Invalid subscription ID" });
  }

  try {
    // Get subscription
    const [subRows]: any = await db.query(
      `SELECT * FROM subscriptions WHERE id = ? LIMIT 1`,
      [subscriptionId]
    );

    if (!subRows?.[0]) {
      return res.status(404).json({ success: false, message: "Subscription not found" });
    }

    const subscription = subRows[0];

    // Update subscription to PENDING (unpaid)
    await db.query(
      `UPDATE subscriptions 
       SET status = 'PENDING' 
       WHERE id = ?`,
      [subscriptionId]
    );

    await logAdminAction(subscription.user_id, "SUBSCRIPTION_MARKED_UNPAID", req.body.reason || "Marked as unpaid by admin", {
      subscriptionId: subscriptionId,
      previousStatus: subscription.status,
    });

    return res.json({
      success: true,
      message: "Subscription marked as unpaid successfully",
      subscription: {
        id: subscriptionId,
        status: "PENDING",
      },
    });
  } catch (err: any) {
    console.error("markSubscriptionUnpaid error:", err);
    return res.status(500).json({ success: false, message: "Failed to mark subscription as unpaid", error: err.message });
  }
}

// POST /api/admin/subscriptions/:subscriptionId/mark-paid - Mark subscription as paid
export async function markSubscriptionPaid(req: Request, res: Response) {
  const subscriptionId = Number(req.params.subscriptionId);
  if (!subscriptionId) {
    return res.status(400).json({ success: false, message: "Invalid subscription ID" });
  }

  try {
    // Get subscription
    const [subRows]: any = await db.query(
      `SELECT * FROM subscriptions WHERE id = ? LIMIT 1`,
      [subscriptionId]
    );

    if (!subRows?.[0]) {
      return res.status(404).json({ success: false, message: "Subscription not found" });
    }

    const subscription = subRows[0];

    // Update subscription to ACTIVE
    await db.query(
      `UPDATE subscriptions 
       SET status = 'ACTIVE', cancel_at_period_end = 0 
       WHERE id = ?`,
      [subscriptionId]
    );

    await logAdminAction(subscription.user_id, "SUBSCRIPTION_MARKED_PAID", req.body.reason || "Marked as paid by admin", {
      subscriptionId: subscriptionId,
      previousStatus: subscription.status,
    });

    return res.json({
      success: true,
      message: "Subscription marked as paid successfully",
      subscription: {
        id: subscriptionId,
        status: "ACTIVE",
      },
    });
  } catch (err: any) {
    console.error("markSubscriptionPaid error:", err);
    return res.status(500).json({ success: false, message: "Failed to mark subscription as paid", error: err.message });
  }
}

// POST /api/admin/users/:userId/suspend - Suspend user (remove from group)
export async function suspendUser(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  try {
    // Get user info
    const [userRows]: any = await db.query(
      `SELECT * FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (!userRows?.[0]) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = userRows[0];

    // Mark telegram access as removed
    await db.query(
      `UPDATE telegram_access 
       SET removed_at = NOW() 
       WHERE user_id = ? AND removed_at IS NULL`,
      [userId]
    );

    // If user has telegram_user_id, try to remove them from group
    if (user.telegram_user_id) {
      try {
        const { env } = await import("../../config/env");
        await bot.telegram.banChatMember(env.telegram.groupChatId, user.telegram_user_id);
        // Unban immediately so they can be re-added later
        await bot.telegram.unbanChatMember(env.telegram.groupChatId, user.telegram_user_id, { only_if_banned: true });
      } catch (err: any) {
        console.error("Failed to remove user from Telegram group:", err);
        // Continue even if Telegram removal fails
      }
    }

    await logAdminAction(userId, "USER_SUSPENDED", req.body.reason || "Suspended by admin", {
      telegramUserId: user.telegram_user_id,
    });

    return res.json({
      success: true,
      message: "User suspended successfully",
      user: {
        id: userId,
        telegramAccessRemoved: true,
      },
    });
  } catch (err: any) {
    console.error("suspendUser error:", err);
    return res.status(500).json({ success: false, message: "Failed to suspend user", error: err.message });
  }
}

// POST /api/admin/users/:userId/unsuspend - Unsuspend user (restore access)
export async function unsuspendUser(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  try {
    // Get user info
    const [userRows]: any = await db.query(
      `SELECT * FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (!userRows?.[0]) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Restore telegram access
    await db.query(
      `UPDATE telegram_access 
       SET removed_at = NULL, last_verified_at = NOW() 
       WHERE user_id = ?`,
      [userId]
    );

    await logAdminAction(userId, "USER_UNSUSPENDED", req.body.reason || "Unsuspended by admin", {});

    return res.json({
      success: true,
      message: "User unsuspended successfully",
      user: {
        id: userId,
        telegramAccessRestored: true,
      },
    });
  } catch (err: any) {
    console.error("unsuspendUser error:", err);
    return res.status(500).json({ success: false, message: "Failed to unsuspend user", error: err.message });
  }
}

// GET /api/admin/users/:userId/details - Get detailed user information
export async function getUserDetails(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  try {
    // Get user
    const [userRows]: any = await db.query(
      `SELECT * FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (!userRows?.[0]) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Get all subscriptions
    const [subRows]: any = await db.query(
      `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC`,
      [userId]
    );

    // Get telegram access
    const [accessRows]: any = await db.query(
      `SELECT * FROM telegram_access WHERE user_id = ? ORDER BY id DESC`,
      [userId]
    );

    // Get audit log for this user
    const [auditRows]: any = await db.query(
      `SELECT * FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
      [userId]
    );

    return res.json({
      success: true,
      user: {
        ...userRows[0],
        subscriptions: subRows,
        telegramAccess: accessRows,
        auditLog: auditRows,
      },
    });
  } catch (err: any) {
    console.error("getUserDetails error:", err);
    return res.status(500).json({ success: false, message: "Failed to get user details", error: err.message });
  }
}

// POST /api/admin/subscriptions/:subscriptionId/extend - Extend subscription period
export async function extendSubscription(req: Request, res: Response) {
  const subscriptionId = Number(req.params.subscriptionId);
  const days = Number(req.body.days) || 30;

  if (!subscriptionId) {
    return res.status(400).json({ success: false, message: "Invalid subscription ID" });
  }

  if (days <= 0) {
    return res.status(400).json({ success: false, message: "Days must be a positive number" });
  }

  try {
    // Get subscription
    const [subRows]: any = await db.query(
      `SELECT * FROM subscriptions WHERE id = ? LIMIT 1`,
      [subscriptionId]
    );

    if (!subRows?.[0]) {
      return res.status(404).json({ success: false, message: "Subscription not found" });
    }

    const subscription = subRows[0];
    const currentEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end)
      : new Date();
    const newEnd = new Date(currentEnd);
    newEnd.setDate(newEnd.getDate() + days);

    // Update subscription
    await db.query(
      `UPDATE subscriptions 
       SET current_period_end = ?, status = 'ACTIVE', cancel_at_period_end = 0 
       WHERE id = ?`,
      [newEnd, subscriptionId]
    );

    await logAdminAction(subscription.user_id, "SUBSCRIPTION_EXTENDED", req.body.reason || "Extended by admin", {
      subscriptionId: subscriptionId,
      daysAdded: days,
      newEndDate: newEnd.toISOString(),
    });

    return res.json({
      success: true,
      message: `Subscription extended by ${days} days successfully`,
      subscription: {
        id: subscriptionId,
        current_period_end: newEnd.toISOString(),
        status: "ACTIVE",
      },
    });
  } catch (err: any) {
    console.error("extendSubscription error:", err);
    return res.status(500).json({ success: false, message: "Failed to extend subscription", error: err.message });
  }
}

// GET /api/admin/audit-log - Get audit log
export async function getAuditLog(req: Request, res: Response) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const action = req.query.action as string | undefined;

  try {
    let whereClause = "WHERE 1=1";
    let queryParams: any[] = [];

    if (userId) {
      whereClause += " AND user_id = ?";
      queryParams.push(userId);
    }

    if (action) {
      whereClause += " AND action = ?";
      queryParams.push(action);
    }

    // Get total count
    const [countRows]: any = await db.query(
      `SELECT COUNT(*) as total FROM audit_log ${whereClause}`,
      queryParams
    );
    const total = countRows?.[0]?.total || 0;

    // Get audit log entries
    const [rows]: any = await db.query(
      `SELECT * FROM audit_log ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return res.json({
      success: true,
      auditLog: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("getAuditLog error:", err);
    return res.status(500).json({ success: false, message: "Failed to get audit log", error: err.message });
  }
}


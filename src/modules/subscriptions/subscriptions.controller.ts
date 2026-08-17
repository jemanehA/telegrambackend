import { Request, Response } from "express";
import { db } from "../../config/db";
import { stripe } from "../billing/stripe.service";

// GET /api/subscriptions/:subscriptionId - Get subscription details
export async function getSubscription(req: Request, res: Response) {
  const subscriptionId = Number(req.params.subscriptionId);
  if (!subscriptionId) {
    return res.status(400).json({ success: false, message: "Invalid subscription ID" });
  }

  const [rows]: any = await db.query(
    `SELECT 
      s.*,
      u.telegram_user_id,
      u.email,
      u.phone
     FROM subscriptions s
     INNER JOIN users u ON s.user_id = u.id
     WHERE s.id = ? LIMIT 1`,
    [subscriptionId]
  );

  if (!rows?.[0]) {
    return res.status(404).json({ success: false, message: "Subscription not found" });
  }

  // Get Stripe subscription details if available
  let stripeSubscription = null;
  if (rows[0].stripe_subscription_id) {
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(rows[0].stripe_subscription_id);
    } catch (err) {
      console.error("Failed to fetch Stripe subscription:", err);
    }
  }

  return res.json({
    success: true,
    subscription: {
      ...rows[0],
      stripeDetails: stripeSubscription,
    },
  });
}

// GET /api/subscriptions/user/:userId - Get user's subscriptions
export async function getUserSubscriptions(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  const [rows]: any = await db.query(
    `SELECT * FROM subscriptions 
     WHERE user_id = ? 
     ORDER BY id DESC`,
    [userId]
  );

  return res.json({
    success: true,
    subscriptions: rows,
  });
}

// GET /api/subscriptions - List all subscriptions with filters
export async function listSubscriptions(req: Request, res: Response) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const status = req.query.status as string | undefined;
  const plan = req.query.plan as string | undefined;

  let whereClause = "WHERE 1=1";
  let queryParams: any[] = [];

  if (status) {
    whereClause += " AND status = ?";
    queryParams.push(status);
  }

  if (plan) {
    whereClause += " AND plan = ?";
    queryParams.push(plan);
  }

  // Get total count
  const [countRows]: any = await db.query(
    `SELECT COUNT(*) as total FROM subscriptions ${whereClause}`,
    queryParams
  );
  const total = countRows?.[0]?.total || 0;

  // Get subscriptions
  const [rows]: any = await db.query(
    `SELECT 
      s.*,
      u.telegram_user_id,
      u.email,
      u.phone
     FROM subscriptions s
     INNER JOIN users u ON s.user_id = u.id
     ${whereClause}
     ORDER BY s.id DESC
     LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset]
  );

  return res.json({
    success: true,
    subscriptions: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST /api/subscriptions/:subscriptionId/cancel - Cancel subscription
export async function cancelSubscription(req: Request, res: Response) {
  const subscriptionId = Number(req.params.subscriptionId);
  if (!subscriptionId) {
    return res.status(400).json({ success: false, message: "Invalid subscription ID" });
  }

  // Get subscription
  const [rows]: any = await db.query(
    `SELECT * FROM subscriptions WHERE id = ? LIMIT 1`,
    [subscriptionId]
  );

  if (!rows?.[0]) {
    return res.status(404).json({ success: false, message: "Subscription not found" });
  }

  const subscription = rows[0];

  // Cancel in Stripe if subscription ID exists
  if (subscription.stripe_subscription_id) {
    try {
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    } catch (err: any) {
      console.error("Failed to cancel Stripe subscription:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to cancel subscription in Stripe",
      });
    }
  }

  // Update in database
  await db.query(
    `UPDATE subscriptions 
     SET cancel_at_period_end = 1 
     WHERE id = ?`,
    [subscriptionId]
  );

  return res.json({
    success: true,
    message: "Subscription will be cancelled at the end of the current period",
  });
}

// GET /api/subscriptions/stats - Get subscription statistics
export async function getSubscriptionStats(req: Request, res: Response) {
  const [total]: any = await db.query(`SELECT COUNT(*) as total FROM subscriptions`);
  const [active]: any = await db.query(
    `SELECT COUNT(*) as total 
     FROM subscriptions 
     WHERE status = 'ACTIVE' AND current_period_end > NOW()`
  );
  const [pending]: any = await db.query(
    `SELECT COUNT(*) as total FROM subscriptions WHERE status = 'PENDING'`
  );
  const [canceled]: any = await db.query(
    `SELECT COUNT(*) as total FROM subscriptions WHERE status = 'CANCELED'`
  );
  const [expired]: any = await db.query(
    `SELECT COUNT(*) as total FROM subscriptions WHERE status = 'EXPIRED'`
  );
  const [byPlan]: any = await db.query(
    `SELECT plan, COUNT(*) as count 
     FROM subscriptions 
     GROUP BY plan`
  );

  return res.json({
    success: true,
    stats: {
      total: total[0]?.total || 0,
      active: active[0]?.total || 0,
      pending: pending[0]?.total || 0,
      canceled: canceled[0]?.total || 0,
      expired: expired[0]?.total || 0,
      byPlan: byPlan,
    },
  });
}


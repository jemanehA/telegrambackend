import { Request, Response } from "express";
import { db } from "../../config/db";
import { stripe } from "../billing/stripe.service";

// GET /api/payments/user/:userId - Get user's payment history
export async function getUserPayments(req: Request, res: Response) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  // Get user's Stripe customer ID
  const [subRows]: any = await db.query(
    `SELECT stripe_customer_id 
     FROM subscriptions 
     WHERE user_id = ? AND stripe_customer_id IS NOT NULL 
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  if (!subRows?.[0]?.stripe_customer_id) {
    return res.json({
      success: true,
      payments: [],
      message: "No payment history found",
    });
  }

  const customerId = subRows[0].stripe_customer_id;

  try {
    // Get invoices from Stripe
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 100,
    });

    // Get payment intents
    const paymentIntents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 100,
    });

    return res.json({
      success: true,
      payments: {
        invoices: invoices.data.map((inv) => ({
          id: inv.id,
          amount: inv.amount_paid,
          currency: inv.currency,
          status: inv.status,
          created: new Date(inv.created * 1000),
          paidAt: inv.status_transitions.paid_at
            ? new Date(inv.status_transitions.paid_at * 1000)
            : null,
          invoicePdf: inv.invoice_pdf,
          hostedInvoiceUrl: inv.hosted_invoice_url,
        })),
        paymentIntents: paymentIntents.data.map((pi) => ({
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
          status: pi.status,
          created: new Date(pi.created * 1000),
        })),
      },
    });
  } catch (err: any) {
    console.error("Failed to fetch payments:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
    });
  }
}

// GET /api/payments/stats - Get payment/revenue statistics
export async function getPaymentStats(req: Request, res: Response) {
  try {
    // Get all active subscriptions with their plans
    const [subs]: any = await db.query(
      `SELECT plan, COUNT(*) as count 
       FROM subscriptions 
       WHERE status = 'ACTIVE' AND current_period_end > NOW()
       GROUP BY plan`
    );

    // Calculate estimated monthly recurring revenue (MRR)
    let mrr = 0;
    subs.forEach((sub: any) => {
      if (sub.plan === "MONTHLY_20") mrr += sub.count * 20;
      else if (sub.plan === "MONTHLY_30") mrr += sub.count * 30;
      else if (sub.plan === "YEARLY_280") mrr += (sub.count * 280) / 12;
    });

    // Get total revenue from Stripe (last 30 days)
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const charges = await stripe.charges.list({
      created: { gte: thirtyDaysAgo },
      limit: 100,
    });

    const totalRevenue30Days = charges.data.reduce(
      (sum, charge) => sum + (charge.amount || 0),
      0
    );

    return res.json({
      success: true,
      stats: {
        monthlyRecurringRevenue: mrr,
        totalRevenueLast30Days: totalRevenue30Days / 100, // Convert from cents
        activeSubscriptions: subs.reduce((sum: number, sub: any) => sum + sub.count, 0),
        byPlan: subs,
      },
    });
  } catch (err: any) {
    console.error("Failed to fetch payment stats:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment statistics",
    });
  }
}

// GET /api/payments/invoice/:invoiceId - Get invoice details
export async function getInvoice(req: Request, res: Response) {
  const invoiceId = req.params.invoiceId;

  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);

    return res.json({
      success: true,
      invoice: {
        id: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status,
        created: new Date(invoice.created * 1000),
        paidAt: invoice.status_transitions.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : null,
        invoicePdf: invoice.invoice_pdf,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        customer: invoice.customer,
        subscription: invoice.subscription,
      },
    });
  } catch (err: any) {
    return res.status(404).json({
      success: false,
      message: "Invoice not found",
    });
  }
}


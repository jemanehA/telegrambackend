import dotenv from "dotenv";
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 4005),
  baseUrl: process.env.BASE_URL || "http://localhost:4005",

  db: {
    host: process.env.DB_HOST!,
    user: process.env.DB_USER!,
    pass: process.env.DB_PASS!,
    name: process.env.DB_NAME!,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    priceMonthly20: process.env.STRIPE_PRICE_ID_MONTHLY_30!,
    priceMonthly30: process.env.STRIPE_PRICE_ID_MONTHLY_30!,
    priceYearly280: process.env.STRIPE_PRICE_ID_YEARLY_280!,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    groupChatId: Number(process.env.TELEGRAM_GROUP_CHAT_ID!),
  },

  earlyAccessDeadline: process.env.EARLY_ACCESS_DEADLINE!,
};

# Crypto Pay Integration Setup Guide

## ✅ Implementation Complete!

The Crypto Pay API integration has been fully implemented. Follow these steps to complete the setup:

## Step 1: Add Environment Variables

Add these lines to your `.env` file:

```env
# Crypto Pay API Configuration
CRYPTO_PAY_API_TOKEN=510166:AAiIkpkOwKTSF3f4rmKTzyTcGhSCKoEs
CRYPTO_PAY_NETWORK=mainnet
# Optional: For testing
# CRYPTO_PAY_TESTNET_TOKEN=your_testnet_token_here
# CRYPTO_PAY_WEBHOOK_SECRET=your_webhook_secret_here
```

## Step 2: Run Database Migration

Execute the SQL migration to create the `crypto_payments` table:

```bash
mysql -u YOUR_DB_USER -p YOUR_DB_NAME < crypto_payments_schema.sql
```

Or manually run the SQL from `crypto_payments_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS crypto_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  invoice_id BIGINT UNIQUE,
  plan VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  asset VARCHAR(10) NOT NULL DEFAULT 'USDT',
  status ENUM('PENDING', 'PAID', 'EXPIRED', 'CANCELLED') DEFAULT 'PENDING',
  invoice_hash VARCHAR(255),
  pay_url TEXT,
  payload VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_invoice_id (invoice_id),
  INDEX idx_status (status),
  INDEX idx_user_id (user_id),
  INDEX idx_telegram_user_id (telegram_user_id)
);
```

## Step 3: Restart Your Application

After adding the environment variables and running the migration, restart your bot:

```bash
# If using Docker
docker-compose restart telegrambackend-bot

# Or if running directly
npm run bot
```

## How It Works

1. **User selects Crypto Payment**: When a user clicks "₿ Crypto" payment option
2. **Invoice Creation**: Bot creates a Crypto Pay invoice via Telegram's API
3. **Payment Link**: User receives a payment link they can click
4. **Payment Processing**: User pays via Telegram Wallet (USDT TRC20)
5. **Status Check**: User can click "Check Payment Status" to verify
6. **Auto-Activation**: When payment is confirmed, subscription is activated automatically
7. **Invite Link**: User receives invite link to premium group

## Payment Flow

```
User → Select Plan → Choose Crypto Payment → 
Bot Creates Invoice → User Pays via Telegram → 
User Clicks "Check Status" → Bot Verifies Payment → 
Subscription Activated → Invite Link Sent
```

## Features

✅ **USDT TRC20 Support** - Accepts USDT on TRON network
✅ **Automatic Verification** - Checks payment status on demand
✅ **Invoice Expiration** - Invoices expire after 1 hour
✅ **Database Tracking** - All payments tracked in `crypto_payments` table
✅ **Auto-Activation** - Subscriptions activated automatically on payment
✅ **Invite Link Generation** - Automatic invite link generation after payment

## Testing

1. Start with a test user
2. Select a subscription plan
3. Choose "₿ Crypto" payment
4. You'll receive a payment invoice link
5. Complete payment via Telegram Wallet
6. Click "Check Payment Status" to verify
7. Subscription should activate automatically

## Troubleshooting

### Issue: "Failed to create payment invoice"
- **Solution**: Check that `CRYPTO_PAY_API_TOKEN` is set correctly in `.env`
- Verify the token is valid by checking @CryptoBot

### Issue: "Invoice Not Found"
- **Solution**: Invoice may have expired (1 hour limit)
- Create a new payment invoice

### Issue: Payment not activating
- **Solution**: Click "Check Payment Status" button
- The bot will verify and activate if payment is confirmed

## API Token Security

⚠️ **Important**: Keep your API token secure!
- Never commit `.env` file to version control
- Use environment variables in production
- Rotate tokens if compromised

## Support

For Crypto Pay API issues, refer to:
- [Crypto Pay API Documentation](https://crypto-pay.pages.dev/)
- [@CryptoBot](https://t.me/CryptoBot) on Telegram


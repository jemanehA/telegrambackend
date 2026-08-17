import got from 'got';
import { ApiClient, Network, GotHttpClient } from '@crypto-pay/sdk';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

const httpClient = new GotHttpClient({ got });

const client = new ApiClient({
  appToken: env.cryptoPay.network === 'testnet' 
    ? env.cryptoPay.testnetToken 
    : env.cryptoPay.apiToken,
  httpClient,
  network: env.cryptoPay.network === 'testnet' ? Network.Testnet : Network.Mainnet,
});

export interface CreateInvoiceParams {
  asset: 'USDT' | 'TRX' | 'BTC' | 'ETH' | 'TON';
  amount: string; // Amount as string (e.g., "10.00")
  description?: string;
  // SDK expects values like: 'viewItem' | 'openChannel' | 'openBot' | 'callback'
  paidBtnName?: 'viewItem' | 'openChannel' | 'openBot' | 'callback';
  paidBtnUrl?: string;
  payload?: string; // Custom data to identify payment
  allowComments?: boolean;
  allowAnonymous?: boolean;
}

export interface Invoice {
  invoiceId: number;
  hash: string;
  asset: string;
  amount: any;
  payUrl: string;
  status: 'active' | 'paid';
  description?: string;
  createdAt?: Date;
  paidAt?: Date;
  allowComments?: boolean;
  allowAnonymous?: boolean;
  paidBtnName?: string;
  paidBtnUrl?: string;
  payload?: any;
}

/**
 * Create a payment invoice
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  try {
    logger.info(`📝 Creating crypto invoice: ${JSON.stringify(params)}`);

    // IMPORTANT: @crypto-pay/sdk expects camelCase params here (it converts to snake_case internally).
    // Also, paidBtnUrl is forbidden unless paidBtnName is set.
    const invoiceParams: any = {
      asset: params.asset,
      amount: params.amount,
      description: params.description,
      payload: params.payload,
      allowComments: params.allowComments,
      allowAnonymous: params.allowAnonymous,
    };

    if (params.paidBtnName && params.paidBtnUrl) {
      invoiceParams.paidBtnName = params.paidBtnName;
      invoiceParams.paidBtnUrl = params.paidBtnUrl;
    }

    const invoice = await client.createInvoice(invoiceParams);

    logger.info(`✅ Invoice created: ${invoice.invoiceId}, URL: ${invoice.payUrl}`);
    return invoice as Invoice;
  } catch (err: any) {
    logger.error(`❌ Failed to create crypto invoice:`, err.message);
    throw err;
  }
}

/**
 * Get invoice status
 */
export async function getInvoice(invoiceId: number): Promise<Invoice | null> {
  try {
    const invoices = await client.getInvoices({
      invoiceIds: [invoiceId],
    } as any);

    if (invoices.items && invoices.items.length > 0) {
      return invoices.items[0] as Invoice;
    }
    return null;
  } catch (err: any) {
    logger.error(`❌ Failed to get invoice ${invoiceId}:`, err.message);
    return null;
  }
}

/**
 * Get exchange rates (to convert USD to USDT)
 */
export async function getExchangeRates(): Promise<any> {
  try {
    const rates = await client.getExchangeRates();
    return rates;
  } catch (err: any) {
    logger.error(`❌ Failed to get exchange rates:`, err.message);
    throw err;
  }
}

export { client };


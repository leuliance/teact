import { useState, useCallback, useRef } from 'react';
import { useBot } from './context';
import { useOn } from './event-hooks';

/** A price entry for a Telegram payment invoice. */
export interface LabeledPrice {
  label: string;
  /** Price in the smallest currency unit (e.g. cents for USD: 499 = $4.99). */
  amount: number;
}

/**
 * Configuration for {@link useInvoice}.
 *
 * Maps 1-to-1 with Telegram's `sendInvoice` parameters.
 * The `providerToken` is the secret token you get from BotFather
 * after linking a payment provider.
 *
 * @example
 * ```ts
 * useInvoice({
 *   title: 'Premium Plan',
 *   description: 'Monthly subscription',
 *   payload: 'premium-v1',
 *   providerToken: process.env.CHAPA_PROVIDER_TOKEN!,
 *   currency: 'ETB',
 *   prices: [{ label: 'Premium', amount: 10000 }],
 *   photoUrl: 'https://example.com/product.png',
 *   photoWidth: 512,
 *   photoHeight: 512,
 *   needName: true,
 *   needEmail: true,
 * });
 * ```
 */
export interface InvoiceConfig {
  title: string;
  description: string;
  /** Bot-defined payload for tracking (1-128 bytes, not shown to users). */
  payload: string;
  /** Payment provider token from BotFather. */
  providerToken: string;
  /** Three-letter ISO 4217 currency code (e.g. "USD", "ETB"). */
  currency: string;
  prices: LabeledPrice[];
  /** URL of the product photo for the invoice. */
  photoUrl?: string;
  /** Photo width in pixels. */
  photoWidth?: number;
  /** Photo height in pixels. */
  photoHeight?: number;
  /** Photo size in bytes. */
  photoSize?: number;
  /** Request the user's full name. */
  needName?: boolean;
  /** Request the user's phone number. */
  needPhoneNumber?: boolean;
  /** Request the user's email address. */
  needEmail?: boolean;
  /** Request the user's shipping address. */
  needShippingAddress?: boolean;
  /** Pass the user's phone number to the payment provider. */
  sendPhoneNumberToProvider?: boolean;
  /** Pass the user's email to the payment provider. */
  sendEmailToProvider?: boolean;
  /** True if the final price depends on the shipping method. */
  isFlexible?: boolean;
  /** Maximum accepted tip amount in the smallest currency unit. */
  maxTipAmount?: number;
  /** Suggested tip amounts (max 4 values). */
  suggestedTipAmounts?: number[];
  /** Deep-linking parameter for the invoice link. */
  startParameter?: string;
  /** JSON-serialized data about the invoice for the payment provider. */
  providerData?: string;
  /** Protect the content of the invoice message from forwarding/saving. */
  protectContent?: boolean;
}

/** Data received after a successful Telegram payment. */
export interface SuccessfulPayment {
  currency: string;
  totalAmount: number;
  invoicePayload: string;
  telegramPaymentChargeId: string;
  providerPaymentChargeId: string;
  orderInfo?: any;
}

/** Return value of {@link useInvoice} with send action and payment state. */
export interface InvoiceResult {
  /** Send the invoice to the current chat. */
  send: () => Promise<void>;
  /** Current payment status. */
  status: 'idle' | 'pending' | 'success' | 'failed';
  /** Populated after successful payment. */
  receipt: SuccessfulPayment | null;
  /** Error message when status is 'failed'. */
  error: string | null;
}

/**
 * Hook for sending Telegram payment invoices.
 *
 * @example
 * ```tsx
 * const invoice = useInvoice({
 *   title: 'Premium',
 *   description: 'Unlock all features',
 *   payload: 'premium-v1',
 *   providerToken: process.env.PAYMENT_PROVIDER_TOKEN!,
 *   currency: 'USD',
 *   prices: [{ label: 'Premium', amount: 499 }],
 * });
 *
 * return (
 *   <Message text={invoice.status === 'success' ? '✅ Paid!' : '💎 Buy Premium'}>
 *     <InlineKeyboard>
 *       <ButtonRow>
 *         <Button text="💳 Pay $4.99" onClick={invoice.send} />
 *       </ButtonRow>
 *     </InlineKeyboard>
 *   </Message>
 * );
 * ```
 */
export function useInvoice(config: InvoiceConfig): InvoiceResult {
  const bot = useBot();
  const [status, setStatus] = useState<InvoiceResult['status']>('idle');
  const [receipt, setReceipt] = useState<SuccessfulPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useOn('successful_payment', (data) => {
    if (data?.invoice_payload === configRef.current.payload) {
      setStatus('success');
      setReceipt({
        currency: data.currency,
        totalAmount: data.total_amount,
        invoicePayload: data.invoice_payload,
        telegramPaymentChargeId: data.telegram_payment_charge_id,
        providerPaymentChargeId: data.provider_payment_charge_id,
        orderInfo: data.order_info,
      });
    }
  });

  const send = useCallback(async () => {
    const raw = bot.raw;
    if (!raw?.api) return;
    const c = configRef.current;
    if (!c.providerToken && c.currency !== 'XTR') {
      setStatus('failed');
      setError('Missing providerToken. Get one from @BotFather → Payments, or use currency "XTR" for Telegram Stars.');
      return;
    }
    setStatus('pending');
    try {
      const opts: Record<string, any> = {};
      if (c.providerToken) opts.provider_token = c.providerToken;
      if (c.photoUrl) opts.photo_url = c.photoUrl;
      if (c.photoWidth) opts.photo_width = c.photoWidth;
      if (c.photoHeight) opts.photo_height = c.photoHeight;
      if (c.photoSize) opts.photo_size = c.photoSize;
      if (c.needName) opts.need_name = true;
      if (c.needPhoneNumber) opts.need_phone_number = true;
      if (c.needEmail) opts.need_email = true;
      if (c.needShippingAddress) opts.need_shipping_address = true;
      if (c.sendPhoneNumberToProvider) opts.send_phone_number_to_provider = true;
      if (c.sendEmailToProvider) opts.send_email_to_provider = true;
      if (c.isFlexible) opts.is_flexible = true;
      if (c.maxTipAmount) opts.max_tip_amount = c.maxTipAmount;
      if (c.suggestedTipAmounts) opts.suggested_tip_amounts = c.suggestedTipAmounts;
      if (c.startParameter) opts.start_parameter = c.startParameter;
      if (c.providerData) opts.provider_data = c.providerData;
      if (c.protectContent) opts.protect_content = true;
      await raw.api.sendInvoice(
        Number(bot.chatId), c.title, c.description, c.payload,
        c.currency,
        c.prices.map(p => ({ label: p.label, amount: p.amount })),
        opts,
      );
    } catch (err: any) {
      const msg = err?.message ?? err?.description ?? String(err);
      setStatus('failed');
      setError(msg);
      console.error('[teact] Invoice send failed:', err);
    }
  }, [bot.chatId, bot.raw]);

  return { send, status, receipt, error };
}

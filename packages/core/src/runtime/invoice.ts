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
  /** Payment provider token from BotFather. Omit (or `''`) for Telegram Stars (`currency: 'XTR'`). */
  providerToken?: string;
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
  /**
   * Send the invoice to the current chat. Calls while an invoice is already being sent — or
   * was sent moments ago and is still unpaid (double taps) — are ignored; pass
   * `{ force: true }` to send a fresh one anyway.
   */
  send: (opts?: { force?: boolean }) => Promise<void>;
  /** Back to `'idle'`: clears error/receipt (e.g. a "Cancel" button after the user closed the invoice). */
  reset: () => void;
  /** Current payment status. */
  status: 'idle' | 'pending' | 'success' | 'failed';
  /** Populated after successful payment. */
  receipt: SuccessfulPayment | null;
  /** Error message when status is 'failed'. */
  error: string | null;
}

/** Window in which a repeated `send()` for a still-unpaid invoice is treated as a double tap. */
const RESEND_GUARD_MS = 15_000;

/**
 * Check an invoice against Telegram's rules before calling the API, so mistakes surface as a
 * clear `error` instead of an opaque 400. Returns an error message, or `null` when valid.
 */
export function validateInvoice(c: InvoiceConfig): string | null {
  const stars = c.currency === 'XTR';
  if (!c.title || !c.description) return 'Invoice needs a title and a description.';
  if (!c.currency || !/^[A-Z]{3}$/.test(c.currency)) return `Invalid currency "${c.currency}" — use a 3-letter ISO 4217 code or "XTR" for Stars.`;
  const bytes = new TextEncoder().encode(c.payload ?? '').length;
  if (bytes < 1 || bytes > 128) return `Invoice payload must be 1–128 bytes (got ${bytes}).`;
  if (!Array.isArray(c.prices) || c.prices.length === 0) return 'Invoice needs at least one price.';
  for (const p of c.prices) {
    if (!Number.isInteger(p.amount)) {
      return `Price "${p.label}" amount must be an integer in the smallest currency unit (e.g. 499 for $4.99), got ${p.amount}.`;
    }
  }
  const total = c.prices.reduce((sum, p) => sum + p.amount, 0);
  if (total <= 0) return `Invoice total must be positive (got ${total}).`;
  if (stars) {
    if (c.prices.length !== 1) return 'Telegram Stars (XTR) invoices must have exactly one price.';
    if (c.maxTipAmount || c.suggestedTipAmounts?.length) return 'Tips are not supported for Telegram Stars (XTR) invoices.';
  } else if (!c.providerToken) {
    return 'Missing providerToken. Get one from @BotFather → Payments, or use currency "XTR" for Telegram Stars.';
  }
  const tips = c.suggestedTipAmounts;
  if (tips?.length) {
    if (tips.length > 4) return 'At most 4 suggestedTipAmounts are allowed.';
    for (let i = 0; i < tips.length; i++) {
      if (!Number.isInteger(tips[i]) || tips[i] <= 0) return 'suggestedTipAmounts must be positive integers.';
      if (i > 0 && tips[i] <= tips[i - 1]) return 'suggestedTipAmounts must be in strictly increasing order.';
    }
    if (!c.maxTipAmount || tips[tips.length - 1] > c.maxTipAmount) return 'suggestedTipAmounts must not exceed maxTipAmount.';
  }
  return null;
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
      paidRef.current = true;
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

  const inFlight = useRef(false);
  const sentAt = useRef(0);
  const sentPayload = useRef<string | null>(null);
  const paidRef = useRef(false);

  const reset = useCallback(() => {
    sentAt.current = 0;
    paidRef.current = false;
    setStatus('idle');
    setError(null);
    setReceipt(null);
  }, []);

  const send = useCallback(async (opts?: { force?: boolean }) => {
    // Double taps / concurrent calls: one invoice per intent.
    if (inFlight.current) return;
    const api = bot.api;
    const c = configRef.current;
    // A repeat for the SAME unpaid invoice moments later is a double tap; a different
    // invoice (new payload) always goes out.
    if (
      !opts?.force && !paidRef.current && sentAt.current && sentPayload.current === c.payload &&
      Date.now() - sentAt.current < RESEND_GUARD_MS
    ) return;
    setReceipt(null);
    if (!api) {
      setStatus('failed');
      setError('No platform API available — useInvoice needs an adapter that provides one (e.g. TelegramAdapter).');
      return;
    }
    const invalid = validateInvoice(c);
    if (invalid) {
      setStatus('failed');
      setError(invalid);
      console.warn(`[teact] useInvoice: ${invalid}`);
      return;
    }
    inFlight.current = true;
    paidRef.current = false;
    setError(null);
    setStatus('pending');
    try {
      const opts: Record<string, any> = {
        chat_id: bot.chatId,
        title: c.title,
        description: c.description,
        payload: c.payload,
        currency: c.currency,
        prices: c.prices.map(p => ({ label: p.label, amount: p.amount })),
      };
      if (bot.threadId != null) opts.message_thread_id = bot.threadId;
      // Stars invoices must not carry a provider token.
      if (c.providerToken && c.currency !== 'XTR') opts.provider_token = c.providerToken;
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
      await api.call('sendInvoice', opts);
      sentAt.current = Date.now();
      sentPayload.current = c.payload;
    } catch (err: any) {
      const msg = err?.message ?? err?.description ?? String(err);
      sentAt.current = 0;
      setStatus('failed');
      setError(msg);
      console.error(`[teact] Invoice send failed: ${msg}`);
    } finally {
      inFlight.current = false;
    }
  }, [bot.chatId, bot.threadId, bot.api]);

  return { send, reset, status, receipt, error };
}

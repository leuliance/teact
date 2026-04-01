import { describe, test, expect } from 'bun:test';
import type { InvoiceConfig, InvoiceResult, LabeledPrice, SuccessfulPayment } from '../packages/runtime/src/invoice';

describe('InvoiceConfig interface', () => {
  test('has all required fields', () => {
    const config: InvoiceConfig = {
      title: 'Premium Plan',
      description: 'Unlock all features',
      payload: 'premium-v1',
      providerToken: 'tok_test_123',
      currency: 'USD',
      prices: [{ label: 'Premium', amount: 499 }],
    };

    expect(config.title).toBe('Premium Plan');
    expect(config.description).toBe('Unlock all features');
    expect(config.payload).toBe('premium-v1');
    expect(config.providerToken).toBe('tok_test_123');
    expect(config.currency).toBe('USD');
    expect(config.prices).toHaveLength(1);
  });

  test('supports optional photo fields', () => {
    const config: InvoiceConfig = {
      title: 'Item',
      description: 'An item',
      payload: 'item-1',
      providerToken: 'tok',
      currency: 'EUR',
      prices: [{ label: 'Item', amount: 100 }],
      photoUrl: 'https://example.com/photo.jpg',
      photoWidth: 640,
      photoHeight: 480,
    };

    expect(config.photoUrl).toBe('https://example.com/photo.jpg');
    expect(config.photoWidth).toBe(640);
    expect(config.photoHeight).toBe(480);
  });

  test('supports needName, needPhoneNumber, needEmail, needShippingAddress', () => {
    const config: InvoiceConfig = {
      title: 'Physical Item',
      description: 'Needs shipping',
      payload: 'phys-1',
      providerToken: 'tok',
      currency: 'USD',
      prices: [{ label: 'Item', amount: 2000 }],
      needName: true,
      needPhoneNumber: true,
      needEmail: true,
      needShippingAddress: true,
    };

    expect(config.needName).toBe(true);
    expect(config.needPhoneNumber).toBe(true);
    expect(config.needEmail).toBe(true);
    expect(config.needShippingAddress).toBe(true);
  });

  test('supports isFlexible and tip amounts', () => {
    const config: InvoiceConfig = {
      title: 'Donation',
      description: 'Support us',
      payload: 'donate-1',
      providerToken: 'tok',
      currency: 'USD',
      prices: [{ label: 'Donation', amount: 500 }],
      isFlexible: true,
      maxTipAmount: 10000,
      suggestedTipAmounts: [100, 200, 500, 1000],
    };

    expect(config.isFlexible).toBe(true);
    expect(config.maxTipAmount).toBe(10000);
    expect(config.suggestedTipAmounts).toEqual([100, 200, 500, 1000]);
  });

  test('supports startParameter', () => {
    const config: InvoiceConfig = {
      title: 'Sub',
      description: 'Monthly subscription',
      payload: 'sub-monthly',
      providerToken: 'tok',
      currency: 'USD',
      prices: [{ label: 'Monthly', amount: 999 }],
      startParameter: 'sub-link',
    };

    expect(config.startParameter).toBe('sub-link');
  });
});

describe('LabeledPrice interface', () => {
  test('has label and amount fields', () => {
    const price: LabeledPrice = { label: 'Base price', amount: 1000 };
    expect(price.label).toBe('Base price');
    expect(price.amount).toBe(1000);
  });

  test('amount is in smallest currency unit', () => {
    const price: LabeledPrice = { label: 'USD $4.99', amount: 499 };
    expect(price.amount).toBe(499);
  });
});

describe('InvoiceResult interface', () => {
  test('has send, status, receipt, error fields', () => {
    const result: InvoiceResult = {
      send: async () => {},
      status: 'idle',
      receipt: null,
      error: null,
    };

    expect(result.status).toBe('idle');
    expect(result.receipt).toBeNull();
    expect(result.error).toBeNull();
    expect(typeof result.send).toBe('function');
  });

  test('status can be pending', () => {
    const result: InvoiceResult = {
      send: async () => {},
      status: 'pending',
      receipt: null,
      error: null,
    };
    expect(result.status).toBe('pending');
  });

  test('status can be success with receipt', () => {
    const receipt: SuccessfulPayment = {
      currency: 'USD',
      totalAmount: 499,
      invoicePayload: 'premium-v1',
      telegramPaymentChargeId: 'ch_123',
      providerPaymentChargeId: 'prov_456',
    };
    const result: InvoiceResult = {
      send: async () => {},
      status: 'success',
      receipt,
      error: null,
    };
    expect(result.status).toBe('success');
    expect(result.receipt).toBeTruthy();
    expect(result.receipt!.currency).toBe('USD');
    expect(result.receipt!.totalAmount).toBe(499);
    expect(result.receipt!.telegramPaymentChargeId).toBe('ch_123');
  });

  test('status can be failed with error', () => {
    const result: InvoiceResult = {
      send: async () => {},
      status: 'failed',
      receipt: null,
      error: 'Payment provider rejected',
    };
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Payment provider rejected');
  });
});

describe('SuccessfulPayment interface', () => {
  test('has all required fields', () => {
    const payment: SuccessfulPayment = {
      currency: 'EUR',
      totalAmount: 1500,
      invoicePayload: 'order-42',
      telegramPaymentChargeId: 'tg_ch_789',
      providerPaymentChargeId: 'stripe_pi_abc',
    };

    expect(payment.currency).toBe('EUR');
    expect(payment.totalAmount).toBe(1500);
    expect(payment.invoicePayload).toBe('order-42');
    expect(payment.telegramPaymentChargeId).toBe('tg_ch_789');
    expect(payment.providerPaymentChargeId).toBe('stripe_pi_abc');
  });

  test('supports optional orderInfo', () => {
    const payment: SuccessfulPayment = {
      currency: 'USD',
      totalAmount: 999,
      invoicePayload: 'order-99',
      telegramPaymentChargeId: 'tg_1',
      providerPaymentChargeId: 'prov_1',
      orderInfo: { name: 'John Doe', email: 'john@example.com' },
    };

    expect(payment.orderInfo).toBeDefined();
    expect(payment.orderInfo.name).toBe('John Doe');
  });
});

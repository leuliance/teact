import { useNavigate, useInvoice } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow, Alert } from '@teactjs/ui';

export function StorePage() {
  const navigate = useNavigate();
  const invoice = useInvoice({
    title: 'Premium Access',
    description: 'Unlock all features for 30 days',
    payload: 'premium-30d',
    providerToken: process.env.PAYMENT_PROVIDER_TOKEN ?? '',
    currency: 'USD',
    prices: [{ label: 'Premium (30 days)', amount: 499 }],
  });

  if (invoice.status === 'success') {
    return (
      <Message text={`✅ Payment successful!\n\nCharge ID: ${invoice.receipt?.telegramPaymentChargeId}`}>
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
  }

  if (invoice.status === 'failed') {
    return (
      <>
        <Alert variant="error" title="Payment Failed">
          {invoice.error ?? 'Unknown error'}
        </Alert>
        <Message text="Please check your payment configuration.">
          <InlineKeyboard>
            <ButtonRow>
              <Button text="🔄 Retry" onClick={invoice.send} />
              <Button text="🏠 Menu" onClick={() => navigate('/')} />
            </ButtonRow>
          </InlineKeyboard>
        </Message>
      </>
    );
  }

  return (
    <Message text={`💎 Premium Access\n\nUnlock all features.\n💰 Price: $4.99${invoice.status === 'pending' ? '\n\n⏳ Processing...' : ''}`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="💳 Buy — $4.99" onClick={invoice.send} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

import { useNavigate, useInvoice } from '@teact/core';
import { Message, Button, InlineKeyboard, ButtonRow, Alert } from '@teact/ui';

export function StorePage() {
  const navigate = useNavigate();
  const invoice = useInvoice({
    title: 'Premium Pokedex',
    description: 'Unlock all 151 Pokemon details, stats, and exclusive features',
    payload: 'premium-pokedex-v1',
    providerToken: process.env.PAYMENT_PROVIDER_TOKEN ?? '',
    currency: 'USD',
    prices: [{ label: 'Premium Access', amount: 499 }],
    photoUrl: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',
    photoWidth: 475,
    photoHeight: 475,
    needEmail: true,
    sendEmailToProvider: true,
  });

  if (invoice.status === 'success') {
    return (
      <Message text={
        `✅ Payment successful!\n\n` +
        `Thank you for purchasing Premium Pokedex.\n` +
        `Charge ID: ${invoice.receipt?.telegramPaymentChargeId}`
      }>
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
          {invoice.error ?? 'An unknown error occurred.'}
        </Alert>
        <Message text="Please check your payment provider configuration and try again.">
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
    <Message text={
      `💎 Premium Pokedex\n\n` +
      `Unlock all Pokemon details and exclusive features.\n\n` +
      `💰 Price: $4.99\n\n` +
      `Tap below to purchase.` +
      (invoice.status === 'pending' ? '\n\n⏳ Processing...' : '')
    }>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="💳 Buy Premium ($4.99)" onClick={invoice.send} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

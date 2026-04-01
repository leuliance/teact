import { useState } from 'react';
import { useNavigate, useAuthSession } from '@teactjs/core';
import { Message, InlineKeyboard, ButtonRow, Button } from '@teactjs/ui';

export function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [loggingIn, setLoggingIn] = useState(false);

  if (loggingIn || auth.isAuthenticated) {
    return (
      <Message text={
        `✅ Logged in successfully!\n\n` +
        `Token: ${auth.accessToken}\n\n` +
        `You can now access guarded pages.`
      }>
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🔐 Go to Secret" onClick={() => navigate('/secret-login', { mode: 'push' })} />
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
  }

  return (
    <Message text={
      `🔑 Login Required\n\n` +
      `You need to log in to access the secret area.\n` +
      `Tap the button below to authenticate.`
    }>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="🔓 Log In" onClick={() => {
            auth.login({ accessToken: `tok_${Date.now()}` });
            setLoggingIn(true);
          }} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

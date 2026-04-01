import { useNavigate, useAuthSession } from '@teact/core';
import { Message, InlineKeyboard, ButtonRow, Button } from '@teact/ui';

export function SecretLoginPage() {
  const navigate = useNavigate();
  const auth = useAuthSession();

  return (
    <Message text={
      `🔐 Secret Area (Login Guard)\n\n` +
      `Welcome! You got here because the route guard\n` +
      `redirected you to /login first, and after logging in\n` +
      `you were sent back here.\n\n` +
      `Token: ${auth.accessToken}`
    }>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="🚪 Logout" onClick={() => {
            auth.logout();
            navigate('/');
          }} />
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

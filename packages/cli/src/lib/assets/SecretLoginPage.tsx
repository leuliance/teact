import { useNavigate, useAuthSession } from '@teactjs/core';
import { Message, InlineKeyboard, ButtonRow, Button } from '@teactjs/ui';

export function SecretLoginPage() {
  const navigate = useNavigate();
  const auth = useAuthSession();

  return (
    <Message text={
      `🔐 Secret Area (Login Guard)\n\n` +
      `Welcome! You got here because the route guard\n` +
      `let you through after login.\n\n` +
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

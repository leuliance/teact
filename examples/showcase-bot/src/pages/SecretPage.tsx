import { useNavigate, useAuthSession } from '@teact/core';
import { Message, InlineKeyboard, ButtonRow, Button } from '@teact/ui';

export function SecretPage() {
  const navigate = useNavigate();
  const auth = useAuthSession();

  return (
    <Message text={
      `🔐 Secret Area\n\n` +
      `Welcome, authenticated user!\n` +
      `This page is protected by a beforeLoad guard.\n\n` +
      `Token: ${auth.accessToken ?? 'n/a'}`
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

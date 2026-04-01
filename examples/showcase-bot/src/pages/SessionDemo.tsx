import { useNavigate, useAuthSession, useSession } from '@teactjs/core';
import { Message, InlineKeyboard, ButtonRow, Button } from '@teactjs/ui';

export function SessionDemo() {
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [session] = useSession();

  if (!auth.isAuthenticated) {
    return (
      <Message text={
        `🔓 Session Demo — Not Logged In\n\n` +
        `This page does NOT use a route guard.\n` +
        `Instead, it checks auth state inline and shows\n` +
        `different views based on the session.\n\n` +
        `Session: ${JSON.stringify(session, null, 2)}`
      }>
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🔑 Login" onClick={() => {
              auth.login({
                accessToken: `tok_${Date.now()}`,
                refreshToken: `ref_${Date.now()}`,
                expiresAt: Date.now() + 3600_000,
              });
            }} />
          </ButtonRow>
          <ButtonRow>
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
  }

  return (
    <Message text={
      `🔐 Session Demo — Logged In\n\n` +
      `You're authenticated! Here's your live session data:\n\n` +
      `🪪 Token: ${auth.accessToken}\n` +
      `🔄 Refresh: ${auth.refreshToken ?? 'none'}\n` +
      `⏰ Expires: ${auth.expiresAt ? new Date(auth.expiresAt).toLocaleString() : 'never'}\n\n` +
      `Full session:\n${JSON.stringify(session, null, 2)}`
    }>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="🔄 Refresh Token" onClick={() => {
            auth.setAccessToken(`tok_${Date.now()}`, Date.now() + 3600_000);
          }} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🚪 Logout" onClick={() => auth.logout()} />
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

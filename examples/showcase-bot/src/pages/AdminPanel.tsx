import { useNavigate, useAuth, useChatId } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function AdminPanel() {
  const navigate = useNavigate();
  const { isAdmin, is, userId, role } = useAuth();
  const chatId = useChatId();

  if (!is('admin')) {
    return (
      <Message text={`🔒 Access Denied\n\nThis area is for admins only.\n\nYour user ID: ${userId}\nAdd it to the admins list in teact.config.ts to get access.`}>
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
  }

  return (
    <Message text={`🛡️ Admin Panel\n\nUser ID: ${userId}\nRole: ${role}\nChat ID: ${chatId}\n\nYou have full admin access.`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="📊 Bot Stats" onClick={() => {}} />
          <Button text="👥 Manage Users" onClick={() => {}} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

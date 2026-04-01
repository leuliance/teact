import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';
import { useStorage } from '@teactjs/storage';

export function Settings() {
  const navigate = useNavigate();
  const [theme, setTheme] = useStorage('theme', 'light');
  const [pageSize, setPageSize] = useStorage('page_size', '5');
  const [notifications, setNotifications] = useStorage('notifications', 'on');

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');
  const toggleNotifications = () => setNotifications(notifications === 'on' ? 'off' : 'on');
  const cyclePageSize = () => {
    const sizes = ['3', '5', '10'];
    setPageSize(sizes[(sizes.indexOf(pageSize) + 1) % sizes.length]);
  };

  return (
    <Message text={`⚙️ Settings\n\n🎨 Theme: ${theme}\n📄 Page size: ${pageSize}\n🔔 Notifications: ${notifications}\n\nThese settings persist across bot restarts.`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text={theme === 'light' ? '🌙 Dark mode' : '☀️ Light mode'} onClick={toggleTheme} />
          <Button text={`📄 Page: ${pageSize}`} onClick={cyclePageSize} />
        </ButtonRow>
        <ButtonRow>
          <Button text={notifications === 'on' ? '🔕 Mute' : '🔔 Unmute'} onClick={toggleNotifications} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

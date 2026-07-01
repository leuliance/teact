import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard } from '@teactjs/ui';

/**
 * The hub. Shows off the new keyboard ergonomics:
 *  - `<InlineKeyboard columns={2}>` auto-grids buttons (no <ButtonRow> needed)
 *  - `<Button route="/x" />` navigates declaratively (no onClick handler)
 */
export function MainMenu() {
  const navigate = useNavigate();
  const randomId = Math.floor(Math.random() * 151) + 1;

  return (
    <Message
      text={
        '🤖 Teact Showcase\n\n' +
        'A full tour of the framework — built with React, running on Telegram.\n' +
        'Tap anything below. Start with 🤖 AI Assistant to see live streaming.'
      }
    >
      <InlineKeyboard columns={2}>
        {/* AI + data */}
        <Button text="🤖 AI Assistant" route="/ai" />
        <Button text="📋 Pokédex" route="/list" />
        <Button text="🎲 Random Pokémon" onClick={() => navigate(`/pokemon/${randomId}`)} />
        <Button text="🧪 Components" route="/showcase" />

        {/* Flows */}
        <Button text="🎮 Trainer Profile" route="/profile" />
        <Button text="🔢 Counter" route="/counter" />
        <Button text="💬 Feedback (convo)" route="/feedback" />
        <Button text="📝 Feedback (hook)" route="/feedback-hook" />

        {/* Platform features */}
        <Button text="⚙️ Settings" route="/settings" />
        <Button text="📋 Session" route="/session-demo" />
        <Button text="📱 Contact / events" route="/contact-demo" />
        <Button text="💎 Store (payments)" route="/store" />
        <Button text="🌐 Language (i18n)" route="/language" />
        <Button text="🛡️ Admin (roles)" route="/admin" />

        {/* Auth guards */}
        <Button text="🔐 Secret (redirect)" route="/secret" />
        <Button text="🔑 Secret (JSX guard)" route="/secret-login" />
        <Button text="🔒 Secret (reply guard)" route="/secret-reply" />
      </InlineKeyboard>
    </Message>
  );
}

import { useNavigate } from '@teact/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teact/ui';

export function MainMenu() {
  const navigate = useNavigate();

  return (
    <Message text="🤖 Welcome to Teact Showcase Bot!\n\nPick an option below:">
      <InlineKeyboard>
        <ButtonRow>
          <Button text="📋 Browse Pokedex" onClick={() => navigate('/list')} />
        </ButtonRow>
        <ButtonRow>
          <Button
            text="🎲 Random Pokemon"
            onClick={() => navigate(`/pokemon/${Math.floor(Math.random() * 151) + 1}`)}
          />
        </ButtonRow>
        <ButtonRow>
          <Button text="🎮 Trainer Profile" onClick={() => navigate('/profile')} />
          <Button text="⚙️ Settings" onClick={() => navigate('/settings')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="💬 Feedback" onClick={() => navigate('/feedback')} />
          <Button text="🔢 Counter" onClick={() => navigate('/counter')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="⚡ Stream Demo" onClick={() => navigate('/stream')} />
          <Button text="🛡️ Admin" onClick={() => navigate('/admin')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="💬 Feedback with hook" onClick={() => navigate('/feedback-hook')} />
          <Button text="🎥 Component Showcase" onClick={() => navigate('/showcase')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="📱 Contact Demo" onClick={() => navigate('/contact-demo')} />
          <Button text="💎 Store" onClick={() => navigate('/store')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🌐 Language" onClick={() => navigate('/language')} />
          <Button text="🔐 Secret (redirect)" onClick={() => navigate('/secret')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🔑 Secret (JSX)" onClick={() => navigate('/secret-login')} />
          <Button text="🔒 Secret (reply)" onClick={() => navigate('/secret-reply')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="📋 Session Demo" onClick={() => navigate('/session-demo')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

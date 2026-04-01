import { useState } from 'react';
import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function Counter() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  return (
    <Message text={`Count: ${count}`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="-1" onClick={() => setCount((c) => c - 1)} />
          <Button text={`[ ${count} ]`} onClick={() => {}} />
          <Button text="+1" onClick={() => setCount((c) => c + 1)} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

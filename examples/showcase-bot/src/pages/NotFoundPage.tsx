import { useNavigate, useRoute } from '@teact/core';
import { Message, InlineKeyboard, ButtonRow, Button, Alert } from '@teact/ui';

export function NotFoundPage() {
  const navigate = useNavigate();
  const { path } = useRoute();

  return (
    <>
      <Alert variant="warning" title="Page Not Found">
        {`The route "${path}" doesn't exist.`}
      </Alert>
      <Message text="Use the button below to go back to the main menu.">
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🏠 Go to Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    </>
  );
}

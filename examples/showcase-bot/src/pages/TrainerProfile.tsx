import { useForm, Form, useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';
import { z } from 'zod';

export function TrainerProfile() {
  const navigate = useNavigate();

  const form = useForm({
    name: {
      prompt: "What's your trainer name?",
      validate: z.string().min(2, 'Name must be at least 2 characters'),
    },
    email: {
      prompt: "What's your email address?",
      validate: z.email('Please enter a valid email address'),
    },
    region: {
      prompt: (d) => `Nice to meet you ${d.name}! Pick your region:`,
      options: [['🌿 Kanto', '🌊 Johto'], ['🔥 Hoenn', '⚡ Sinnoh']],
    },
    starter: {
      prompt: (d) => `Great choice, ${d.region}! Who's your favorite starter pokemon?`,
      validate: (v) => v.trim().length > 0 || 'Please enter a pokemon name',
    },
  });

  return (
    <Form value={form}>
      <Form.Complete>
        <Message text={`🎮 Trainer Profile\n\nName: ${form.data.name}\nEmail: ${form.data.email}\nRegion: ${form.data.region}\nStarter: ${form.data.starter}`}>
          <InlineKeyboard>
            <ButtonRow>
              <Button text="✏️ Edit Name" onClick={() => form.goTo('name')} />
              <Button text="✏️ Edit Region" onClick={() => form.goTo('region')} />
            </ButtonRow>
            <ButtonRow>
              <Button text="🔄 Start over" onClick={() => form.reset()} />
              <Button text="🏠 Menu" onClick={() => navigate('/')} />
            </ButtonRow>
          </InlineKeyboard>
        </Message>
      </Form.Complete>
    </Form>
  );
}

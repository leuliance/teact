import { useNavigate, useLocale } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function LanguagePage() {
  const navigate = useNavigate();
  const { t, locale, setLocale } = useLocale();

  return (
    <Message text={`🌐 ${t('lang.title')}\n\n${t('lang.current')}\n\n${t('lang.hint')}`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button
            text={locale === 'en' ? '✅ English' : '🇺🇸 English'}
            onClick={() => setLocale('en')}
          />
          <Button
            text={locale === 'am' ? '✅ አማርኛ' : '🇪🇹 አማርኛ'}
            onClick={() => setLocale('am')}
          />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

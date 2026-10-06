import React, { useContext, useLayoutEffect, useRef } from 'react';
import {
  useLocale,
  localeCallbackData,
  LOCALE_CALLBACK_PREFIX,
  RuntimeContext,
} from '@teactjs/core';
import { Message, InlineKeyboard, Button } from '@teactjs/ui';
import { getLocaleInfo, type LocaleInfo } from './metadata';
import { PACK_KEY } from './plugin';

/** Props for {@link LanguagePicker}. */
export interface LanguagePickerProps {
  /** Message text above the buttons. Default: the built-in `teact.selectLanguage` string. */
  title?: string;
  /** Buttons per row. Default `2`. */
  columns?: number;
  /** Restrict / order the locales shown. Default: every available locale. */
  locales?: string[];
  /** Called after the user picked a (different or same) locale. */
  onChange?: (locale: string) => void;
  /** Show flag emojis. Default `true`. */
  showFlags?: boolean;
  /** Prefix for the current locale's button. Default `'✓ '`. */
  currentMark?: string;
  /** Override names/flags per locale code, e.g. `{ sw: { flag: '🇹🇿' } }`. */
  labels?: Partial<Record<string, Partial<Omit<LocaleInfo, 'code'>>>>;
  /** Custom label builder; wins over `showFlags` / `labels`. */
  renderLabel?: (info: LocaleInfo, isCurrent: boolean) => string;
  /**
   * Render only the `<InlineKeyboard>` so you can put it inside your own `<Message>`.
   * Default `false` (renders a full `<Message>`).
   */
  keyboardOnly?: boolean;
}

/**
 * A ready-made language switcher: one inline button per available locale
 * (flag + native name), the current one marked with ✓.
 *
 * Buttons carry `__teact_locale:<code>` callback data that the i18n Provider handles itself,
 * so switching works even on serverless (no in-memory click handlers) and the choice is
 * persisted to the session.
 *
 * @example
 * <LanguagePicker columns={3} onChange={(l) => console.log('now', l)} />
 *
 * @example
 * // Inside your own message:
 * <Message text={t('settings.title')}>
 *   <LanguagePicker keyboardOnly />
 * </Message>
 */
export function LanguagePicker(props: LanguagePickerProps): React.ReactNode {
  const {
    title,
    columns = 2,
    locales,
    onChange,
    showFlags = true,
    currentMark = '✓ ',
    labels,
    renderLabel,
    keyboardOnly = false,
  } = props;
  const { t, locale, availableLocales } = useLocale();
  const rt = useContext(RuntimeContext);

  // Fire onChange once per update when this update is one of our callbacks.
  const firedFor = useRef<unknown>(null);
  const data = rt?.botCtx?.callbackData;
  useLayoutEffect(() => {
    if (!onChange || !rt || firedFor.current === rt) return;
    if (data?.startsWith(LOCALE_CALLBACK_PREFIX)) {
      firedFor.current = rt;
      onChange(locale);
    }
  });

  const shown = (locales ?? availableLocales).filter((l) => availableLocales.includes(l));
  const buttons = shown.map((code) => {
    const info = getLocaleInfo(code, labels);
    const isCurrent = code === locale;
    const text = renderLabel
      ? renderLabel(info, isCurrent)
      : `${isCurrent ? currentMark : ''}${showFlags ? `${info.flag} ` : ''}${info.nativeName}`;
    return React.createElement(Button, { key: code, text, onClick: localeCallbackData(code) });
  });

  const keyboard = React.createElement(InlineKeyboard, { columns }, ...buttons);
  if (keyboardOnly) return keyboard;

  const defaultTitle = t(`${PACK_KEY}.selectLanguage`, { defaultValue: 'Choose your language' });
  return React.createElement(Message, { text: title ?? defaultTitle }, keyboard);
}

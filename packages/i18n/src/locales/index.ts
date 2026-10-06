import { en } from './en';
import { am } from './am';
import { ar } from './ar';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { hi } from './hi';
import { id } from './id';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { nl } from './nl';
import { pl } from './pl';
import { pt } from './pt';
import { ru } from './ru';
import { sw } from './sw';
import { tr } from './tr';
import { uk } from './uk';
import { zh } from './zh';

export type { TeactMessages } from './en';
export { en, am, ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sw, tr, uk, zh };

/**
 * All built-in UI string packs keyed by locale code. Merged by `i18nPlugin` under the
 * `teact` key of each locale (`t('teact.cancel')`) without overriding your own keys.
 */
export const packs = { en, am, ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sw, tr, uk, zh } as const;

/** Locale codes that ship a built-in pack. */
export const packLocales = Object.keys(packs) as Array<keyof typeof packs>;

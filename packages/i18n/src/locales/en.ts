/**
 * Built-in English strings — the reference pack. Every other pack has exactly these keys.
 * Values use i18next interpolation (`{{page}}`).
 */
export const en = {
  yes: "Yes",
  no: "No",
  ok: "OK",
  back: "Back",
  next: "Next",
  previous: "Previous",
  cancel: "Cancel",
  done: "Done",
  confirm: "Confirm",
  close: "Close",
  save: "Save",
  edit: "Edit",
  delete: "Delete",
  skip: "Skip",
  loading: "Loading…",
  error: "Something went wrong.",
  tryAgain: "Try again",
  menu: "Menu",
  settings: "Settings",
  language: "Language",
  help: "Help",
  search: "Search",
  pageOf: "Page {{page}} of {{total}}",
  selectLanguage: "Choose your language",
  languageChanged: "Language changed to {{language}}.",
  noResults: "Nothing found.",
  areYouSure: "Are you sure?",
};

/** Shape of every built-in pack (the keys of {@link en}). */
export type TeactMessages = { [K in keyof typeof en]: string };

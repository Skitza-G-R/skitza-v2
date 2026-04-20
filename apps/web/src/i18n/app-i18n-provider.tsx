import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { isRtl } from "./config";

// Authenticated-app i18n wrapper.
//
// The root <html> is pinned to lang="en" / dir="ltr" so the landing
// page, public storefront, sign-in/up, and magic-link handler are
// never affected by the NEXT_LOCALE cookie. This helper is the single
// mount point that opts a route group INTO i18n: it resolves the
// active locale + messages, hands them to NextIntlClientProvider, and
// wraps the children in a `<div dir="…" lang="…">` so Tailwind's
// `rtl:` variants + CSS logical properties fire only inside the
// authenticated surfaces.
//
// Used by the (app), (artist), (artist-welcome), and (onboarding)
// route-group layouts. Keep the wrapper `<div>` lightweight — no
// styling beyond the dir/lang attributes — so consumers retain full
// control over their own chrome + backgrounds.
export async function AppI18nProvider({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const rtl = isRtl(locale);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div dir={rtl ? "rtl" : "ltr"} lang={locale} className="contents">
        {children}
      </div>
    </NextIntlClientProvider>
  );
}

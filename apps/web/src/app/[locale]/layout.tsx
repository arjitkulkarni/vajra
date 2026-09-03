import { notFound } from "next/navigation";
import { isLocale, LOCALES } from "@/i18n";
import { I18nProvider } from "@/lib/i18n-client";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div lang={locale}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </div>
  );
}

import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { getDictionary } from "@/lib/i18n";
import { dir, getLocale } from "@/lib/i18n/locale";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Afro Egypt | Factory Workforce",
  description: "نظام إدارة العمالة والحضور والرواتب — Afro Egypt Factory Workforce",
  icons: { icon: "/brand/afro-egypt-logo.jpg" },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const dictionary = getDictionary(locale);

  return (
    <html lang={locale} dir={dir(locale)} className={`${cairo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <LocaleProvider locale={locale} dictionary={dictionary}>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </LocaleProvider>
      </body>
    </html>
  );
}

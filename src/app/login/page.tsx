import Image from "next/image";
import { LoginForm } from "./login-form";
import { COMPANY } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { getDictionary } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";

export default async function LoginPage() {
  const locale = await getLocale();
  const t = getDictionary(locale);

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-950 p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, rgba(214,57,42,0.35), transparent 45%), radial-gradient(circle at 85% 80%, rgba(231,177,58,0.25), transparent 45%)",
          }}
        />
        <div className="relative z-10 flex items-center gap-2 text-sm text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
          {t.app.subtitle}
        </div>

        <div className="relative z-10 flex flex-col items-start gap-6">
          <div className="rounded-2xl bg-white p-6 shadow-elevated">
            <Image src={COMPANY.logo} alt="Afro Egypt" width={220} height={110} priority />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{t.app.productName}</h1>
            <p className="mt-2 max-w-sm text-white/70">{t.app.subtitle}</p>
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-1 text-xs text-white/50">
          <p>{t.app.poweredBy}</p>
          <p className="italic">{t.app.slogan}</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col items-center justify-center gap-8 bg-background p-6 sm:p-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex items-center justify-between">
            <div className="flex flex-col items-center gap-4 text-center lg:hidden">
              <Image src={COMPANY.logo} alt="Afro Egypt" width={160} height={80} priority />
            </div>
            <div className="ms-auto">
              <LanguageSwitcher variant="outline" />
            </div>
          </div>

          <div className="flex flex-col gap-2 text-center lg:text-start">
            <div className="flex items-center justify-center gap-2 lg:justify-start">
              <h2 className="text-2xl font-bold text-foreground">{t.login.heading}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {t.login.subDescription} {COMPANY.name}
            </p>
          </div>

          <LoginForm />

          <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground lg:hidden">
            <p>{t.app.poweredBy}</p>
            <p className="italic">{t.app.slogan}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

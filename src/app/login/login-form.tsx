"use client";

import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { loginAction, LoginState } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? t.login.submitting : t.login.submit}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);
  const t = useT();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {t.login.error}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t.login.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          placeholder="name@company.com"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t.login.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          placeholder="••••••••"
          required
        />
      </div>
      <SubmitButton />
    </form>
  );
}

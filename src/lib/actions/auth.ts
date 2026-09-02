"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, findCredential, setSessionCookie } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const credential = findCredential(email, password);
  if (!credential) {
    return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  }

  setSessionCookie(credential.user);
  redirect("/dashboard");
}

export async function logoutAction() {
  clearSessionCookie();
  redirect("/login");
}

// Tipos e helpers compartilhados entre Server e Client Components.
// Sem 'use client'/'server-only' — usado em ambos contextos.

export type TabKey = "dashboard" | "ton";

export function parseTab(v: string | null | undefined): TabKey {
  return v === "ton" ? "ton" : "dashboard";
}

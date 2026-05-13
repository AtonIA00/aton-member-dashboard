"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
};

type Props = {
  /** Params HMAC pra autenticar PATCH /api/me/theme. */
  hmac: HmacParams;
};

const STORAGE_KEY = "aton-theme";

function readDocumentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const v = document.documentElement.getAttribute("data-theme");
  return v === "dark" ? "dark" : "light";
}

function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // Safari/iframe pode bloquear storage de terceiros. Falha silenciosa —
    // o DB é o source of truth; o cache local é otimização.
  }
}

export function ThemeToggle({ hmac }: Props) {
  // Inicializa com o que o script anti-FOUC já aplicou no <html>.
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readDocumentTheme());
    setMounted(true);
  }, []);

  // Fetch silencioso pro DB confirmar/atualizar a preferência cacheada.
  // Roda 1x no mount. Se o DB tiver valor diferente do cache local, sincroniza.
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({
      workspace_id: hmac.workspace_id,
      user_id: hmac.user_id,
      timestamp: hmac.timestamp,
      signature: hmac.signature,
    }).toString();
    (async () => {
      try {
        const r = await fetch(`/api/me/theme?${qs}`);
        if (!r.ok) return;
        const j = (await r.json()) as { theme?: Theme };
        if (cancelled) return;
        if (j.theme === "light" || j.theme === "dark") {
          if (j.theme !== readDocumentTheme()) {
            applyTheme(j.theme);
            setTheme(j.theme);
          }
        }
      } catch {
        // Network/iframe storage falhou — mantém o tema do cache local.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hmac.workspace_id, hmac.user_id, hmac.timestamp, hmac.signature]);

  const toggle = useCallback(async () => {
    const prev = readDocumentTheme();
    const next: Theme = prev === "light" ? "dark" : "light";
    // Otimista: aplica antes da rede pra resposta instantânea ao clique.
    applyTheme(next);
    setTheme(next);

    try {
      const r = await fetch("/api/me/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: next,
          workspace_id: hmac.workspace_id,
          user_id: hmac.user_id,
          timestamp: hmac.timestamp,
          signature: hmac.signature,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      // Rollback se a persistência falhar — o cache local também volta.
      applyTheme(prev);
      setTheme(prev);
    }
  }, [hmac]);

  // Sem mount, evita mismatch de SSR (servidor não sabe o tema).
  const isDark = mounted && theme === "dark";
  const label = isDark ? "Mudar para tema claro" : "Mudar para tema escuro";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--aton-blue)]/30 hover:text-[color:var(--aton-blue)] hover:shadow-md active:translate-y-0"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

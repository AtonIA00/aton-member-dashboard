"use client";

// Error boundary do App Router. Captura exceptions não-tratadas no SSR ou
// no render do Client Component e mostra uma tela controlada em vez de
// deixar o iframe do Uchat exibir o fallback genérico "This page couldn't
// load". Sem isso, qualquer 5xx no servidor vira UX confusa pro assinante.
//
// O Next.js logga `error.digest` server-side automaticamente — usa esse
// digest pra cruzar com os logs do runner.

import { useEffect } from "react";
import { AtonLogo } from "@/components/brand/AtonLogo";

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Telemetria mínima — o digest aparece nos logs do servidor.
    console.error("[page-error]", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(220, 38, 38, 0.10) 0%, rgba(220, 38, 38, 0) 70%)",
        }}
      />

      <div className="relative w-full max-w-xl text-center">
        <div
          className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--card)]/80 backdrop-blur"
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[color:var(--destructive)]"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <h1 className="font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-tight tracking-tight text-[color:var(--foreground)] sm:text-4xl">
          Algo deu errado
        </h1>

        <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-[color:var(--muted-foreground)] sm:text-lg">
          Não conseguimos carregar o dashboard agora. Tente recarregar — se
          persistir, fale com o suporte:{" "}
          <a
            href="mailto:suporte@atonbot.cc"
            className="font-medium text-[color:var(--primary)] hover:underline"
          >
            suporte@atonbot.cc
          </a>
          .
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--primary)] px-5 py-2.5 font-[family-name:var(--font-montserrat)] text-sm font-bold tracking-wide text-[color:var(--primary-foreground)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--aton-blue-mid)] hover:shadow-md active:translate-y-0"
          >
            Tentar novamente
          </button>
        </div>

        {error.digest && (
          <div className="mt-6 font-mono text-[11px] text-[color:var(--muted-foreground)]/60">
            ref: {error.digest}
          </div>
        )}

        <div className="mt-12 flex flex-col items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
          <AtonLogo height={16} />
          <span className="font-mono">member-dashboard.aton-ia.com.br</span>
        </div>
      </div>
    </main>
  );
}

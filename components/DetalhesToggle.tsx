"use client";

import { useCallback, useState } from "react";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
};

/** Raiz do dash que carrega o atributo lido pelo CSS de <Detalhe>. */
export const DETALHES_ROOT_ID = "dash-root";

function aplicar(on: boolean): void {
  document.getElementById(DETALHES_ROOT_ID)?.setAttribute("data-detalhes", on ? "on" : "off");
}

/**
 * Liga e desliga as notas de apoio do dash inteiro de uma vez.
 *
 * O estado inicial vem do servidor (a página já nasce certa, sem piscar). O
 * clique é otimista, igual ao ThemeToggle: aplica na hora e persiste depois;
 * se a gravação falhar, volta.
 */
export function DetalhesToggle({ hmac, inicial }: { hmac: HmacParams; inicial: boolean }) {
  const [on, setOn] = useState(inicial);

  const toggle = useCallback(async () => {
    const prev = on;
    const next = !prev;
    aplicar(next);
    setOn(next);
    try {
      const r = await fetch("/api/me/detalhes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mostrarDetalhes: next, ...hmac }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      aplicar(prev);
      setOn(prev);
    }
  }, [on, hmac]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={on ? "Esconder as notas de apoio" : "Mostrar as notas de apoio"}
      className={
        "inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border px-3 text-[13px] font-medium transition-colors " +
        (on
          ? "border-[color:var(--aton-blue)]/40 bg-[color:var(--aton-blue)]/10 text-[color:var(--aton-blue)]"
          : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)] hover:border-[color:var(--aton-blue)]/30 hover:text-[color:var(--aton-blue)]")
      }
    >
      <span
        aria-hidden
        className={
          "relative inline-block h-3.5 w-6 rounded-full transition-colors " +
          (on ? "bg-[color:var(--aton-blue)]" : "bg-[color:var(--border)]")
        }
      >
        <span
          className={
            "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all " +
            (on ? "left-3" : "left-0.5")
          }
        />
      </span>
      Detalhes
    </button>
  );
}

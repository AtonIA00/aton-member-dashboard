"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Marcação em lote como "teste de implantação" (09/10/2026). Dois modos:
//   · "ate": todos os leads da workspace com data até o dia escolhido — é o
//     uso no fim da implantação, para zerar o dashboard;
//   · "ids": os leads selecionados na tabela.
// Sempre em dois passos: o servidor CONFERE (quantos vai marcar, quantos já
// estavam) e só grava depois do "Confirmar". A gravação refaz a contagem.

type HmacParams = { workspace_id: string; user_id: string; timestamp: string; signature: string };

type Resumo = {
  total: number;
  ja_marcados: number;
  a_marcar: number;
  ignorados: number;
  data_min: string | null;
  data_max: string | null;
  gravados: number;
  limite?: number;
  error?: string;
};

function dataBR(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

function ontemSP(): string {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const int = (n: number) => n.toLocaleString("pt-BR");

export function BulkTesteModal({
  modo,
  leadIds,
  hmac,
  onClose,
  onDone,
}: {
  modo: "ate" | "ids";
  leadIds?: number[];
  hmac: HmacParams;
  onClose: () => void;
  onDone: (gravados: number) => void;
}) {
  const [ate, setAte] = useState(ontemSP);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [busy, setBusy] = useState<null | "conferir" | "gravar">(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function chamar(confirmar: boolean): Promise<Resumo | null> {
    const res = await fetch("/api/leads/exclude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bulk_exclude",
        ...(modo === "ate" ? { ate } : { lead_ids: leadIds ?? [] }),
        confirmar,
        ...hmac,
      }),
    });
    const j = (await res.json().catch(() => null)) as Resumo | null;
    if (!res.ok) {
      if (j?.error === "too_many") {
        setResumo(j);
        setErro(
          `São ${int(j.a_marcar ?? 0)} leads novos, acima do limite de ${int(j.limite ?? 5000)} por vez. Escolha uma data mais antiga e marque em etapas.`,
        );
      } else {
        setErro("Não consegui concluir. Nada foi alterado se a contagem não mudou; tente de novo.");
      }
      return null;
    }
    return j;
  }

  async function conferir() {
    setBusy("conferir");
    setErro(null);
    setResumo(null);
    try {
      const r = await chamar(false);
      if (r) setResumo(r);
    } finally {
      setBusy(null);
    }
  }

  async function gravar() {
    setBusy("gravar");
    setErro(null);
    try {
      const r = await chamar(true);
      if (r) onDone(r.gravados);
    } finally {
      setBusy(null);
    }
  }

  // No modo seleção a conferência roda sozinha ao abrir.
  useEffect(() => {
    if (modo === "ids") void conferir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const podeGravar = !!resumo && resumo.a_marcar > 0 && !erro;

  // Portal no body: o cartão da tabela tem backdrop-blur, e backdrop-filter
  // vira o bloco de contenção do position:fixed (o modal ficava preso nele).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-teste-titulo"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)] p-5 shadow-xl">
        <h3
          id="bulk-teste-titulo"
          className="font-[family-name:var(--font-montserrat)] text-sm font-bold text-[color:var(--foreground)]"
        >
          {modo === "ate" ? "Marcar como teste até uma data" : "Marcar selecionados como teste"}
        </h3>
        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          Os leads marcados saem das métricas, dos gráficos, da lista e da exportação, aqui e no
          Core. Motivo registrado: <strong>teste de implantação</strong>. Dá para restaurar depois
          em “gerenciar”.
        </p>

        {modo === "ate" && (
          <div className="mt-4 flex items-end gap-2">
            <label className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              Todos os leads com data até
              <input
                type="date"
                value={ate}
                max={new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())}
                onChange={(e) => {
                  setAte(e.target.value);
                  setResumo(null);
                  setErro(null);
                }}
                className="mt-1 block w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-[color:var(--foreground)]"
              />
            </label>
            <button
              type="button"
              onClick={conferir}
              disabled={!ate || !!busy}
              className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] hover:border-[color:var(--primary)]/50 disabled:opacity-50"
            >
              {busy === "conferir" ? "Conferindo…" : "Conferir"}
            </button>
          </div>
        )}

        {modo === "ids" && busy === "conferir" && (
          <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">Conferindo…</p>
        )}

        {resumo && (
          <div className="mt-4 rounded-md bg-[color:var(--surface-2)] px-3 py-2.5 text-sm text-[color:var(--foreground)]">
            {resumo.total === 0 ? (
              <span>Nenhum lead desta workspace bate com o critério.</span>
            ) : (
              <>
                <div>
                  <strong className="text-base">{int(resumo.a_marcar)}</strong>{" "}
                  {resumo.a_marcar === 1 ? "lead será marcado" : "leads serão marcados"} como teste.
                </div>
                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  {int(resumo.total)} no critério, de {dataBR(resumo.data_min)} a{" "}
                  {dataBR(resumo.data_max)}
                  {resumo.ja_marcados > 0 &&
                    ` · ${int(resumo.ja_marcados)} já estavam marcados e ficam como estão`}
                  {resumo.ignorados > 0 && ` · ${int(resumo.ignorados)} não são desta workspace`}
                </div>
              </>
            )}
          </div>
        )}

        {erro && <p className="mt-3 text-xs text-[color:var(--destructive)]">{erro}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={gravar}
            disabled={!podeGravar || !!busy}
            className="rounded-md bg-[color:var(--destructive)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy === "gravar"
              ? "Marcando…"
              : resumo && resumo.a_marcar > 0
                ? `Confirmar: marcar ${int(resumo.a_marcar)}`
                : "Confirmar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

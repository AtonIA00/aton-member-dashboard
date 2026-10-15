"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TrisulAtendimento } from "@/lib/trisul";
import {
  DIRECIONADO_PARA_MAX,
  aguardaCoordenador,
  ehParceiro,
  simNaoLabel,
} from "@/lib/trisul-direcionamento";

type Props = {
  atendimento: TrisulAtendimento;
  resultadoLabel: string;
  busy: boolean;
  erro: string | null;
  onClose: () => void;
  onDirecionar: (direcionado: boolean, para: string) => void;
};

export function fmtDataHora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Painel lateral do parceiro: dados, resumo completo da conversa e a ação de
// direcionamento para o coordenador. Portal no body: o cartão da tabela tem
// backdrop-blur, que vira o bloco de contenção do position:fixed.
export function TrisulDetailPanel({ atendimento: a, resultadoLabel, busy, erro, onClose, onDirecionar }: Props) {
  const [para, setPara] = useState(a.direcionado_para ?? a.coordenador_nome ?? "");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const parceiro = ehParceiro(a);
  const direcionado = Boolean(a.direcionado_em);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trisul-detalhe-titulo"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-[color:var(--border)] bg-[color:var(--card)] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[color:var(--border)] px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
              Parceiro{a.partner_id != null ? ` · FAC ID ${a.partner_id}` : ""}
            </div>
            <h3
              id="trisul-detalhe-titulo"
              className="mt-1 truncate font-[family-name:var(--font-montserrat)] text-lg font-bold text-[color:var(--foreground)]"
            >
              {a.nome || "Sem nome"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
            className="rounded-md border border-[color:var(--border)] px-2.5 py-1 text-xs text-[color:var(--muted-foreground)] hover:border-[color:var(--primary)]/40 hover:text-[color:var(--foreground)] disabled:opacity-50"
          >
            Fechar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Item label="FAC ID" value={a.partner_id != null ? String(a.partner_id) : ""} mono />
            <Item label="Telefone" value={a.telefone ?? ""} mono />
            <Item label="E-mail" value={a.email ?? ""} span />
            <Item label="Coordenador base anterior" value={a.coordenador_nome ?? ""} />
            <Item label="Gerente base anterior" value={a.gerente_nome ?? ""} />
            <Item label="Resultado" value={resultadoLabel} />
            <Item label="É parceiro" value={simNaoLabel(parceiro)} />
            <Item label="Aguarda coordenador" value={aguardaCoordenador(a) ? "Sim" : ""} />
            <Item label="Campanha" value={a.campanha ?? ""} />
            <Item label="Disparo" value={fmtDataHora(a.disparo_at)} />
          </dl>

          <section className="mt-6 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)]/40 p-4">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
              Direcionado para coordenador
            </h4>
            {direcionado ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="flex-1 text-sm text-[color:var(--foreground)]">
                  Direcionado para <strong>{a.direcionado_para || "coordenador"}</strong> em{" "}
                  {fmtDataHora(a.direcionado_em)}
                  {a.direcionado_por ? <> por {a.direcionado_por}</> : null}
                </p>
                <button
                  type="button"
                  onClick={() => onDirecionar(false, "")}
                  disabled={busy}
                  className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] hover:border-[color:var(--destructive)]/50 hover:text-[color:var(--destructive)] disabled:opacity-50"
                >
                  {busy ? "Salvando…" : "Desfazer"}
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-[200px] flex-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  Direcionado para
                  <input
                    type="text"
                    value={para}
                    maxLength={DIRECIONADO_PARA_MAX}
                    onChange={(e) => setPara(e.target.value)}
                    placeholder="Nome do coordenador"
                    className="mt-1 block w-full rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-[color:var(--foreground)] outline-none focus:border-[color:var(--primary)]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onDirecionar(true, para)}
                  disabled={busy}
                  className="rounded-md bg-[color:var(--primary)] px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Salvando…" : "Marcar como direcionado"}
                </button>
              </div>
            )}
            {erro && <p className="mt-2 text-xs text-[color:var(--destructive)]">{erro}</p>}
          </section>

          <section className="mt-6">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
              Resumo da conversa
            </h4>
            {a.resumo_conversa?.trim() ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[color:var(--foreground)]">
                {a.resumo_conversa}
              </p>
            ) : (
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">Sem resumo registrado.</p>
            )}
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function Item({ label, value, mono, span }: { label: string; value: string; mono?: boolean; span?: boolean }) {
  return (
    <div className={span ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">{label}</dt>
      <dd className={"mt-0.5 break-words text-[color:var(--foreground)] " + (mono ? "font-mono text-xs" : "")}>
        {value || <span className="text-[color:var(--muted-foreground)]/60">—</span>}
      </dd>
    </div>
  );
}

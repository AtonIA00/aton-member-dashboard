"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RetornoComercial } from "@/lib/retorno-comercial/types";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
};

type Props = {
  /** Feature disponível (flag global). Se false, nem monta. */
  enabled: boolean;
  /** Estado inicial do toggle ocultar/mostrar (mostrar_retorno_comercial). */
  initialVisible: boolean;
  hmac: HmacParams;
};

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "ready"; data: RetornoComercial };

// Tempo de espera em MINUTOS ÚTEIS (Seg–Sáb 08–18). Pode ser grande — o
// Core manda coisas como 4992 (~8 dias úteis, quando um retorno atrasou
// muito). 1 dia útil = 10h = 600 min úteis. Régua: min → h → dias úteis.
function fmtEsperaUtil(min: number): string {
  if (!min || min <= 0) return "—";
  if (min < 60) return `${min}min`;
  if (min < 600) {
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
  }
  const dias = min / 600;
  return `${dias.toFixed(1).replace(".", ",")} d úteis`;
}

// Telefone vem com +55 (ex.: "+5527999844698"). Formata pro padrão BR
// legível; se não casar, mostra cru.
function fmtTelefone(raw: string | null): string {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  let ddd: string, num: string;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const r = d.slice(2);
    ddd = r.slice(0, 2);
    num = r.slice(2);
  } else if (d.length === 10 || d.length === 11) {
    ddd = d.slice(0, 2);
    num = d.slice(2);
  } else {
    return raw;
  }
  const mid =
    num.length === 9
      ? `${num.slice(0, 5)}-${num.slice(5)}`
      : num.length === 8
        ? `${num.slice(0, 4)}-${num.slice(4)}`
        : num;
  return `(${ddd}) ${mid}`;
}

// nome pode vir "" — cai pro telefone formatado, senão rótulo neutro.
function nomeDisplay(nome: string | null, telefone: string | null): string {
  const n = (nome ?? "").trim();
  if (n) return n;
  return telefone ? fmtTelefone(telefone) : "Lead sem nome";
}

export function RetornoComercialSection({ enabled, initialVisible, hmac }: Props) {
  const [visible, setVisible] = useState(initialVisible);
  const [state, setState] = useState<State>(
    enabled && initialVisible ? { kind: "loading" } : { kind: "hidden" },
  );
  const [showList, setShowList] = useState(false);
  const [toggling, setToggling] = useState(false);

  const hmacQS = useMemo(() => {
    const p = new URLSearchParams();
    p.set("workspace_id", hmac.workspace_id);
    p.set("user_id", hmac.user_id);
    p.set("timestamp", hmac.timestamp);
    p.set("signature", hmac.signature);
    return p.toString();
  }, [hmac]);

  useEffect(() => {
    // Só busca quando a feature está on E o assinante não ocultou a seção.
    if (!enabled || !visible) {
      setState({ kind: "hidden" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/retorno-comercial?${hmacQS}`);
        if (cancelled) return;
        if (res.status === 204 || !res.ok) {
          setState({ kind: "hidden" });
          return;
        }
        const data = (await res.json()) as RetornoComercial;
        if (cancelled) return;
        if (!data || data.agendados <= 0) {
          setState({ kind: "hidden" });
          return;
        }
        setState({ kind: "ready", data });
      } catch {
        if (!cancelled) setState({ kind: "hidden" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, visible, hmacQS]);

  // Persiste a preferência por workspace (optimista; mantém local se falhar).
  const setPref = useCallback(
    async (next: boolean) => {
      setVisible(next);
      setToggling(true);
      try {
        await fetch("/api/me/retorno-comercial", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visible: next,
            workspace_id: hmac.workspace_id,
            user_id: hmac.user_id,
            timestamp: hmac.timestamp,
            signature: hmac.signature,
          }),
        });
      } catch {
        /* persistência falhou — mantém o estado local nesta sessão */
      } finally {
        setToggling(false);
      }
    },
    [hmac],
  );

  if (!enabled) return null;

  // Oculto pelo assinante → stub discreto com "mostrar" (permite reaparecer).
  if (!visible) {
    return (
      <section aria-label="Retorno do time comercial" className="mt-10">
        <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[color:var(--border)] bg-[color:var(--card)]/40 px-5 py-2.5">
          <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--muted-foreground)]/40" />
          <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
            Retorno do time comercial
          </h2>
          <span className="text-[11px] text-[color:var(--muted-foreground)]/60">oculto</span>
          <button
            type="button"
            onClick={() => setPref(true)}
            disabled={toggling}
            className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--primary)] transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            <EyeIcon />
            mostrar
          </button>
        </div>
      </section>
    );
  }

  // Visível, mas sem dados acionáveis → não renderiza (nada a mostrar).
  if (state.kind === "hidden") return null;

  return (
    <section aria-label="Retorno do time comercial" className="mt-10">
      <div className="mb-4 flex items-center gap-2">
        <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]" />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Retorno do time comercial
        </h2>
        {state.kind === "ready" && (
          <span className="ml-2 text-[11px] text-[color:var(--muted-foreground)]/70">
            últimos {state.data.janela_dias} dias · via plataforma (Aton)
          </span>
        )}
        <button
          type="button"
          onClick={() => setPref(false)}
          disabled={toggling}
          title="Ocultar esta seção (pode reaparecer depois)"
          aria-label="Ocultar seção"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--muted-foreground)]/50 transition-colors hover:bg-[color:var(--surface-2)] hover:text-[color:var(--foreground)] disabled:opacity-50"
        >
          <EyeOffIcon />
        </button>
      </div>

      {state.kind === "loading" ? (
        <SkeletonRow />
      ) : (
        <ReadyView
          data={state.data}
          showList={showList}
          onToggleList={() => setShowList((v) => !v)}
        />
      )}
    </section>
  );
}

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function ReadyView({
  data,
  showList,
  onToggleList,
}: {
  data: RetornoComercial;
  showList: boolean;
  onToggleList: () => void;
}) {
  // Base "localizados" = quem tem conversa vinculada (exclui gap de dado).
  const localizados = data.retornados + data.aguardando;
  const pctRetornados = localizados > 0 ? Math.round((data.retornados / localizados) * 100) : null;
  const temAguardando = data.aguardando > 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
        {/* Herói acionável */}
        <button
          type="button"
          onClick={temAguardando ? onToggleList : undefined}
          aria-expanded={temAguardando ? showList : undefined}
          className={
            "group relative overflow-hidden rounded-[var(--radius-lg)] border p-5 text-left backdrop-blur transition-all duration-200 " +
            (temAguardando
              ? "cursor-pointer border-[color:var(--primary)]/40 bg-[color:var(--primary)]/8 hover:-translate-y-0.5 hover:border-[color:var(--primary)]/60 hover:shadow-md"
              : "border-[color:var(--border)] bg-[color:var(--card)]/70")
          }
        >
          <div
            aria-hidden
            className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[color:var(--primary)] to-transparent"
          />
          <div className="flex items-baseline gap-2">
            <span className="font-[family-name:var(--font-montserrat)] text-4xl font-bold leading-none text-[color:var(--foreground)]">
              {data.aguardando}
            </span>
            {temAguardando && (
              <span className="text-[11px] font-semibold text-[color:var(--primary)] opacity-0 transition-opacity group-hover:opacity-100">
                {showList ? "ocultar lista ▲" : "ver lista ▼"}
              </span>
            )}
          </div>
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            {temAguardando ? "Aguardando seu retorno" : "Tudo retornado 🎉"}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]/80">
            {temAguardando
              ? "Leads agendados que ainda não receberam mensagem do seu time pela plataforma. Toque para ver e agir."
              : "Todos os leads agendados na janela já receberam um retorno do time pela plataforma."}
          </p>
        </button>

        {/* Secundário: retornados */}
        <StatCard
          value={
            pctRetornados !== null ? `${data.retornados} (${pctRetornados}%)` : String(data.retornados)
          }
          label="Retornados pelo time"
          sub={
            data.nao_localizados > 0
              ? `${data.nao_localizados} sem conversa vinculada`
              : `de ${localizados} agendados`
          }
          accent="green"
        />

        {/* Secundário: tempo médio */}
        <StatCard
          value={fmtEsperaUtil(data.mediana_util_min)}
          label="Tempo médio de retorno"
          sub={`hora útil · meta ${data.sla_min}min`}
          accent="neutral"
        />
      </div>

      {/* Lista clicável dos que aguardam */}
      {showList && data.aguardando > 0 && (
        <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
          <div className="border-b border-[color:var(--border)] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
            Leads aguardando retorno
          </div>
          {data.lista_aguardando.length === 0 ? (
            <div className="px-5 py-4 text-xs text-[color:var(--muted-foreground)]">
              Lista indisponível no momento.
            </div>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-[color:var(--card)]">
                  <tr>
                    <ThMini>Nome</ThMini>
                    <ThMini>Telefone</ThMini>
                    <ThMini>Campanha</ThMini>
                    <ThMini>Agendou em</ThMini>
                  </tr>
                </thead>
                <tbody>
                  {data.lista_aguardando.map((l, i) => (
                    <tr
                      key={i}
                      className="border-t border-[color:var(--border)]/60 transition-colors hover:bg-[color:var(--primary)]/5"
                    >
                      <td className="px-4 py-2.5 text-sm font-medium text-[color:var(--foreground)]">
                        {nomeDisplay(l.nome, l.telefone)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-[color:var(--muted-foreground)]">
                        {fmtTelefone(l.telefone)}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-[color:var(--foreground)]/90">
                        {l.campanha ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[color:var(--muted-foreground)] tabular-nums">
                        {l.agendado_em ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]/70">
        Considera o retorno registrado <strong className="font-semibold">pela plataforma (Aton)</strong>.
        Horário comercial Seg–Sáb 08–18. Contatos feitos por outros canais não entram nesta conta.
      </p>
    </>
  );
}

function StatCard({
  value,
  label,
  sub,
  accent,
}: {
  value: string;
  label: string;
  sub?: string;
  accent: "green" | "neutral";
}) {
  const bar = accent === "green" ? "from-[#10b981]" : "from-[color:var(--muted-foreground)]";
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-5 backdrop-blur">
      <div
        aria-hidden
        className={`absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b ${bar} to-transparent opacity-80`}
      />
      <div className="font-[family-name:var(--font-montserrat)] text-3xl font-bold leading-none text-[color:var(--foreground)]">
        {value}
      </div>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      {sub && (
        <div className="mt-1.5 truncate text-[11px] text-[color:var(--muted-foreground)]/80">{sub}</div>
      )}
    </div>
  );
}

function ThMini({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]"
    >
      {children}
    </th>
  );
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[132px] animate-pulse rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/50"
        />
      ))}
    </div>
  );
}

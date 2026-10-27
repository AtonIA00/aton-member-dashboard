"use client";

import { useState } from "react";
import type { OutboundData, OutboundLinha, OutboundVisao } from "@/lib/outbound";
import { Detalhe } from "@/components/Detalhe";

// Funil de DISPARO ATIVO. Aparece só pra quem tem disparo — assinante de
// inbound não vê nada disto.
//
// "Avançaram" é o campo `convertido` da tabela, marcado pelo fluxo de
// atendimento em TRÊS rotas — agendado, falar humano, material avançado — sem
// registrar qual. É o handoff ao consultor.
//
// A ordem das peças é a ordem em que a operação perde gente:
//   base → conseguiu entregar → alguém respondeu → o atendimento avançou
// e, ao lado, o opt-out (tocou "Parar"): o risco de qualidade do número na
// Meta, que em base grande decide se a operação continua.
//
// 27/10/2026 (ativação da base da Lavvi): tabela por campanha (uma linha por
// hipótese de template, para escolher a vencedora), tabela por remessa (dia
// do disparo) e campanhas de teste fora por padrão, com opção de incluir.
// Texto visível ao cliente: sem travessão e sem tom negativo.

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}
function pct(v: number): string {
  return v.toFixed(1).replace(".", ",") + "%";
}
function horas(h: number | null): string {
  if (h === null) return "·";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h.toFixed(1).replace(".", ",")} h`;
}
function diaBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Opt-out a partir do qual a linha ganha destaque âmbar. Régua NOSSA, de
// partida (27/10/2026), não um limite publicado pela Meta: a Meta não
// divulga o corte que rebaixa a qualidade do número. Recalibrar com as
// primeiras remessas da Lavvi.
const OPTOUT_ATENCAO = 2;

export function OutboundSection({ data }: { data: OutboundData }) {
  const [comTestes, setComTestes] = useState(false);
  const v: OutboundVisao = comTestes && data.comTestes ? data.comTestes : data;
  const { base, falha, entregues, responderam, converteram, optout } = v;
  const falhaAlta = base > 0 && falha / base >= 0.1;
  const optoutAtencao = entregues > 0 && v.pctOptout >= OPTOUT_ATENCAO;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] px-6 py-4">
        <span aria-hidden className="h-4 w-1 rounded-full bg-[color:var(--primary)]" />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Disparo Ativo
        </h2>
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/70">
          {v.campanhas.length === 1 ? v.campanhas[0] : `${v.campanhas.length} campanhas`}
        </span>
        {data.testes > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={comTestes}
              onChange={(e) => setComTestes(e.target.checked)}
              className="h-3.5 w-3.5 accent-[color:var(--primary)]"
            />
            incluir testes ({int(data.testes)})
          </label>
        )}
      </div>

      {base === 0 ? (
        <p className="px-6 py-5 text-sm text-[color:var(--muted-foreground)]">
          Nenhum disparo neste período. Amplie o intervalo no seletor acima.
        </p>
      ) : (
        <>
          {/* Funil: cada card diz de que denominador ele fala. */}
          <div className="grid grid-cols-2 gap-px border-b border-[color:var(--border)] bg-[color:var(--border)]/40 sm:grid-cols-5">
            <Card label="Base disparada" value={int(base)} sub="contatos no período" />
            <Card
              label="Entregues"
              value={int(entregues)}
              sub={`${pct(v.pctEntrega)} da base`}
              tom={falhaAlta ? "alerta" : undefined}
            />
            <Card
              label="Responderam"
              value={int(responderam)}
              sub={`${pct(v.pctResposta)} dos entregues`}
              tom="destaque"
            />
            <Card
              label="Opt-out"
              value={int(optout)}
              sub={`${pct(v.pctOptout)} dos entregues`}
              tom={optoutAtencao ? "atencao" : "neutro"}
            />
            <Card
              label="Avançaram"
              value={int(converteram)}
              sub={`${pct(v.pctConversaoResp)} de quem respondeu`}
              tom="destaque"
            />
          </div>

          {optout > 0 && (
            <Detalhe
              className={
                "flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[color:var(--border)] px-6 py-3 text-xs " +
                (optoutAtencao
                  ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                  : "text-[color:var(--muted-foreground)]")
              }
            >
              <strong className="font-semibold">
                {int(optout)} {optout === 1 ? "contato pediu" : "contatos pediram"} para não
                receber mais mensagens
              </strong>
              <span>
                ({pct(v.pctOptout)} dos entregues). Acompanhar este número por campanha protege a
                qualidade do número na Meta
                {optoutAtencao ? `: acima de ${OPTOUT_ATENCAO}% vale revisar o template.` : "."}
              </span>
            </Detalhe>
          )}

          {falha > 0 && (
            <Detalhe
              className={
                "flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[color:var(--border)] px-6 py-3 text-xs " +
                (falhaAlta
                  ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                  : "text-[color:var(--muted-foreground)]")
              }
            >
              <strong className="font-semibold">
                {int(falha)} {falha === 1 ? "envio não chegou" : "envios não chegaram"} ao contato
              </strong>
              <span>
                ({pct(100 - v.pctEntrega)} da base). É uma questão de envio, que se ajusta na
                operação; por isso fica fora das taxas.
              </span>
            </Detalhe>
          )}

          <TabelaCampanhas linhas={v.porCampanha} />
          {v.porRemessa.length > 1 && <TabelaRemessas linhas={v.porRemessa} />}

          <div className="grid gap-px border-t border-[color:var(--border)] bg-[color:var(--border)]/40 sm:grid-cols-2">
            {/* Tempo de resposta */}
            <div className="bg-[color:var(--card)] px-6 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                Quando a pessoa responde
              </h3>
              {v.horasMediana === null ? (
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                  As respostas deste período aparecem aqui assim que chegarem.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-[color:var(--foreground)]">
                    <strong className="font-[family-name:var(--font-montserrat)] text-lg font-bold">
                      {pct(v.pctAte1h ?? 0)}
                    </strong>{" "}
                    respondem na primeira hora · mediana de {horas(v.horasMediana)}
                  </p>
                  {v.emVoo > 0 && (
                    <Detalhe as="p" className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                      {int(v.emVoo)} {v.emVoo === 1 ? "contato recebeu" : "contatos receberam"} há
                      menos de 24h: a taxa de resposta do período ainda pode subir.
                    </Detalhe>
                  )}
                </>
              )}
            </div>

            {/* Em qual mensagem respondeu */}
            <div className="bg-[color:var(--card)] px-6 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                Em qual mensagem respondeu
              </h3>
              {v.porTentativa.length === 0 ? (
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                  Este dado aparece aqui assim que as respostas forem registradas.
                </p>
              ) : (
                <>
                  <ul className="mt-2 space-y-1">
                    {v.porTentativa.map((t) => (
                      <li key={t.tentativa} className="flex items-baseline gap-2 text-sm">
                        <span className="text-[color:var(--muted-foreground)]">
                          {t.tentativa === 1 ? "1ª mensagem (abertura)" : `${t.tentativa}ª mensagem`}
                        </span>
                        <span className="h-px flex-1 border-b border-dashed border-[color:var(--border)]" />
                        <strong className="font-semibold">{int(t.n)}</strong>
                      </li>
                    ))}
                  </ul>
                  {v.tentativaCobertura < responderam && (
                    <Detalhe as="p" className="mt-2 text-[11px] text-[color:var(--muted-foreground)]/80">
                      Dado disponível para {int(v.tentativaCobertura)} dos {int(responderam)} que
                      responderam: o registro é recente e os demais seguem contando como resposta.
                    </Detalhe>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Esteira de retomada */}
          <div className="border-t border-[color:var(--border)] px-6 py-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              Esteira de retomada
            </h3>
            {!v.retomadaAtiva ? (
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                Os toques de retomada aparecem aqui assim que começarem a rodar.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-5 gap-px overflow-hidden rounded-[var(--radius-md)] bg-[color:var(--border)]/40">
                {v.retomada.map((t) => (
                  <div key={t.toque} className="bg-[color:var(--card)] px-2 py-2.5 text-center">
                    <div className="font-[family-name:var(--font-montserrat)] text-base font-bold">
                      {int(t.enviados)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      toque {t.toque}
                    </div>
                    <div className="mt-1 text-[11px] text-[color:var(--muted-foreground)]">
                      {int(t.responderam)} resp.
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Detalhe className="border-t border-[color:var(--border)] px-6 py-2 text-[10px] leading-relaxed text-[color:var(--muted-foreground)]/70">
            <strong className="font-semibold">Responderam</strong> = respondeu a pelo menos uma
            mensagem do disparo (conta só a primeira resposta).{" "}
            <strong className="font-semibold">Opt-out</strong> = tocou em “Parar”; recebeu a
            mensagem, então conta nos entregues.{" "}
            <strong className="font-semibold">Avançaram</strong> = o atendimento passou o contato
            ao consultor: agendou visita, pediu para falar com uma pessoa ou recebeu material
            avançado. Este número conta contatos do disparo; o{" "}
            <strong className="font-semibold">Convertido</strong> do funil abaixo conta leads pela
            etapa no CRM.
            <br />
            As taxas são sobre os <strong className="font-semibold">entregues</strong>, para que
            uma questão de envio não pareça resultado da mensagem. A remessa é o dia do disparo,
            no horário de Brasília. Campanhas que começam com “teste” ficam fora dos números,
            salvo quando “incluir testes” está marcado.
            {v.convertidoSemResposta > 0 && (
              <>
                {" "}
                {int(v.convertidoSemResposta)}{" "}
                {v.convertidoSemResposta === 1
                  ? "contato avançou sem resposta registrada"
                  : "contatos avançaram sem resposta registrada"}
                : as duas marcações são gravadas por caminhos diferentes.
              </>
            )}
          </Detalhe>
        </>
      )}
    </div>
  );
}

// ── Tabelas ────────────────────────────────────────────────────────────────

const thBase =
  "whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]";
const th = thBase + " text-right";
const thL = thBase + " text-left";
const td = "whitespace-nowrap px-3 py-2 text-right tabular-nums";

function NumPct({ n, p }: { n: number; p: number }) {
  return (
    <>
      {int(n)}{" "}
      <span className="text-[11px] text-[color:var(--muted-foreground)]">{pct(p)}</span>
    </>
  );
}

function TabelaCampanhas({ linhas }: { linhas: OutboundLinha[] }) {
  if (linhas.length === 0) return null;
  // A melhor taxa de resposta e de avanço ganham destaque: é a leitura que a
  // tabela existe para facilitar (qual template venceu). Só com 2+ campanhas.
  const melhorResp = linhas.length > 1 ? Math.max(...linhas.map((l) => l.pctResposta)) : -1;
  const melhorConv = linhas.length > 1 ? Math.max(...linhas.map((l) => l.pctConversaoEntregue)) : -1;
  return (
    <div className="border-t border-[color:var(--border)] px-6 py-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
        Por campanha
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border)]">
              <th className={thL}>Campanha</th>
              <th className={th}>Base</th>
              <th className={th}>Entregues</th>
              <th className={th} title="Sobre os entregues">Respostas</th>
              <th className={th} title="Tocou em Parar, sobre os entregues">Opt-out</th>
              <th className={th} title="Handoff ao consultor, sobre os entregues">Avançaram</th>
              <th className={th} title="Avançaram sobre quem respondeu">% das respostas</th>
              <th className={th} title="Mediana do tempo até a 1ª resposta">1ª resposta</th>
              <th className={th} title="Respostas na 1ª, 2ª, 3ª, 4ª e 5ª mensagem">Resposta na msg 1 a 5</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-b border-[color:var(--border)]/60">
                <td className="max-w-[260px] truncate px-3 py-2 text-left text-[13px] font-medium" title={l.chave}>
                  {l.chave}
                </td>
                <td className={td}>{int(l.base)}</td>
                <td className={td}>
                  <NumPct n={l.entregues} p={l.pctEntrega} />
                </td>
                <td className={td + (l.pctResposta === melhorResp && l.responderam > 0 ? " font-semibold text-[color:var(--primary)]" : "")}>
                  <NumPct n={l.responderam} p={l.pctResposta} />
                </td>
                <td className={td + (l.pctOptout >= OPTOUT_ATENCAO ? " text-amber-700 dark:text-amber-300" : "")}>
                  <NumPct n={l.optout} p={l.pctOptout} />
                </td>
                <td className={td + (l.pctConversaoEntregue === melhorConv && l.converteram > 0 ? " font-semibold text-[color:var(--primary)]" : "")}>
                  <NumPct n={l.converteram} p={l.pctConversaoEntregue} />
                </td>
                <td className={td}>{l.responderam > 0 ? pct(l.pctConversaoResp) : "·"}</td>
                <td className={td}>{horas(l.horasMediana)}</td>
                <td className={td + " font-mono text-[12px] text-[color:var(--muted-foreground)]"}>
                  {l.porTentativa.join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabelaRemessas({ linhas }: { linhas: OutboundLinha[] }) {
  return (
    <div className="border-t border-[color:var(--border)] px-6 py-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
        Por remessa (dia do disparo)
      </h3>
      <div className="mt-2 max-h-[320px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-[color:var(--card)]">
            <tr className="border-b border-[color:var(--border)]">
              <th className={thL}>Dia</th>
              <th className={th}>Base</th>
              <th className={th}>Entregues</th>
              <th className={th}>Respostas</th>
              <th className={th}>Opt-out</th>
              <th className={th}>Avançaram</th>
              <th className={th}>1ª resposta</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-b border-[color:var(--border)]/60">
                <td className="whitespace-nowrap px-3 py-2 text-left text-[13px] font-medium tabular-nums">
                  {diaBR(l.chave)}
                  {l.emVoo > 0 && (
                    <span className="ml-2 rounded-full bg-[color:var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--primary)]">
                      em andamento
                    </span>
                  )}
                </td>
                <td className={td}>{int(l.base)}</td>
                <td className={td}>
                  <NumPct n={l.entregues} p={l.pctEntrega} />
                </td>
                <td className={td}>
                  <NumPct n={l.responderam} p={l.pctResposta} />
                </td>
                <td className={td + (l.pctOptout >= OPTOUT_ATENCAO ? " text-amber-700 dark:text-amber-300" : "")}>
                  <NumPct n={l.optout} p={l.pctOptout} />
                </td>
                <td className={td}>
                  <NumPct n={l.converteram} p={l.pctConversaoEntregue} />
                </td>
                <td className={td}>{horas(l.horasMediana)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  tom,
}: {
  label: string;
  value: string;
  sub: string;
  tom?: "destaque" | "alerta" | "atencao" | "neutro";
}) {
  return (
    <div className="bg-[color:var(--card)] px-5 py-3.5">
      <div
        className={
          "font-[family-name:var(--font-montserrat)] text-lg font-bold leading-none " +
          (tom === "alerta"
            ? "text-red-600 dark:text-red-400"
            : tom === "atencao"
              ? "text-amber-600 dark:text-amber-400"
              : "text-[color:var(--foreground)]")
        }
      >
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div
        className={
          "mt-0.5 text-[11px] " +
          (tom === "destaque"
            ? "font-semibold text-[color:var(--primary)]"
            : "text-[color:var(--muted-foreground)]/80")
        }
      >
        {sub}
      </div>
    </div>
  );
}

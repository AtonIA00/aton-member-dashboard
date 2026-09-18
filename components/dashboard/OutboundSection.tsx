import type { OutboundData } from "@/lib/outbound";

// Funil de DISPARO ATIVO. Aparece só pra quem tem disparo — assinante de
// inbound não vê nada disto.
//
// A ordem das peças é a ordem em que a operação perde gente:
//   base → conseguiu entregar → alguém respondeu → virou conversa
// A falha de envio vem PRIMEIRO e destacada porque é a única perda que não é
// desempenho de mensagem: é defeito operacional, e some se ninguém olhar
// (na Lavvi em 18/09: 162 de 602, 27% da base).

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}
function pct(v: number): string {
  return v.toFixed(1).replace(".", ",") + "%";
}

export function OutboundSection({ data }: { data: OutboundData }) {
  const { base, falha, entregues, responderam, converteram } = data;
  const falhaAlta = base > 0 && falha / base >= 0.1;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-6 py-4">
        <span aria-hidden className="h-4 w-1 rounded-full bg-[color:var(--primary)]" />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Disparo Ativo
        </h2>
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/70">
          {data.campanhas.length === 1
            ? data.campanhas[0]
            : `${data.campanhas.length} campanhas`}
        </span>
      </div>

      {base === 0 ? (
        <p className="px-6 py-5 text-sm text-[color:var(--muted-foreground)]">
          Nenhum disparo neste período. Amplie o intervalo no seletor acima.
        </p>
      ) : (
        <>
          {/* Funil: cada card diz de que denominador ele fala. */}
          <div className="grid grid-cols-2 gap-px border-b border-[color:var(--border)] bg-[color:var(--border)]/40 sm:grid-cols-4">
            <Card label="Base disparada" value={int(base)} sub="contatos na campanha" />
            <Card
              label="Entregues"
              value={int(entregues)}
              sub={`${pct(data.pctEntrega)} da base`}
              alerta={falhaAlta}
            />
            <Card
              label="Responderam"
              value={int(responderam)}
              sub={`${pct(data.pctResposta)} dos entregues`}
              destaque
            />
            <Card
              label="Viraram conversa"
              value={int(converteram)}
              sub={`${pct(data.pctConversaoResp)} de quem respondeu`}
              destaque
            />
          </div>

          {/* Falha de envio: a perda que não é da mensagem. */}
          {falha > 0 && (
            <div
              className={
                "flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[color:var(--border)] px-6 py-3 text-xs " +
                (falhaAlta
                  ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                  : "text-[color:var(--muted-foreground)]")
              }
            >
              <strong className="font-semibold">
                {int(falha)} {falha === 1 ? "contato não recebeu" : "contatos não receberam"} a
                mensagem
              </strong>
              <span>
                ({pct(100 - data.pctEntrega)} da base) — falha no envio, não na abordagem. É a
                única perda aqui que se resolve na operação, não no texto.
              </span>
            </div>
          )}

          <div className="grid gap-px bg-[color:var(--border)]/40 sm:grid-cols-2">
            {/* Tempo de resposta */}
            <div className="bg-[color:var(--card)] px-6 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                Quando a pessoa responde
              </h3>
              {data.horasMediana === null ? (
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                  Ninguém respondeu neste período ainda.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-[color:var(--foreground)]">
                    <strong className="font-[family-name:var(--font-montserrat)] text-lg font-bold">
                      {pct(data.pctAte1h ?? 0)}
                    </strong>{" "}
                    respondem na primeira hora · mediana de{" "}
                    {data.horasMediana < 1
                      ? `${Math.round(data.horasMediana * 60)} min`
                      : `${data.horasMediana.toFixed(1).replace(".", ",")} h`}
                  </p>
                  {data.emVoo > 0 && (
                    <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                      {int(data.emVoo)} {data.emVoo === 1 ? "contato saiu" : "contatos saíram"} há
                      menos de 24h — a taxa de resposta do período ainda pode subir.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Em qual mensagem respondeu */}
            <div className="bg-[color:var(--card)] px-6 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                Em qual mensagem respondeu
              </h3>
              {data.porTentativa.length === 0 ? (
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                  Ainda sem esse dado no período.
                </p>
              ) : (
                <>
                  <ul className="mt-2 space-y-1">
                    {data.porTentativa.map((t) => (
                      <li key={t.tentativa} className="flex items-baseline gap-2 text-sm">
                        <span className="text-[color:var(--muted-foreground)]">
                          {t.tentativa}ª mensagem
                        </span>
                        <span className="h-px flex-1 border-b border-dashed border-[color:var(--border)]" />
                        <strong className="font-semibold">{int(t.n)}</strong>
                      </li>
                    ))}
                  </ul>
                  {data.tentativaCobertura < responderam && (
                    <p className="mt-2 text-[11px] text-[color:var(--muted-foreground)]/80">
                      Dado disponível para {int(data.tentativaCobertura)} dos {int(responderam)} que
                      responderam — o registro é recente, e ausência aqui não quer dizer que não
                      responderam.
                    </p>
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
            {!data.retomadaAtiva ? (
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                A esteira ainda não registrou nenhum toque. Isso significa{" "}
                <strong className="font-semibold">sem dado</strong>, não desempenho zero — os
                follow-ups aparecem aqui assim que começarem a rodar.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-5 gap-px overflow-hidden rounded-[var(--radius-md)] bg-[color:var(--border)]/40">
                {data.retomada.map((t) => (
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

          <div className="border-t border-[color:var(--border)] px-6 py-2 text-[10px] leading-relaxed text-[color:var(--muted-foreground)]/70">
            Taxa de resposta e de conversa são sempre sobre os{" "}
            <strong className="font-semibold">entregues</strong>, nunca sobre a base — dividir pelo
            total faria uma falha de envio parecer mensagem ruim.
            {data.convertidoSemResposta > 0 && (
              <>
                {" "}
                {int(data.convertidoSemResposta)}{" "}
                {data.convertidoSemResposta === 1
                  ? "contato aparece como conversa sem ter resposta registrada"
                  : "contatos aparecem como conversa sem ter resposta registrada"}
                : a marcação de conversa e a de resposta são gravadas por caminhos diferentes, então
                um pode existir sem o outro.
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  destaque,
  alerta,
}: {
  label: string;
  value: string;
  sub: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="bg-[color:var(--card)] px-5 py-3.5">
      <div
        className={
          "font-[family-name:var(--font-montserrat)] text-lg font-bold leading-none " +
          (alerta ? "text-red-600 dark:text-red-400" : "text-[color:var(--foreground)]")
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
          (destaque
            ? "font-semibold text-[color:var(--primary)]"
            : "text-[color:var(--muted-foreground)]/80")
        }
      >
        {sub}
      </div>
    </div>
  );
}

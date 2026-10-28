import type { AtendimentoResumo } from "@/lib/atendimento-modo";
import { Detalhe } from "@/components/Detalhe";

// Bloco "Atendimento" (WDS, 28/10/2026): quantos leads chegaram por cada
// caminho e, para quem foi direto ao corretor, o que o CV diz. Fica acima dos
// KPIs, que nessa visão são só da Flávia. A tabela de custo por visita é
// exportada à parte e vai logo abaixo do funil.

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

function pct(a: number, b: number): string {
  return b > 0 ? ((a / b) * 100).toFixed(1).replace(".", ",") + "%" : "–";
}

function duracao(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(1).replace(".", ",")} h`;
  return `${(h / 24).toFixed(1).replace(".", ",")} dias`;
}

function dinheiro(v: number, moeda: string | null): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: moeda || "BRL", maximumFractionDigits: 2 });
}

function Titulo({ children }: { children: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]" />
      <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
        {children}
      </h2>
    </div>
  );
}

function Card({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-5 backdrop-blur">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
        {rotulo}
      </div>
      <div className="mt-2 font-[family-name:var(--font-montserrat)] text-3xl font-light text-[color:var(--foreground)]">
        {valor}
      </div>
      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{apoio}</div>
    </div>
  );
}

export function AtendimentoModoSection({ r }: { r: AtendimentoResumo }) {
  const mostraFlavia = r.filtro !== "direto";
  const mostraDireto = r.filtro !== "flavia";
  return (
    <section aria-label="Atendimento" className="mt-6">
      <Titulo>Atendimento</Titulo>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {r.filtro === undefined && (
          <Card rotulo="Chegaram" valor={int(r.chegaram)} apoio="leads no período" />
        )}
        {mostraFlavia && (
          <Card
            rotulo="Com a Flávia"
            valor={int(r.flavia)}
            apoio={r.filtro ? "fora do horário comercial" : `${pct(r.flavia, r.chegaram)} · fora do horário comercial`}
          />
        )}
        {mostraDireto && (
          <Card
            rotulo="Direto ao corretor"
            valor={int(r.direto)}
            apoio={r.filtro ? "no horário comercial" : `${pct(r.direto, r.chegaram)} · no horário comercial`}
          />
        )}
        {mostraDireto && r.cvDisponivel && (
          <Card
            rotulo="Diretos com corretor"
            valor={int(r.diretoComCorretor)}
            apoio={`de ${int(r.diretoNoCv)} entregues ao CV`}
          />
        )}
        {mostraDireto && r.cvDisponivel && (
          <Card
            rotulo="Até o corretor atender"
            valor={r.diretoMinAteCorretor == null ? "–" : duracao(r.diretoMinAteCorretor)}
            apoio={
              r.diretoComTempo
                ? `mediana de ${int(r.diretoComTempo)} ${r.diretoComTempo === 1 ? "lead" : "leads"} diretos`
                : "nenhum direto atendido ainda"
            }
          />
        )}
      </div>
      {!r.cvDisponivel && (
        <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
          O CV não respondeu agora. Corretor, visita e venda voltam a aparecer sozinhos quando ele responder.
        </p>
      )}
      <Detalhe>
        <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
          Fora do horário comercial (dias úteis 08h15 às 20h15; sábado, domingo e feriado 09h00 às 16h15) a
          Flávia conversa com o lead. No horário comercial o lead vai direto ao corretor no CV. Por isso
          interação, MQL e convertido logo abaixo contam só os leads da Flávia. O tempo até o corretor vai
          do envio ao CV até o primeiro atendimento registrado lá.
        </p>
      </Detalhe>
    </section>
  );
}

export function CustoPorVisitaTable({ r }: { r: AtendimentoResumo }) {
  if (!r.porAnuncio.length) return null;
  const tot = r.porAnuncio.reduce(
    (s, a) => ({
      gasto: s.gasto + (a.gasto ?? 0),
      leads: s.leads + a.leads,
      agendados: s.agendados + a.agendados,
      noCv: s.noCv + a.noCv,
      visitas: s.visitas + a.visitas,
      vendas: s.vendas + a.vendas,
    }),
    { gasto: 0, leads: 0, agendados: 0, noCv: 0, visitas: 0, vendas: 0 },
  );
  // Sem o CV as colunas dele somem: "–" em "No CV" lia como "ninguém chegou
  // ao CV". Agendadas vem do CRM e fica sempre.
  const cv = r.cvDisponivel;
  const th = "px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]";
  const td = "px-3 py-2 text-right tabular-nums";
  const custo = (v: number | null, vazio: string) =>
    v != null ? dinheiro(v, r.moeda) : <span className="font-normal text-[color:var(--muted-foreground)]">{vazio}</span>;
  return (
    <section
      aria-label="Custo por agendamento e visita"
      className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-6 backdrop-blur"
    >
      <Titulo>{cv ? "Custo por agendamento e visita, por anúncio" : "Custo por agendamento, por anúncio"}</Titulo>
      {!cv && (
        <p className="mb-3 text-xs text-[color:var(--muted-foreground)]">
          O CV não respondeu agora. No CV, visitas, vendas e custo por visita voltam a aparecer sozinhos quando ele
          responder.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className={`w-full text-sm ${cv ? "min-w-[900px]" : "min-w-[600px]"}`}>
          <thead>
            <tr className="border-b border-[color:var(--border)]">
              <th className={th.replace("text-right", "text-left")}>Anúncio</th>
              <th className={th}>Investimento</th>
              <th className={th}>Leads</th>
              <th className={th}>Agendadas</th>
              <th className={th}>Custo por agendamento</th>
              {cv && <th className={th}>No CV</th>}
              {cv && <th className={th}>Visitas</th>}
              {cv && <th className={th}>Vendas</th>}
              {cv && <th className={th}>Custo por visita</th>}
            </tr>
          </thead>
          <tbody>
            {r.porAnuncio.map((a) => (
              <tr key={a.idAnuncio} className="border-b border-[color:var(--border)]/60">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    {a.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.thumb} alt="" className="h-10 w-10 flex-shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="h-10 w-10 flex-shrink-0 rounded-md bg-[color:var(--surface-2)]" />
                    )}
                    <div className="min-w-0">
                      <div className="max-w-[22rem] truncate text-[color:var(--foreground)]" title={a.nome ?? a.idAnuncio}>
                        {a.nome ?? "Anúncio sem nome na Meta"}
                      </div>
                      <div className="font-mono text-[10px] text-[color:var(--muted-foreground)]">{a.idAnuncio}</div>
                    </div>
                  </div>
                </td>
                <td className={td}>{a.gasto == null ? "–" : dinheiro(a.gasto, r.moeda)}</td>
                <td className={td}>{int(a.leads)}</td>
                <td className={td}>{int(a.agendados)}</td>
                <td className={td + " font-semibold"}>{custo(a.custoPorAgendamento, "sem agendamento")}</td>
                {cv && <td className={td}>{int(a.noCv)}</td>}
                {cv && <td className={td}>{int(a.visitas)}</td>}
                {cv && <td className={td}>{int(a.vendas)}</td>}
                {cv && <td className={td + " font-semibold"}>{custo(a.custoPorVisita, "sem visita")}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className={td}>{dinheiro(tot.gasto, r.moeda)}</td>
              <td className={td}>{int(tot.leads)}</td>
              <td className={td}>{int(tot.agendados)}</td>
              <td className={td}>
                {custo(tot.agendados > 0 && tot.gasto > 0 ? tot.gasto / tot.agendados : null, "sem agendamento")}
              </td>
              {cv && <td className={td}>{int(tot.noCv)}</td>}
              {cv && <td className={td}>{int(tot.visitas)}</td>}
              {cv && <td className={td}>{int(tot.vendas)}</td>}
              {cv && (
                <td className={td}>
                  {custo(tot.visitas > 0 && tot.gasto > 0 ? tot.gasto / tot.visitas : null, "sem visita")}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      <Detalhe>
        <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
          Investimento é o gasto do anúncio na Meta no período. Agendada é o lead que a Flávia converteu ou
          que já tem visita no CV. Visita é visita realizada no CV, não só agendada. Os custos são o
          investimento dividido pelas agendadas e pelas visitas do anúncio.
        </p>
      </Detalhe>
    </section>
  );
}

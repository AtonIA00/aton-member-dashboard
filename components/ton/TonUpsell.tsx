const WHATSAPP_CTA =
  "https://wa.me/5548996765633?text=" +
  encodeURIComponent(
    "Olá! Quero conhecer o TON (assistente IA) do Member Dashboard Enterprise.",
  );

export function TonUpsell() {
  return (
    <section className="mt-10">
      <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/60 p-10 text-center backdrop-blur">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, rgba(0, 87, 255, 0.16) 0%, rgba(0, 87, 255, 0) 70%)",
          }}
        />

        <div className="relative">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-[color:var(--primary)]/40 bg-[color:var(--primary)]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-[color:var(--primary)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--primary)]" aria-hidden />
            Recurso Enterprise
          </div>

          <h2 className="font-[family-name:var(--font-montserrat)] text-3xl font-extrabold leading-tight tracking-tight text-[color:var(--foreground)] sm:text-4xl">
            Conheça o{" "}
            <span className="bg-gradient-to-r from-[color:var(--primary)] to-[#00c2ff] bg-clip-text text-transparent">
              TON
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[color:var(--muted-foreground)]">
            Seu assistente de IA dedicado pra interpretar dados, identificar
            padrões e propor ações estratégicas. Exclusivo do Plano Enterprise.
          </p>

          <ul className="mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-2 text-left text-sm text-[color:var(--muted-foreground)] sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[color:var(--primary)]" aria-hidden />
              Pergunta em linguagem natural sobre KPIs, funil, campanhas.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[color:var(--primary)]" aria-hidden />
              Lê sua base via tool calling — nunca inventa números.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[color:var(--primary)]" aria-hidden />
              Memória persistente entre conversas.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[color:var(--primary)]" aria-hidden />
              Compara períodos, identifica gargalos no funil.
            </li>
          </ul>

          <a
            href={WHATSAPP_CTA}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--primary)] px-7 py-3.5 font-[family-name:var(--font-montserrat)] text-sm font-bold tracking-wide text-[color:var(--primary-foreground)] shadow-[0_8px_30px_rgba(0,87,255,0.30)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--aton-blue-mid)] hover:shadow-[0_12px_36px_rgba(0,87,255,0.40)] active:translate-y-0"
          >
            Falar com o Suporte
          </a>
        </div>
      </div>
    </section>
  );
}

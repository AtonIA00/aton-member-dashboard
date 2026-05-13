import { AtonLogo } from "./brand/AtonLogo";

type Props = {
  workspaceName?: string;
};

const WHATSAPP_CTA =
  "https://wa.me/5548996765633?text=" +
  encodeURIComponent(
    "Olá! Preciso de suporte com o Member Dashboard da Aton.",
  );

const FEATURES = [
  { title: "Total de Leads", desc: "Volume por período e fonte" },
  { title: "MQL Rate", desc: "Qualificação automática do agente" },
  { title: "Performance por Anúncio", desc: "ROI por criativo" },
  { title: "Funil de Qualificação", desc: "De novo lead a agendado" },
];

export function UpsellScreen({ workspaceName }: Props) {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(50% 40% at 30% 0%, rgba(0, 87, 255, 0.16) 0%, rgba(0, 87, 255, 0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(40% 40% at 80% 100%, rgba(0, 194, 255, 0.10) 0%, rgba(0, 194, 255, 0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-8 py-16 lg:px-12">
        {/* Wordmark no topo da tela de upsell */}
        <div className="mb-10">
          <AtonLogo height={22} />
        </div>
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          {/* Coluna esquerda — pitch */}
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--card)]/60 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--primary)] backdrop-blur">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Recurso Pro & Enterprise
            </div>

            <h1 className="font-[family-name:var(--font-montserrat)] text-4xl font-extrabold leading-[1.05] tracking-tight text-[color:var(--foreground)] sm:text-5xl lg:text-6xl">
              Desbloqueie o seu{" "}
              <span className="bg-gradient-to-r from-[color:var(--primary)] to-[#00c2ff] bg-clip-text text-transparent">
                Dashboard de BI
              </span>
            </h1>

            <p className="mt-6 max-w-lg text-base leading-relaxed text-[color:var(--muted-foreground)] sm:text-lg">
              Acompanhe leads, campanhas, anúncios e qualificação em tempo real
              direto do painel da Aton.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-3">
              <a
                href={WHATSAPP_CTA}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--primary)] px-7 py-3.5 font-[family-name:var(--font-montserrat)] text-sm font-bold tracking-wide text-[color:var(--primary-foreground)] shadow-[0_8px_30px_rgba(0,87,255,0.30)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--aton-blue-mid)] hover:shadow-[0_12px_36px_rgba(0,87,255,0.40)] active:translate-y-0"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                </svg>
                Falar com o Suporte
              </a>
              <span className="text-xs text-[color:var(--muted-foreground)] basis-full sm:basis-auto">
                Trial de 7 dias disponível para Pro/Enterprise
              </span>
            </div>

            {workspaceName && (
              <div className="mt-10 text-xs text-[color:var(--muted-foreground)]">
                Workspace: <span className="font-mono">{workspaceName}</span>
              </div>
            )}
          </div>

          {/* Coluna direita — preview dos cards */}
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FEATURES.map((item) => (
              <li
                key={item.title}
                className="group relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-5 backdrop-blur transition-colors hover:border-[color:var(--primary)]/30"
              >
                <div
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-[color:var(--primary)] to-transparent opacity-70"
                />
                <div className="font-[family-name:var(--font-montserrat)] text-base font-bold text-[color:var(--foreground)]">
                  {item.title}
                </div>
                <div className="mt-2 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                  {item.desc}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

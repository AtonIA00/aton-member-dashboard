import type { Tier } from "@/lib/access";

type Props = {
  tier: Tier;
  /** Dias inteiros até expirar (arredondado pra cima). null = sem expiração. */
  daysUntilExpiry: number | null;
  /** Horas inteiras até expirar. Usado quando <24h pra texto preciso. */
  hoursUntilExpiry: number | null;
  /** Data de liberação pelo CS — usado no tooltip. */
  habilitadoAt: Date | null;
  /** Data de expiração — usado no tooltip. */
  expiresAt: Date | null;
};

const TIER_LABEL: Record<Tier, string> = {
  trial: "TRIAL",
  pro: "PRO",
  enterprise: "ENTERPRISE",
};

type Variant = "stable" | "info" | "warn" | "urgent" | "critical";

const VARIANT_STYLE: Record<Variant, string> = {
  // Pro/Enterprise — sólido ciano, sem urgência.
  stable:
    "border-[color:var(--primary)]/40 bg-[color:var(--primary)]/10 text-[color:var(--primary)]",
  // Trial > 7d — ciano discreto, ainda relaxado.
  info:
    "border-[color:var(--primary)]/40 bg-[color:var(--primary)]/10 text-[color:var(--primary)]",
  // Trial 2-7d — amarelo (atenção sutil).
  warn:
    "border-[#FFD740]/50 bg-[#FFD740]/10 text-[#FFD740]",
  // Trial 1d — laranja (urgência).
  urgent:
    "border-[#FF9800]/55 bg-[#FF9800]/12 text-[#FF9800]",
  // Trial <24h — vermelho com pulso sutil.
  critical:
    "border-[color:var(--destructive)]/60 bg-[color:var(--destructive)]/12 text-[color:var(--destructive)]",
};

function pickVariantAndText(
  tier: Tier,
  daysUntilExpiry: number | null,
  hoursUntilExpiry: number | null,
): { variant: Variant; text: string; pulse: boolean } {
  // Pro / Enterprise sem expiração.
  if (tier !== "trial") {
    return { variant: "stable", text: TIER_LABEL[tier], pulse: false };
  }
  // Trial sem expiração (caso teórico) — info.
  if (daysUntilExpiry === null || hoursUntilExpiry === null) {
    return { variant: "info", text: "TRIAL", pulse: false };
  }
  // <24h — texto em horas.
  if (hoursUntilExpiry <= 24) {
    const h = Math.max(1, hoursUntilExpiry);
    return { variant: "critical", text: `TRIAL · expira em ${h}h`, pulse: true };
  }
  // 1d (entre 24h e 48h).
  if (daysUntilExpiry === 1) {
    return { variant: "urgent", text: "TRIAL · expira amanhã", pulse: false };
  }
  // 2-7d.
  if (daysUntilExpiry <= 7) {
    return { variant: "warn", text: `TRIAL · ${daysUntilExpiry} dias`, pulse: false };
  }
  // >7d.
  return {
    variant: "info",
    text: `TRIAL · ${daysUntilExpiry} dias restantes`,
    pulse: false,
  };
}

function fmtBrDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtBrDateTime(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTooltip(
  tier: Tier,
  habilitadoAt: Date | null,
  expiresAt: Date | null,
): string {
  const parts: string[] = [];
  if (habilitadoAt) {
    parts.push(`Acesso liberado pela Aton em ${fmtBrDate(habilitadoAt)}.`);
  }
  if (expiresAt) {
    parts.push(`Expira em ${fmtBrDateTime(expiresAt)}.`);
  } else if (tier !== "trial") {
    parts.push("Sem expiração.");
  }
  return parts.join(" ");
}

export function TierBadge({
  tier,
  daysUntilExpiry,
  hoursUntilExpiry,
  habilitadoAt,
  expiresAt,
}: Props) {
  const { variant, text, pulse } = pickVariantAndText(
    tier,
    daysUntilExpiry,
    hoursUntilExpiry,
  );
  const tooltip = buildTooltip(tier, habilitadoAt, expiresAt);

  return (
    <span
      title={tooltip}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] " +
        VARIANT_STYLE[variant]
      }
    >
      <span
        aria-hidden
        className={
          "h-1.5 w-1.5 rounded-full bg-current " +
          (pulse ? "animate-pulse" : "")
        }
      />
      {text}
    </span>
  );
}

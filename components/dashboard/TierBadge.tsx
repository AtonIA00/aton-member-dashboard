import type { Tier } from "@/lib/access";

const TIER_LABEL: Record<Tier, string> = {
  trial: "Trial",
  pro: "Pro",
  enterprise: "Enterprise",
};

export function TierBadge({
  tier,
  daysUntilExpiry,
}: {
  tier: Tier;
  daysUntilExpiry: number | null;
}) {
  const isTrial = tier === "trial";
  const expiryText =
    isTrial && daysUntilExpiry !== null
      ? ` — expira em ${daysUntilExpiry}d`
      : "";
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] " +
        (isTrial
          ? "border-[#FFD740]/40 bg-[#FFD740]/10 text-[#FFD740]"
          : "border-[color:var(--primary)]/40 bg-[color:var(--primary)]/10 text-[color:var(--primary)]")
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {TIER_LABEL[tier]}
      {expiryText}
    </span>
  );
}

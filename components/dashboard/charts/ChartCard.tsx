type Props = {
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
};

/**
 * Card wrapper compartilhado por todos os charts da seção "Análise visual".
 * Estética idêntica aos cards de Funnel/AdsPerformance/LeadsTable.
 */
export function ChartCard({ title, subtitle, badge, children }: Props) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-5 py-3">
        <span
          aria-hidden
          className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]"
        />
        <h3 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          {title}
        </h3>
        {subtitle && (
          <span className="ml-2 text-[11px] text-[color:var(--muted-foreground)]/70">
            {subtitle}
          </span>
        )}
        {badge && (
          <span className="ml-auto rounded-full bg-[color:var(--primary)]/10 px-2 py-0.5 text-[10px] font-bold text-[color:var(--primary)]">
            {badge}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

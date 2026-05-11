"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TabKey } from "@/lib/tabs";

type Props = {
  active: TabKey;
  /** Se TON está disponível pro tier — controla se a aba aparece. */
  tonAvailable: boolean;
};

export function TabSwitcher({ active, tonAvailable }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setTab(t: TabKey) {
    const params = new URLSearchParams(sp.toString());
    if (t === "dashboard") params.delete("tab");
    else params.set("tab", t);
    // Limpa contexto cruzado: thread_id só faz sentido na aba TON.
    if (t !== "ton") params.delete("thread_id");
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  // Em workspaces sem TON, escondemos o switcher pra reduzir clutter.
  // (Decisão: se quiser sempre mostrar pra criar awareness do upsell,
  //  trocar pra "true". Hoje: esconde quando indisponível.)
  if (!tonAvailable) return null;

  return (
    <nav
      aria-label="Abas"
      className="mt-6 flex items-center gap-1 border-b border-[color:var(--border)]"
    >
      <TabButton
        active={active === "dashboard"}
        onClick={() => setTab("dashboard")}
        isPending={isPending}
      >
        Dashboard
      </TabButton>
      <TabButton
        active={active === "ton"}
        onClick={() => setTab("ton")}
        isPending={isPending}
        accent="primary"
      >
        TON
        <span className="ml-1.5 rounded-full bg-[color:var(--primary)]/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-[color:var(--primary)]">
          AI
        </span>
      </TabButton>
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  isPending,
  accent,
  children,
}: {
  active: boolean;
  onClick: () => void;
  isPending: boolean;
  accent?: "primary";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className={
        "relative flex items-center gap-1 px-4 py-3 font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.12em] transition-colors disabled:opacity-60 " +
        (active
          ? "text-[color:var(--foreground)]"
          : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]")
      }
    >
      {children}
      {active && (
        <span
          aria-hidden
          className={
            "absolute -bottom-px left-0 h-[2px] w-full " +
            (accent === "primary"
              ? "bg-[color:var(--primary)]"
              : "bg-[color:var(--foreground)]")
          }
        />
      )}
    </button>
  );
}

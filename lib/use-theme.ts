"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const v = document.documentElement.getAttribute("data-theme");
  return v === "dark" ? "dark" : "light";
}

/**
 * Hook que lê o tema atual do <html data-theme> e re-renderiza
 * quando ele muda. Usado nos componentes que precisam de cor literal
 * (Recharts SVG, canvas, etc) — Tailwind dark: variants cobrem o resto.
 *
 * Implementação via MutationObserver: o ThemeToggle muda o atributo
 * em vez de despachar evento; observer é a forma idiomática de reagir.
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readTheme());
    const target = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(readTheme());
    });
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

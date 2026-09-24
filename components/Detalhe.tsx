import type { ReactNode } from "react";

/**
 * Nota de apoio do dash: rodapé, aviso de qualidade do dado, definição,
 * variação contra o período anterior.
 *
 * Fica escondida por padrão e aparece quando o usuário liga "Detalhes" no
 * cabeçalho. Quem esconde é o CSS, pela regra
 *   [data-detalhes="off"] [data-detalhe] { display: none }
 * então isto funciona igual dentro de componente de servidor e de cliente,
 * sem contexto React e sem pular na hidratação.
 *
 * Regra de uso: aqui entra o que EXPLICA um número. O número em si, e a linha
 * de apoio com o absoluto por trás dele, ficam sempre visíveis.
 */
export function Detalhe({
  children,
  as = "div",
  className,
}: {
  children: ReactNode;
  as?: "div" | "span" | "p";
  className?: string;
}) {
  const Tag = as;
  return (
    <Tag data-detalhe="" className={className}>
      {children}
    </Tag>
  );
}

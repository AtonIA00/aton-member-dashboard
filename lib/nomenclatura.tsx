"use client";

import { createContext, useContext, type ReactNode } from "react";
import { GRUPO_LABEL, type Grupo } from "./classify";

// Rótulo de exibição dos grupos por assinante. No funil até a venda (Launch e
// Portovelas, 11/11/2026) o produto não usa mais "Convertido": o grupo
// Agendado+ aparece como "Agendado" no filtro, nos gráficos e na tabela de
// leads, e o strip mostra Agendamentos, Reunião acontecida e Venda.
const AgendamentosContext = createContext(false);

export function NomenclaturaProvider({
  agendamentos,
  children,
}: {
  agendamentos: boolean;
  children: ReactNode;
}) {
  return <AgendamentosContext.Provider value={agendamentos}>{children}</AgendamentosContext.Provider>;
}

export function rotuloGrupo(g: Grupo, agendamentos: boolean): string {
  return agendamentos && g === "Agendado+" ? "Agendado" : GRUPO_LABEL[g];
}

/** O assinante atual usa o funil até a venda. Estável entre renders, para
 *  servir de dependência de useMemo. */
export function useAgendamentos(): boolean {
  return useContext(AgendamentosContext);
}

/** GRUPO_LABEL do assinante atual. */
export function useRotuloGrupo(): (g: Grupo) => string {
  const agendamentos = useContext(AgendamentosContext);
  return (g) => rotuloGrupo(g, agendamentos);
}

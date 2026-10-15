// Regras de leitura do direcionamento de parceiros da Trisul. Sem "server-only":
// usadas pela tabela, pelo painel lateral e pela exportação (client).

import type { TrisulAtendimento } from "@/lib/trisul";

type Row = Pick<
  TrisulAtendimento,
  "resultado" | "coordenador_falou_recentemente" | "direcionado_em"
>;

const NAO_PARCEIRO = new Set(["nao_atua_mercado", "nao_atua_parcerias", "negativa_explicita"]);
const COORD_NAO_FALOU = new Set(["nao", "não", "não informado", "nao informado", "nao_informado"]);

/** "sim" = confirmou parceria; "nao" = recusou; "" = sem definição ainda. */
export function ehParceiro(a: Row): "sim" | "nao" | "" {
  const r = (a.resultado ?? "").trim();
  if (r === "confirmado_atualizado") return "sim";
  if (NAO_PARCEIRO.has(r)) return "nao";
  return "";
}

/** Parceiro confirmado cujo coordenador não falou com ele recentemente. */
export function aguardaCoordenador(a: Row): boolean {
  if (ehParceiro(a) !== "sim") return false;
  const v = (a.coordenador_falou_recentemente ?? "").trim().toLowerCase();
  return COORD_NAO_FALOU.has(v);
}

/** Parceiro confirmado ainda sem direcionamento marcado. */
export function pendenteDirecionamento(a: Row): boolean {
  return ehParceiro(a) === "sim" && !a.direcionado_em;
}

export function simNaoLabel(v: "sim" | "nao" | ""): string {
  return v === "sim" ? "Sim" : v === "nao" ? "Não" : "";
}

export const DIRECIONADO_PARA_MAX = 120;

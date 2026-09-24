import "server-only";
import { getSupabaseAdmin } from "./supabase/server";

/**
 * Preferência "Detalhes" lida no SSR, pra página já nascer no estado certo:
 * sem isso, quem deixou ligado veria as notas aparecerem um instante depois
 * do carregamento. Qualquer falha cai no padrão (desligado), que é a tela
 * limpa: errar para o lado do assinante, nunca o contrário.
 */
export async function getMostrarDetalhes(workspaceId: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("wa_user_preferences")
      .select("mostrar_detalhes")
      .eq("uchat_workspace_id", workspaceId)
      .eq("uchat_user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[preferences] mostrar_detalhes", { workspaceId, message: error.message });
      return false;
    }
    return data?.mostrar_detalhes === true;
  } catch {
    return false;
  }
}

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client server-side único, usando SUPABASE_SERVICE_ROLE_KEY.
// NUNCA importar este módulo de Client Component ou expor ao bundle do browser.
// `server-only` faz o build falhar caso isso aconteça.
//
// O service_role bypassa RLS — toda query DEVE filtrar explicitamente por
// `id_workspace_responsavel` / `uchat_workspace_id` no WHERE. RLS não nos
// protege aqui.

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase env ausente: NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

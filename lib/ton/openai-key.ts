import "server-only";

// Resolve a OPENAI_API_KEY do assinante por workspace.
//
// Padrão Aton (cost-shifting): cada assinante paga a própria chamada via
// chave OpenAI cadastrada no Aton Core. Member Dashboard server-to-server
// chama o microendpoint do Core (POST /api/internal/openai-key) com
// shared secret no Authorization header.
//
// Cache em memória 5min por workspace_id — a chave não muda com frequência
// e cada turn de chat busca a key, então evitamos 1 round-trip extra por
// turn (latência crítica em SSE).
//
// Fallback de desenvolvimento: se OPENAI_TEST_KEY estiver setado E
// ATON_CORE_INTERNAL_URL ausente, usa a key de teste pra todos os
// workspaces. Permite desenvolver sem depender do endpoint do Core.

type CacheEntry = { ts: number; key: string };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;

export class OpenAIKeyError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "OpenAIKeyError";
  }
}

export async function getOpenAIKeyForWorkspace(workspaceId: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(workspaceId);
  if (hit && now - hit.ts < TTL_MS) return hit.key;

  const coreUrl = process.env.ATON_CORE_INTERNAL_URL;
  const sharedSecret = process.env.INTERNAL_SHARED_SECRET;
  const testKey = process.env.OPENAI_TEST_KEY;

  // Fallback dev: sem endpoint configurado → usa OPENAI_TEST_KEY se houver.
  // Sinaliza em log pra ficar óbvio que não estamos cost-shifting ainda.
  if (!coreUrl || !sharedSecret) {
    if (testKey) {
      console.warn("[ton/openai-key] using OPENAI_TEST_KEY fallback (Aton Core endpoint not configured)", { workspaceId });
      cache.set(workspaceId, { ts: now, key: testKey });
      return testKey;
    }
    throw new OpenAIKeyError(
      "TON indisponível: integração com Aton Core ainda não configurada.",
      503,
    );
  }

  // Caminho real: chama o endpoint do Aton Core.
  try {
    const res = await fetch(`${coreUrl}/api/internal/openai-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sharedSecret}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
      // Não cacheia no Next fetch — gerenciamos via Map TTL acima.
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[ton/openai-key] core endpoint error", {
        workspaceId,
        status: res.status,
        detail: detail.slice(0, 200),
      });
      // Fallback se test key existir — diagnóstico fica nos logs.
      if (testKey) {
        cache.set(workspaceId, { ts: now, key: testKey });
        return testKey;
      }
      throw new OpenAIKeyError("Aton Core recusou a chave OpenAI.", res.status);
    }
    const payload = await res.json() as { openai_api_key?: string };
    if (!payload.openai_api_key || typeof payload.openai_api_key !== "string") {
      throw new OpenAIKeyError("Aton Core respondeu sem openai_api_key.");
    }
    cache.set(workspaceId, { ts: now, key: payload.openai_api_key });
    return payload.openai_api_key;
  } catch (e) {
    if (e instanceof OpenAIKeyError) throw e;
    console.error("[ton/openai-key] fetch failed", {
      workspaceId,
      error: e instanceof Error ? e.message : String(e),
    });
    if (testKey) {
      cache.set(workspaceId, { ts: now, key: testKey });
      return testKey;
    }
    throw new OpenAIKeyError("Falha ao obter chave OpenAI do Aton Core.");
  }
}

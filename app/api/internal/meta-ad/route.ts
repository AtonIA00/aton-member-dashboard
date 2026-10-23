import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isMetaAdsEnabled } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// De qual conta de anúncios veio um anúncio — SOMENTE LEITURA (23/10/2026).
// Para a integração Flávia → CV da WDS (aton-core#609): o Core recebe o
// ad_id do lead e precisa saber a conta para casar a mídia. O token da Meta
// vive só aqui, então o Core pergunta para este serviço.
//
// Chamador: container do Core, via
//   GET http://member-dashboard_app:3000/api/internal/meta-ad?id=<ad_id>
//   Authorization: Bearer <INTERNAL_SHARED_SECRET>
//
// Respostas:
//   200 { account_id, name, adset_name, campaign_name }
//                               account_id sem o prefixo "act_"; adset_name e
//                               campaign_name (23/10/2026, aditivos) vêm null
//                               se a Meta não devolver. A YZ registra no CV a
//                               mídia = público (conjunto) e a conversão =
//                               criativo (anúncio).
//   400 invalid_id              id fora de 5–25 dígitos
//   401 unauthorized            bearer ausente/errado
//   404 not_found               a Meta não devolveu o anúncio (apagado ou
//                               conta sem acesso para o system user)
//   502 upstream_failed         a Meta falhou
//   503 meta_ads_disabled / not_configured
// O Core trata qualquer 4xx/5xx como "sem mídia" e segue.
//
// Não restringe às contas ligadas em wa_meta_ads_accounts (diferente do
// meta-graph): devolve só a conta e os NOMES de anúncio, conjunto e campanha
// de um anúncio que o system user já enxerga. Nada de gasto ou métrica.

const TTL_MS = 60 * 60_000;
type AdInfo = {
  account_id: string;
  name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
};
const cache = new Map<string, { ts: number; data: AdInfo }>();

function bearerOk(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7).trim(), "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function GET(req: NextRequest) {
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isMetaAdsEnabled()) return NextResponse.json({ error: "meta_ads_disabled" }, { status: 503 });
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!/^\d{5,25}$/.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < TTL_MS) return NextResponse.json(hit.data);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${id}?fields=account_id,name,adset%7Bname%7D,campaign%7Bname%7D&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: controller.signal },
    );
    const json = (await res.json().catch(() => null)) as
      | {
          account_id?: string;
          name?: string;
          adset?: { name?: string };
          campaign?: { name?: string };
          error?: { code?: number };
        }
      | null;
    if (!res.ok || !json || json.error) {
      // 100 = objeto inexistente ou sem permissão: para o Core é "não achei".
      const code = json?.error?.code;
      console.warn("[meta-ad] Meta recusou", { id, status: res.status, code });
      return code === 100
        ? NextResponse.json({ error: "not_found" }, { status: 404 })
        : NextResponse.json({ error: "upstream_failed" }, { status: 502 });
    }
    if (!json.account_id) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const data: AdInfo = {
      account_id: String(json.account_id),
      name: json.name ?? null,
      adset_name: json.adset?.name ?? null,
      campaign_name: json.campaign?.name ?? null,
    };
    cache.set(id, { ts: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error("[meta-ad] falhou", { id, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

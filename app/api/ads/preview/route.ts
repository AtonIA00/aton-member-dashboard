import { NextResponse, type NextRequest } from "next/server";
import { validateUchatSignature } from "@/lib/hmac";
import { getAdPreviewForWorkspace } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preview oficial de um anúncio (Ad Preview API da Meta) — READ-ONLY.
// Auth: mesmos params HMAC do iframe (janela 12h, igual /api/leads/update).
// Tenant scoping REAL em getAdPreviewForWorkspace: o ad precisa pertencer à
// conta vinculada ao workspace da sessão.
const MAX_AGE_SECONDS = 12 * 60 * 60;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const hmac = validateUchatSignature(
    {
      workspace_id: q.get("workspace_id") ?? undefined,
      user_id: q.get("user_id") ?? undefined,
      timestamp: q.get("timestamp") ?? undefined,
      signature: q.get("signature") ?? undefined,
    },
    { maxAgeSeconds: MAX_AGE_SECONDS },
  );
  if (!hmac.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const adId = q.get("ad_id") ?? "";
  const preview = await getAdPreviewForWorkspace(hmac.workspaceId, adId);
  if (!preview) return NextResponse.json({ error: "preview_unavailable" }, { status: 404 });

  return NextResponse.json({ src: preview.src });
}

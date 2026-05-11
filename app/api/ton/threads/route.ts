import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateTonRequest,
  tonAuthErrorResponse,
} from "@/lib/ton/auth";
import { createThread, listThreads } from "@/lib/ton/threads";
import { getQuotaState } from "@/lib/ton/quota";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const auth = await authenticateTonRequest(req);
  if (!auth.ok) return tonAuthErrorResponse(auth);

  const url = new URL(req.url);
  const archived = url.searchParams.get("archived") === "true";

  const [threads, quota] = await Promise.all([
    listThreads(auth.workspaceId, { archived, limit: 50 }),
    getQuotaState(auth.workspaceId),
  ]);

  return NextResponse.json({ threads, quota });
}

export async function POST(req: NextRequest) {
  let body: { workspace_id?: string; user_id?: string; timestamp?: string; signature?: string } = {};
  try {
    body = await req.json();
  } catch {
    // POST sem body — params via query string ainda funcionam.
  }
  const auth = await authenticateTonRequest(req, body);
  if (!auth.ok) return tonAuthErrorResponse(auth);

  const thread = await createThread(auth.workspaceId, auth.userId);
  if (!thread) {
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
  return NextResponse.json({ thread }, { status: 201 });
}

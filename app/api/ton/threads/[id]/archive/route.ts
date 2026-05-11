import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateTonRequest,
  tonAuthErrorResponse,
} from "@/lib/ton/auth";
import { archiveThread } from "@/lib/ton/threads";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  let body: { workspace_id?: string; user_id?: string; timestamp?: string; signature?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const auth = await authenticateTonRequest(req, body);
  if (!auth.ok) return tonAuthErrorResponse(auth);

  const { id: threadId } = await ctx.params;
  const ok = await archiveThread(threadId, auth.workspaceId);
  if (!ok) return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

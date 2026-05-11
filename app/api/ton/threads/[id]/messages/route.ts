import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateTonRequest,
  tonAuthErrorResponse,
} from "@/lib/ton/auth";
import { getThreadForWorkspace, listMessages } from "@/lib/ton/threads";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateTonRequest(req);
  if (!auth.ok) return tonAuthErrorResponse(auth);

  const { id: threadId } = await ctx.params;

  // Defense-in-depth: garante que a thread pertence a esse workspace.
  const thread = await getThreadForWorkspace(threadId, auth.workspaceId);
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  const messages = await listMessages(threadId);
  return NextResponse.json({ thread, messages });
}

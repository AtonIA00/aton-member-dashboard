import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type ChatThread = {
  id: string;
  uchat_workspace_id: string;
  user_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  total_tokens_in: number;
  total_tokens_out: number;
};

export type ChatMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: unknown;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tool_name: string | null;
  tool_call_id: string | null;
  created_at: string;
};

// ──────────────────────────────────────────────────────────────────────────
// Threads

export async function listThreads(
  workspaceId: string,
  opts: { archived?: boolean; limit?: number } = {},
): Promise<ChatThread[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_chat_threads")
    .select("*")
    .eq("uchat_workspace_id", workspaceId)
    .eq("archived", opts.archived ?? false)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) {
    console.error("[ton/threads] listThreads error", { workspaceId, error: error.message });
    return [];
  }
  return (data ?? []) as ChatThread[];
}

export async function createThread(
  workspaceId: string,
  userId: string | null,
): Promise<ChatThread | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_chat_threads")
    .insert({ uchat_workspace_id: workspaceId, user_id: userId })
    .select()
    .single<ChatThread>();
  if (error) {
    console.error("[ton/threads] createThread error", { workspaceId, error: error.message });
    return null;
  }
  return data;
}

/** Busca thread + valida ownership defense-in-depth. Null se não pertencer. */
export async function getThreadForWorkspace(
  threadId: string,
  workspaceId: string,
): Promise<ChatThread | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_chat_threads")
    .select("*")
    .eq("id", threadId)
    .eq("uchat_workspace_id", workspaceId)
    .maybeSingle<ChatThread>();
  if (error) {
    console.error("[ton/threads] getThreadForWorkspace error", { threadId, error: error.message });
    return null;
  }
  return data;
}

export async function archiveThread(
  threadId: string,
  workspaceId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("wa_chat_threads")
    .update({ archived: true, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", threadId)
    .eq("uchat_workspace_id", workspaceId);
  if (error) {
    console.error("[ton/threads] archiveThread error", { threadId, error: error.message });
    return false;
  }
  return (count ?? 0) > 0;
}

export async function updateThreadTitle(threadId: string, title: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("wa_chat_threads")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", threadId);
}

export async function bumpThreadTokens(
  threadId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  // Buscar atual + adicionar (sem incremento atômico simples no client).
  const { data } = await supabase
    .from("wa_chat_threads")
    .select("total_tokens_in, total_tokens_out")
    .eq("id", threadId)
    .maybeSingle<{ total_tokens_in: number; total_tokens_out: number }>();
  const ti = (data?.total_tokens_in ?? 0) + tokensIn;
  const to = (data?.total_tokens_out ?? 0) + tokensOut;
  await supabase
    .from("wa_chat_threads")
    .update({
      total_tokens_in: ti,
      total_tokens_out: to,
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);
}

// ──────────────────────────────────────────────────────────────────────────
// Messages

export async function listMessages(threadId: string): Promise<ChatMessage[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[ton/threads] listMessages error", { threadId, error: error.message });
    return [];
  }
  return (data ?? []) as ChatMessage[];
}

export async function insertMessage(msg: {
  thread_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: unknown;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  tool_name?: string;
  tool_call_id?: string;
}): Promise<ChatMessage | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wa_chat_messages")
    .insert({
      thread_id: msg.thread_id,
      role: msg.role,
      content: msg.content,
      model: msg.model ?? null,
      tokens_in: msg.tokens_in ?? null,
      tokens_out: msg.tokens_out ?? null,
      tool_name: msg.tool_name ?? null,
      tool_call_id: msg.tool_call_id ?? null,
    })
    .select()
    .single<ChatMessage>();
  if (error) {
    console.error("[ton/threads] insertMessage error", { threadId: msg.thread_id, error: error.message });
    return null;
  }
  return data;
}

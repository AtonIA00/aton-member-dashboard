import { type NextRequest } from "next/server";
import OpenAI from "openai";
import { authenticateTonRequest, tonAuthErrorResponse } from "@/lib/ton/auth";
import { getOpenAIKeyForWorkspace, OpenAIKeyError } from "@/lib/ton/openai-key";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/ton/tools";
import {
  bumpThreadTokens,
  createThread,
  getThreadForWorkspace,
  insertMessage,
  listMessages,
  updateThreadTitle,
  type ChatMessage,
} from "@/lib/ton/threads";
import { buildSystemPrompt } from "@/lib/ton/system-prompt";
import { getQuotaState } from "@/lib/ton/quota";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Streaming SSE precisa de runtime nodejs (não edge) — usamos openai SDK
// que depende de stream nativo.
export const runtime = "nodejs";

const MODEL = "gpt-5.4-2026-03-05";
const MAX_TOOL_ITERATIONS = 8;

type ChatRequestBody = {
  thread_id?: string;
  message: string;
  // HMAC params
  workspace_id?: string;
  user_id?: string;
  timestamp?: string;
  signature?: string;
  // contextuais (vindos do iframe)
  user_name?: string;
  workspace_name?: string;
};

// Tipo do conteúdo serializado em wa_chat_messages.content (JSONB).
// Espelha o formato OpenAI Chat Completions API.
type StoredMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function generateTitle(
  openai: OpenAI,
  firstUserMessage: string,
  firstAssistantReply: string,
): Promise<string> {
  // Modelo pequeno (mesmo do principal — spec diz: se variante mini não
  // estiver clearly available, mantém). Prompt minimalista, max_tokens=30.
  try {
    const r = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 30,
      messages: [
        {
          role: "system",
          content:
            "Gere um título curto (3-6 palavras, em português, sem aspas, sem emojis) que resuma o tema da pergunta do usuário abaixo.",
        },
        { role: "user", content: firstUserMessage.slice(0, 500) },
        { role: "assistant", content: firstAssistantReply.slice(0, 500) },
        { role: "user", content: "Título:" },
      ],
    });
    const title = r.choices[0]?.message?.content?.trim() ?? "";
    return title.replace(/^["']|["']$/g, "").slice(0, 80) || "Nova conversa";
  } catch {
    return "Nova conversa";
  }
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "bad_json" }), { status: 400 });
  }

  const auth = await authenticateTonRequest(req, body);
  if (!auth.ok) return tonAuthErrorResponse(auth);

  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return new Response(JSON.stringify({ error: "empty_message" }), { status: 400 });
  }

  // Quota check.
  const quota = await getQuotaState(auth.workspaceId);
  if (quota.level === "blocked") {
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        message: "Limite diário de uso atingido. Volte amanhã ou fale com a Aton.",
        quota,
      }),
      { status: 429 },
    );
  }

  // Get or create thread.
  let thread = body.thread_id
    ? await getThreadForWorkspace(body.thread_id, auth.workspaceId)
    : null;
  const isNewThread = !thread;
  if (!thread) {
    thread = await createThread(auth.workspaceId, auth.userId);
    if (!thread) {
      return new Response(JSON.stringify({ error: "create_thread_failed" }), { status: 500 });
    }
  }
  const threadId = thread.id;

  // Build conversation history.
  const history = isNewThread ? [] : await listMessages(threadId);
  const systemPrompt = buildSystemPrompt({
    userName: body.user_name,
    workspaceName: body.workspace_name,
  });

  const openaiMessages: StoredMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => m.content as StoredMessage),
    { role: "user", content: body.message },
  ];

  // Persist user message early — independente do que aconteça depois.
  await insertMessage({
    thread_id: threadId,
    role: "user",
    content: { role: "user", content: body.message },
    model: MODEL,
  });

  // Get OpenAI key (cost-shifting).
  let openaiKey: string;
  try {
    openaiKey = await getOpenAIKeyForWorkspace(auth.workspaceId);
  } catch (e) {
    const detail =
      e instanceof OpenAIKeyError
        ? e.message
        : "Falha desconhecida ao obter chave OpenAI.";
    return new Response(
      JSON.stringify({
        error: "openai_key_unavailable",
        message: "O TON está temporariamente indisponível. Avisamos a equipe Aton.",
        detail,
      }),
      { status: 503 },
    );
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  // ─────────────────────────────────────────────────────────────────
  // SSE stream com tool-call loop
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let totalTokensIn = 0;
      let totalTokensOut = 0;
      let finalAssistantText = "";

      try {
        controller.enqueue(encoder.encode(sseEvent("thread", { thread_id: threadId, isNewThread })));

        // Loop: chama OpenAI, se houver tool_calls executa e re-chama;
        // a última iteração emite o stream de texto final.
        let iter = 0;
        while (iter < MAX_TOOL_ITERATIONS) {
          iter++;

          const stream = await openai.chat.completions.create({
            model: MODEL,
            messages: openaiMessages.map((m) => {
              // Recharts/OpenAI espera type union sem campos extras. Limpa.
              if (m.role === "assistant") {
                return m.tool_calls && m.tool_calls.length > 0
                  ? { role: "assistant", content: m.content, tool_calls: m.tool_calls }
                  : { role: "assistant", content: m.content };
              }
              if (m.role === "tool") {
                return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
              }
              return { role: m.role, content: m.content };
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any,
            tools: TOOL_DEFINITIONS,
            stream: true,
            stream_options: { include_usage: true },
          });

          // Coletando chunks.
          let assistantText = "";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolCalls = new Map<number, { id: string; name: string; args: string }>();

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              assistantText += delta.content;
              controller.enqueue(encoder.encode(sseEvent("token", { text: delta.content })));
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                const cur = toolCalls.get(idx) ?? { id: "", name: "", args: "" };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name = tc.function.name;
                if (tc.function?.arguments) cur.args += tc.function.arguments;
                toolCalls.set(idx, cur);
              }
            }
            // Usage chega no chunk final quando stream_options.include_usage=true.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const usage = (chunk as any).usage;
            if (usage) {
              totalTokensIn += usage.prompt_tokens ?? 0;
              totalTokensOut += usage.completion_tokens ?? 0;
            }
          }

          // Sem tool calls → resposta final.
          if (toolCalls.size === 0) {
            finalAssistantText = assistantText;
            const stored: StoredMessage = { role: "assistant", content: assistantText };
            openaiMessages.push(stored);
            await insertMessage({
              thread_id: threadId,
              role: "assistant",
              content: stored,
              model: MODEL,
              tokens_in: totalTokensIn,
              tokens_out: totalTokensOut,
            });
            break;
          }

          // Com tool calls: registra a mensagem assistant com tool_calls,
          // executa cada uma, emite SSE com resultado, append tool messages.
          const tcs = [...toolCalls.values()].map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          }));
          const stored: StoredMessage = {
            role: "assistant",
            content: assistantText || null,
            tool_calls: tcs,
          };
          openaiMessages.push(stored);
          await insertMessage({
            thread_id: threadId,
            role: "assistant",
            content: stored,
            model: MODEL,
            tokens_in: totalTokensIn,
            tokens_out: totalTokensOut,
          });

          for (const tc of tcs) {
            controller.enqueue(
              encoder.encode(
                sseEvent("tool_call", {
                  id: tc.id,
                  name: tc.function.name,
                  arguments_raw: tc.function.arguments,
                }),
              ),
            );

            let argsObj: Record<string, unknown> = {};
            try {
              argsObj = JSON.parse(tc.function.arguments || "{}");
            } catch {
              argsObj = {};
            }

            let resultJson: string;
            try {
              const result = await executeTool(tc.function.name, argsObj, auth.workspaceId);
              resultJson = JSON.stringify(result);
            } catch (e) {
              resultJson = JSON.stringify({
                error: e instanceof Error ? e.message : "tool_execution_failed",
              });
            }

            const toolMsg: StoredMessage = {
              role: "tool",
              tool_call_id: tc.id,
              content: resultJson,
            };
            openaiMessages.push(toolMsg);
            await insertMessage({
              thread_id: threadId,
              role: "tool",
              content: toolMsg,
              tool_name: tc.function.name,
              tool_call_id: tc.id,
            });

            controller.enqueue(
              encoder.encode(
                sseEvent("tool_result", {
                  id: tc.id,
                  name: tc.function.name,
                  // Resultado completo no payload — UI decide se mostra colapsado.
                  result: resultJson.slice(0, 8000),
                }),
              ),
            );
          }
          // Continua loop pra próxima iteração do modelo.
        }

        // Bump de contadores no thread.
        await bumpThreadTokens(threadId, totalTokensIn, totalTokensOut);

        // Geração de título — apenas no primeiro turno de uma thread nova.
        if (isNewThread && finalAssistantText) {
          const title = await generateTitle(openai, body.message, finalAssistantText);
          await updateThreadTitle(threadId, title);
          controller.enqueue(encoder.encode(sseEvent("title", { title })));
        }

        controller.enqueue(
          encoder.encode(
            sseEvent("done", {
              tokens_in: totalTokensIn,
              tokens_out: totalTokensOut,
            }),
          ),
        );
      } catch (e) {
        console.error("[ton/chat] stream error", {
          workspaceId: auth.workspaceId,
          threadId,
          error: e instanceof Error ? e.message : String(e),
        });
        controller.enqueue(
          encoder.encode(
            sseEvent("error", {
              message: "TON teve um problema. Tente novamente em alguns segundos.",
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

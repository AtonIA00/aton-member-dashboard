"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
  user_name?: string;
  workspace_name?: string;
};

type Props = {
  hmac: HmacParams;
};

type Thread = {
  id: string;
  title: string | null;
  updated_at: string;
  total_tokens_in: number;
  total_tokens_out: number;
};

type Quota = {
  tokensToday: number;
  level: "none" | "visible" | "warn" | "blocked";
  resetsAtIso: string;
  limit: number;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  toolResult?: string;
  /** Markdown rendering aplica só pra role=assistant. */
};

const SUGGESTIONS = [
  "Quais campanhas estão dando mais MQL?",
  "Compare meu mês atual com o anterior",
  "Quais leads estão parados sem ação há mais de 3 dias?",
  "Qual a melhor hora do dia pra receber leads?",
  "Identifique gargalos no meu funil",
];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffDay = Math.floor(diffH / 24);
  if (diffDay === 1) return "ontem";
  if (diffDay < 7) return `há ${diffDay}d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function TonChat({ hmac }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const threadIdFromUrl = sp.get("thread_id");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(threadIdFromUrl);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionTokens, setSessionTokens] = useState({ in: 0, out: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  // Quando o stream cria uma thread NOVA, atualizamos activeThreadId localmente
  // pra preservar as messages do stream em andamento. O useEffect que carrega
  // histórico do servidor DEVE PULAR esse caso (servidor ainda não tem a
  // resposta final salva → carregaria histórico parcial e clobberaria
  // o array local). Ref permite ao effect ler o estado sem dependency.
  const skipNextLoadRef = useRef(false);

  const hmacQS = useMemo(() => {
    const p = new URLSearchParams();
    p.set("workspace_id", hmac.workspace_id);
    p.set("user_id", hmac.user_id);
    p.set("timestamp", hmac.timestamp);
    p.set("signature", hmac.signature);
    return p.toString();
  }, [hmac]);

  // Sync UNIDIRECIONAL URL → state, pra cobrir back/forward do browser e
  // deep-linking. NÃO incluir activeThreadId nas deps: quando o stream
  // cria thread nova e chama setActiveThreadId(NEW) inline ANTES do
  // router.replace propagar pro sp, o effect rodaria com threadIdFromUrl
  // ainda null e reverteria o state pra null — clobberando o stream.
  useEffect(() => {
    setActiveThreadId(threadIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadIdFromUrl]);

  // Carrega lista de threads + quota.
  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch(`/api/ton/threads?${hmacQS}`);
      if (!res.ok) return;
      const j = await res.json();
      setThreads(j.threads ?? []);
      setQuota(j.quota ?? null);
    } catch (e) {
      console.error("[ton] refreshThreads", e);
    }
  }, [hmacQS]);

  useEffect(() => {
    refreshThreads();
  }, [refreshThreads]);

  // Carrega mensagens da thread ativa.
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    // Pula o reload quando o próprio stream acabou de criar essa thread:
    // o servidor ainda não persistiu a resposta final → o histórico voltaria
    // parcial e clobberaria o array que está sendo construído via SSE.
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ton/threads/${activeThreadId}/messages?${hmacQS}`);
        if (!res.ok) {
          if (!cancelled) setMessages([]);
          return;
        }
        const j = await res.json();
        if (cancelled) return;
        const ui: Message[] = [];
        for (const m of j.messages ?? []) {
          const c = m.content;
          if (m.role === "user") {
            ui.push({ id: m.id, role: "user", text: c?.content ?? "" });
          } else if (m.role === "assistant") {
            const text = typeof c?.content === "string" ? c.content : "";
            // Mostra tool calls como mensagens "tool" colapsadas no histórico.
            if (c?.tool_calls?.length) {
              for (const tc of c.tool_calls) {
                ui.push({
                  id: `${m.id}-${tc.id}`,
                  role: "tool",
                  text: "",
                  toolName: tc.function?.name,
                });
              }
            }
            if (text) {
              ui.push({ id: m.id, role: "assistant", text });
            }
          } else if (m.role === "tool") {
            // Result de tool já está coberto pela mensagem assistant anterior.
            // Aqui poderíamos anexar o result ao tool message correspondente,
            // mas pra simplicidade ignoramos no histórico (mostra só "consultou X").
          }
        }
        setMessages(ui);
      } catch (e) {
        console.error("[ton] load messages", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, hmacQS]);

  // Auto-scroll pro fim quando novas mensagens chegam.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  function selectThread(id: string | null) {
    const params = new URLSearchParams(sp.toString());
    if (id) params.set("thread_id", id);
    else params.delete("thread_id");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setActiveThreadId(id);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isStreaming) return;
    if (quota?.level === "blocked") {
      setError("Limite diário atingido. Volte amanhã ou fale com a Aton.");
      return;
    }
    setError(null);
    setIsStreaming(true);

    const tempUserId = "temp-" + Math.random().toString(36).slice(2);
    setMessages((prev) => [...prev, { id: tempUserId, role: "user", text }]);
    setInput("");

    const tempAssistantId = "temp-a-" + Math.random().toString(36).slice(2);
    setMessages((prev) => [...prev, { id: tempAssistantId, role: "assistant", text: "" }]);

    try {
      const res = await fetch("/api/ton/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: activeThreadId,
          message: text,
          workspace_id: hmac.workspace_id,
          user_id: hmac.user_id,
          timestamp: hmac.timestamp,
          signature: hmac.signature,
          user_name: hmac.user_name,
          workspace_name: hmac.workspace_name,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newThreadId: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events separados por \n\n
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }

          if (event === "thread") {
            newThreadId = (payload.thread_id as string) ?? null;
            if (newThreadId && !activeThreadId) {
              // Sinaliza ao effect de reload pra ignorar essa transição:
              // o stream segue alimentando as messages locais; o servidor
              // só persiste a resposta final no evento "done".
              skipNextLoadRef.current = true;
              setActiveThreadId(newThreadId);
              // Atualiza URL pra refletir a thread nova.
              const params = new URLSearchParams(sp.toString());
              params.set("thread_id", newThreadId);
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }
          } else if (event === "token") {
            const tx = (payload.text as string) ?? "";
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.id === tempAssistantId) {
                next[next.length - 1] = { ...last, text: last.text + tx };
              }
              return next;
            });
          } else if (event === "tool_call") {
            const toolName = (payload.name as string) ?? "unknown";
            setMessages((prev) => [
              ...prev.slice(0, -1), // remove assistant placeholder
              { id: `tool-${payload.id}`, role: "tool", text: "", toolName },
              prev[prev.length - 1], // reinsere assistant placeholder
            ]);
          } else if (event === "tool_result") {
            const id = `tool-${payload.id}`;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id
                  ? { ...m, toolResult: String(payload.result ?? "").slice(0, 800) }
                  : m,
              ),
            );
          } else if (event === "title") {
            // Refresca lista de threads pra puxar título atualizado.
            refreshThreads();
          } else if (event === "done") {
            const ti = (payload.tokens_in as number) ?? 0;
            const to = (payload.tokens_out as number) ?? 0;
            setSessionTokens((s) => ({ in: s.in + ti, out: s.out + to }));
            refreshThreads();
          } else if (event === "error") {
            setError((payload.message as string) ?? "Erro no TON.");
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro de rede.";
      setError(msg);
      // Remove placeholder vazio se nada chegou.
      setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId || m.text));
    } finally {
      setIsStreaming(false);
    }
  }

  function newThread() {
    selectThread(null);
    setMessages([]);
    setInput("");
    setError(null);
  }

  const showSuggestions = !activeThreadId && messages.length === 0;

  return (
    <section className="mt-6 grid min-h-[600px] grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="flex flex-col rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/60 backdrop-blur">
        <button
          type="button"
          onClick={newThread}
          className="m-3 inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--primary)] px-4 py-2.5 font-[family-name:var(--font-montserrat)] text-sm font-bold tracking-wide text-[color:var(--primary-foreground)] transition-transform hover:scale-[1.02]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nova conversa
        </button>

        <div className="flex-1 overflow-auto px-2 pb-2">
          {threads.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-[color:var(--muted-foreground)]/70">
              Suas conversas aparecem aqui.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => selectThread(t.id)}
                    className={
                      "w-full truncate rounded-[var(--radius-md)] px-3 py-2 text-left text-xs transition-colors " +
                      (t.id === activeThreadId
                        ? "bg-[color:var(--primary)]/15 text-[color:var(--foreground)]"
                        : "text-[color:var(--muted-foreground)] hover:bg-white/[0.04] hover:text-[color:var(--foreground)]")
                    }
                    title={t.title ?? "Nova conversa"}
                  >
                    <div className="truncate font-medium">
                      {t.title ?? "Nova conversa"}
                    </div>
                    <div className="mt-0.5 text-[10px] opacity-70">
                      {formatRelative(t.updated_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {quota && quota.level !== "none" && (
          <div className="border-t border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--muted-foreground)]">
            <div className="tabular-nums">
              {int(quota.tokensToday)} tokens hoje
            </div>
            {quota.level === "warn" && (
              <div className="mt-1 text-[10px] text-[#FFD740]">
                Uso alto — considere encerrar threads antigas.
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Chat panel */}
      <div className="flex flex-col rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/60 backdrop-blur">
        {quota?.level === "warn" && (
          <div className="rounded-t-[var(--radius-lg)] border-b border-[#FFD740]/30 bg-[#FFD740]/8 px-4 py-2 text-[11px] text-[#FFD740]">
            Você está usando muitos tokens hoje. Considere fechar threads antigas.
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto px-6 py-6"
          style={{ maxHeight: "60vh" }}
        >
          {showSuggestions ? (
            <div className="mx-auto max-w-2xl">
              <div className="mb-6 text-center">
                <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--primary)]/15 font-[family-name:var(--font-montserrat)] text-lg font-bold text-[color:var(--primary)]">
                  T
                </div>
                <h2 className="mt-3 font-[family-name:var(--font-montserrat)] text-xl font-bold text-[color:var(--foreground)]">
                  Olá, eu sou o TON
                </h2>
                <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                  Pergunta sobre seus leads, campanhas, MQL — ou peça uma análise.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendMessage(s)}
                    className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)]/40 px-4 py-3 text-left text-sm text-[color:var(--foreground)] transition-colors hover:border-[color:var(--primary)]/40 hover:bg-[color:var(--card)]/70"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {isStreaming && (
                <li className="flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[color:var(--primary)]" />
                  TON está pensando…
                </li>
              )}
            </ul>
          )}
        </div>

        {error && (
          <div className="border-t border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/8 px-4 py-2 text-[12px] text-[color:var(--destructive)]">
            {error}
          </div>
        )}

        <ChatInput
          value={input}
          onChange={setInput}
          onSend={sendMessage}
          disabled={isStreaming || quota?.level === "blocked"}
        />
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "tool") {
    return (
      <li>
        <details className="rounded-md border border-[color:var(--border)] bg-white/[0.02] px-3 py-1.5 text-[11px] text-[color:var(--muted-foreground)]">
          <summary className="cursor-pointer select-none">
            <span className="mr-1.5">📊</span>
            Consultando <code className="text-[color:var(--primary)]">{message.toolName}</code>
            {message.toolResult ? " · pronto" : "…"}
          </summary>
          {message.toolResult && (
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-[10px]">
              {message.toolResult}
            </pre>
          )}
        </details>
      </li>
    );
  }

  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[color:var(--primary)]/15 px-4 py-2.5 text-sm text-[color:var(--foreground)]">
          {message.text}
        </div>
      </li>
    );
  }

  // assistant
  return (
    <li className="flex items-start gap-3">
      <div
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--primary)]/20 font-[family-name:var(--font-montserrat)] text-sm font-bold text-[color:var(--primary)]"
        aria-hidden
      >
        T
      </div>
      <div className="prose prose-invert prose-sm max-w-[80%] text-sm leading-relaxed text-[color:var(--foreground)]">
        {message.text ? (
          <ReactMarkdown>{message.text}</ReactMarkdown>
        ) : (
          <span className="text-[color:var(--muted-foreground)] italic">…</span>
        )}
      </div>
    </li>
  );
}

function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (v: string) => void;
  disabled: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSend(value);
    }
  }

  return (
    <div className="border-t border-[color:var(--border)] p-3">
      <div className="flex items-end gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 focus-within:border-[color:var(--primary)]/40">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Pergunta pro TON… (Enter envia, Shift+Enter quebra linha)"
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted-foreground)]/60 disabled:opacity-50"
          style={{ maxHeight: 140 }}
        />
        <button
          type="button"
          onClick={() => value.trim() && onSend(value)}
          disabled={disabled || !value.trim()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[color:var(--primary)] text-[color:var(--primary-foreground)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Enviar"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Shell } from "../../components/shell";
import { FeedbackBanner, PageHeader, StatePanel } from "../../components/ui-foundation";
import { LoadingRegion } from "../../components/loading-system";
import { archiveTorresAiThread, askTorresAi, fetchTorresAi, type TorresAiKind, type TorresAiSnapshot } from "../../lib/torres-ai-api";
import { readStoredSession } from "../../lib/supabase-auth";
import type { AuthSession } from "../../lib/types";

const starters: Array<{ label: string; prompt: string; kind: TorresAiKind }> = [
  { label: "Today’s briefing", prompt: "Give me a concise briefing of what needs attention today, using only current workspace evidence.", kind: "daily_briefing" },
  { label: "Weekly summary", prompt: "Summarize this week’s client, project, service, and reporting activity. Call out missing or stale evidence.", kind: "weekly_summary" },
  { label: "Priority check", prompt: "What are the three highest-priority items I should review next, and why?", kind: "answer" },
];

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function TorresAiPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [snapshot, setSnapshot] = useState<TorresAiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (!stored) return setLoading(false);
    void fetchTorresAi(stored).then(setSnapshot).catch((cause) => setError(cause instanceof Error ? cause.message : "Torres AI could not be loaded.")).finally(() => setLoading(false));
  }, []);

  const loadThread = async (threadId: string) => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try { setSnapshot(await fetchTorresAi(session, threadId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "That conversation could not be opened."); }
    finally { setBusy(false); }
  };

  const submit = async (event?: FormEvent, preset?: { prompt: string; kind: TorresAiKind }) => {
    event?.preventDefault();
    if (!session || busy) return;
    const question = (preset?.prompt ?? prompt).trim();
    if (!question) return;
    setBusy(true);
    setError("");
    try {
      const next = await askTorresAi(session, { threadId: snapshot?.selectedThreadId || undefined, prompt: question, kind: preset?.kind });
      setSnapshot(next);
      setPrompt("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Torres AI could not answer safely."); }
    finally { setBusy(false); }
  };

  const newConversation = () => {
    if (!snapshot) return;
    setSnapshot({ ...snapshot, selectedThreadId: null, messages: [] });
    setPrompt("");
    setError("");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const archive = async () => {
    if (!session || !snapshot?.selectedThreadId || busy) return;
    setBusy(true);
    setError("");
    try { setSnapshot(await archiveTorresAiThread(session, snapshot.selectedThreadId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The conversation could not be archived."); }
    finally { setBusy(false); }
  };

  return <Shell active="Torres AI"><div className="torres-ai-page">
    <PageHeader eyebrow="Private intelligence" title="Torres AI" description="Ask questions across the workspace and receive concise answers grounded in records you are already permitted to see." actions={<button type="button" className="button button-dark" onClick={newConversation}>New conversation</button>} />
    <section className="ai-trust-bar" aria-label="Torres AI safeguards"><span><b>Private</b> Tenant-isolated</span><span><b>Read-only</b> No actions or edits</span><span><b>Verified</b> Source-linked answers</span></section>
    {error && <FeedbackBanner tone="error" title="Torres AI needs attention"><p>{error}</p></FeedbackBanner>}
    {loading ? <LoadingRegion active label="Opening your private AI workspace" /> : !session ? <StatePanel state="error" title="Sign in to continue" description="Your session is required before any workspace evidence can be retrieved." /> : !snapshot ? <StatePanel state="error" title="Torres AI is not ready" description="The secure service could not be opened. Try again after the Phase 7 migration and service binding are configured." /> : <div className="ai-workspace">
      <aside className="ai-thread-rail" aria-label="Private conversations">
        <div><p className="eyebrow">Your conversations</p><h2>Private ledger</h2></div>
        {snapshot.threads.length ? <div className="ai-thread-list">{snapshot.threads.map((thread) => <button type="button" className={thread.id === snapshot.selectedThreadId ? "is-active" : ""} onClick={() => void loadThread(thread.id)} key={thread.id}><strong>{thread.title}</strong><small>{timeLabel(thread.lastMessageAt || thread.createdAt)}</small></button>)}</div> : <p className="ai-thread-empty">No saved conversations yet.</p>}
        <p className="ai-privacy-note">{snapshot.privacy}</p>
      </aside>
      <section className="ai-conversation" aria-label="Torres AI conversation">
        <header className="ai-conversation-header"><div><p className="eyebrow">Evidence desk</p><h2>{snapshot.selectedThreadId ? "Workspace conversation" : "How can I help?"}</h2></div>{snapshot.selectedThreadId && <button type="button" onClick={() => void archive()} disabled={busy}>Archive</button>}</header>
        <div className="ai-message-ledger" aria-live="polite">
          {!snapshot.messages.length ? <div className="ai-welcome"><span className="ai-mark" aria-hidden="true">T</span><h3>Begin with a private operating question.</h3><p>I will use only the current workspace records you can access and link every factual answer back to its source.</p><div className="ai-starters">{starters.map((starter) => <button type="button" onClick={() => void submit(undefined, starter)} disabled={busy} key={starter.label}>{starter.label}<span aria-hidden="true">→︎</span></button>)}</div></div> : snapshot.messages.map((message) => <article className={`ai-message ai-message-${message.role}`} key={message.id}>
            <div className="ai-message-meta"><strong>{message.role === "assistant" ? "Torres AI" : "You"}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>{message.confidence && <span>{message.confidence} confidence</span>}</div>
            <p>{message.content}</p>
            {message.citations.length > 0 && <div className="ai-citations"><strong>Sources</strong>{message.citations.map((citation) => <Link href={citation.href} key={citation.id}>{citation.label}<span aria-hidden="true">→︎</span></Link>)}</div>}
          </article>)}
          {busy && <div className="ai-thinking" role="status"><span aria-hidden="true" /> Reviewing authorized evidence…</div>}
        </div>
        <form className="ai-composer" onSubmit={(event) => void submit(event)}>
          <label htmlFor="torres-ai-question">Ask Torres AI</label>
          <div><textarea ref={composerRef} id="torres-ai-question" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} rows={3} placeholder="Ask about priorities, client work, projects, service delivery, or reports…" disabled={busy} /><button type="submit" disabled={busy || !prompt.trim()} aria-label="Send question">Send <span aria-hidden="true">→︎</span></button></div>
          <small>{prompt.length.toLocaleString()} / 2,000 · Do not enter passwords, API keys, financial account numbers, or sensitive personal information.</small>
        </form>
      </section>
    </div>}
  </div></Shell>;
}

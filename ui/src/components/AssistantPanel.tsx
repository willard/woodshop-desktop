/**
 * The editor's Assistant tab: a chat about the open design with the model chosen in
 * Settings ▸ AI agents. The model acts through the same tools as an MCP agent, so every change is
 * a version in Versions and reaches the editor like an agent's edit does.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { listen } from '@tauri-apps/api/event';
import { api, errorMessage, type AssistantAction, type AssistantEvent } from '@/app/api';
import { useAssistantKeys, useAssistantSetting } from './AssistantSettings';

interface Message {
    from: 'you' | 'assistant' | 'error';
    text: string;
    actions?: AssistantAction[];
}

/** "resize_part" → "resize part". */
const toolWords = (name: string) => name.replace(/_/g, ' ');

const SETTINGS_GROUP_KEY = 'woodshop.settings.group';

export function AssistantPanel({
    projectId,
    beforeSend,
    onBusyChange,
    onChanged,
}: {
    projectId: number;
    /** Saves the editor's unsaved edits first, so the assistant reads what the user sees. */
    beforeSend: () => Promise<void>;
    onBusyChange: (busy: boolean) => void;
    /** The assistant changed the design: load it into the editor. */
    onChanged: () => void;
}) {
    const setting = useAssistantSetting();
    const keys = useAssistantKeys();
    const provider = setting.provider ?? 'anthropic';
    const ready =
        provider === 'anthropic' ? keys.data?.anthropic === true : (setting.openaiModel ?? '').trim() !== '';

    const [messages, setMessages] = useState<Message[]>([]);
    const [history, setHistory] = useState<unknown[]>([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    /** The reply as it streams in; replaced by the finished message. */
    const [live, setLive] = useState('');
    const [stopping, setStopping] = useState(false);
    const stoppingRef = useRef(false);
    stoppingRef.current = stopping;
    const end = useRef<HTMLDivElement>(null);

    // A conversation is in one provider's format: switching provider starts a new one.
    useEffect(() => {
        setHistory([]);
    }, [provider]);

    useEffect(() => {
        end.current?.scrollIntoView({ block: 'end' });
    }, [messages, progress, live]);

    useEffect(() => {
        if (!busy) return;
        const off = listen<AssistantEvent>('assistant-event', ({ payload }) => {
            if (payload.kind === 'text') {
                setLive((t) => t + payload.delta);
                setProgress(null);
            } else if (payload.kind === 'tool' && !stoppingRef.current) {
                // What it wrote before reaching for a tool was a note to itself; the answer comes after.
                setLive('');
                setProgress(`Using ${toolWords(payload.name)}…`);
            }
        });
        return () => void off.then((fn) => fn());
    }, [busy]);

    async function send(): Promise<void> {
        const text = draft.trim();
        if (text === '' || busy) return;
        setDraft('');
        setMessages((m) => [...m, { from: 'you', text }]);
        setBusy(true);
        onBusyChange(true);
        setProgress('Thinking…');
        try {
            await beforeSend();
            const turn = await api.assistantSend(projectId, history, text);
            setHistory(turn.history);
            setMessages((m) => [...m, { from: 'assistant', text: turn.reply, actions: turn.actions }]);
            if (turn.changed) onChanged();
        } catch (e) {
            setMessages((m) => [...m, { from: 'error', text: errorMessage(e) }]);
        } finally {
            setBusy(false);
            onBusyChange(false);
            setProgress(null);
            setLive('');
            setStopping(false);
        }
    }

    function newChat(): void {
        setMessages([]);
        setHistory([]);
    }

    if (!ready) {
        return (
            <div className="p-4 text-sm" data-testid="assistant-setup">
                <p className="mb-2 font-semibold">Design with an AI assistant</p>
                <p className="text-muted mb-3">
                    Ask for changes in plain words (“add a shelf halfway up”, “make the drawers soft-close”)
                    and the assistant makes them here, each one undoable from Versions. It uses your own API
                    key for Claude or an OpenAI-compatible server.
                </p>
                <Link
                    to="/settings"
                    className="text-accent font-semibold"
                    onClick={() => {
                        try {
                            window.localStorage.setItem(SETTINGS_GROUP_KEY, 'agents');
                        } catch {
                            // Storage unavailable: Settings opens at its first group.
                        }
                    }}
                >
                    Set it up in Settings ▸ AI agents
                </Link>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="assistant-panel">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
                {messages.length === 0 && (
                    <p className="text-muted text-sm">
                        Ask about this design or for a change: “why is the shelf flagged?”, “add a back
                        panel”, “make it 4 inches taller”. Messages and the design are sent to{' '}
                        {provider === 'anthropic' ? 'Anthropic' : 'your model server'}.
                    </p>
                )}
                {messages.map((m, i) => (
                    <div
                        key={i}
                        data-testid={`assistant-message-${m.from}`}
                        className={
                            m.from === 'you'
                                ? 'bg-accent/12 ml-8 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap'
                                : m.from === 'error'
                                  ? 'text-danger-fg text-sm'
                                  : 'text-sm whitespace-pre-wrap'
                        }
                    >
                        {m.text}
                        {m.actions && m.actions.length > 0 && (
                            <ul
                                className="text-faint mt-1.5 space-y-0.5 text-xs"
                                data-testid="assistant-actions"
                            >
                                {m.actions.map((a, j) => (
                                    <li key={j} className={a.ok ? '' : 'text-danger-fg'}>
                                        {a.ok ? '✓' : '✕'} {toolWords(a.tool)}
                                        {a.error ? ` — ${a.error}` : ''}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ))}
                {busy && live !== '' && (
                    <div className="text-sm whitespace-pre-wrap" data-testid="assistant-live">
                        {live}
                    </div>
                )}
                {progress && (
                    <p className="text-muted text-xs" data-testid="assistant-progress">
                        {progress}
                    </p>
                )}
                <div ref={end} />
            </div>
            <div className="border-fg/[0.07] flex-none border-t p-3">
                <textarea
                    className="bg-surface-2 focus:border-accent border-fg/10 h-20 w-full resize-none rounded-lg border p-2 text-sm focus:outline-none"
                    placeholder="Ask the assistant…  (Enter to send, Shift+Enter for a new line)"
                    aria-label="Message to the assistant"
                    value={draft}
                    disabled={busy}
                    data-testid="assistant-input"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                />
                <div className="mt-2 flex items-center justify-between">
                    <button
                        className="text-muted hover:text-fg text-xs disabled:opacity-50"
                        disabled={busy || messages.length === 0}
                        onClick={newChat}
                    >
                        New chat
                    </button>
                    {busy ? (
                        <button
                            className="border-fg/12 hover:bg-surface-3 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                            disabled={stopping}
                            data-testid="assistant-stop"
                            onClick={() => {
                                setStopping(true);
                                setProgress('Stopping…');
                                void api.assistantStop();
                            }}
                        >
                            Stop
                        </button>
                    ) : (
                        <button
                            className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                            disabled={draft.trim() === ''}
                            data-testid="assistant-send"
                            onClick={() => void send()}
                        >
                            Send
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

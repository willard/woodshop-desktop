/** App settings: appearance, cut-list defaults, where the library lives, MCP setup, updates. */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { api, errorMessage } from '@/app/api';
import { formatFraction } from '@/lib/fraction';
import { readPreference, setPreference, type ThemePreference } from '@/lib/theme';
import { useToast } from '@/components/Toast';
import { KERF_OPTIONS, useDefaultKerf } from '@/app/settings';

function Section({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <section className="border-fg/8 bg-surface-1/50 mb-5 rounded-xl border p-5">
            <h2 className="mb-1 font-semibold">{title}</h2>
            {description && <p className="text-muted mb-4 text-sm">{description}</p>}
            {children}
        </section>
    );
}

function Copyable({ text, testId }: { text: string; testId?: string }) {
    const toast = useToast();
    return (
        <div className="relative">
            <pre
                className="bg-surface-0 border-fg/8 text-fg-strong overflow-x-auto rounded-lg border p-3 pr-20 text-xs"
                data-testid={testId}
            >
                {text}
            </pre>
            <button
                className="border-fg/12 bg-surface-2 hover:bg-surface-3 absolute top-2 right-2 rounded-md border px-2 py-1 text-xs"
                onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Copied.'))}
            >
                Copy
            </button>
        </div>
    );
}

export default function SettingsPage() {
    const toast = useToast();
    const queryClient = useQueryClient();
    const info = useQuery({ queryKey: ['library-info'], queryFn: api.libraryInfo, staleTime: Infinity });
    const mcp = useQuery({ queryKey: ['mcp-setup'], queryFn: api.mcpSetup, staleTime: Infinity });
    const kerf = useDefaultKerf();
    const [theme, setTheme] = useState<ThemePreference>(readPreference);
    const [updateStatus, setUpdateStatus] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);

    async function setKerf(value: number): Promise<void> {
        try {
            await api.setSetting('defaultKerf', value);
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
        } catch (e) {
            toast.error(errorMessage(e));
        }
    }

    async function checkForUpdates(): Promise<void> {
        setChecking(true);
        setUpdateStatus(null);
        try {
            const update = await check();
            if (update === null) {
                setUpdateStatus('You have the latest version.');
                return;
            }
            setUpdateStatus(`Downloading Woodshop ${update.version}…`);
            await update.downloadAndInstall();
            setUpdateStatus('Update installed — restarting.');
            await relaunch();
        } catch (e) {
            setUpdateStatus(`Couldn't check for updates: ${errorMessage(e)}`);
        } finally {
            setChecking(false);
        }
    }

    const choice = (active: boolean) =>
        `h-9 flex-1 rounded-lg border px-3 text-sm ${active ? 'border-accent bg-accent/12 text-accent font-medium' : 'border-fg/12 text-muted hover:bg-surface-2'}`;

    return (
        <div className="max-w-3xl">
            <h1 className="mb-6 text-xl font-semibold tracking-tight">Settings</h1>

            <Section title="Appearance">
                <div className="flex gap-2">
                    {(['system', 'light', 'dark'] as const).map((t) => (
                        <button
                            key={t}
                            className={choice(theme === t)}
                            onClick={() => {
                                setPreference(t);
                                setTheme(t);
                            }}
                        >
                            {t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
                        </button>
                    ))}
                </div>
            </Section>

            <Section
                title="Cut list"
                description="The saw kerf every new editor session starts with. You can still change it per session in the Cut list panel."
            >
                <div className="flex gap-2">
                    {KERF_OPTIONS.map((k) => (
                        <button key={k} className={choice(kerf === k)} onClick={() => void setKerf(k)}>
                            {formatFraction(k, 32)}"
                        </button>
                    ))}
                </div>
            </Section>

            <Section
                title="Project library"
                description="Every project, version, note and thumbnail is stored in one folder on this computer. Back it up like any other folder, or export single projects as .woodshop files."
            >
                {info.data && (
                    <div className="flex items-center gap-2">
                        <code className="bg-surface-0 border-fg/8 min-w-0 flex-1 truncate rounded-lg border px-3 py-2 text-xs">
                            {info.data.dataDir}
                        </code>
                        <button
                            className="border-fg/12 hover:bg-surface-2 flex-none rounded-lg border px-3 py-2 text-sm"
                            onClick={() =>
                                void revealItemInDir(`${info.data.dataDir}/woodshop.db`).catch((e) =>
                                    toast.error(errorMessage(e)),
                                )
                            }
                        >
                            Show in folder
                        </button>
                    </div>
                )}
            </Section>

            <Section
                title="AI agents (MCP)"
                description="Let Claude Desktop, Claude Code or any MCP client design in your library. The server runs locally from this app — no account, no token, nothing sent anywhere by Woodshop itself."
            >
                {mcp.data ? (
                    <>
                        <p className="text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
                            Claude Desktop — claude_desktop_config.json
                        </p>
                        <Copyable text={mcp.data.claudeDesktopConfig} testId="mcp-desktop-config" />
                        <p className="text-muted mt-4 mb-2 text-xs font-semibold tracking-wider uppercase">
                            Claude Code
                        </p>
                        <Copyable text={mcp.data.claudeCodeCommand} testId="mcp-code-command" />
                        <p className="text-faint mt-3 text-xs">
                            Every agent edit is snapshotted as a version first, and an open editor picks the
                            change up.
                        </p>
                    </>
                ) : (
                    mcp.isError && <p className="text-danger-fg text-sm">{errorMessage(mcp.error)}</p>
                )}
            </Section>

            <Section
                title="Updates"
                description={`Woodshop ${info.data?.version ?? ''}. Updates are signed and downloaded from the project's releases — nothing else is sent.`}
            >
                <div className="flex items-center gap-3">
                    <button
                        className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                        disabled={checking}
                        onClick={() => void checkForUpdates()}
                    >
                        {checking ? 'Checking…' : 'Check for updates'}
                    </button>
                    {updateStatus && <span className="text-muted text-sm">{updateStatus}</span>}
                </div>
            </Section>

            <Section
                title="Diagnostics"
                description="If something goes wrong, Woodshop writes what happened to a log file on this computer. Nothing is sent anywhere; attach the file when you report a problem."
            >
                {info.data?.logDir && (
                    <div className="flex items-center gap-2">
                        <code className="bg-surface-0 border-fg/8 min-w-0 flex-1 truncate rounded-lg border px-3 py-2 text-xs">
                            {info.data.logDir}
                        </code>
                        <button
                            className="border-fg/12 hover:bg-surface-2 flex-none rounded-lg border px-3 py-2 text-sm"
                            data-testid="show-logs"
                            onClick={() =>
                                void revealItemInDir(info.data.logDir!).catch((e) =>
                                    toast.error(errorMessage(e)),
                                )
                            }
                        >
                            Show log files
                        </button>
                    </div>
                )}
            </Section>
        </div>
    );
}

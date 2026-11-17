/**
 * Settings ▸ AI agents ▸ Design assistant: which provider and model the in-app chat uses, and the
 * API key, which goes straight to the system keychain and never comes back to the page.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, failure, type AssistantProvider, type AssistantSetting } from '@/app/api';
import { useSettings } from '@/app/settings';
import { useToast } from '@/components/Toast';
import { Field, Select, TextInput } from './form';

export const CLAUDE_MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most capable' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — faster, costs less' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, cheapest' },
];

export function useAssistantSetting(): AssistantSetting {
    const v = useSettings().data?.assistant;
    return typeof v === 'object' && v !== null ? (v as AssistantSetting) : {};
}

export function useAssistantKeys() {
    return useQuery({ queryKey: ['assistant-keys'], queryFn: api.assistantKeys });
}

export function AssistantSettings() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const setting = useAssistantSetting();
    const keys = useAssistantKeys();
    const provider: AssistantProvider = setting.provider ?? 'anthropic';
    const [key, setKey] = useState('');
    const [busy, setBusy] = useState(false);

    async function update(patch: Partial<AssistantSetting>): Promise<void> {
        try {
            await api.setSetting('assistant', { ...setting, ...patch });
            await queryClient.invalidateQueries({ queryKey: ['settings'] });
        } catch (e) {
            toast.error(failure('save the assistant setting', e));
        }
    }

    async function saveKey(value: string | null): Promise<void> {
        setBusy(true);
        try {
            await api.assistantSetKey(provider, value);
            setKey('');
            await queryClient.invalidateQueries({ queryKey: ['assistant-keys'] });
            toast.success(value === null ? 'Key removed.' : 'Key saved in the keychain.');
        } catch (e) {
            toast.error(failure(value === null ? 'remove the key' : 'save the key', e));
        } finally {
            setBusy(false);
        }
    }

    const hasKey = keys.data?.[provider] ?? false;
    return (
        <div className="grid gap-4" data-testid="assistant-settings">
            <Field label="Provider">
                <Select
                    h="md"
                    value={provider}
                    data-testid="assistant-provider"
                    onChange={(e) => void update({ provider: e.target.value as AssistantProvider })}
                >
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai">OpenAI-compatible server (OpenAI, Ollama, …)</option>
                </Select>
            </Field>
            {provider === 'anthropic' ? (
                <Field label="Model">
                    <Select
                        h="md"
                        value={setting.anthropicModel ?? CLAUDE_MODELS[0].id}
                        data-testid="assistant-model"
                        onChange={(e) => void update({ anthropicModel: e.target.value })}
                    >
                        {CLAUDE_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.label}
                            </option>
                        ))}
                    </Select>
                </Field>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Server address">
                        <TextInput
                            h="md"
                            placeholder="https://api.openai.com/v1"
                            defaultValue={setting.openaiBaseUrl ?? ''}
                            data-testid="assistant-base-url"
                            onBlur={(e) => {
                                if (e.target.value !== (setting.openaiBaseUrl ?? ''))
                                    void update({ openaiBaseUrl: e.target.value.trim() });
                            }}
                        />
                    </Field>
                    <Field label="Model">
                        <TextInput
                            h="md"
                            placeholder="The model's name on that server"
                            defaultValue={setting.openaiModel ?? ''}
                            data-testid="assistant-openai-model"
                            onBlur={(e) => {
                                if (e.target.value !== (setting.openaiModel ?? ''))
                                    void update({ openaiModel: e.target.value.trim() });
                            }}
                        />
                    </Field>
                </div>
            )}
            <Field
                label={
                    provider === 'anthropic'
                        ? 'API key (from console.anthropic.com)'
                        : 'API key (leave empty for a local server that needs none)'
                }
            >
                <div className="flex gap-2">
                    <TextInput
                        h="md"
                        type="password"
                        autoComplete="off"
                        placeholder={
                            hasKey ? 'A key is saved — type a new one to replace it' : 'Paste your key'
                        }
                        value={key}
                        data-testid="assistant-key"
                        onChange={(e) => setKey(e.target.value)}
                    />
                    <button
                        className="bg-accent text-accent-ink hover:bg-accent-strong flex-none rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
                        disabled={busy || key.trim() === ''}
                        data-testid="assistant-key-save"
                        onClick={() => void saveKey(key.trim())}
                    >
                        Save
                    </button>
                    {hasKey && (
                        <button
                            className="border-fg/12 hover:bg-surface-3 flex-none rounded-lg border px-3 text-sm disabled:opacity-50"
                            disabled={busy}
                            data-testid="assistant-key-remove"
                            onClick={() => void saveKey(null)}
                        >
                            Remove
                        </button>
                    )}
                </div>
            </Field>
            <p className="text-faint text-xs" data-testid="assistant-key-status">
                {hasKey ? 'A key is saved in your system keychain.' : 'No key saved yet.'} While you use the
                assistant, your messages and the open design are sent to this provider, and its use is billed
                to your key. Nothing is sent otherwise.
            </p>
        </div>
    );
}

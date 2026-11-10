/**
 * EditorDocument — framework-agnostic editor state (CLAUDE.md §4). Owns the spec (the
 * document), the current selection, and the undo/redo history. It is the ONLY place the
 * spec is mutated, and every mutation goes through a Command, is schema-validated, and is
 * available to the linter (hard rules 4 & 9). No Three.js, no Vue — testable in isolation.
 *
 * Selection (1.6): an ordered id list plus an optional group flavour. Single-part consumers
 * read `selectedId`, which is non-null only when exactly one part is selected — they degrade
 * gracefully during multi/group selection. The group-first / drill-in click behaviour lives
 * here (`handlePick`), so the engine stays a dumb modifier-threading picker.
 */
import { parseSpec, type Spec, type Part, type Group } from '../spec';
import { lintSpec, type LintIssue } from '../spec/linter';
import { groupOf, type Command } from './commands';

const HISTORY_LIMIT = 100;

export type DocumentListener = (doc: EditorDocument) => void;

export interface PickOptions {
    /** Shift/Cmd/Ctrl was held: toggle membership instead of replacing the selection. */
    additive: boolean;
    /** The pick came from a drag start: never drill into a group member mid-drag. */
    fromDrag?: boolean;
}

export class EditorDocument {
    private currentSpec: Spec;
    private selectedPartIds: string[] = [];
    private selectedGroupIdValue: string | null = null;
    private readonly undoStack: Command[] = [];
    private readonly redoStack: Command[] = [];
    private readonly listeners = new Set<DocumentListener>();

    constructor(spec: Spec) {
        this.currentSpec = parseSpec(spec);
    }

    get spec(): Spec {
        return this.currentSpec;
    }

    /** The sole selected part id, or null when nothing or several parts are selected. */
    get selectedId(): string | null {
        return this.selectedPartIds.length === 1 ? this.selectedPartIds[0] : null;
    }

    get selectedIds(): readonly string[] {
        return this.selectedPartIds;
    }

    get selectedGroupId(): string | null {
        return this.selectedGroupIdValue;
    }

    get selectedGroup(): Group | null {
        if (this.selectedGroupIdValue === null) {
            return null;
        }
        return (this.currentSpec.groups ?? []).find((g) => g.id === this.selectedGroupIdValue) ?? null;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** Applies a command, validating the result. Throws (leaving state intact) if invalid. */
    execute(command: Command): void {
        const next = parseSpec(command.do(this.currentSpec));
        this.currentSpec = next;
        this.undoStack.push(command);
        if (this.undoStack.length > HISTORY_LIMIT) {
            this.undoStack.shift();
        }
        this.redoStack.length = 0;
        this.pruneSelection();
        this.emit();
    }

    /**
     * Applies a command in place of the top undo entry, as if the two were always one — how a
     * burst of arrow-key nudges becomes a single undo step instead of thirty. The caller passes
     * the *cumulative* command (the whole nudge so far), not the increment.
     *
     * The replacement is validated against the reverted spec before anything is committed, so a
     * nudge that would push a part out of bounds leaves both the document and the history exactly
     * as they were.
     */
    executeReplacingTop(command: Command): void {
        const top = this.undoStack[this.undoStack.length - 1];
        if (top === undefined) {
            this.execute(command);
            return;
        }

        const reverted = parseSpec(top.undo(this.currentSpec));
        const next = parseSpec(command.do(reverted));

        this.undoStack.pop();
        this.currentSpec = next;
        this.undoStack.push(command);
        this.redoStack.length = 0;
        this.pruneSelection();
        this.emit();
    }

    undo(): void {
        const command = this.undoStack.pop();
        if (command === undefined) {
            return;
        }
        this.currentSpec = parseSpec(command.undo(this.currentSpec));
        this.redoStack.push(command);
        this.pruneSelection();
        this.emit();
    }

    redo(): void {
        const command = this.redoStack.pop();
        if (command === undefined) {
            return;
        }
        this.currentSpec = parseSpec(command.do(this.currentSpec));
        this.undoStack.push(command);
        this.pruneSelection();
        this.emit();
    }

    /** Literal single selection (cut-list issue clicks, tests): no group resolution. */
    select(partId: string | null): void {
        this.setSelection(partId === null ? [] : [partId], null);
    }

    /** Selects a whole group (or clears the group flavour with null). */
    selectGroup(groupId: string | null): void {
        if (groupId === null) {
            this.setSelection([], null);
            return;
        }
        const group = (this.currentSpec.groups ?? []).find((g) => g.id === groupId);
        if (group !== undefined) {
            this.setSelection([...group.partIds], group.id);
        }
    }

    /**
     * The canvas/cut-list click state machine (design: group-first, click again to drill).
     * - Plain click on a grouped part selects its whole group; a second plain click on a
     *   member drills into that single part. Drag-initiated picks never drill (fromDrag).
     * - Additive clicks toggle: whole groups atomically, ungrouped parts individually.
     */
    handlePick(partId: string | null, options: PickOptions): void {
        if (partId === null) {
            if (!options.additive) {
                this.setSelection([], null);
            }
            return;
        }
        const group = groupOf(this.currentSpec, partId);

        if (options.additive) {
            const toggled = new Set(this.selectedPartIds);
            const ids = group === null ? [partId] : group.partIds;
            const allIn = ids.every((id) => toggled.has(id));
            for (const id of ids) {
                if (allIn) {
                    toggled.delete(id);
                } else {
                    toggled.add(id);
                }
            }
            // Additive selection is always a plain multi-select (group flavour would make
            // "which group do the actions target?" ambiguous).
            this.setSelection(
                this.currentSpec.parts.map((p) => p.id).filter((id) => toggled.has(id)),
                null,
            );
            return;
        }

        if (group === null) {
            this.setSelection([partId], null);
            return;
        }
        if (this.selectedGroupIdValue === group.id) {
            if (options.fromDrag === true) {
                return; // grabbing a member of the selected group must not drill mid-drag
            }
            this.setSelection([partId], null); // drill into the member
            return;
        }
        this.setSelection([...group.partIds], group.id);
    }

    get selectedPart(): Part | null {
        const id = this.selectedId;
        if (id === null) {
            return null;
        }
        return this.currentSpec.parts.find((p) => p.id === id) ?? null;
    }

    /** Current linter issues for the whole spec (surface red/amber in the UI). */
    lint(): LintIssue[] {
        return lintSpec(this.currentSpec);
    }

    /** Linter issues grouped by part id, for per-part badges. */
    issuesByPart(): Map<string, LintIssue[]> {
        const byPart = new Map<string, LintIssue[]>();
        for (const issue of this.lint()) {
            if (issue.partId === undefined) {
                continue;
            }
            const list = byPart.get(issue.partId) ?? [];
            list.push(issue);
            byPart.set(issue.partId, list);
        }
        return byPart;
    }

    subscribe(listener: DocumentListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Applies a selection change, emitting only when something actually changed. */
    private setSelection(ids: string[], groupId: string | null): void {
        const same =
            groupId === this.selectedGroupIdValue &&
            ids.length === this.selectedPartIds.length &&
            ids.every((id, i) => id === this.selectedPartIds[i]);
        if (same) {
            return;
        }
        this.selectedPartIds = ids;
        this.selectedGroupIdValue = groupId;
        this.emit();
    }

    /**
     * Reconciles the selection after a mutation: dead part ids drop out; a vanished group
     * loses its flavour but keeps surviving members as a plain multi-select; a surviving
     * group re-syncs its membership (undo/redo can change it).
     */
    private pruneSelection(): void {
        let ids = this.selectedPartIds.filter((id) => this.currentSpec.parts.some((p) => p.id === id));
        let groupId = this.selectedGroupIdValue;
        if (groupId !== null) {
            const group = (this.currentSpec.groups ?? []).find((g) => g.id === groupId);
            if (group === undefined) {
                groupId = null;
            } else {
                ids = [...group.partIds];
            }
        }
        this.selectedPartIds = ids;
        this.selectedGroupIdValue = groupId;
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener(this);
        }
    }
}

/**
 * Editor keyboard shortcuts (Phase 1d). Pure handler so it can be unit tested without a DOM:
 * given a KeyboardEvent and a set of actions, it decides what to do and returns whether it
 * handled the event. The Vue layer wires it to a window keydown listener.
 */
export interface ShortcutActions {
    undo(): void;
    redo(): void;
    duplicate(): void;
    remove(): void;
    deselect(): void;
    hasSelection(): boolean;
    /** Group the current multi-selection (mod+G). */
    group(): void;
    canGroup(): boolean;
    /** Dissolve the selected group (mod+shift+G). */
    ungroup(): void;
    hasGroupSelection(): boolean;
    /** Move the selection by one step (arrow keys; PageUp/PageDown for height). */
    nudge(direction: NudgeDirection, step: NudgeStep): void;
    /** Hide the selection (H), show only it (shift+H), or bring everything back (alt+H). */
    hide(): void;
    isolate(): void;
    showAll(): void;
}

/** Viewer-relative directions the arrow keys ask for; the engine maps them to world axes. */
export type NudgeDirection = 'left' | 'right' | 'forward' | 'back' | 'up' | 'down';
export type NudgeStep = 'grid' | 'coarse' | 'fine';

/** Arrow (and page) keys, in viewer terms. Up/down the screen is along the ground, not the Y axis. */
const NUDGE_KEYS: Record<string, NudgeDirection> = {
    arrowleft: 'left',
    arrowright: 'right',
    arrowup: 'forward',
    arrowdown: 'back',
    pageup: 'up',
    pagedown: 'down',
};

/** True if the event originated from a text field, where shortcuts must not fire. */
function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (el === null) {
        return false;
    }
    return (
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
    );
}

export function handleEditorKeydown(event: KeyboardEvent, actions: ShortcutActions): boolean {
    if (isTypingTarget(event.target)) {
        return false;
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z' && !event.shiftKey) {
        actions.undo();
        event.preventDefault();
        return true;
    }
    if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
        actions.redo();
        event.preventDefault();
        return true;
    }
    if (mod && key === 'd') {
        event.preventDefault(); // stop the browser's bookmark dialog
        if (actions.hasSelection()) {
            actions.duplicate();
        }
        return true;
    }
    if (mod && key === 'g') {
        event.preventDefault(); // stop the browser's find-again / native group
        if (event.shiftKey) {
            if (actions.hasGroupSelection()) {
                actions.ungroup();
            }
        } else if (actions.canGroup()) {
            actions.group();
        }
        return true;
    }
    if ((key === 'delete' || key === 'backspace') && actions.hasSelection()) {
        actions.remove();
        event.preventDefault();
        return true;
    }
    if (key === 'escape') {
        actions.deselect();
        return true;
    }
    // Visibility (view only — nothing here touches the spec). Alt+H comes first: it must work
    // even with nothing selected, since that is exactly the state you are in after hiding.
    if (key === 'h' && !mod) {
        event.preventDefault();
        if (event.altKey) {
            actions.showAll();
        } else if (actions.hasSelection()) {
            if (event.shiftKey) {
                actions.isolate();
            } else {
                actions.hide();
            }
        }
        return true;
    }
    // Nudge. No modifier key of its own — mod+arrow is a browser/OS navigation gesture, so only
    // shift (coarse) and alt (fine) change the step. However, mod+up/down is mapped to height
    // nudging (up/down) as an alternative to PageUp/PageDown for compact keyboards.
    let direction = NUDGE_KEYS[key];
    const isHeightNudge = mod && (key === 'arrowup' || key === 'arrowdown');

    if (isHeightNudge) {
        direction = key === 'arrowup' ? 'up' : 'down';
    }

    if (direction !== undefined && (!mod || isHeightNudge)) {
        event.preventDefault(); // stop the page scrolling under the editor
        if (actions.hasSelection()) {
            actions.nudge(direction, event.shiftKey ? 'coarse' : event.altKey ? 'fine' : 'grid');
        }
        return true;
    }
    return false;
}

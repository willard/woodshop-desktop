import { describe, it, expect, vi } from 'vitest';
import { handleEditorKeydown, type ShortcutActions } from '@/lib/shortcuts';

function actions(overrides: Partial<ShortcutActions> = {}): ShortcutActions {
    return {
        undo: vi.fn(),
        redo: vi.fn(),
        duplicate: vi.fn(),
        remove: vi.fn(),
        deselect: vi.fn(),
        hasSelection: () => true,
        nudge: vi.fn(),
        group: vi.fn(),
        canGroup: () => true,
        ungroup: vi.fn(),
        hasGroupSelection: () => true,
        hide: vi.fn(),
        isolate: vi.fn(),
        showAll: vi.fn(),
        ...overrides,
    };
}

function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
    return {
        preventDefault: vi.fn(),
        target: null,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        ...init,
    } as unknown as KeyboardEvent;
}

describe('handleEditorKeydown', () => {
    it('Cmd/Ctrl+Z undoes; Shift adds redo', () => {
        const a = actions();
        expect(handleEditorKeydown(key({ key: 'z', metaKey: true }), a)).toBe(true);
        expect(a.undo).toHaveBeenCalledOnce();
        handleEditorKeydown(key({ key: 'z', metaKey: true, shiftKey: true }), a);
        expect(a.redo).toHaveBeenCalledOnce();
        handleEditorKeydown(key({ key: 'y', ctrlKey: true }), a);
        expect(a.redo).toHaveBeenCalledTimes(2);
    });

    it('Delete/Backspace removes only when something is selected', () => {
        const a = actions();
        handleEditorKeydown(key({ key: 'Delete' }), a);
        expect(a.remove).toHaveBeenCalledOnce();

        const none = actions({ hasSelection: () => false });
        expect(handleEditorKeydown(key({ key: 'Backspace' }), none)).toBe(false);
        expect(none.remove).not.toHaveBeenCalled();
    });

    it('Cmd/Ctrl+D duplicates and Escape deselects', () => {
        const a = actions();
        handleEditorKeydown(key({ key: 'd', metaKey: true }), a);
        expect(a.duplicate).toHaveBeenCalledOnce();
        handleEditorKeydown(key({ key: 'Escape' }), a);
        expect(a.deselect).toHaveBeenCalledOnce();
    });

    it('ignores keys while typing in a form field', () => {
        const a = actions();
        const target = { tagName: 'INPUT', isContentEditable: false } as unknown as HTMLElement;
        expect(handleEditorKeydown(key({ key: 'Delete', target }), a)).toBe(false);
        expect(a.remove).not.toHaveBeenCalled();
    });
});

describe('group shortcuts', () => {
    it('Cmd/Ctrl+G groups when groupable', () => {
        const a = actions();
        expect(handleEditorKeydown(key({ key: 'g', metaKey: true }), a)).toBe(true);
        expect(a.group).toHaveBeenCalledOnce();
        expect(a.ungroup).not.toHaveBeenCalled();
    });

    it('Cmd/Ctrl+G does nothing when the selection cannot group (still swallows the key)', () => {
        const a = actions({ canGroup: () => false });
        expect(handleEditorKeydown(key({ key: 'g', metaKey: true }), a)).toBe(true);
        expect(a.group).not.toHaveBeenCalled();
    });

    it('Shift+Cmd/Ctrl+G ungroups the selected group', () => {
        const a = actions();
        expect(handleEditorKeydown(key({ key: 'g', metaKey: true, shiftKey: true }), a)).toBe(true);
        expect(a.ungroup).toHaveBeenCalledOnce();
        expect(a.group).not.toHaveBeenCalled();
    });
});

describe('nudge keys', () => {
    function press(
        key: string,
        init: Partial<KeyboardEventInit> = {},
    ): { event: KeyboardEvent; nudge: ReturnType<typeof vi.fn> } {
        const nudge = vi.fn();
        const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
        handleEditorKeydown(event, actions({ nudge }));
        return { event, nudge };
    }

    it('maps the arrows to viewer-relative directions', () => {
        expect(press('ArrowLeft').nudge).toHaveBeenCalledWith('left', 'grid');
        expect(press('ArrowRight').nudge).toHaveBeenCalledWith('right', 'grid');
        expect(press('ArrowUp').nudge).toHaveBeenCalledWith('forward', 'grid');
        expect(press('ArrowDown').nudge).toHaveBeenCalledWith('back', 'grid');
    });

    it('raises and lowers with PageUp/PageDown', () => {
        expect(press('PageUp').nudge).toHaveBeenCalledWith('up', 'grid');
        expect(press('PageDown').nudge).toHaveBeenCalledWith('down', 'grid');
    });

    it('takes a coarse step with shift and a fine one with alt', () => {
        expect(press('ArrowLeft', { shiftKey: true }).nudge).toHaveBeenCalledWith('left', 'coarse');
        expect(press('ArrowLeft', { altKey: true }).nudge).toHaveBeenCalledWith('left', 'fine');
    });

    it('stops the page scrolling under the editor', () => {
        expect(press('ArrowDown').event.defaultPrevented).toBe(true);
    });

    it('leaves mod+arrowleft/right to the browser (history navigation, word jumps)', () => {
        const nudge = vi.fn();
        const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, cancelable: true });
        expect(handleEditorKeydown(event, actions({ nudge }))).toBe(false);
        expect(nudge).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('raises and lowers with mod+ArrowUp/ArrowDown as an alternative to PageUp/PageDown', () => {
        expect(press('ArrowUp', { metaKey: true }).nudge).toHaveBeenCalledWith('up', 'grid');
        expect(press('ArrowDown', { ctrlKey: true }).nudge).toHaveBeenCalledWith('down', 'grid');
    });

    it('does nothing with an empty selection, but still swallows the scroll', () => {
        const nudge = vi.fn();
        const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
        handleEditorKeydown(event, actions({ nudge, hasSelection: () => false }));
        expect(nudge).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
    });

    it('never fires while typing in a field — arrows move the caret there', () => {
        const nudge = vi.fn();
        const input = document.createElement('input');
        const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
        Object.defineProperty(event, 'target', { value: input });
        expect(handleEditorKeydown(event, actions({ nudge }))).toBe(false);
        expect(nudge).not.toHaveBeenCalled();
    });
});

describe('visibility shortcuts', () => {
    it('hides the selection on H', () => {
        const a = actions();
        expect(handleEditorKeydown(key({ key: 'h' }), a)).toBe(true);
        expect(a.hide).toHaveBeenCalled();
        expect(a.isolate).not.toHaveBeenCalled();
    });

    it('isolates on shift+H', () => {
        const a = actions();
        handleEditorKeydown(key({ key: 'H', shiftKey: true }), a);
        expect(a.isolate).toHaveBeenCalled();
        expect(a.hide).not.toHaveBeenCalled();
    });

    it('shows everything on alt+H even with nothing selected', () => {
        // The state you are in right after hiding: no selection, and you want it back.
        const a = actions({ hasSelection: () => false });
        handleEditorKeydown(key({ key: 'h', altKey: true }), a);
        expect(a.showAll).toHaveBeenCalled();
    });

    it('does not hide when nothing is selected', () => {
        const a = actions({ hasSelection: () => false });
        handleEditorKeydown(key({ key: 'h' }), a);
        expect(a.hide).not.toHaveBeenCalled();
    });

    it('leaves mod+H to the browser', () => {
        const a = actions();
        expect(handleEditorKeydown(key({ key: 'h', metaKey: true }), a)).toBe(false);
        expect(a.hide).not.toHaveBeenCalled();
    });

    it('ignores H typed into a field', () => {
        const a = actions();
        const target = { tagName: 'INPUT' } as unknown as EventTarget;
        handleEditorKeydown(key({ key: 'h', target }), a);
        expect(a.hide).not.toHaveBeenCalled();
    });
});

import { describe, it, expect } from 'vitest';
import { computeMovement, emcFromRh, type MovementInput } from '@/calc/movement';
import { speciesById } from '@/lib/species';

function panel(over: Partial<MovementInput> = {}): MovementInput {
    return {
        speciesId: 'oak',
        width: 24,
        grain: 'flatsawn',
        moisture: { kind: 'rh', lowPercent: 30, highPercent: 70 },
        ...over,
    };
}

describe('emcFromRh', () => {
    it('hits the standard table rows exactly', () => {
        expect(emcFromRh(30)).toBeCloseTo(6.2, 10);
        expect(emcFromRh(50)).toBeCloseTo(9.3, 10);
        expect(emcFromRh(70)).toBeCloseTo(13.1, 10);
        expect(emcFromRh(80)).toBeCloseTo(16.0, 10);
    });

    it('interpolates between them', () => {
        expect(emcFromRh(32.5)).toBeCloseTo((6.2 + 6.9) / 2, 10);
        expect(emcFromRh(62.5)).toBeCloseTo((11.0 + 12.0) / 2, 10);
    });

    it('rises monotonically with humidity', () => {
        let previous = -Infinity;
        for (let rh = 5; rh <= 95; rh += 1) {
            const emc = emcFromRh(rh);
            expect(emc).toBeGreaterThan(previous);
            previous = emc;
        }
    });

    it('clamps outside the table rather than extrapolating into nonsense', () => {
        expect(emcFromRh(0)).toBe(emcFromRh(5));
        expect(emcFromRh(100)).toBe(emcFromRh(95));
    });
});

describe('computeMovement', () => {
    it('matches the worked reference: a 24in flatsawn red oak panel, 30 to 70 percent', () => {
        const r = computeMovement(panel());
        expect(r?.deltaEmc).toBeCloseTo(6.9, 10);
        expect(r?.coefficient).toBe(0.00369);
        expect(r?.change).toBeCloseTo(0.6111, 4);
        expect(r?.perSide).toBeCloseTo(0.3055, 4);
    });

    it('leads with the per-side figure, which is the one you build to', () => {
        const r = computeMovement(panel());
        expect(r?.perSide).toBeCloseTo((r as { change: number }).change / 2, 12);
        expect(r?.widthAtHigh as number).toBeGreaterThan(r?.widthAtLow as number);
        expect((r?.widthAtHigh as number) - (r?.widthAtLow as number)).toBeCloseTo(
            (r as { change: number }).change,
            10,
        );
    });

    it('always reports both grain orientations, whichever was chosen', () => {
        // A wrong guess about how the board was sawn should be visible, not authoritative.
        const flat = computeMovement(panel({ grain: 'flatsawn' }));
        const quarter = computeMovement(panel({ grain: 'quartersawn' }));

        expect(flat?.flatsawnChange).toBeCloseTo(quarter?.flatsawnChange as number, 12);
        expect(flat?.quartersawnChange).toBeCloseTo(quarter?.quartersawnChange as number, 12);
        expect(flat?.change).toBeCloseTo(flat?.flatsawnChange as number, 12);
        expect(quarter?.change).toBeCloseTo(quarter?.quartersawnChange as number, 12);
        // Quartersawn is the calmer cut — that is the whole reason to pay for it.
        expect(quarter?.change as number).toBeLessThan(flat?.change as number);
    });

    it('treats rift as the midpoint', () => {
        const r = computeMovement(panel({ grain: 'riftsawn' }));
        const oak = speciesById('oak');
        expect(r?.coefficient).toBeCloseTo(((oak?.tangential as number) + (oak?.radial as number)) / 2, 12);
    });

    it('scales with width and with the size of the swing', () => {
        const narrow = computeMovement(panel({ width: 12 }));
        const wide = computeMovement(panel({ width: 24 }));
        expect((wide?.change as number) / (narrow?.change as number)).toBeCloseTo(2, 10);

        const mild = computeMovement(panel({ moisture: { kind: 'rh', lowPercent: 40, highPercent: 60 } }));
        expect(mild?.change as number).toBeLessThan(wide?.change as number);
    });

    it('accepts moisture content directly for someone with a meter', () => {
        const r = computeMovement(panel({ moisture: { kind: 'emc', lowPercent: 6, highPercent: 12 } }));
        expect(r?.deltaEmc).toBeCloseTo(6, 10);
        expect(r?.change).toBeCloseTo(24 * 0.00369 * 6, 8);
    });

    it('is symmetric about which end of the range you give first', () => {
        const up = computeMovement(panel({ moisture: { kind: 'rh', lowPercent: 30, highPercent: 70 } }));
        const down = computeMovement(panel({ moisture: { kind: 'rh', lowPercent: 70, highPercent: 30 } }));
        expect(up?.change).toBeCloseTo(down?.change as number, 12);
    });

    it('refuses panels rather than inventing a number for them', () => {
        expect(computeMovement(panel({ speciesId: 'mdf' }))).toBeNull();
        expect(computeMovement(panel({ speciesId: 'plywood_baltic' }))).toBeNull();
        expect(computeMovement(panel({ speciesId: 'nope' as never }))).toBeNull();
    });

    it('warns that flatsawn is the figure to plan around', () => {
        expect(computeMovement(panel({ grain: 'flatsawn' }))?.notes.join(' ')).toContain('twice');
        expect(computeMovement(panel())?.notes.join(' ')).toContain('across-grain');
    });
});

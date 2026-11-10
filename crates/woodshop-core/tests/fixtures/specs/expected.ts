/**
 * Frozen expectations for the golden fixtures (CLAUDE.md: golden specs are frozen; any
 * change to their expected render/cut-list output requires a DECISIONS.md entry). Phase 1a
 * freezes part/material counts; Phase 3 adds expected cut-list snapshots alongside these.
 */
export interface GoldenExpectation {
    readonly partCount: number;
    readonly materialCount: number;
    readonly jointCount: number;
}

// Joint counts jumped in spec 1.8 (D54): the fixtures were butted together with nothing holding
// them, which the fastening rules now reject, so both carry their real screws and pocket screws.
export const goldenExpectations = {
    'record-stand': { partCount: 6, materialCount: 1, jointCount: 10 },
    bookshelf: { partCount: 8, materialCount: 1, jointCount: 17 },
} as const satisfies Record<string, GoldenExpectation>;

export type GoldenName = keyof typeof goldenExpectations;

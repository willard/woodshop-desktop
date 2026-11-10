/**
 * Convenience types derived from the generated Zod schema (types only — validation runs in the
 * Rust core). `Spec` is the parsed shape, with schema defaults filled; these are indexed views.
 */
import type { Spec } from './schema.generated';

export type { Spec };

export type Material = Spec['materials'][number];
export type Part = Spec['parts'][number];
export type Joint = NonNullable<Spec['joints']>[number];
export type Group = NonNullable<Spec['groups']>[number];
export type Movable = NonNullable<Spec['movables']>[number];
export type Op = Part['ops'] extends readonly (infer O)[] | undefined ? O : never;

/** Wood species preset (spec 1.3) — drives renderer tint and cut-list labels. */
export type Species = NonNullable<Material['species']>;

/** Local-frame axis label (build-plan §3.1). */
export type Axis = 'l' | 'w';

/** Local-frame edge label (build-plan §3.1): l0/l1 run along the length, w0/w1 along the width. */
export type Edge = 'l0' | 'l1' | 'w0' | 'w1';

/** A 3-tuple of inches, [x, y, z], y-up in world space. */
export type Vec3 = readonly [number, number, number];

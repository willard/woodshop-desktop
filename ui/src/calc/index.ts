/**
 * Shop calculators (D86) — pure TS, spec-free, decimal inches in and out.
 *
 * Import from here for the catalogue and the shared types; import a calculator's own module for its
 * `compute` function and input/result types, so a page only pulls in the maths it renders.
 */
export * from './types';
export * from './registry';

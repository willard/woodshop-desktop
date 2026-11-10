import { describe, it, expect } from 'vitest';
import { formatFraction } from '@/lib/fraction';
import cases from '@fixtures/fraction-cases.json';

/**
 * The fraction contract shared with PHP (App\Support\Inches), which has no fraction math of its own
 * and cannot borrow this one. Both runtimes read tests/fixtures/fraction-cases.json and must agree
 * value for value — the cut list is rendered by the TS engine in the app and by PHP in the PDF, and
 * a measurement that disagrees between the two is worse than either answer. The PHP side is
 * tests/Feature/InchesTest.php.
 *
 * The corpus is hand-picked (shop dimensions, rounding boundaries, the signed-zero case) rather
 * than generated, so it needs no regeneration hook and stays type-checked like any other suite.
 */
describe('formatFraction — the contract PHP mirrors', () => {
    for (const [input, expected] of Object.entries(cases as Record<string, string>)) {
        it(`${input} → ${expected}`, () => {
            expect(formatFraction(Number(input))).toBe(expected);
        });
    }
});

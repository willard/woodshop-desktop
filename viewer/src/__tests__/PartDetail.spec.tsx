import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';
import { PartDetail } from '../PartDetail';

describe('PartDetail', () => {
    const spec = parseSpec(recordStand);
    const part = (id: string) => spec.parts.find((p) => p.id === id)!;
    afterEach(cleanup);

    it('words each joint as the assembly steps do', () => {
        render(<PartDetail spec={spec} part={part('p_side_l')} />);
        expect(screen.getAllByTestId('part-joint').map((li) => li.textContent)).toEqual([
            'Middle Shelf seats in its dado',
            '3 pocket screws from Top',
            '3 pocket screws from Bottom',
            '6 screws through Back Panel',
        ]);
    });

    it('gives the blank and the machining', () => {
        render(<PartDetail spec={spec} part={part('p_side_l')} />);
        expect(screen.getByRole('heading', { name: 'Left Side' })).toBeInTheDocument();
        expect(screen.getByTestId('part-blank')).toHaveTextContent('×');
        expect(screen.getAllByTestId('part-op')[0]).toHaveTextContent(/dado/i);
    });
});

import type { Material } from '@/spec';

/** Board feet for a part (build-plan §5). One board foot = 144 cubic inches (1"×12"×12"). */
export function boardFeet(length: number, width: number, thickness: number, qty: number): number {
    return ((thickness * width * length) / 144) * qty;
}

/**
 * Board feet for round stock (D60). A dowel is a cylinder inside a square blank, so the box volume
 * overstates it by 4/π — 27% — and board feet drives cost. Diameter is the material's thickness.
 */
export function roundBoardFeet(length: number, diameter: number, qty: number): number {
    return ((Math.PI / 4) * diameter * diameter * length * qty) / 144;
}

/** Inches: a lumber or round material with no stock lengths is sold at this (core's default). */
export const DEFAULT_STOCK_LENGTH = 96;

/**
 * One board (or dowel) of the shortest length a material is sold in, with its board feet: what
 * turns a price per board into one per board foot. Null for a sheet, and for lumber that gives no
 * board width (its boards are as wide as its widest part, so one has no fixed size).
 */
export function oneBoard(material: Material): { length: number; boardFeet: number } | null {
    if (material.type === 'sheet') return null;
    const lengths = material.stockLengths?.length ? material.stockLengths : [DEFAULT_STOCK_LENGTH];
    const length = Math.min(...lengths);
    if (material.type === 'round')
        return { length, boardFeet: roundBoardFeet(length, material.thickness, 1) };
    if (material.stockWidth === undefined) return null;
    return { length, boardFeet: boardFeet(length, material.stockWidth, material.thickness, 1) };
}

/** A price per board as a price per board foot, to four places so it reads back to the cent. */
export function perBoardFoot(pricePerBoard: number, board: { boardFeet: number }): number {
    return Math.round((pricePerBoard / board.boardFeet) * 10000) / 10000;
}

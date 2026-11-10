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

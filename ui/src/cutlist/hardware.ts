/**
 * The hardware list: the metal to buy, from fastener ops, dowel holes, joints with no fastener op
 * (estimated) and movables. Computed by the Rust core (`woodshop-core::cutlist::hardware`).
 */
import { wasm } from '@/domain';
import type { Spec } from '../spec/types';
import type { HardwareRow } from './types';

export function computeHardware(spec: Spec): HardwareRow[] {
    return wasm.computeHardware(spec) as HardwareRow[];
}

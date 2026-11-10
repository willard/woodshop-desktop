/** Read-only part detail for the exported plan; op rows use the editor's own vocabulary. */
import { formatFraction } from '@/lib/fraction';
import { opSummary } from '@/spec/opLabel';
import type { Part, Spec } from '@/spec';

const inch = (n: number): string => `${formatFraction(n)}"`;
const AXIS_LABEL = ['X (length)', 'Y (width)', 'Z (up)'] as const;

export function PartDetail({ spec, part }: { spec: Spec; part: Part }) {
    const material = spec.materials.find((m) => m.id === part.materialId);
    const joints = (spec.joints ?? [])
        .filter((j) => j.hostPartId === part.id || j.insertPartId === part.id)
        .map((j) => {
            const otherId = j.hostPartId === part.id ? j.insertPartId : j.hostPartId;
            return {
                key: j.id ?? `${j.type}-${j.hostPartId}-${j.insertPartId}`,
                type: j.type,
                role: j.hostPartId === part.id ? 'hosts' : 'seats into',
                other: spec.parts.find((p) => p.id === otherId)?.name ?? otherId,
            };
        });
    const rotated = part.transform.rot.some((d) => d !== 0);
    const heading = 'text-muted mb-2 text-[11.5px] font-semibold tracking-wider uppercase';

    return (
        <div className="px-4 pt-3.5 pb-5 text-sm" data-testid="part-detail">
            <h2 className="mb-3.5 truncate text-[15px] font-semibold">{part.name}</h2>
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Blank</dt>
                <dd data-testid="part-blank">
                    {inch(part.size.l)} × {inch(part.size.w)}
                    {material && <> × {inch(material.thickness)}</>}
                </dd>
                <dt className="text-muted">Material</dt>
                <dd data-testid="part-material">
                    {material?.name ?? part.materialId}
                    {material?.species && <span className="text-muted"> · {material.species}</span>}
                </dd>
                {part.qty > 1 && (
                    <>
                        <dt className="text-muted">Quantity</dt>
                        <dd>×{part.qty}</dd>
                    </>
                )}
                <dt className="text-muted">Grain</dt>
                <dd>
                    {part.grainAxis === 'none'
                        ? 'no direction'
                        : `runs along the ${part.grainAxis === 'l' ? 'length' : 'width'}`}
                </dd>
                <dt className="text-muted">Position</dt>
                <dd data-testid="part-position">
                    {AXIS_LABEL.map((axis, i) => (
                        <span key={axis} className="mr-2 inline-block whitespace-nowrap">
                            <span className="text-faint">{axis}</span> {inch(part.transform.pos[i])}
                        </span>
                    ))}
                </dd>
                {rotated && (
                    <>
                        <dt className="text-muted">Rotation</dt>
                        <dd>{part.transform.rot.map((d) => `${d}°`).join(' · ')}</dd>
                    </>
                )}
            </dl>
            {part.ops.length > 0 && (
                <section className="mb-4" data-print="keep">
                    <h3 className={heading}>Machining</h3>
                    <ul className="space-y-1">
                        {part.ops.map((op, i) => (
                            <li
                                key={i}
                                className="bg-surface-2 rounded-lg px-2.5 py-1.5 text-xs"
                                data-testid="part-op"
                            >
                                {opSummary(op)}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {joints.length > 0 && (
                <section data-print="keep">
                    <h3 className={heading}>Joinery</h3>
                    <ul className="space-y-1">
                        {joints.map((j) => (
                            <li
                                key={j.key}
                                className="bg-surface-2 rounded-lg px-2.5 py-1.5 text-xs"
                                data-testid="part-joint"
                            >
                                {j.type} · {j.role} {j.other}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {part.ops.length === 0 && joints.length === 0 && (
                <p className="text-muted text-xs">A plain blank — no machining, no joinery recorded.</p>
            )}
        </div>
    );
}

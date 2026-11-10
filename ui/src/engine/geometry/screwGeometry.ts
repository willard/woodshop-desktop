/**
 * Screw geometry (§3.1 fasteners). Fasteners are annotations — no boolean touches the wood — but
 * they are drawn as the real thing, because a pocket screw and a wood screw are not the same
 * object and a builder should be able to tell them apart on screen.
 *
 * A pocket-hole screw has a flat washer head whose *underside is flat*, so it seats squarely on
 * the flat bottom of a pocket and drives force straight down the shank instead of wedging the
 * pocket open; below it a smooth shank, a coarse deep thread, and a self-tapping tip that cuts its
 * own hole in the mate. A wood screw is the familiar countersunk cone — the head's underside is
 * tapered so it pulls itself flush into a countersink.
 *
 * Both are lathed profiles: a screw is a solid of revolution apart from the thread's helix, and a
 * sawtooth radius reads as a thread at editor scale for a fraction of the triangles a real helix
 * would cost. Each is built head-at-origin, running down local −Y, so placing one is "put the head
 * where it sits and point −Y where it drives".
 */
import * as THREE from 'three';

/** Wire diameters by gauge (inches) — the major thread diameter of the real screw. */
const GAUGE_DIAMETER: Record<string, number> = {
    '#6': 0.138,
    '#8': 0.164,
    '#10': 0.19,
};

const LATHE_SEGMENTS = 10; // low-poly on purpose: dozens of these can be on screen at once

export function gaugeDiameter(gauge: string | undefined): number {
    return GAUGE_DIAMETER[gauge ?? '#8'] ?? GAUGE_DIAMETER['#8'];
}

/**
 * Appends a threaded shaft to a lathe profile: a sawtooth between the root and crest radius, at a
 * pitch coarse or fine, ending in a point. `y0` is where the thread starts (negative, below the
 * head) and the tip lands at `yTip`.
 */
function threadProfile(
    points: THREE.Vector2[],
    root: number,
    crest: number,
    y0: number,
    yTip: number,
    pitch: number,
): void {
    const tipLength = Math.min(crest * 2.2, Math.abs(yTip - y0) * 0.35);
    const yThreadEnd = yTip + tipLength;
    const turns = Math.max(2, Math.round(Math.abs(yThreadEnd - y0) / pitch));
    const step = (yThreadEnd - y0) / turns;

    for (let i = 0; i < turns; i += 1) {
        const y = y0 + i * step;
        points.push(new THREE.Vector2(root, y));
        points.push(new THREE.Vector2(crest, y + step * 0.55));
    }
    // Self-tapping point: the thread carries all the way onto the taper, then closes on the axis.
    points.push(new THREE.Vector2(root, yThreadEnd));
    points.push(new THREE.Vector2(root * 0.55, yThreadEnd + (yTip - yThreadEnd) * 0.55));
    points.push(new THREE.Vector2(0, yTip));
}

/**
 * A pocket-hole screw: flat washer head with a flat bearing underside, smooth shank, coarse
 * thread, self-tapping tip. `length` is the screw's nominal length (head underside to tip).
 */
export function pocketScrewGeometry(length: number, gauge?: string): THREE.BufferGeometry {
    const major = gaugeDiameter(gauge);
    const root = major * 0.34;
    const crest = major * 0.52; // coarse thread stands proud of the shank
    const headRadius = major * 1.05; // washer head: a wide, flat bearing surface
    const headThickness = major * 0.32;
    const shankEnd = -headThickness - major * 0.5;

    const points: THREE.Vector2[] = [
        // Square-drive recess: a dimple in the top of the head, so the head reads as a screw and
        // not a stud from the one angle you ever see it — down the pocket.
        new THREE.Vector2(0, -major * 0.22),
        new THREE.Vector2(major * 0.3, 0),
        new THREE.Vector2(headRadius, 0),
        new THREE.Vector2(headRadius, -headThickness), // the flat underside that seats in the pocket
        new THREE.Vector2(root * 1.05, -headThickness),
        new THREE.Vector2(root * 1.05, shankEnd),
    ];
    threadProfile(points, root, crest, shankEnd, -length, major * 0.55);

    return new THREE.LatheGeometry(points, LATHE_SEGMENTS);
}

/**
 * The mouth of a pocket hole: the long oval a 15° bore leaves where it breaks through the face.
 * Marker-only ops cut no geometry (§3.1), so the hole is drawn as a dark disc lying on the face —
 * which is what you actually see across a pocket-screwed panel, and the only outward sign that the
 * joint has metal in it.
 *
 * Built in the XY plane facing +Z, a unit circle scaled to the bore: callers stretch it along the
 * screw's in-plane direction (a bore at angle θ to the face opens up `1/sin θ` times longer than
 * it is wide) and lay it on the surface.
 */
export function pocketMouthGeometry(radius: number): THREE.BufferGeometry {
    return new THREE.CircleGeometry(radius, 20);
}

/** Pocket bore diameter — 3/8", the standard jig's stepped bit. */
export const POCKET_BORE_RADIUS = 0.1875;

/**
 * The countersink a flat-head screw sits in: a shallow ring of exposed end grain around the head,
 * darker than the surface around it. It is the reason a screwed panel reads as screwed from across
 * the room — the head alone is 1/3" of steel and disappears at any distance, but the dark ring it
 * sits in does not. Built flat in the XY plane like the pocket mouth.
 */
export function countersinkGeometry(gauge?: string): THREE.BufferGeometry {
    const headRadius = gaugeDiameter(gauge) * 1.0;
    return new THREE.RingGeometry(headRadius * 0.92, headRadius * 1.45, 20);
}

/** The dark of a hole: unlit-looking, visible from either side since it lies flat on a face. */
export function createBoreMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x14100c,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
    });
}

/** A countersunk wood screw: an 82° conical head that pulls flush, then a plain thread. */
export function woodScrewGeometry(length: number, gauge?: string): THREE.BufferGeometry {
    const major = gaugeDiameter(gauge);
    const root = major * 0.36;
    const crest = major * 0.5;
    const headRadius = major * 1.0;
    const headDepth = headRadius / Math.tan((82 / 2) * (Math.PI / 180)); // 82° included angle

    const points: THREE.Vector2[] = [
        // A Phillips recess, dished into the top of the head: at any real viewing distance this is
        // the difference between "there is a screw here" and a bare disc of metal.
        new THREE.Vector2(0, -major * 0.26),
        new THREE.Vector2(major * 0.34, 0),
        new THREE.Vector2(headRadius, 0),
        new THREE.Vector2(root * 1.05, -headDepth), // the cone that draws the head flush
    ];
    threadProfile(points, root, crest, -headDepth, -length, major * 0.72);

    return new THREE.LatheGeometry(points, LATHE_SEGMENTS);
}

/**
 * Zinc-plated steel, shared by every fastener in a scene. Metalness is kept well under a real
 * plating's because there is no environment map to reflect: a fully metallic surface with nothing
 * to mirror renders as a dark smudge, and these are small enough to lose already.
 */
export function createScrewMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 0.5, roughness: 0.3 });
}

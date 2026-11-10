//! Fastener sizing — the shop's tables, shared by everything that has to agree on what screw goes
//! in a joint: the editor, the cut list's hardware rows, the renderer and the linter. Sizes a spec
//! leaves out are derived here rather than stored.

use crate::geometry::local_to_world;
use crate::spec::{Axis, Edge, Face, Gauge, Material, MaterialType, Part, PocketHoles, Screws, Species, Thread, Vec3};
use serde::Serialize;

/// Lengths shops actually stock, ascending (inches).
pub const STOCK_SCREW_LENGTHS: [f64; 8] = [0.625, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

/// Pocket-screw length by host thickness — the Kreg table; the nearest thickness wins.
pub const POCKET_SCREW_LENGTHS: [(f64, f64); 4] = [(0.5, 1.0), (0.75, 1.25), (1.0, 1.5), (1.5, 2.5)];

/// Clearance kept between a screw tip and the far face of the mate.
pub const SCREW_TIP_CLEARANCE: f64 = 0.125;

/// Share of a pocket screw that ends up in the mate (the rest travels inside the drilled board).
pub const POCKET_BITE_FRACTION: f64 = 0.45;

/// Species that want a fine thread; everything else (and every sheet good) takes coarse.
pub const HARDWOOD_SPECIES: [Species; 4] = [Species::Oak, Species::Maple, Species::Walnut, Species::Cherry];

/// Pocket screws are driven at this angle off the face — the jig's angle.
pub const POCKET_ANGLE: f64 = 15.0 * std::f64::consts::PI / 180.0;

fn largest_stock_at_most(limit: f64) -> f64 {
    STOCK_SCREW_LENGTHS
        .iter()
        .copied()
        .rfind(|&l| l <= limit)
        .unwrap_or(STOCK_SCREW_LENGTHS[0])
}

/// The 2/3 rule with a hard stop: through the near board, two thirds into the far one, rounded
/// down to a stocked length, never long enough to break out the far face.
pub fn wood_screw_length(host_thickness: f64, mate_thickness: f64) -> f64 {
    let ideal = host_thickness + (2.0 / 3.0) * mate_thickness;
    let limit = host_thickness + mate_thickness - SCREW_TIP_CLEARANCE;
    largest_stock_at_most(ideal.min(limit))
}

/// Pocket-screw length for a host of this thickness — the nearest table row. With the mate's
/// thickness the answer is clamped so the bite fits inside it.
pub fn pocket_screw_length(host_thickness: f64, mate_thickness: Option<f64>) -> f64 {
    let from_table = POCKET_SCREW_LENGTHS
        .iter()
        .copied()
        .reduce(|best, row| {
            if (row.0 - host_thickness).abs() < (best.0 - host_thickness).abs() {
                row
            } else {
                best
            }
        })
        .expect("table is non-empty")
        .1;
    let Some(mate) = mate_thickness else { return from_table };
    let limit = (mate - SCREW_TIP_CLEARANCE) / POCKET_BITE_FRACTION;
    if from_table <= limit {
        from_table
    } else {
        largest_stock_at_most(limit)
    }
}

/// Coarse bites softwood and sheet goods; fine holds in hardwood without splitting it.
pub fn pocket_screw_thread(mate: Option<&Material>) -> Thread {
    match mate {
        None => Thread::Coarse,
        Some(m) if m.kind == MaterialType::Sheet => Thread::Coarse,
        Some(m) => match m.species {
            Some(s) if HARDWOOD_SPECIES.contains(&s) => Thread::Fine,
            _ => Thread::Coarse,
        },
    }
}

/// #6 in thin stock, #8 everywhere else — #10 is only ever an explicit override.
pub fn screw_gauge(mate_thickness: f64) -> Gauge {
    if mate_thickness < 0.5 { Gauge::G6 } else { Gauge::G8 }
}

/// One screw in the part's local frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct FastenerSegment {
    pub head: Vec3,
    /// Unit direction head → tip.
    pub direction: Vec3,
    pub length: f64,
    pub tip: Vec3,
}

impl FastenerSegment {
    fn new(head: Vec3, direction: Vec3, length: f64) -> Self {
        let tip = std::array::from_fn(|i| head[i] + direction[i] * length);
        Self {
            head,
            direction,
            length,
            tip,
        }
    }

    /// The same screw in world inches.
    pub fn to_world(&self, part: &Part) -> (Vec3, Vec3) {
        (local_to_world(part, self.head), local_to_world(part, self.tip))
    }
}

/// Outward unit normal of an edge in the local frame (l0 = −Y, l1 = +Y, w0 = −X, w1 = +X).
pub fn edge_normal(edge: Edge) -> Vec3 {
    match edge {
        Edge::L0 => [0.0, -1.0, 0.0],
        Edge::L1 => [0.0, 1.0, 0.0],
        Edge::W0 => [-1.0, 0.0, 0.0],
        Edge::W1 => [1.0, 0.0, 0.0],
    }
}

/// Evenly spaced positions along a run; a single fastener centres itself.
fn spread(count: u32, from: f64, to: f64) -> Vec<f64> {
    if count == 1 {
        return vec![(from + to) / 2.0];
    }
    (0..count)
        .map(|i| from + ((to - from) * i as f64) / (count - 1) as f64)
        .collect()
}

/// Every pocket screw an op places. They leave the named edge at 15°: the head sits in its pocket
/// near the drilled face and the tip climbs out through the edge at mid-thickness.
pub fn pocket_segments(part: &Part, thickness: f64, op: &PocketHoles) -> Vec<FastenerSegment> {
    let (l, w) = (part.size.l, part.size.w);
    let length = op.length.unwrap_or_else(|| pocket_screw_length(thickness, None));
    let in_part = length * (1.0 - POCKET_BITE_FRACTION);
    let normal = edge_normal(op.edge);
    let scale = POCKET_ANGLE.cos();
    let from_front = op.face == Some(Face::Front);
    let direction = [
        normal[0] * scale,
        normal[1] * scale,
        if from_front {
            -POCKET_ANGLE.sin()
        } else {
            POCKET_ANGLE.sin()
        },
    ];

    let on_length = op.edge.is_l_edge();
    let edge_run = if on_length { l } else { w };
    // Without from/to the pockets spread over the whole edge, inset from both ends.
    let along: Vec<f64> = if op.from.is_none() && op.to.is_none() {
        (0..op.count)
            .map(|i| ((i + 1) as f64 / (op.count + 1) as f64) * edge_run)
            .collect()
    } else {
        spread(op.count, op.from.unwrap_or(0.0), op.to.unwrap_or(edge_run))
    };

    along
        .into_iter()
        .map(|at| {
            let exit = if on_length {
                [-l / 2.0 + at, (normal[1] * w) / 2.0, 0.0]
            } else {
                [(normal[0] * l) / 2.0, -w / 2.0 + at, 0.0]
            };
            let head = std::array::from_fn(|i| exit[i] - direction[i] * in_part);
            FastenerSegment::new(head, direction, length)
        })
        .collect()
}

/// Every wood screw an op places: heads on the named face, driven straight through.
pub fn screw_segments(part: &Part, thickness: f64, op: &Screws) -> Vec<FastenerSegment> {
    let (l, w) = (part.size.l, part.size.w);
    let length = op.length.unwrap_or_else(|| wood_screw_length(thickness, thickness));
    let along_length = op.axis == Axis::L;
    let run = if along_length { l } else { w };
    let head_on_front = op.face == Face::Front;
    let direction = [0.0, 0.0, if head_on_front { -1.0 } else { 1.0 }];

    spread(op.count, op.from.unwrap_or(run * 0.1), op.to.unwrap_or(run * 0.9))
        .into_iter()
        .map(|at| {
            let head = [
                if along_length {
                    -l / 2.0 + at
                } else {
                    -l / 2.0 + op.offset
                },
                if along_length {
                    -w / 2.0 + op.offset
                } else {
                    -w / 2.0 + at
                },
                if head_on_front {
                    thickness / 2.0
                } else {
                    -thickness / 2.0
                },
            ];
            FastenerSegment::new(head, direction, length)
        })
        .collect()
}

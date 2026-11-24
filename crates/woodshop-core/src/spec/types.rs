//! Typed spec model, mirroring `spec.schema.json` 1.14 field for field. Optional fields stay
//! `Option` and are omitted on write, so a spec round-trips without growing defaults it never
//! had (locked parts must survive edits byte-identical).

use serde::{Deserialize, Serialize};

pub type Id = String;
pub type Vec3 = [f64; 3];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Spec {
    pub spec_version: String,
    pub units: String,
    pub name: String,
    pub materials: Vec<Material>,
    pub parts: Vec<Part>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joints: Option<Vec<Joint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<Group>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub movables: Option<Vec<Movable>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hardware: Option<Vec<HardwareMount>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Meta>,
}

impl Spec {
    pub fn joints(&self) -> &[Joint] {
        self.joints.as_deref().unwrap_or_default()
    }

    pub fn groups(&self) -> &[Group] {
        self.groups.as_deref().unwrap_or_default()
    }

    pub fn movables(&self) -> &[Movable] {
        self.movables.as_deref().unwrap_or_default()
    }

    pub fn hardware(&self) -> &[HardwareMount] {
        self.hardware.as_deref().unwrap_or_default()
    }

    pub fn material(&self, id: &str) -> Option<&Material> {
        self.materials.iter().find(|m| m.id == id)
    }

    pub fn part(&self, id: &str) -> Option<&Part> {
        self.parts.iter().find(|p| p.id == id)
    }

    pub fn part_mut(&mut self, id: &str) -> Option<&mut Part> {
        self.parts.iter_mut().find(|p| p.id == id)
    }

    /// Thickness of a part (from its material), if the material exists.
    pub fn thickness_of(&self, part: &Part) -> Option<f64> {
        self.material(&part.material_id).map(|m| m.thickness)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Meta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub difficulty: Option<Difficulty>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Your own assembly order (1.18); replaces the generated one when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_steps: Option<Vec<BuildStep>>,
    /// Who drew the plan this design is from (1.21), credited on the PDF and in the gallery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<Author>,
}

/// The maker a design's plan comes from (1.21).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Author {
    pub name: String,
    /// Where their plans are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// The terms the plan is shared under.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}

impl Author {
    /// "Plan by Jo Maker (CC BY 4.0)", for a credit line.
    pub fn credit(&self) -> String {
        match self.license.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
            Some(license) => format!("Plan by {} ({license})", self.name.trim()),
            None => format!("Plan by {}", self.name.trim()),
        }
    }
}

/// One step of your own assembly order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildStep {
    pub heading: String,
    pub part_ids: Vec<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Difficulty {
    Beginner,
    Intermediate,
    Advanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MaterialType {
    Sheet,
    Lumber,
    Round,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Species {
    Pine,
    Oak,
    Maple,
    Walnut,
    Cherry,
    /// Western red cedar (1.19): light, soft and weather-resistant, for outdoor work.
    Cedar,
}

impl Species {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pine => "pine",
            Self::Oak => "oak",
            Self::Maple => "maple",
            Self::Walnut => "walnut",
            Self::Cherry => "cherry",
            Self::Cedar => "cedar",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Size2 {
    pub l: f64,
    pub w: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub id: Id,
    #[serde(rename = "type")]
    pub kind: MaterialType,
    pub name: String,
    /// Actual thickness; for `round` this is the diameter.
    pub thickness: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_size: Option<Size2>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_sizes: Option<Vec<Size2>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stock_lengths: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stock_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grain: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub species: Option<Species>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_per_sheet: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_per_board_foot: Option<f64>,
    /// How the stock looks once finished (1.20): painted, stained, glass or metal. `None` = bare wood.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Appearance>,
}

impl Material {
    /// Schema default: grain = true.
    pub fn has_grain(&self) -> bool {
        self.grain.unwrap_or(true)
    }

    /// What it looks like, bare wood when nothing is set.
    pub fn look(&self) -> AppearanceKind {
        self.appearance.as_ref().map_or(AppearanceKind::Wood, |a| a.kind)
    }
}

/// How a material looks once finished (1.20).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Appearance {
    pub kind: AppearanceKind,
    /// `#rrggbb`: the paint, the stain's tint, the glass's tint or the metal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// What the colour is called on the can, e.g. "Sage green", for the shopping list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppearanceKind {
    /// Bare or clear-finished wood.
    Wood,
    /// Opaque paint: the grain is hidden.
    Paint,
    /// Stain: the grain shows through a tint.
    Stain,
    /// Glass, e.g. a door panel.
    Glass,
    /// Metal stock, e.g. a steel rod.
    Metal,
}

impl AppearanceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wood => "wood",
            Self::Paint => "paint",
            Self::Stain => "stain",
            Self::Glass => "glass",
            Self::Metal => "metal",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GrainAxis {
    L,
    W,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transform {
    /// Center position in inches; y is up.
    pub pos: Vec3,
    /// Euler XYZ degrees.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rot: Option<Vec3>,
}

impl Transform {
    pub fn rot(&self) -> Vec3 {
        self.rot.unwrap_or([0.0; 3])
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Part {
    pub id: Id,
    pub name: String,
    pub material_id: Id,
    pub size: Size2,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grain_axis: Option<GrainAxis>,
    pub transform: Transform,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ops: Option<Vec<Op>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qty: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    /// Edges covered with edge banding (1.16).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_band: Option<Vec<Edge>>,
}

impl Part {
    pub fn ops(&self) -> &[Op] {
        self.ops.as_deref().unwrap_or_default()
    }

    pub fn qty(&self) -> u32 {
        self.qty.unwrap_or(1)
    }

    pub fn grain_axis(&self) -> GrainAxis {
        self.grain_axis.unwrap_or(GrainAxis::L)
    }

    pub fn is_locked(&self) -> bool {
        self.locked.unwrap_or(false)
    }
}

/// Local-frame faces: front = +Z, back = −Z.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Face {
    Front,
    Back,
}

/// Edges along length (l0/l1) or width (w0/w1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    L0,
    L1,
    W0,
    W1,
}

impl Edge {
    pub const ALL: [Edge; 4] = [Edge::L0, Edge::L1, Edge::W0, Edge::W1];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::L0 => "l0",
            Self::L1 => "l1",
            Self::W0 => "w0",
            Self::W1 => "w1",
        }
    }

    /// `l0`/`l1` are the long edges (running along length); `w0`/`w1` the ends.
    pub fn is_l_edge(self) -> bool {
        matches!(self, Self::L0 | Self::L1)
    }

    pub fn is_perpendicular_to(self, other: Edge) -> bool {
        self.is_l_edge() != other.is_l_edge()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    L,
    W,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HolePurpose {
    Dowel,
    ShelfPin,
    Hardware,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Thread {
    Coarse,
    Fine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Gauge {
    #[serde(rename = "#6")]
    G6,
    #[serde(rename = "#8")]
    G8,
    #[serde(rename = "#10")]
    G10,
}

impl Gauge {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::G6 => "#6",
            Self::G8 => "#8",
            Self::G10 => "#10",
        }
    }
}

/// A part operation. `curve` and `ease` carry a second discriminator (`kind` / `profile`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Op {
    Dado(Channel),
    Groove(Channel),
    Rabbet(Rabbet),
    Hole(Hole),
    Cutout(Cutout),
    PocketHoles(PocketHoles),
    Screws(Screws),
    Miter(Miter),
    Curve(Curve),
    Notch(Notch),
    Ease(Ease),
}

impl Op {
    pub fn type_name(&self) -> &'static str {
        match self {
            Op::Dado(_) => "dado",
            Op::Groove(_) => "groove",
            Op::Rabbet(_) => "rabbet",
            Op::Hole(_) => "hole",
            Op::Cutout(_) => "cutout",
            Op::PocketHoles(_) => "pocketHoles",
            Op::Screws(_) => "screws",
            Op::Miter(_) => "miter",
            Op::Curve(_) => "curve",
            Op::Notch(_) => "notch",
            Op::Ease(_) => "ease",
        }
    }

    /// The edge an edge-based op acts on.
    pub fn edge(&self) -> Option<Edge> {
        match self {
            Op::Rabbet(o) => Some(o.edge),
            Op::PocketHoles(o) => Some(o.edge),
            Op::Miter(o) => Some(o.edge),
            Op::Curve(c) => Some(c.edge()),
            Op::Notch(o) => Some(o.edge),
            Op::Ease(e) => Some(e.edge()),
            _ => None,
        }
    }
}

/// Dado (across the grain) or groove (with it): a flat-bottomed channel in a face.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Channel {
    pub face: Face,
    pub axis: Axis,
    /// Channel centerline from the part origin edge.
    pub offset: f64,
    pub width: f64,
    pub depth: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rabbet {
    pub edge: Edge,
    pub width: f64,
    pub depth: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hole {
    pub face: Face,
    pub x: f64,
    pub y: f64,
    pub diameter: f64,
    /// `None` = through hole.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<HolePurpose>,
}

/// A rectangular opening or pocket in a face, away from the edges (1.22).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cutout {
    pub face: Face,
    /// Centre, from the w0 end along the length.
    pub x: f64,
    /// Centre, from the l0 edge across the width.
    pub y: f64,
    pub length: f64,
    pub width: f64,
    /// `None` = through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
    /// Corner radius; `None` or 0 = square corners.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
}

impl Cutout {
    /// The corner radius actually cut: never more than half the shorter side.
    pub fn corner(&self) -> f64 {
        self.radius.unwrap_or(0.0).clamp(0.0, self.length.min(self.width) / 2.0)
    }

    /// Its footprint on the face, local frame (centred on the part): (min x, min y, max x, max y).
    pub fn footprint(&self, l: f64, w: f64) -> (f64, f64, f64, f64) {
        let (cx, cy) = (-l / 2.0 + self.x, -w / 2.0 + self.y);
        (
            cx - self.length / 2.0,
            cy - self.width / 2.0,
            cx + self.length / 2.0,
            cy + self.width / 2.0,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PocketHoles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face: Option<Face>,
    pub edge: Edge,
    pub count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread: Option<Thread>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<f64>,
}

impl PocketHoles {
    /// Schema default: pockets drilled from the back face.
    pub fn face(&self) -> Face {
        self.face.unwrap_or(Face::Back)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Screws {
    pub face: Face,
    pub axis: Axis,
    pub offset: f64,
    pub count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gauge: Option<Gauge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Miter {
    pub edge: Edge,
    /// Degrees off square.
    pub angle: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Curve {
    /// Dome over the whole edge, or a scallop over `[from, to]`.
    Arc {
        edge: Edge,
        height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<f64>,
    },
    /// Corner radius on one or both corners of the edge.
    Round {
        edge: Edge,
        radius: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        corner: Option<Edge>,
    },
    /// A straight 45° cut off a corner, `size` along each edge (1.19): a dog ear. With no
    /// `corner`, both corners of the edge (a dog-eared end).
    Clip {
        edge: Edge,
        size: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        corner: Option<Edge>,
    },
    /// One-sided tangent-arc sweep dropping toward `low`.
    Ramp { edge: Edge, height: f64, low: Edge },
    /// A straight cut from the opposite corner to the corner shared with `low`, moved in by
    /// `height` (1.17): an angled end on a w edge, a tapered leg on an l edge.
    Taper {
        edge: Edge,
        height: f64,
        low: Edge,
        /// How far the edge runs straight from its full-size end before the taper starts (1.19):
        /// a leg kept square where the apron meets it. `None` tapers the whole edge.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<f64>,
    },
}

impl Curve {
    pub fn edge(&self) -> Edge {
        match self {
            Curve::Arc { edge, .. }
            | Curve::Round { edge, .. }
            | Curve::Ramp { edge, .. }
            | Curve::Taper { edge, .. }
            | Curve::Clip { edge, .. } => *edge,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            Curve::Arc { .. } => "arc",
            Curve::Round { .. } => "round",
            Curve::Ramp { .. } => "ramp",
            Curve::Taper { .. } => "taper",
            Curve::Clip { .. } => "clip",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Notch {
    pub edge: Edge,
    pub from: f64,
    pub to: f64,
    pub depth: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "profile", rename_all = "lowercase")]
pub enum Ease {
    Roundover {
        edge: Edge,
        radius: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        face: Option<Face>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<f64>,
    },
    Chamfer {
        edge: Edge,
        width: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        face: Option<Face>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<f64>,
    },
    Bullnose {
        edge: Edge,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<f64>,
    },
}

impl Ease {
    pub fn edge(&self) -> Edge {
        match self {
            Ease::Roundover { edge, .. } | Ease::Chamfer { edge, .. } | Ease::Bullnose { edge, .. } => *edge,
        }
    }

    pub fn face(&self) -> Option<Face> {
        match self {
            Ease::Roundover { face, .. } | Ease::Chamfer { face, .. } => *face,
            Ease::Bullnose { .. } => None,
        }
    }

    pub fn run(&self) -> (Option<f64>, Option<f64>) {
        match self {
            Ease::Roundover { from, to, .. } | Ease::Chamfer { from, to, .. } | Ease::Bullnose { from, to, .. } => {
                (*from, *to)
            }
        }
    }

    pub fn profile_name(&self) -> &'static str {
        match self {
            Ease::Roundover { .. } => "roundover",
            Ease::Chamfer { .. } => "chamfer",
            Ease::Bullnose { .. } => "bullnose",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JointType {
    Dado,
    Rabbet,
    Butt,
    PocketScrew,
    Screw,
    Dowel,
}

impl JointType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dado => "dado",
            Self::Rabbet => "rabbet",
            Self::Butt => "butt",
            Self::PocketScrew => "pocketScrew",
            Self::Screw => "screw",
            Self::Dowel => "dowel",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Joint {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Id>,
    #[serde(rename = "type")]
    pub kind: JointType,
    pub host_part_id: Id,
    pub insert_part_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op_ref: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub part_ids: Vec<Id>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MovableStyle {
    Overlay,
    Inset,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Movable {
    Door {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(rename = "partIds")]
        part_ids: Vec<Id>,
        #[serde(rename = "panelPartId")]
        panel_part_id: Id,
        #[serde(rename = "hingeEdge")]
        hinge_edge: Edge,
        style: MovableStyle,
        /// Catalog hinge (1.15); `None` = the default for the style.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hinge: Option<String>,
        /// Catalog pull or knob (1.15), or `"none"`; `None` = a plain knob.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pull: Option<String>,
        /// Finish of the visible hardware (1.16); `None` = plain steel.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finish: Option<Finish>,
    },
    Drawer {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(rename = "partIds")]
        part_ids: Vec<Id>,
        #[serde(rename = "frontPartId")]
        front_part_id: Id,
        style: MovableStyle,
        /// Catalog slide (1.15); `None` = side-mount ball-bearing.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        slide: Option<String>,
        /// Catalog pull or knob (1.15), or `"none"`; `None` = a plain knob.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pull: Option<String>,
        /// Finish of the visible hardware (1.16); `None` = plain steel.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finish: Option<Finish>,
    },
    /// A drop leaf or fold-down wing (1.22), stored raised; it folds down about its hinge edge.
    Leaf {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(rename = "partIds")]
        part_ids: Vec<Id>,
        #[serde(rename = "leafPartId")]
        leaf_part_id: Id,
        #[serde(rename = "hingeEdge")]
        hinge_edge: Edge,
        /// Catalog hinge; `None` = butt hinges; `"none"` = no hinges, the leaf is screwed to its
        /// folding brackets and pivots on their knuckles.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hinge: Option<String>,
        /// Catalog folding bracket; `None` = the longest that fits under the leaf.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        support: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finish: Option<Finish>,
    },
}

impl Movable {
    pub fn id(&self) -> &str {
        match self {
            Movable::Door { id, .. } | Movable::Drawer { id, .. } | Movable::Leaf { id, .. } => id,
        }
    }

    pub fn name(&self) -> Option<&str> {
        match self {
            Movable::Door { name, .. } | Movable::Drawer { name, .. } | Movable::Leaf { name, .. } => name.as_deref(),
        }
    }

    pub fn part_ids(&self) -> &[Id] {
        match self {
            Movable::Door { part_ids, .. } | Movable::Drawer { part_ids, .. } | Movable::Leaf { part_ids, .. } => {
                part_ids
            }
        }
    }

    /// The panel (door), front (drawer) or leaf part.
    pub fn anchor_part_id(&self) -> &str {
        match self {
            Movable::Door { panel_part_id, .. } => panel_part_id,
            Movable::Drawer { front_part_id, .. } => front_part_id,
            Movable::Leaf { leaf_part_id, .. } => leaf_part_id,
        }
    }

    /// The chosen pull's catalog id, `"none"`, or `None` for the default knob. A leaf has no
    /// pull: `"none"`.
    pub fn pull(&self) -> Option<&str> {
        match self {
            Movable::Door { pull, .. } | Movable::Drawer { pull, .. } => pull.as_deref(),
            Movable::Leaf { .. } => Some("none"),
        }
    }

    /// A leaf with no hinges: screwed to its folding brackets, which are its pivot.
    pub fn hung_on_brackets(&self) -> bool {
        matches!(self, Movable::Leaf { hinge: Some(h), .. } if h == "none")
    }

    /// The finish of the pull (and a door's hinges); `None` = plain steel.
    pub fn finish(&self) -> Option<Finish> {
        match self {
            Movable::Door { finish, .. } | Movable::Drawer { finish, .. } | Movable::Leaf { finish, .. } => *finish,
        }
    }

    /// Overlay or inset; `None` for a leaf, which covers no opening.
    pub fn style(&self) -> Option<MovableStyle> {
        match self {
            Movable::Door { style, .. } | Movable::Drawer { style, .. } => Some(*style),
            Movable::Leaf { .. } => None,
        }
    }
}

/// A side of a part a piece of hardware can mount on: a face or an edge, in the local frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Front,
    Back,
    L0,
    L1,
    W0,
    W1,
}

/// One piece of catalog hardware mounted on a part (1.15). See `crate::hardware` for the catalog
/// and the mounting frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HardwareMount {
    pub id: Id,
    pub item: String,
    pub part_id: Id,
    pub side: Side,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rot: Option<u16>,
    /// The piece's finish (1.16); `None` = plain steel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish: Option<Finish>,
}

/// A metal finish for visible hardware (1.16).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Finish {
    Nickel,
    Black,
    Brass,
    Bronze,
}

impl Finish {
    /// The spec value, as stored.
    pub fn as_str(self) -> &'static str {
        match self {
            Finish::Nickel => "nickel",
            Finish::Black => "black",
            Finish::Brass => "brass",
            Finish::Bronze => "bronze",
        }
    }

    /// As a shop or a catalog names it.
    pub fn label(self) -> &'static str {
        match self {
            Finish::Nickel => "satin nickel",
            Finish::Black => "matte black",
            Finish::Brass => "brass",
            Finish::Bronze => "oil-rubbed bronze",
        }
    }
}

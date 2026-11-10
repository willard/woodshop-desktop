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
}

impl Species {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pine => "pine",
            Self::Oak => "oak",
            Self::Maple => "maple",
            Self::Walnut => "walnut",
            Self::Cherry => "cherry",
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
}

impl Material {
    /// Schema default: grain = true.
    pub fn has_grain(&self) -> bool {
        self.grain.unwrap_or(true)
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
    /// One-sided tangent-arc sweep dropping toward `low`.
    Ramp { edge: Edge, height: f64, low: Edge },
}

impl Curve {
    pub fn edge(&self) -> Edge {
        match self {
            Curve::Arc { edge, .. } | Curve::Round { edge, .. } | Curve::Ramp { edge, .. } => *edge,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            Curve::Arc { .. } => "arc",
            Curve::Round { .. } => "round",
            Curve::Ramp { .. } => "ramp",
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
    },
}

impl Movable {
    pub fn id(&self) -> &str {
        match self {
            Movable::Door { id, .. } | Movable::Drawer { id, .. } => id,
        }
    }

    pub fn name(&self) -> Option<&str> {
        match self {
            Movable::Door { name, .. } | Movable::Drawer { name, .. } => name.as_deref(),
        }
    }

    pub fn part_ids(&self) -> &[Id] {
        match self {
            Movable::Door { part_ids, .. } | Movable::Drawer { part_ids, .. } => part_ids,
        }
    }

    /// The panel (door) or front (drawer) part.
    pub fn anchor_part_id(&self) -> &str {
        match self {
            Movable::Door { panel_part_id, .. } => panel_part_id,
            Movable::Drawer { front_part_id, .. } => front_part_id,
        }
    }

    /// The chosen pull's catalog id, `"none"`, or `None` for the default knob.
    pub fn pull(&self) -> Option<&str> {
        match self {
            Movable::Door { pull, .. } | Movable::Drawer { pull, .. } => pull.as_deref(),
        }
    }

    pub fn style(&self) -> MovableStyle {
        match self {
            Movable::Door { style, .. } | Movable::Drawer { style, .. } => *style,
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
}

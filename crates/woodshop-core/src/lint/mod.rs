//! Buildability rules the JSON Schema can't express: a part fits its material, an op fits its
//! part, a dado is as wide as its mate is thick, joint refs resolve, nothing floats free, nothing
//! passes through anything else, and every part is actually fastened. Op semantics follow §3.1.
//!
//! Errors mean "this would not be cut or assembled the way it is written"; warns mean "legal, but
//! probably a mistake".

mod checks;
mod ops;

use serde::{Deserialize, Serialize};

use crate::spec::Spec;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warn,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warn => "warn",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintIssue {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op_index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joint_index: Option<usize>,
    /// The joint's stable id (1.14), alongside — never instead of — `joint_index`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joint_id: Option<String>,
}

impl LintIssue {
    pub(crate) fn part(severity: Severity, code: &str, message: String, part_id: &str) -> Self {
        Self {
            severity,
            code: code.into(),
            message,
            part_id: Some(part_id.into()),
            op_index: None,
            joint_index: None,
            joint_id: None,
        }
    }

    pub(crate) fn op(severity: Severity, code: &str, message: String, part_id: &str, op_index: usize) -> Self {
        Self {
            op_index: Some(op_index),
            ..Self::part(severity, code, message, part_id)
        }
    }

    pub(crate) fn joint(code: &str, severity: Severity, message: String, index: usize, id: Option<&str>) -> Self {
        Self {
            severity,
            code: code.into(),
            message,
            part_id: None,
            op_index: None,
            joint_index: Some(index),
            joint_id: id.map(str::to_owned),
        }
    }

    /// Identity used to compare findings across edits (code + where), ignoring the message.
    pub fn identity(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}",
            self.severity.as_str(),
            self.code,
            self.part_id.as_deref().unwrap_or(""),
            self.op_index.map(|i| i.to_string()).unwrap_or_default(),
            self.joint_index.map(|i| i.to_string()).unwrap_or_default(),
        )
    }

    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }
}

/// Small tolerance so exact fits (part == sheet) don't false-positive on float error.
pub(crate) const EPS: f64 = 1e-6;

/// Every finding for a spec, in rule order.
pub fn lint(spec: &Spec) -> Vec<LintIssue> {
    let mut issues = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for part in &spec.parts {
        if !seen.insert(part.id.as_str()) {
            issues.push(LintIssue::part(
                Severity::Error,
                "part.duplicate-id",
                format!(
                    "Duplicate part id \"{}\" on \"{}\". Every part must have a unique id.",
                    part.id, part.name
                ),
                &part.id,
            ));
        }
        let Some(material) = spec.material(&part.material_id) else {
            issues.push(LintIssue::part(
                Severity::Error,
                "part.material-missing",
                format!(
                    "Part \"{}\" references unknown material \"{}\".",
                    part.name, part.material_id
                ),
                &part.id,
            ));
            continue;
        };
        checks::part_fits_material(part, material, &mut issues);
        ops::ops_fit_part(part, material, &mut issues);
        ops::overlapping_ops(part, &mut issues);
    }

    let member_of = crate::movables::movable_member_of(spec);
    checks::joints(spec, &mut issues);
    checks::eased_joint_edges(spec, &mut issues);
    checks::groups(spec, &mut issues);
    checks::movables(spec, &mut issues);
    checks::floating_parts(spec, &member_of, &mut issues);
    checks::pierced_parts(spec, &mut issues);
    checks::fastening(spec, &member_of, &mut issues);
    checks::fastener_ops(spec, &mut issues);
    issues
}

pub use checks::{FastenerLandings, duplicate_placements, fastener_landings};

/// Whether a spec has no error-severity findings.
pub fn is_buildable(issues: &[LintIssue]) -> bool {
    !issues.iter().any(LintIssue::is_error)
}

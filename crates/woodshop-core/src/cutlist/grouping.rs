//! A friendly view over a computed cut list: identical blanks collapse into one ×N row, and rows
//! are bucketed into per-material sections (sheet goods, then lumber, then unplanned stock).
//! Derived from `CutList` alone.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::hardware::locale_compare;
use super::types::{CutList, PartRow};

fn is_false(b: &bool) -> bool {
    !*b
}

/// Identical blanks — same material and L×W×T — merged into one row to cut N times.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutListGroup {
    /// `materialId|l|w|t` at 3dp.
    pub key: String,
    pub material_id: String,
    pub label: String,
    pub length: f64,
    pub width: f64,
    pub thickness: f64,
    pub qty: u32,
    pub board_feet: f64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub curved: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub notched: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub mitered: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub eased: bool,
    /// Members disagree on an op flag — same blank, different machining.
    #[serde(default, skip_serializing_if = "is_false")]
    pub mixed_ops: bool,
    pub members: Vec<PartRow>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StockUnit {
    Sheet,
    Stick,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CutListStock {
    pub count: usize,
    pub unit: StockUnit,
    pub l: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionKind {
    Sheet,
    Lumber,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutListSection {
    pub material_id: String,
    pub material_name: String,
    pub kind: SectionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub species: Option<String>,
    pub thickness: f64,
    pub groups: Vec<CutListGroup>,
    pub stock: Option<CutListStock>,
    pub board_feet: f64,
    pub cost: Option<f64>,
    pub waste_percent: Option<f64>,
}

pub fn group_cut_list(cut_list: &CutList) -> Vec<CutListSection> {
    let mut rows_by_material: Vec<(&str, Vec<&PartRow>)> = Vec::new();
    for row in &cut_list.parts {
        match rows_by_material.iter_mut().find(|(id, _)| *id == row.material_id) {
            Some((_, rows)) => rows.push(row),
            None => rows_by_material.push((&row.material_id, vec![row])),
        }
    }
    let sheet_of = |id: &str| cut_list.sheets.iter().find(|p| p.material_id == id);
    let lumber_of = |id: &str| cut_list.lumber.iter().find(|p| p.material_id == id);

    let mut material_ids: Vec<&str> = cut_list.sheets.iter().map(|p| p.material_id.as_str()).collect();
    material_ids.extend(cut_list.lumber.iter().map(|p| p.material_id.as_str()));
    material_ids.extend(
        rows_by_material
            .iter()
            .map(|(id, _)| *id)
            .filter(|id| sheet_of(id).is_none() && lumber_of(id).is_none()),
    );

    let mut sections = Vec::new();
    for material_id in material_ids {
        let Some((_, rows)) = rows_by_material.iter().find(|(id, _)| *id == material_id) else {
            continue;
        };
        let Some(first) = rows.first() else { continue };
        let sheet = sheet_of(material_id);
        let lumber = lumber_of(material_id);
        let (plan_name, cost, waste) = match (sheet, lumber) {
            (Some(s), _) => (Some(&s.material_name), s.cost, Some(s.waste)),
            (None, Some(l)) => (Some(&l.material_name), l.cost, Some(l.waste)),
            _ => (None, None, None),
        };
        sections.push(CutListSection {
            material_id: material_id.to_owned(),
            material_name: plan_name.unwrap_or(&first.material_name).clone(),
            kind: if sheet.is_some() {
                SectionKind::Sheet
            } else if lumber.is_some() {
                SectionKind::Lumber
            } else {
                SectionKind::Other
            },
            species: first.species.clone(),
            thickness: first.thickness,
            groups: group_rows(rows),
            stock: match (sheet, lumber) {
                (Some(s), _) => Some(CutListStock {
                    count: s.sheet_count,
                    unit: StockUnit::Sheet,
                    l: s.sheet_size.l,
                    w: Some(s.sheet_size.w),
                }),
                (None, Some(l)) => Some(CutListStock {
                    count: l.stick_count,
                    unit: StockUnit::Stick,
                    l: l.stock_length,
                    w: None,
                }),
                _ => None,
            },
            board_feet: rows.iter().map(|r| r.board_feet).sum(),
            cost,
            waste_percent: waste,
        });
    }
    sections
}

fn group_key(row: &PartRow) -> String {
    format!(
        "{}|{:.3}|{:.3}|{:.3}",
        row.material_id, row.length, row.width, row.thickness
    )
}

/// Merges one material's rows on dimensions, biggest blank first.
fn group_rows(rows: &[&PartRow]) -> Vec<CutListGroup> {
    let mut order: Vec<String> = Vec::new();
    let mut by_key: HashMap<String, Vec<PartRow>> = HashMap::new();
    for row in rows {
        let key = group_key(row);
        by_key
            .entry(key.clone())
            .or_insert_with(|| {
                order.push(key);
                Vec::new()
            })
            .push((*row).clone());
    }

    let mut groups: Vec<CutListGroup> = order
        .into_iter()
        .map(|key| {
            let members = by_key.remove(&key).unwrap_or_default();
            let first = &members[0];
            let any = |f: fn(&PartRow) -> bool| members.iter().any(f);
            let all = |f: fn(&PartRow) -> bool| members.iter().all(f);
            let flags: [fn(&PartRow) -> bool; 4] = [|m| m.curved, |m| m.notched, |m| m.mitered, |m| m.eased];
            CutListGroup {
                key,
                material_id: first.material_id.clone(),
                label: group_label(&members.iter().map(|m| m.name.as_str()).collect::<Vec<_>>()),
                length: first.length,
                width: first.width,
                thickness: first.thickness,
                qty: members.iter().map(|m| m.qty).sum(),
                board_feet: members.iter().map(|m| m.board_feet).sum(),
                curved: any(flags[0]),
                notched: any(flags[1]),
                mitered: any(flags[2]),
                eased: any(flags[3]),
                mixed_ops: flags.iter().any(|&f| any(f) && !all(f)),
                members,
            }
        })
        .collect();

    // Big blanks first by face area, then longest side, then label.
    groups.sort_by(|a, b| {
        let area = (b.length * b.width) - (a.length * a.width);
        let side = b.length.max(b.width) - a.length.max(a.width);
        if area != 0.0 {
            return area.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal);
        }
        if side != 0.0 {
            return side.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal);
        }
        locale_compare(&a.label, &b.label)
    });
    groups
}

/// Numbering and punctuation left dangling once a shared prefix is cut ("Leg (" → "Leg").
fn trim_trailing_noise(s: &str) -> &str {
    s.trim_end_matches(|c: char| c.is_whitespace() || "-_#0123456789(,:;/|.".contains(c))
}

/// A name that reads for the whole group: the shared name, else the shared prefix, else a couple
/// of names spelled out, else a word they all share, else the first name and a count.
pub fn group_label(names: &[&str]) -> String {
    if names.len() == 1 || names.iter().all(|n| *n == names[0]) {
        return names[0].to_owned();
    }
    let prefix = common_prefix(names);
    let prefix = trim_trailing_noise(&prefix);
    if prefix.chars().count() >= 3 {
        return prefix.to_owned();
    }
    let joined = names.join(", ");
    if names.len() <= 3 && joined.chars().count() <= 40 {
        return joined;
    }
    shared_word(names).unwrap_or_else(|| format!("{} +{} more", names[0], names.len() - 1))
}

fn words(name: &str) -> Vec<String> {
    name.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.chars().count() >= 3)
        .map(str::to_owned)
        .collect()
}

/// The longest word every name contains, cased as the first name has it.
fn shared_word(names: &[&str]) -> Option<String> {
    let mut candidates = words(names[0]);
    candidates.sort_by_key(|w| std::cmp::Reverse(w.len()));
    let rest: Vec<Vec<String>> = names[1..].iter().map(|n| words(n)).collect();
    let hit = candidates
        .into_iter()
        .find(|w| rest.iter().all(|theirs| theirs.contains(w)))?;
    let lower = names[0].to_lowercase();
    let at = lower.find(&hit)?;
    names[0].get(at..at + hit.len()).map(str::to_owned)
}

fn common_prefix(names: &[&str]) -> String {
    let mut prefix: Vec<char> = names[0].chars().collect();
    for name in &names[1..] {
        let n = prefix.iter().zip(name.chars()).take_while(|(a, b)| **a == *b).count();
        prefix.truncate(n);
        if prefix.is_empty() {
            break;
        }
    }
    prefix.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::group_label;

    #[test]
    fn labels() {
        assert_eq!(group_label(&["Shelf 1", "Shelf 2", "Shelf 3"]), "Shelf");
        assert_eq!(group_label(&["Leg (1)", "Leg (2)"]), "Leg");
        assert_eq!(group_label(&["Top", "Bottom"]), "Top, Bottom");
        assert_eq!(
            group_label(&["Tabletop Slat 1", "Front Bench Slat", "Rear Bench Slat", "Another Slat"]),
            "Slat"
        );
    }
}

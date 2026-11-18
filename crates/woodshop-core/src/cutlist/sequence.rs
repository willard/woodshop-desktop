//! The order to make the saw cuts on a sheet layout.
//!
//! Layouts from the guillotine packer can always be cut apart with straight cuts that run from
//! one edge of a piece of sheet to the other. This finds those cuts: on each piece of sheet it
//! takes the first cut that runs its long way (a rip, on a full sheet) without crossing a part,
//! else the first that runs across it, and carries on with what is left. A piece's cuts all come
//! before those of the pieces cut from it, so a sheet is ripped into strips first and the strips
//! are then crosscut.

use std::collections::VecDeque;

use super::types::{Placement, SheetCut};

const EPS: f64 = 1e-6;

#[derive(Debug, Clone, Copy)]
struct Region {
    x: f64,
    y: f64,
    l: f64,
    w: f64,
}

/// The cuts that free every part placed on one sheet (or piece on hand) of size `l` × `w`, in
/// the order to make them, numbered from 1. `placements` may hold other sheets' parts; only those
/// on `sheet` count. Waste is cut off only where it frees a part.
pub fn sheet_cuts(placements: &[Placement], sheet: usize, l: f64, w: f64, kerf: f64) -> Vec<SheetCut> {
    let parts: Vec<&Placement> = placements.iter().filter(|p| p.sheet == sheet).collect();
    let mut cuts = Vec::new();
    let mut todo: VecDeque<(Region, Vec<&Placement>)> = VecDeque::new();
    todo.push_back((Region { x: 0.0, y: 0.0, l, w }, parts));
    while let Some((region, parts)) = todo.pop_front() {
        if parts.is_empty() || (parts.len() == 1 && fills(parts[0], region)) {
            continue;
        }
        // Cuts along the piece's long way come first; a sheet is ripped before it is crosscut.
        let order = if region.l >= region.w {
            [true, false]
        } else {
            [false, true]
        };
        let Some((rip, at)) = order
            .iter()
            .find_map(|&rip| first_cut(&parts, region, rip, kerf).map(|at| (rip, at)))
        else {
            // Not a guillotine layout: nothing more can be cut straight through here.
            continue;
        };
        cuts.push(SheetCut {
            sheet,
            n: cuts.len() as u32 + 1,
            x: if rip { region.x } else { at },
            y: if rip { at } else { region.y },
            l: if rip { region.l } else { region.w },
            rip,
        });
        let (before, after): (Vec<&Placement>, Vec<&Placement>) = parts.into_iter().partition(|p| {
            if rip {
                p.y + p.h <= at + EPS
            } else {
                p.x + p.w <= at + EPS
            }
        });
        let (near, far) = split(region, rip, at, kerf);
        // The rest of this piece is cut before the piece just cut off it.
        todo.push_front((far, after));
        todo.push_back((near, before));
    }
    cuts
}

fn fills(p: &Placement, r: Region) -> bool {
    (p.x - r.x).abs() < EPS && (p.y - r.y).abs() < EPS && p.w >= r.l - EPS && p.h >= r.w - EPS
}

/// The nearest place a cut `rip` (along the length: a line of constant y) or across (constant x)
/// can go through `region` without crossing a part, where it frees something: parts on both
/// sides, or waste cut off beside them.
fn first_cut(parts: &[&Placement], region: Region, rip: bool, kerf: f64) -> Option<f64> {
    let (start, end) = if rip {
        (region.y, region.y + region.w)
    } else {
        (region.x, region.x + region.l)
    };
    let span = |p: &Placement| if rip { (p.y, p.y + p.h) } else { (p.x, p.x + p.w) };
    let mut places: Vec<f64> = parts
        .iter()
        .flat_map(|p| {
            let (a, b) = span(p);
            [b, a - kerf]
        })
        .filter(|&at| at > start + EPS && at < end - EPS)
        .collect();
    places.sort_by(f64::total_cmp);
    places.into_iter().find(|&at| {
        parts.iter().all(|p| {
            let (a, b) = span(p);
            b <= at + EPS || a >= at - EPS
        })
    })
}

/// The two pieces either side of a cut at `at`, the saw's kerf taken out between them.
fn split(r: Region, rip: bool, at: f64, kerf: f64) -> (Region, Region) {
    if rip {
        let rest = (at + kerf).min(r.y + r.w);
        (
            Region { w: at - r.y, ..r },
            Region {
                y: rest,
                w: r.y + r.w - rest,
                ..r
            },
        )
    } else {
        let rest = (at + kerf).min(r.x + r.l);
        (
            Region { l: at - r.x, ..r },
            Region {
                x: rest,
                l: r.x + r.l - rest,
                ..r
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(x: f64, y: f64, w: f64, h: f64) -> Placement {
        Placement {
            part_id: "p".into(),
            name: "p".into(),
            sheet: 0,
            x,
            y,
            w,
            h,
            rotated: false,
        }
    }

    #[test]
    fn strips_are_ripped_before_they_are_crosscut() {
        // Two strips across a 96 × 48 sheet: 20" wide with two parts, then 10" wide with one.
        let kerf = 0.125;
        let parts = [
            part(0.0, 0.0, 30.0, 20.0),
            part(30.0 + kerf, 0.0, 30.0, 20.0),
            part(0.0, 20.0 + kerf, 50.0, 10.0),
        ];
        let cuts = sheet_cuts(&parts, 0, 96.0, 48.0, kerf);
        let kinds: Vec<(bool, f64)> = cuts.iter().map(|c| (c.rip, if c.rip { c.y } else { c.x })).collect();
        assert_eq!(
            kinds,
            vec![
                (true, 20.0),
                (true, 30.0 + kerf),
                (false, 30.0),
                (false, 60.0 + kerf),
                (false, 50.0),
            ]
        );
        assert_eq!(cuts.iter().map(|c| c.n).collect::<Vec<_>>(), vec![1, 2, 3, 4, 5]);
        assert!(cuts[0].l == 96.0 && cuts[2].l == 20.0);
    }

    #[test]
    fn a_part_that_fills_its_sheet_needs_no_cut() {
        assert!(sheet_cuts(&[part(0.0, 0.0, 24.0, 12.0)], 0, 24.0, 12.0, 0.125).is_empty());
    }

    #[test]
    fn other_sheets_are_left_out() {
        let mut other = part(0.0, 0.0, 10.0, 10.0);
        other.sheet = 1;
        assert!(sheet_cuts(&[other], 0, 96.0, 48.0, 0.125).is_empty());
    }
}

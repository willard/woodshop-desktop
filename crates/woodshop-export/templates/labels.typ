// Part labels on a standard label sheet. Every word arrives from Rust; this file is layout only.
#let data = json(bytes(sys.inputs.at("data")))

#let ink = rgb("#1c1917")
#let muted = rgb("#78716c")

// Avery 5160 (US Letter, 3 × 10) and L7160 (A4, 3 × 7).
#let sheet = if data.paper == "a4" {
  (paper: "a4", top: 15.15mm, side: 7.21mm, w: 63.5mm, h: 38.1mm, gap: 2.54mm, scale: 1.25)
} else {
  (paper: "us-letter", top: 0.5in, side: 0.1875in, w: 2.625in, h: 1in, gap: 0.125in, scale: 1)
}

#set document(title: data.title + " — part labels", author: "Woodshop")
// The bottom margin is a hair under the top one, so a full column of labels always fits.
#set page(paper: sheet.paper, margin: (top: sheet.top, bottom: sheet.top - 2pt, x: sheet.side))
#set text(font: ("Libertinus Serif", "New Computer Modern"), size: 8pt, fill: ink)
#set par(leading: 0.35em)

#grid(
  columns: (sheet.w,) * 3,
  rows: sheet.h,
  column-gutter: sheet.gap,
  // Labels already peeled off a partly used sheet stay blank.
  ..range(data.skip).map(_ => []),
  ..data.labels.map(l => box(width: sheet.w, height: sheet.h, inset: (x: 9pt, y: 6pt * sheet.scale), clip: true)[
    #grid(
      columns: (1fr, auto),
      column-gutter: 4pt,
      text(size: 9.5pt * sheet.scale, weight: "bold", l.name),
      text(size: 7pt * sheet.scale, fill: muted, l.count),
    )
    #v(-2pt)
    #grid(
      columns: (1fr, auto),
      column-gutter: 4pt,
      text(size: 9pt * sheet.scale, l.size),
      text(size: 7.5pt * sheet.scale, weight: "bold", l.source),
    )
    #v(-2pt)
    #text(size: 7.5pt * sheet.scale, fill: muted, l.material) \
    #text(size: 6.5pt * sheet.scale, fill: muted, data.title)
  ]),
)

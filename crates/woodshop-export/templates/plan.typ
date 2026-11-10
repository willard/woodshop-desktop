// The printable plan. All numbers arrive pre-formatted from Rust (woodshop-core formats every
// fraction), so this file is layout only.
#let data = json(bytes(sys.inputs.at("data")))

#let ink = rgb("#1c1917")
#let muted = rgb("#78716c")
#let rule = rgb("#d6d3d1")
#let faint = rgb("#ececeb")
#let accent = rgb("#a16207")

#set document(title: data.title, author: "Woodshop")
#set page(paper: "us-letter", margin: (x: 0.6in, y: 0.6in), footer: context [
  #set text(size: 8pt, fill: muted)
  #data.title #h(1fr) Page #counter(page).display() of #counter(page).final().first()
])
#set text(font: ("Libertinus Serif", "New Computer Modern"), size: 10pt, fill: ink)
#show heading.where(level: 2): it => block(above: 14pt, below: 6pt, width: 100%, stroke: (bottom: 0.6pt + rule), inset: (bottom: 3pt))[
  #text(size: 11.5pt, weight: "bold", it.body)
]

#let label(t) = text(size: 7.5pt, fill: muted, upper(t))

#grid(
  columns: (1fr, auto),
  column-gutter: 12pt,
  [
    #text(size: 20pt, weight: "bold", data.title)
    #v(-6pt)
    #text(fill: muted)[Cut list & plan · #data.date]
    #if data.overall != none [
      #v(2pt)
      #text(fill: muted)[Overall #data.overall (W × D × H) · #data.partCount parts]
    ]
  ],
  if data.hasThumbnail { image("/thumb.png", width: 1.9in) },
)

== Summary
#table(
  columns: (1fr,) * 4,
  stroke: none,
  fill: rgb("#f5f5f4"),
  inset: 7pt,
  column-gutter: 3pt,
  ..data.totals.map(t => [#label(t.label) \ #text(size: 14pt, weight: "bold", t.value)]),
)

#if data.notes.len() > 0 [
  == Shop notes
  #table(
    columns: (14pt, 1fr),
    stroke: (_, y) => (bottom: 0.5pt + faint),
    inset: (x: 2pt, y: 5pt),
    ..data.notes.map(n => (text(fill: accent, weight: "bold", if n.pinned { "★" } else { "" }), n.body)).flatten(),
  )
]

#for section in data.sections [
  == #section.title
  #text(fill: muted, section.summary)
  #v(2pt)
  #table(
    columns: (8%, 45%, 27%, 20%),
    stroke: (_, y) => (bottom: 0.5pt + faint),
    inset: (x: 3pt, y: 4pt),
    align: (center, left, right, left),
    table.header(label("Qty"), label("Blank"), label("L × W × T"), label("Notes")),
    ..section.rows.map(r => (
      strong(str(r.qty)),
      [*#r.label* #if r.members != "" [ \ #text(size: 7.5pt, fill: muted, r.members)]],
      r.dims,
      text(fill: muted, r.notes),
    )).flatten(),
  )
]

#if data.hardware.len() > 0 [
  == Hardware
  #table(
    columns: (8%, 92%),
    stroke: (_, y) => (bottom: 0.5pt + faint),
    inset: (x: 3pt, y: 4pt),
    align: (center, left),
    table.header(label("Qty"), label("Item")),
    ..data.hardware.map(h => (strong(str(h.qty)), h.description)).flatten(),
  )
]

#let sheet-width = 100%
#for plan in data.sheets [
  == #plan.title
  #for n in range(plan.count) {
    let (sl, sw) = (plan.l, plan.w)
    block(breakable: false, below: 10pt, layout(size => {
      let s = size.width / sl
      box(width: sl * s, height: sw * s, fill: rgb("#f5f5f4"), stroke: 0.5pt + rgb("#a8a29e"), {
        for p in plan.placements.filter(p => p.sheet == n) {
          let fs = calc.max(calc.min(p.w, p.h) * s * 0.22, 5pt)
          place(dx: p.x * s, dy: (sw - p.y - p.h) * s, rect(
            width: p.w * s,
            height: p.h * s,
            fill: rgb("#e0b978"),
            stroke: 0.4pt + accent,
            inset: 1pt,
            align(center + horizon, text(size: calc.min(fs, 8pt), p.name)),
          ))
        }
      })
    }))
  }
]

#for plan in data.lumber [
  == #plan.title
  #table(
    columns: (1fr, 15%, 20%),
    stroke: (_, y) => (bottom: 0.5pt + faint),
    inset: (x: 3pt, y: 4pt),
    align: (left, center, right),
    table.header(label("Cut"), label("Stick"), label("Length")),
    ..plan.cuts.map(c => (c.name, str(c.stick), c.length)).flatten(),
  )
]

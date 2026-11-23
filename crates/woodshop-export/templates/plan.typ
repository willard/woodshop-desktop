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
    #if data.credit != none [
      #v(2pt)
      #text(fill: muted)[#data.credit#if data.creditUrl != none [ · #link(data.creditUrl)]]
    ]
    #if data.overall != none [
      #v(2pt)
      #text(fill: muted)[Overall #data.overall (W × D × H) · #data.partCount parts]
    ]
  ],
  if data.hasThumbnail { image("/thumb.png", width: 1.9in) },
)

== Summary
#table(
  columns: (1fr,) * data.totals.len(),
  stroke: none,
  fill: rgb("#f5f5f4"),
  inset: 7pt,
  column-gutter: 3pt,
  ..data.totals.map(t => [#label(t.label) \ #text(size: 14pt, weight: "bold", t.value)]),
)
#if data.finish != "" { block(above: 5pt, text(size: 8.5pt, fill: muted, data.finish)) }

#if data.notes.len() > 0 [
  == Shop notes
  #table(
    columns: (14pt, 1fr),
    stroke: (_, y) => (bottom: 0.5pt + faint),
    inset: (x: 2pt, y: 5pt),
    ..data.notes.map(n => (text(fill: accent, weight: "bold", if n.pinned { "★" } else { "" }), n.body)).flatten(),
  )
]

#if data.buildNotes != none [
  == Build notes
  #text(size: 9.5pt, data.buildNotes)
]

#if data.hasDrawings [
  == Drawings
  // One block, so the side and top never land on a page apart from the front.
  #block(breakable: false)[
    #text(fill: muted)[Overall sizes, and from the front the clear height of each opening.]
    #v(4pt)
    #align(center, image("/front.svg", height: 9cm, fit: "contain"))
    #v(6pt)
    #grid(
      columns: (1fr, 1fr),
      column-gutter: 14pt,
      [#label("Side") #v(2pt) #image("/side.svg", width: 100%, height: 5.5cm, fit: "contain")],
      [#label("Top") #v(2pt) #image("/top.svg", width: 100%, height: 5.5cm, fit: "contain")],
    )
  ]
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
  #if data.hardwarePriced {
    table(
      columns: (8%, 77%, 15%),
      stroke: (_, y) => (bottom: 0.5pt + faint),
      inset: (x: 3pt, y: 4pt),
      align: (center, left, right),
      table.header(label("Qty"), label("Item"), label("Cost")),
      ..data.hardware.map(h => (strong(str(h.qty)), h.description, h.cost)).flatten(),
    )
  } else {
    table(
      columns: (8%, 92%),
      stroke: (_, y) => (bottom: 0.5pt + faint),
      inset: (x: 3pt, y: 4pt),
      align: (center, left),
      table.header(label("Qty"), label("Item")),
      ..data.hardware.map(h => (strong(str(h.qty)), h.description)).flatten(),
    )
  }
]

#if data.joinery.setups.len() > 0 or data.joinery.parts.len() > 0 [
  == Joinery and shaping
  #if data.joinery.setups.len() > 0 [
    #text(fill: muted)[Set each tool once and make every cut at that setting:]
    #table(
      columns: (40%, 8%, 52%),
      stroke: (_, y) => (bottom: 0.5pt + faint),
      inset: (x: 3pt, y: 4pt),
      align: (left, center, left),
      table.header(label("Setup"), label("Cuts"), label("Parts")),
      ..data.joinery.setups.map(s => (s.setup, strong(str(s.cuts)), text(size: 8.5pt, s.parts))).flatten(),
    )
    #v(4pt)
  ]
  #text(fill: muted)[Each part as drawn face-on: its length left to right, the bottom edge nearest you. Parts listed together are cut the same way.]
  #v(2pt)
  #for j in data.joinery.parts [
    #block(breakable: false, below: 8pt)[
      *#j.parts*
      #v(-4pt)
      #list(marker: text(fill: muted, "–"), ..j.lines.map(line => text(size: 9pt, line)))
    ]
  ]
]

#if data.drilling.len() > 0 [
  == Drilling
  #list(..data.drilling.map(line => [#line]))
]

#let sheet-width = 100%
#let saw = rgb("#dc2626")
#for plan in data.sheets [
  == #plan.title
  #if plan.cuts.len() > 0 {
    block(below: 6pt, text(size: 8.5pt, fill: muted)[The red numbers are the order to make the saw cuts: rip each sheet into strips, then crosscut the strips. Under each sheet, each cut's fence setting: the width of the piece it takes off, from the bottom edge for a rip and the left for a crosscut.])
  }
  #for board in plan.boards {
    let (n, sl, sw) = (board.sheet, board.l, board.w)
    block(breakable: false, below: 10pt, layout(size => {
      // An offcut is drawn to the same scale as the full sheets, with its caption above.
      let full = plan.boards.at(0, default: board).l
      let s = size.width / calc.max(sl, full)
      if board.caption != "" { block(below: 3pt, text(size: 8.5pt, fill: muted, board.caption)) }
      box(width: sl * s, height: sw * s, fill: rgb("#f5f5f4"), stroke: 0.5pt + rgb("#a8a29e"), {
        // The trimmed edges, dashed: everything is cut inside them.
        if board.trim > 0 {
          place(dx: board.trim * s, dy: board.trim * s, rect(width: (sl - 2 * board.trim) * s,
            height: (sw - 2 * board.trim) * s, stroke: (paint: rgb("#a8a29e"), thickness: 0.5pt, dash: "dashed")))
        }
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
        // A rip runs along the length at y; a crosscut runs up from y at x.
        let r = 4.5pt
        for c in plan.cuts.filter(c => c.sheet == n) {
          let (x, y) = (c.x * s, (sw - c.y) * s)
          if c.rip {
            place(dx: x, dy: y, line(end: (c.l * s, 0pt), stroke: 0.9pt + saw))
          } else {
            place(dx: x, dy: y, line(end: (0pt, -c.l * s), stroke: 0.9pt + saw))
          }
          let (cx, cy) = if c.rip { (x + r * 1.3, y) } else { (x, y - r * 1.3) }
          place(dx: cx - r, dy: cy - r, box(width: 2 * r, height: 2 * r, radius: r, fill: saw,
            align(center + horizon, text(size: 5.5pt, weight: "bold", fill: white, str(c.n)))))
        }
      })
      if board.steps != "" { block(above: 4pt, text(size: 8pt, fill: muted, board.steps)) }
    }))
  }
]

#for plan in data.lumber [
  == #plan.title
  #if plan.boards.any(b => b.steps != "") {
    block(below: 6pt, text(size: 8.5pt, fill: muted)[Red numbers: the order of the saw cuts, crosscuts to rough length first, then rips. Under each board, each cut's stop or fence setting.])
  }
  #for board in plan.boards {
    block(breakable: false, below: 6pt, layout(size => {
      // Boards are long and thin: along is to scale, across is a bar of fixed height.
      let full = plan.boards.at(0, default: board).l
      let s = size.width / calc.max(board.l, full)
      let h = if board.ripped { 26pt } else { 14pt }
      let t = h / board.across
      if board.caption != "" { block(below: 3pt, text(size: 8.5pt, fill: muted, board.caption)) }
      box(width: board.l * s, height: h, fill: rgb("#f5f5f4"), stroke: 0.5pt + rgb("#a8a29e"), {
        // The trimmed ends, dashed: everything is cut between them.
        if board.trim > 0 {
          for x in (board.trim, board.l - board.trim) {
            place(dx: x * s, dy: 0pt, line(end: (0pt, h), stroke: (paint: rgb("#a8a29e"), thickness: 0.5pt, dash: "dashed")))
          }
        }
        for c in board.cuts {
          // Clipped: a short piece's name is cut off rather than spilling over its neighbour.
          place(dx: c.x * s, dy: h - (c.y + c.h) * t, box(
            width: c.w * s,
            height: c.h * t,
            fill: rgb("#e0b978"),
            stroke: 0.4pt + accent,
            inset: 1pt,
            clip: true,
            align(center + horizon, text(size: 6.5pt, c.name)),
          ))
        }
        let r = 4pt
        for c in board.saws {
          let (x, y) = (c.x * s, h - c.y * t)
          if c.rip {
            place(dx: x, dy: y, line(end: (c.l * s, 0pt), stroke: 0.9pt + saw))
            // A quarter of the way along, clear of the crosscut numbers at the piece's ends.
            place(dx: x + c.l * s / 4 - r, dy: y - r, box(width: 2 * r, height: 2 * r, radius: r, fill: saw,
              align(center + horizon, text(size: 5pt, weight: "bold", fill: white, str(c.n)))))
          } else {
            place(dx: x, dy: y, line(end: (0pt, -c.l * t), stroke: 0.9pt + saw))
            place(dx: x - r, dy: y - c.l * t / 2 - r, box(width: 2 * r, height: 2 * r, radius: r, fill: saw,
              align(center + horizon, text(size: 5pt, weight: "bold", fill: white, str(c.n)))))
          }
        }
      })
      if board.steps != "" { block(above: 3pt, text(size: 8pt, fill: muted, board.steps)) }
    }))
  }
  #v(4pt)
  #table(
    columns: (1fr, 15%, 20%),
    stroke: (_, y) => (bottom: 0.5pt + faint),
    inset: (x: 3pt, y: 4pt),
    align: (left, center, right),
    table.header(label("Cut"), label("Board"), label("Length")),
    ..plan.cuts.map(c => (c.name, c.stick, c.length)).flatten(),
  )
]

#if data.assembly.len() > 0 [
  == Assembly order
  #text(fill: muted)[A suggested order: up from the floor, the back last, then drawers, doors and hardware. Dry-fit before you glue.]
  #v(2pt)
  #let words(step) = [
    *#step.heading*
    #if step.lines.len() > 0 [
      #v(-4pt)
      #list(marker: text(fill: muted, "–"), ..step.lines.map(line => text(size: 9pt, line)))
    ]
  ]
  #enum(
    tight: false,
    ..data.assembly.map(step => if step.picture == none { words(step) } else {
      // The picture shows the piece once the step is done, its new parts in orange; a step stays
      // on one page with its picture.
      block(breakable: false, grid(
        columns: (1fr, 5.2cm),
        column-gutter: 10pt,
        words(step),
        image(step.picture, width: 5.2cm),
      ))
    }),
  )
]

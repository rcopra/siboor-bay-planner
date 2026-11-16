# Siboor Trident electronics bay planner

Plan the electronics bay of a Siboor Trident June (250 / 300 / 350): drag parts onto the
bottom panel, to scale, and see clashes with each other, the skirts, the feet, the frame,
the stock IEC inlet and the deck.

Run it: `npm install`, then `npm run dev` and open the printed URL. `npm test` checks the geometry.

## Conventions

- Positions are millimetres from the bottom panel's **front-left corner**, X to the right,
  Y to the back, as seen from above. A part's X/Y is the front-left corner of its footprint.
  A tape measure on the real panel reads the same numbers.
- The layout is saved in the browser and can be saved/loaded as a `.json` file to share.

## Views

- **Layout**: place parts on the bottom panel; clash checks; panel DXF and drill template.
- **Wiring**: wires between terminals, using the current layout. Click a terminal, click to add
  bends, click another terminal to finish. "Auto-route" runs a wire through the ducts instead (shortest
  way in, along and out, going round other parts) and re-routes it when the layout changes. Parts
  without terminals in the library get them by double-clicking where their connector is. It warns where
  mains and low-voltage wires share a duct or cross outside one, or a wire joins mains to low voltage.
  The wiring diagram lists what lands on each terminal.
- **3D preview**: the bay with its parts and wires.

Terminals: the PSU's 9-way block (L, N, PE, −V ×3, +V ×3) and the SSR's four (L1, T1, A1+, A2−) are
measured on Siboor's models (`tools/extract_stock.py`). The stock inlet's L, N, PE are approximate.

## Where the numbers come from

- **Bottom panel**: Siboor's panel drawings (`Panel/Trident_AWD_{300,350}_Model_PC_Panel_Drawing.dxf`
  in github.com/Lzhikai/SIBOOR-Voron-Trident-June). The panel is a square of side
  build size + 137 with 19.5 mm round corners and four 5.4 mm frame holes 12 mm in from the sides and
  14 mm in from the front and back. 300 and 350 match the drawings. **250 is derived** from the same rule
  (no Siboor drawing), and Siboor's stock layout doesn't fit it as-is.
- **Keep-outs and bay height** (78 mm, panel top to deck underside): measured on Siboor's 300 model
  (`tools/keepouts.py`). They keep their distance to the edges at every size.
- **Stock panel holes** (`public/parts/stock-panel.json`, from `tools/stock_holes.py`): the 27 holes
  Siboor's bottom panel comes with, read from their 300 and 350 drawings, plus the SSR cut-out. With
  "Stock panel (pre-drilled)" the plan rings them, a part hole on one reuses it, new holes cutting into
  one are flagged, and the drill template greys them out. Siboor's 3D model has the middle duct 3.1 mm
  in front of its drilled holes; the stock layout follows the drawing. There's no 250 drawing.
  The stock panel can also be fitted turned 180° (its frame holes allow that, not 90°): its holes
  and cut-out turn, and so do the parts on it; the power inlet and Z motors stay where they are.
- **Z motors**: the three NEMA17 Z motors hang from the deck to 40 mm above the panel; the rear one's
  mount reaches 62 mm. Measured on Siboor's 300 model (`tools/keepouts.py` on the bed/Z group). The front
  two keep their distance to their corners; the rear one and its mount stay centred at the back.
  Only parts taller than ~40 mm can hit them, so ducts and the PSU pass underneath.
- **Stock parts** (`public/parts/`, written by `tools/extract_stock.py` from Siboor's model): PSU, SSR,
  Manta M8P, cable distribution box. Mounting holes come from Siboor's pre-drilled base plate (`tools/holes.py`).
  The M8P STEP is a light version (board outline, standoffs and fans, with no connectors). Its 3D view keeps the detail.
- **Tapped or through holes** follow how each part is held, as on Siboor's 350 drawing
  (blue through, green M3 tap, red M4 tap). The screw goes up through the panel into the part for the
  PSU (Ø4.2 through) and frame (Ø5.4). Tapped holes are drilled at the ISO tap drill (M3 2.5, M4 3.3):
  ducts and SSR M4, cable distribution box M3. Siboor's drawing has the Manta M8P through (Ø3.2);
  here it is tapped M3 for its standoffs.

## Stages

1. Layout, library, clash warnings, 2D + 3D views
2. Bottom panel DXF and a 1:1 printable drilling template (PDF) ← **here**
3. Upload your own STEP parts
4. Export the whole bay as one STEP

## Credits

- Stock parts, the bottom panel and its drawings come from Siboor's Trident June CAD,
  github.com/Lzhikai/SIBOOR-Voron-Trident-June. They're converted here (moved into each part's
  own frame, lightened) and credited in the app. If you're Siboor and want them removed, open an issue.
- Inspired by FizzysTech's FT EMS planner (ft-ems-planner.netlify.app, github.com/akashrpatel/ft-ems-visualizer).

## Deploying

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/pages.yml`).
The tests run first; if one fails, nothing is published and the live site stays as it was.
Run `npm test` before pushing.

import { SIZES, BAY_HEIGHT, panelSide, problems, stockLayout, stockSpot, stockPanel, turn180, existingHole, partSize, partHoles, placedHoles, holeLabel, round1 } from "./bay.js";
import { Plan2D } from "./plan2d.js";
import { View3D } from "./view3d.js";
import { panelDrawing, panelDXF } from "./panel.js";
import { drillTemplate } from "./pdf.js";
import { routeWires } from "./wires.js";
import { Wiring } from "./wiring.js";
import { History } from "./history.js";
import { UP, readStep, guessUp, toPart, allUploads, putUpload, deleteUpload, fileId, packUpload, unpackUpload } from "./uploads.js";

const $ = id => document.getElementById(id);
const KEY = "siboor-bay-planner/v1";

// Parts built into the app (not files): the 25 x 25 duct and a plain box.
const BUILTIN = [
  { id: "duct", kind: "duct", name: "Wire duct (25 × 25)", category: "Wiring", notes: "Siboor's slotted duct. M4 tapped holes every 102 mm from its middle.", source: "Siboor Trident June" },
  { id: "box", kind: "box", name: "Custom box", category: "Other", notes: "A stand-in for a part with no CAD model.", source: "" },
];
const COLOURS = { Power: "#f1d27a", Electronics: "#9cc3ef", Wiring: "#d8d8d8", Other: "#cfcfcf", Custom: "#c9a7ea" };

const library = [...(await (await fetch("parts/library.json")).json()), ...BUILTIN];
const partById = new Map(library.map(p => [p.id, p]));
const STOCK_HOLES = await (await fetch("parts/stock-panel.json")).json();

// Parts from people's own STEP files (uploads.js): id -> the stored upload.
const uploads = new Map();
function register(u) { uploads.set(u.id, u); partById.set(u.id, toPart(u)); }
let undo = null;   // History of the layout (below), once the app is set up

// Terminals added by hand to a placed copy of an upload (before they were kept with the part)
// move onto the upload, keeping their ids, so the wires on them stay put.
function adoptTerminals() {
  for (const it of app.state.items) {
    const u = uploads.get(it.part);
    if (!u || !it.terminals?.length) continue;
    u.terminals ??= [];
    for (const t of it.terminals) if (!u.terminals.some(x => x.id === t.id)) u.terminals.push(t);
    delete it.terminals;
    register(u); putUpload(u); save();
  }
}
for (const u of await allUploads().catch(() => [])) register(u);

const app = {
  state: load() ?? { size: 350, iec: true, base: "stock", items: stockLayout(350), selected: null },
  problems: {},
  partOf: it => partById.get(it.part),
  colourOf: (part, it) => it?.colour || COLOURS[part.category] || "#ccc",
  // the stock panel's holes when starting from it (null on a blank panel, or at 250: no drawing)
  stock() { return this.state.base === "blank" ? null : stockPanel(STOCK_HOLES, this.state.size, this.stockOpts()); },
  // where Siboor's parts go: on the stock panel's holes, turned with it
  stockOpts() { return { turned: this.state.base === "stock180", partOf: this.partOf }; },
  select(uid) { this.state.selected = uid; update(); },
  move(uid, x, y) { const it = find(uid); it.x = round1(x); it.y = round1(y); update(false); },
  commit() { save(); },
  update: (persist = true) => update(persist),
  uploadOf: part => uploads.get(part?.id),
  uploadChanged(u) { register(u); update(); putUpload(u); },   // its terminals edited in the wiring view
  view: "layout",           // layout | wiring | 3d
  routed: { wires: [], problems: {} },
};
app.state.items = app.state.items.filter(it => partById.has(it.part));   // parts since removed from the library
app.state.base ??= "stock";
app.state.wires ??= [];
adoptTerminals();
undo = new History(snapshot());
app.wiring = new Wiring(app);
const plan = new Plan2D($("plan"), app);
const view = new View3D($("three"), app);

function find(uid) { return app.state.items.find(i => i.uid === uid); }
function uid() { return Math.random().toString(36).slice(2, 9); }
function save() { localStorage.setItem(KEY, JSON.stringify(app.state)); undo?.record(snapshot()); }

// --- undo -------------------------------------------------------------------------------

// What undo brings back: the layout and wires, and the edits to people's own parts (their STEP
// files stay as they are). Not what's selected, nor the auto-route switch.
function snapshot() {
  const NOT_UNDONE = new Set(["selected", "wireSel", "wirePart", "autoRoute"]);
  return JSON.stringify({
    state: Object.fromEntries(Object.entries(app.state).filter(([k]) => !NOT_UNDONE.has(k))),
    uploads: [...uploads.values()].map(u => ({ id: u.id, name: u.name, up: u.up, holes: u.holes, terminals: u.terminals ?? [] })),
  });
}
function restore(snap) {
  const { state, uploads: saved } = JSON.parse(snap), st = app.state;
  for (const s of saved) {
    const u = uploads.get(s.id);   // a part since removed from the planner stays removed
    if (!u || JSON.stringify([u.name, u.up, u.holes, u.terminals ?? []]) === JSON.stringify([s.name, s.up, s.holes, s.terminals])) continue;
    Object.assign(u, s); register(u); putUpload(u);
  }
  const items = state.items.filter(it => partById.has(it.part)), kept = new Set([...items.map(i => i.uid), "printer"]);
  const wires = state.wires.filter(w => kept.has(w.a.uid) && kept.has(w.b.uid)), has = uid => items.some(i => i.uid === uid);
  app.state = { ...state, items, wires, autoRoute: st.autoRoute, selected: has(st.selected) ? st.selected : null,
    wirePart: has(st.wirePart) ? st.wirePart : null, wireSel: wires.some(w => w.id === st.wireSel) ? st.wireSel : null };
  app.wiring.drawing = null; app.wiring.placing = null;
  $("size").value = app.state.size; $("iec").checked = app.state.iec; $("base").value = app.state.base;
  if (state.size !== st.size) plan.fit();
  renderLibrary();
  localStorage.setItem(KEY, JSON.stringify(app.state));
  update(false);
}
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
const nameOf = it => it.label || app.partOf(it).name;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function update(persist = true) {
  const st = app.state;
  app.problems = problems(st.items, app.partOf, st.size, { iec: st.iec, stock: app.stock() });
  app.routed = routeWires(st, app.partOf);
  $("legend-stock").hidden = !app.stock();
  for (const o of $("base").options) if (o.value !== "blank") o.disabled = !STOCK_HOLES[st.size];
  $("base").title = STOCK_HOLES[st.size] ? "Start from Siboor's pre-drilled bottom panel (as fitted, or turned 180°), or a blank one" : `Siboor has no drawing of the ${st.size} panel: blank only`;
  if (!$("plan").hidden) plan.render();
  if (!$("three").hidden) view.render();
  if (app.view === "wiring") {
    app.wiring.renderStatus($("status"));
    app.wiring.renderSelected($("selected"));
    $("bomwrap").querySelector("summary").textContent = `Wiring diagram (${st.wires.length})`;
    app.wiring.renderDiagram($("bom"));
  } else {
    renderStatus();
    renderSelected();
    renderBom();
  }
  if (persist) save();
}

// --- library ---------------------------------------------------------------------------

function renderLibrary() {
  const box = $("library");
  box.innerHTML = `<button id="upload" class="upload">＋ Add your own part<small>From a STEP file (.step, .stp), or drop one anywhere on the page</small></button><h2>Add a part</h2>`;
  $("upload").onclick = () => $("stepfile").click();
  for (const p of library) {
    const b = document.createElement("button");
    b.className = "libitem";
    const size = p.size ? `${p.size[0]} × ${p.size[1]} × ${p.size[2]} mm` : "Any size";
    b.innerHTML = `<span class="swatch" style="background:${app.colourOf(p, {})}"></span><span>${esc(p.name)}<small>${size}</small></span>`;
    b.title = p.notes || "";
    b.onclick = () => add(p);
    box.appendChild(b);
  }
  if (uploads.size) {
    box.insertAdjacentHTML("beforeend", `<h2>Your parts</h2>`);
    for (const u of uploads.values()) {
      const p = partById.get(u.id), row = document.createElement("div");
      row.className = "yourpart";
      row.innerHTML = `<button class="libitem"><span class="swatch" style="background:${COLOURS.Custom}"></span><span>${esc(p.name)}<small>${p.size.join(" × ")} mm</small></span></button><button class="x" title="Remove this part from the planner (and from the layout)">×</button>`;
      row.querySelector(".libitem").onclick = () => add(p);
      row.querySelector(".x").onclick = () => removeUpload(u.id);
      box.appendChild(row);
    }
  }
  box.insertAdjacentHTML("beforeend", `<p class="muted">Parts land in the middle of the panel.</p>
    <p class="credit">Stock parts, panel and drawings from <a href="https://github.com/Lzhikai/SIBOOR-Voron-Trident-June" target="_blank" rel="noopener">Siboor's Trident June CAD</a>.
    Inspired by FizzysTech's <a href="https://ft-ems-planner.netlify.app" target="_blank" rel="noopener">FT EMS planner</a>.</p>`);
}

function add(part) {
  const s = panelSide(app.state.size);
  const params = part.kind === "duct" ? { length: 200 } : part.kind === "box" ? { w: 50, d: 50, h: 30 } : undefined;
  const it = { uid: uid(), part: part.id, label: "", x: 0, y: 0, rot: 0, params };
  const [w, d] = partSize(it, part);
  it.x = round1(s / 2 - w / 2); it.y = round1(s / 2 - d / 2);
  app.state.items.push(it);
  app.state.selected = it.uid;
  update();
}

// --- right panel -----------------------------------------------------------------------

function renderStatus() {
  const bad = app.state.items.filter(it => app.problems[it.uid]?.length);
  const box = $("status");
  box.className = bad.length ? "bad" : "ok";
  if (!bad.length) { box.textContent = "✓ Everything fits"; return; }
  box.innerHTML = `⚠ ${bad.length} part${bad.length > 1 ? "s" : ""} don't fit<ul>` +
    bad.map(it => `<li><a href="#" data-uid="${it.uid}">${esc(nameOf(it))}</a>: ${app.problems[it.uid].join("; ")}</li>`).join("") + "</ul>";
  box.querySelectorAll("a").forEach(a => a.onclick = e => { e.preventDefault(); app.select(a.dataset.uid); });
}

function num(key, value, attrs = "") {
  return `<input type="number" data-k="${key}" value="${value}" step="1" ${attrs}>`;
}

function renderSelected() {
  const it = app.state.selected && find(app.state.selected), box = $("selected");
  if (!it) { box.innerHTML = `<p class="muted">Click a part on the panel to move, rotate or resize it.</p>`; return; }
  const part = app.partOf(it);
  const [w, d, h] = partSize(it, part);
  let html = `<input type="text" class="name" data-k="label" value="${esc(nameOf(it))}" title="Rename">`;
  html += `<div class="row"><label>Position</label>X ${num("x", it.x)} Y ${num("y", it.y)}<span class="unit">mm</span></div>`;
  html += `<div class="row"><label>Rotation</label><span class="seg">${[0, 90, 180, 270].map(r => `<button data-rot="${r}" class="${it.rot === r ? "on" : ""}">${r}°</button>`).join("")}</span></div>`;
  if (part.kind === "duct") html += `<div class="row"><label>Length</label>${num("p.length", it.params.length, `min="20"`)}<span class="unit">mm</span></div>`;
  if (part.kind === "box") html += `<div class="row"><label>Size</label>${num("p.w", it.params.w, `min="1"`)}×${num("p.d", it.params.d, `min="1"`)}×${num("p.h", it.params.h, `min="1"`)}</div>`;
  const holes = partHoles(it, part), byKind = new Map();
  for (const hl of holes) byKind.set(holeLabel(hl), (byKind.get(holeLabel(hl)) || 0) + 1);
  let holeText = holes.length ? [...byKind].map(([k, n]) => `${n} × ${k}`).join(", ") : "no holes";
  const stock = app.stock();
  if (stock && holes.length) {
    const reused = placedHoles(it, part).filter(h => existingHole(h, stock)).length;
    holeText += reused === holes.length ? `<br><b>All on existing holes</b>: nothing to drill` : reused ? `<br>${reused} on existing holes, <b>${holes.length - reused} new</b>` : `<br><b>All new</b>: none on existing holes`;
  }
  html += `<p class="info">${part.name !== nameOf(it) ? esc(part.name) + "<br>" : ""}${w} × ${d} mm, ${h} mm tall (bay ${BAY_HEIGHT} mm)<br>${holeText}${part.notes ? "<br>" + esc(part.notes) : ""}</p>`;
  if (part.kind === "upload") html += uploadEditor(uploads.get(part.id));
  const spot = stockSpot(it, app.state.size, app.stockOpts());
  const atSpot = spot && spot.x === it.x && spot.y === it.y && spot.rot === it.rot && (part.kind !== "duct" || spot.params.length === it.params.length);
  if (spot) html += `<button id="tostock" class="wide" ${atSpot ? "disabled" : ""} title="Siboor's position${part.kind === "duct" ? " and length" : ""} for this part, on the stock panel's holes">${atSpot ? "✓ At its stock position" : "↺ Back to stock position"}</button>`;
  html += `<div class="actions"><button id="dup">Duplicate</button><button id="del">Remove</button></div>`;
  box.innerHTML = html;
  box.querySelectorAll("[data-k]").forEach(e => e.onchange = () => {
    const k = e.dataset.k;
    if (k === "label") it.label = e.value.trim() === part.name ? "" : e.value.trim();
    else if (k.startsWith("p.")) it.params[k.slice(2)] = parseFloat(e.value);
    else it[k] = round1(parseFloat(e.value));
    update();
  });
  box.querySelectorAll("[data-rot]").forEach(b => b.onclick = () => { it.rot = +b.dataset.rot; update(); });
  if (spot && !atSpot) $("tostock").onclick = () => {
    Object.assign(it, { x: spot.x, y: spot.y, rot: spot.rot });
    if (part.kind === "duct") it.params.length = spot.params.length;
    update();
  };
  $("dup").onclick = duplicate;
  $("del").onclick = remove;
  if (part.kind === "upload") wireUploadEditor(box, uploads.get(part.id));
}

// --- your own parts ----------------------------------------------------------------------

const HOLE_TYPES = {
  "M3 tap": { thread: "M3", fix: "tap", d: 3.4 }, "M4 tap": { thread: "M4", fix: "tap", d: 4.5 }, "M5 tap": { thread: "M5", fix: "tap", d: 5.5 },
  "M3 through": { thread: "M3", fix: "through", d: 3.4 }, "M4 through": { thread: "M4", fix: "through", d: 4.5 }, "M5 through": { thread: "M5", fix: "through", d: 5.5 },
};
const holeType = h => `${h.thread} ${h.fix}`;

function uploadEditor(u) {
  const rows = u.holes.map((h, i) => `<tr data-i="${i}"><td>${num("hx", h.x, `step="0.1"`)}</td><td>${num("hy", h.y, `step="0.1"`)}</td>` +
    `<td><select data-ht>${Object.keys(HOLE_TYPES).map(k => `<option ${k === holeType(h) ? "selected" : ""}>${k}</option>`).join("")}</select></td><td><button data-hdel title="Remove this hole">×</button></td></tr>`).join("");
  return `<div class="upedit">
    <div class="row"><label>Part name</label><input type="text" data-pname value="${esc(u.name)}"></div>
    <div class="row"><label>Up</label><select data-up>${Object.entries(UP).map(([k, v]) => `<option value="${k}" ${k === u.up ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <p class="muted">Mounting holes, in mm from the part's front-left corner as it sits at 0°:</p>
    ${u.holes.length ? `<table class="holes"><tr class="muted"><td>X</td><td>Y</td><td>Hole</td><td></td></tr>${rows}</table>` : ""}
    <button id="addhole">Add a hole</button>
  </div>`;
}

function wireUploadEditor(box, u) {
  const changed = async () => { await putUpload(u); register(u); renderLibrary(); update(); };
  box.querySelector("[data-pname]").onchange = e => { u.name = e.target.value.trim() || u.name; changed(); };
  box.querySelector("[data-up]").onchange = e => { u.up = e.target.value; changed(); };
  box.querySelector("#addhole").onclick = () => {
    const [w, d] = partById.get(u.id).size;
    u.holes.push({ x: round1(w / 2), y: round1(d / 2), ...HOLE_TYPES["M3 tap"] });
    changed();
  };
  box.querySelectorAll(".holes tr[data-i]").forEach(tr => {
    const h = u.holes[+tr.dataset.i];
    tr.querySelector("[data-k=hx]").onchange = e => { h.x = round1(parseFloat(e.target.value)); changed(); };
    tr.querySelector("[data-k=hy]").onchange = e => { h.y = round1(parseFloat(e.target.value)); changed(); };
    tr.querySelector("[data-ht]").onchange = e => { Object.assign(h, HOLE_TYPES[e.target.value]); changed(); };
    tr.querySelector("[data-hdel]").onclick = () => { u.holes.splice(+tr.dataset.i, 1); changed(); };
  });
}

function busy(msg) { $("busy").hidden = !msg; $("busy").textContent = msg || ""; }

async function addStepFiles(files) {
  for (const f of files) {
    if (!/\.(step|stp)$/i.test(f.name)) { alert(`${f.name} isn't a STEP file (.step or .stp).`); continue; }
    try {
      const step = await f.arrayBuffer(), id = await fileId(step);
      if (!uploads.has(id)) {
        busy(`Reading ${f.name}…${readStep.loaded ? "" : " (the first file also loads the STEP reader, about 8 MB)"}`);
        const meshes = await readStep(step);
        readStep.loaded = true;
        const u = { id, name: f.name.replace(/\.(step|stp)$/i, ""), up: guessUp(meshes), holes: [], step, meshes };
        await putUpload(u);
        register(u);
      }
      add(partById.get(id));
    } catch (err) {
      alert(`Couldn't read ${f.name}: ${err.message}`);
    } finally {
      busy(null);
    }
  }
  renderLibrary();
}

async function removeUpload(id) {
  const used = app.state.items.filter(i => i.part === id);
  if (!confirm(`Remove "${partById.get(id).name}" from the planner?${used.length ? ` It's in this layout ${used.length} time(s); those go too.` : ""}`)) return;
  const gone = new Set(used.map(i => i.uid));
  app.state.items = app.state.items.filter(i => !gone.has(i.uid));
  app.state.wires = app.state.wires.filter(w => !gone.has(w.a.uid) && !gone.has(w.b.uid));
  await deleteUpload(id);
  uploads.delete(id); partById.delete(id);
  renderLibrary();
  update();
}

$("stepfile").onchange = e => { addStepFiles([...e.target.files]); e.target.value = ""; };
document.addEventListener("dragover", e => { if ([...e.dataTransfer.items].some(i => i.kind === "file")) { e.preventDefault(); document.body.classList.add("dropping"); } });
document.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
document.addEventListener("drop", e => {
  e.preventDefault();
  document.body.classList.remove("dropping");
  const files = [...e.dataTransfer.files].filter(f => /\.(step|stp)$/i.test(f.name));
  if (files.length) { showView("layout"); addStepFiles(files); }
});

function duplicate() {
  const it = find(app.state.selected);
  if (!it) return;
  const copy = { ...structuredClone(it), uid: uid(), x: it.x + 10, y: it.y + 10 };
  app.state.items.push(copy);
  app.state.selected = copy.uid;
  update();
}

function remove() {
  const gone = app.state.selected;
  app.state.items = app.state.items.filter(i => i.uid !== gone);
  app.state.wires = app.state.wires.filter(w => w.a.uid !== gone && w.b.uid !== gone);
  app.state.selected = null;
  update();
}

function renderBom() {
  const counts = new Map();
  for (const it of app.state.items) {
    const p = app.partOf(it);
    const key = p.kind === "duct" ? `${p.name}, ${it.params.length} mm` : p.kind === "box" ? `${nameOf(it)} (${it.params.w} × ${it.params.d} × ${it.params.h})` : p.name;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  $("bomwrap").querySelector("summary").textContent = `Parts list (${app.state.items.length})`;
  $("bom").innerHTML = `<table>${[...counts].map(([k, n]) => `<tr><td class="n">${n} ×</td><td>${esc(k)}</td></tr>`).join("")}</table>`;
}

// --- header ----------------------------------------------------------------------------

$("size").innerHTML = SIZES.map(s => `<option value="${s}">Trident ${s}${s === 250 ? " (estimated)" : ""}</option>`).join("");
$("size").value = app.state.size;
$("size").onchange = e => {
  // keep the parts where they are relative to the panel's centre (Siboor centres its layout)
  const old = panelSide(app.state.size), size = +e.target.value, shift = (panelSide(size) - old) / 2;
  for (const it of app.state.items) { it.x = round1(it.x + shift); it.y = round1(it.y + shift); }
  for (const w of app.state.wires) w.pts = (w.pts ?? []).map(([x, y]) => [round1(x + shift), round1(y + shift)]);
  app.state.size = size;
  plan.fit();
  update();
};
$("base").value = app.state.base;
$("base").onchange = e => {
  // turning the stock panel turns what's mounted on it; the printer's keep-outs stay put
  const was = app.state.base, now = e.target.value;
  if (was !== "blank" && now !== "blank" && was !== now) {
    const s = panelSide(app.state.size);
    app.state.items = app.state.items.map(it => turn180(it, app.partOf(it), app.state.size));
    for (const w of app.state.wires) w.pts = (w.pts ?? []).map(([x, y]) => [round1(s - x), round1(s - y)]);
  }
  app.state.base = now;
  update();
};
$("iec").checked = app.state.iec;
$("iec").onchange = e => { app.state.iec = e.target.checked; update(); };

// menus close when an item is picked or on a click elsewhere
document.addEventListener("click", e => {
  for (const m of document.querySelectorAll("details.menu[open]")) if (!m.contains(e.target) || e.target.closest(".menu > div button")) m.open = false;
});
$("stock").onclick = () => {
  if (app.state.items.length && !confirm(`Replace this layout with Siboor's stock layout?${app.state.wires.length ? " Its wires go too." : ""}`)) return;
  app.state.items = stockLayout(app.state.size, app.stockOpts()); app.state.wires = []; app.state.selected = null; update();
};
$("clear").onclick = () => {
  if (app.state.items.length && !confirm("Remove every part?")) return;
  app.state.items = []; app.state.wires = []; app.state.selected = null; update();
};

function download(blob, name) {
  Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name }).click();
}
$("save").onclick = async () => {
  const used = [...new Set(app.state.items.map(i => i.part))].filter(id => uploads.has(id));
  const packed = await Promise.all(used.map(id => packUpload(uploads.get(id))));
  download(new Blob([JSON.stringify({ app: "siboor-bay-planner", version: 1, ...app.state, uploads: packed }, null, 1)], { type: "application/json" }), `bay-${app.state.size}.json`);
};
function clashesOk() {
  const n = Object.values(app.problems).filter(m => m.length).length;
  return !n || confirm(`${n} part(s) don't fit yet. Export anyway?`);
}
$("dxf").onclick = () => {
  if (!clashesOk()) return;
  download(new Blob([panelDXF(panelDrawing(app.state, app.partOf, app.stock()))], { type: "application/dxf" }), `bottom-panel-${app.state.size}.dxf`);
};
for (const b of document.querySelectorAll("[data-pdf]")) {
  b.onclick = () => {
    if (!clashesOk()) return;
    const paper = b.dataset.pdf;
    const doc = drillTemplate(panelDrawing(app.state, app.partOf, app.stock()), { paper, size: app.state.size, iec: app.state.iec });
    download(doc.output("blob"), `drill-template-${app.state.size}-${paper}.pdf`);
  };
}
$("load").onclick = () => $("loadfile").click();
$("loadfile").onchange = async e => {
  const data = JSON.parse(await e.target.files[0].text());
  for (const p of data.uploads ?? []) {
    if (uploads.has(p.id)) continue;
    try {
      busy(`Reading ${p.name} from the layout file…`);
      const u = await unpackUpload(p);
      await putUpload(u);
      register(u);
    } catch (err) { alert(`Couldn't read the part ${p.name}: ${err.message}`); } finally { busy(null); }
  }
  renderLibrary();
  const missing = data.items.filter(it => !partById.has(it.part)).map(it => it.part);
  if (missing.length) alert(`Skipped parts this planner doesn't have: ${[...new Set(missing)].join(", ")}`);
  const items = data.items.filter(it => partById.has(it.part)), kept = new Set([...items.map(i => i.uid), "printer"]);
  app.state = { size: data.size, iec: data.iec, base: data.base ?? "stock", items, selected: null,
    wires: (data.wires ?? []).filter(w => kept.has(w.a.uid) && kept.has(w.b.uid)), autoRoute: !!data.autoRoute };
  adoptTerminals();
  $("size").value = app.state.size; $("iec").checked = app.state.iec; $("base").value = app.state.base;
  plan.fit();
  update();
  e.target.value = "";
};
function showView(v) {
  app.view = v;
  plan.mode = v === "wiring" ? "wiring" : "layout";
  app.wiring.drawing = null; app.wiring.placing = null;
  $("plan").hidden = v === "3d"; $("three").hidden = v !== "3d";
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.view === v);
  $("library").hidden = v !== "layout";
  $("legend").hidden = v !== "layout"; $("wlegend").hidden = v !== "wiring";
  $("bomwrap").open = v === "wiring" || $("bomwrap").open;
  view.resize();
  update(false);
}
for (const b of document.querySelectorAll("#tabs button")) b.onclick = () => showView(b.dataset.view);
$("autoroute").checked = !!app.state.autoRoute;
$("autoroute").onchange = e => { app.state.autoRoute = e.target.checked; update(); };

document.addEventListener("keydown", e => {
  if (e.target.matches("input, select, textarea")) return;   // their own undo
  // Cmd/Ctrl+Z undo; Cmd/Ctrl+Shift+Z or Ctrl+Y redo. A wire being drawn is just dropped.
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === "z" || (key === "y" && e.ctrlKey))) {
    e.preventDefault();
    if (app.wiring.drawing) { app.wiring.drawing = null; return update(false); }
    const snap = key === "y" || e.shiftKey ? undo.redo() : undo.undo();
    if (snap) restore(snap);
    return;
  }
  if (app.view === "wiring") { if (app.wiring.keys(e)) e.preventDefault(); return; }
  if (app.view !== "layout") return;
  const it = app.state.selected && find(app.state.selected);
  if (!it) return;
  const step = e.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (moves[e.key]) { it.x = round1(it.x + moves[e.key][0]); it.y = round1(it.y + moves[e.key][1]); }
  else if (e.key === "r" || e.key === "R") it.rot = (it.rot + 90) % 360;
  else if (e.key === "d" || e.key === "D") return duplicate();
  else if (e.key === "Delete" || e.key === "Backspace") return remove();
  else if (e.key === "Escape") app.state.selected = null;
  else return;
  e.preventDefault();
  update();
});

renderLibrary();
update(false);

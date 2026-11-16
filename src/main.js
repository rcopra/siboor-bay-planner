import { SIZES, BAY_HEIGHT, panelSide, problems, stockLayout, stockSpot, stockPanel, existingHole, partSize, partHoles, placedHoles, holeLabel, round1 } from "./bay.js";
import { Plan2D } from "./plan2d.js";
import { View3D } from "./view3d.js";
import { panelDrawing, panelDXF } from "./panel.js";
import { drillTemplate } from "./pdf.js";

const $ = id => document.getElementById(id);
const KEY = "siboor-bay-planner/v1";

// Parts built into the app (not files): the 25 x 25 duct and a plain box.
const BUILTIN = [
  { id: "duct", kind: "duct", name: "Wire duct (25 × 25)", category: "Wiring", notes: "Siboor's slotted duct. M4 tapped holes every 102 mm from its middle.", source: "Siboor Trident June" },
  { id: "box", kind: "box", name: "Custom box", category: "Other", notes: "A stand-in for a part with no CAD model.", source: "" },
];
const COLOURS = { Power: "#f1d27a", Electronics: "#9cc3ef", Wiring: "#d8d8d8", Other: "#cfcfcf" };

const library = [...(await (await fetch("parts/library.json")).json()), ...BUILTIN];
const partById = new Map(library.map(p => [p.id, p]));
const STOCK_HOLES = await (await fetch("parts/stock-panel.json")).json();

const app = {
  state: load() ?? { size: 350, iec: true, base: "stock", items: stockLayout(350), selected: null },
  problems: {},
  partOf: it => partById.get(it.part),
  colourOf: (part, it) => it?.colour || COLOURS[part.category] || "#ccc",
  // the stock panel's holes when starting from it (null on a blank panel, or at 250: no drawing)
  stock() { return this.state.base === "blank" ? null : stockPanel(STOCK_HOLES, this.state.size); },
  select(uid) { this.state.selected = uid; update(); },
  move(uid, x, y) { const it = find(uid); it.x = round1(x); it.y = round1(y); update(false); },
  commit() { save(); },
};
app.state.items = app.state.items.filter(it => partById.has(it.part));
app.state.base ??= "stock";   // parts since removed from the library
const plan = new Plan2D($("plan"), app);
const view = new View3D($("three"), app);

function find(uid) { return app.state.items.find(i => i.uid === uid); }
function uid() { return Math.random().toString(36).slice(2, 9); }
function save() { localStorage.setItem(KEY, JSON.stringify(app.state)); }
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
const nameOf = it => it.label || app.partOf(it).name;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function update(persist = true) {
  const st = app.state;
  app.problems = problems(st.items, app.partOf, st.size, { iec: st.iec, stock: app.stock() });
  $("legend-stock").hidden = !app.stock();
  $("base").options[0].textContent = STOCK_HOLES[st.size] ? "Stock panel (pre-drilled)" : `Stock panel (no Siboor drawing at ${st.size})`;
  if (!$("plan").hidden) plan.render();
  if (!$("three").hidden) view.render();
  renderStatus();
  renderSelected();
  renderBom();
  if (persist) save();
}

// --- library ---------------------------------------------------------------------------

function renderLibrary() {
  const box = $("library");
  box.innerHTML = "<h2>Add a part</h2>";
  for (const p of library) {
    const b = document.createElement("button");
    b.className = "libitem";
    const size = p.size ? `${p.size[0]} × ${p.size[1]} × ${p.size[2]} mm` : "Any size";
    b.innerHTML = `<span class="swatch" style="background:${app.colourOf(p, {})}"></span><span>${esc(p.name)}<small>${size}</small></span>`;
    b.title = p.notes || "";
    b.onclick = () => add(p);
    box.appendChild(b);
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
  const spot = stockSpot(it, app.state.size);
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
}

function duplicate() {
  const it = find(app.state.selected);
  if (!it) return;
  const copy = { ...structuredClone(it), uid: uid(), x: it.x + 10, y: it.y + 10 };
  app.state.items.push(copy);
  app.state.selected = copy.uid;
  update();
}

function remove() {
  app.state.items = app.state.items.filter(i => i.uid !== app.state.selected);
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
  app.state.size = size;
  plan.fit();
  update();
};
$("base").value = app.state.base;
$("base").onchange = e => { app.state.base = e.target.value; update(); };
$("iec").checked = app.state.iec;
$("iec").onchange = e => { app.state.iec = e.target.checked; update(); };

// menus close when an item is picked or on a click elsewhere
document.addEventListener("click", e => {
  for (const m of document.querySelectorAll("details.menu[open]")) if (!m.contains(e.target) || e.target.closest(".menu > div button")) m.open = false;
});
$("stock").onclick = () => {
  if (app.state.items.length && !confirm("Replace this layout with Siboor's stock layout?")) return;
  app.state.items = stockLayout(app.state.size); app.state.selected = null; update();
};
$("clear").onclick = () => {
  if (app.state.items.length && !confirm("Remove every part?")) return;
  app.state.items = []; app.state.selected = null; update();
};

function download(blob, name) {
  Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name }).click();
}
$("save").onclick = () => {
  download(new Blob([JSON.stringify({ app: "siboor-bay-planner", version: 1, ...app.state }, null, 1)], { type: "application/json" }), `bay-${app.state.size}.json`);
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
  const missing = data.items.filter(it => !partById.has(it.part)).map(it => it.part);
  if (missing.length) alert(`Skipped parts this planner doesn't have: ${[...new Set(missing)].join(", ")}`);
  app.state = { size: data.size, iec: data.iec, base: data.base ?? "stock", items: data.items.filter(it => partById.has(it.part)), selected: null };
  $("size").value = app.state.size; $("iec").checked = app.state.iec; $("base").value = app.state.base;
  plan.fit();
  update();
  e.target.value = "";
};
for (const [btn, show] of [["view2d", "plan"], ["view3d", "three"]]) {
  $(btn).onclick = () => {
    $("plan").hidden = show !== "plan"; $("three").hidden = show !== "three";
    $("view2d").classList.toggle("on", show === "plan"); $("view3d").classList.toggle("on", show === "three");
    $("legend").hidden = show !== "plan";
    view.resize();
    update(false);
  };
}

document.addEventListener("keydown", e => {
  if (e.target.matches("input, select, textarea")) return;
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

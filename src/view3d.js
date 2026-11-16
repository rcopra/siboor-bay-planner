// The 3D view: the panel, the keep-outs and every placed part, Z up, in panel coordinates.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { COLOURS } from "./wires.js";
import { panelSide, CORNER_R, PANEL_THICKNESS, BAY_HEIGHT, frameHoles, keepouts, partSize, placedHoles, placedCutouts, toPanel } from "./bay.js";

const loader = new GLTFLoader();
const glbCache = new Map();   // url -> Promise<THREE.Object3D> (Z up, part frame)

function loadGLB(url) {
  if (!glbCache.has(url)) {
    glbCache.set(url, loader.loadAsync(url).then(g => {
      const holder = new THREE.Group();
      // glTF is Y up and in metres; the parts are drawn Z up in millimetres
      g.scene.rotation.x = Math.PI / 2;
      g.scene.scale.setScalar(1000);
      holder.add(g.scene);
      return holder;
    }));
  }
  return glbCache.get(url);
}

export function panelShape(size, holes, cutouts) {
  const s = panelSide(size), r = CORNER_R, sh = new THREE.Shape();
  sh.moveTo(r, 0); sh.lineTo(s - r, 0); sh.absarc(s - r, r, r, -Math.PI / 2, 0);
  sh.lineTo(s, s - r); sh.absarc(s - r, s - r, r, 0, Math.PI / 2);
  sh.lineTo(r, s); sh.absarc(r, s - r, r, Math.PI / 2, Math.PI);
  sh.lineTo(0, r); sh.absarc(r, r, r, Math.PI, Math.PI * 1.5);
  for (const h of holes) {
    const p = new THREE.Path(); p.absarc(h.x, h.y, (h.drill ?? h.d) / 2, 0, Math.PI * 2, true); sh.holes.push(p);
  }
  for (const c of cutouts) {
    const p = new THREE.Path();
    p.moveTo(c.x, c.y); p.lineTo(c.x, c.y + c.h); p.lineTo(c.x + c.w, c.y + c.h); p.lineTo(c.x + c.w, c.y); p.closePath();
    sh.holes.push(p);
  }
  return sh;
}

function ductMesh(L, colour) {
  // Siboor's 25 x 25 slotted duct: a U channel, 1.5 mm walls, with its cover on top.
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: colour, roughness: .8 });
  const box = (w, d, h, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), m); b.position.set(x + w / 2, y + d / 2, z + h / 2); g.add(b); };
  box(L, 25, 1.5, 0, 0, 0); box(L, 1.5, 23, 0, 0, 1.5); box(L, 1.5, 23, 0, 23.5, 1.5); box(L, 25, 1.5, 0, 0, 23);
  return g;
}

export class View3D {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#eef0f3");
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#667", 2.2));
    const sun = new THREE.DirectionalLight("#fff", 1.6); sun.position.set(-300, -500, 800); this.scene.add(sun);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.size = null;
    new ResizeObserver(() => this.resize()).observe(el);
    const loop = () => { requestAnimationFrame(loop); if (!this.el.hidden) { this.controls.update(); this.renderer.render(this.scene, this.camera); } };
    loop();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(s) {
    this.controls.target.set(s / 2, s / 2, 20);
    this.camera.position.set(s / 2 - s * .3, -s * 1.1, s * 1.3);
  }

  async render() {
    const { state, partOf, colourOf } = this.app;
    const s = panelSide(state.size);
    if (this.size !== state.size) { this.frame(s); this.size = state.size; }
    const token = (this.token = {});
    const group = new THREE.Group();

    const items = state.items.map(it => ({ it, part: partOf(it) })).filter(p => p.part);
    const holes = [...frameHoles(state.size), ...items.flatMap(p => placedHoles(p.it, p.part))];
    const cutouts = items.flatMap(p => placedCutouts(p.it, p.part));
    // the stock panel's holes and cut-out that no part uses (a shape can't take the same hole twice)
    const stock = this.app.stock();
    for (const h of stock?.holes ?? []) if (!holes.some(p => Math.hypot(p.x - h.x, p.y - h.y) < (p.drill ?? p.d) / 2 + h.d / 2)) holes.push(h);
    for (const c of stock?.cutouts ?? []) if (!cutouts.some(p => p.x < c.x + c.w && c.x < p.x + p.w && p.y < c.y + c.h && c.y < p.y + p.h)) cutouts.push(c);
    const panel = new THREE.Mesh(
      new THREE.ExtrudeGeometry(panelShape(state.size, holes, cutouts), { depth: PANEL_THICKNESS, bevelEnabled: false, curveSegments: 24 }),
      new THREE.MeshStandardMaterial({ color: "#2d2f33", roughness: .9 }));
    panel.position.z = -PANEL_THICKNESS;
    group.add(panel);

    for (const k of keepouts(state.size, { iec: state.iec })) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(k.w, k.d, k.z1 - k.z0),
        k.kind === "z"
          ? new THREE.MeshStandardMaterial({ color: "#8a5cd6", transparent: true, opacity: .55, depthWrite: false })
          : new THREE.MeshBasicMaterial({ color: k.z0 > 40 ? "#d4b040" : "#8890a0", transparent: true, opacity: .18, depthWrite: false }));
      b.position.set(k.x + k.w / 2, k.y + k.d / 2, (k.z0 + k.z1) / 2);
      group.add(b);
    }
    for (const { it, part } of items) {
      const [w, d, h] = partSize(it, part);
      let obj;
      if (part.kind === "duct") obj = ductMesh(w, colourOf(part, it));
      else if (part.kind === "box") {
        obj = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), new THREE.MeshStandardMaterial({ color: colourOf(part, it) }));
        obj.position.set(w / 2, d / 2, h / 2);
        const wrap = new THREE.Group(); wrap.add(obj); obj = wrap;
      } else if (part.mesh) obj = part.mesh.clone();
      else obj = (await loadGLB(part.glb)).clone();
      if (token !== this.token) return;   // a newer render started
      const place = new THREE.Group();
      place.add(obj);
      place.rotation.z = (it.rot * Math.PI) / 180;
      // where the part's own origin lands after the turn
      const [ox, oy] = toPanel(it, w, d, 0, 0);
      place.position.set(ox, oy, 0);
      group.add(place);
      if (it.uid === state.selected) {
        place.updateMatrixWorld(true);
        group.add(new THREE.BoxHelper(place, "#0a62d0"));   // group sits at the origin
      }
    }
    // wires, as tubes at duct height
    for (const r of this.app.routed.wires) {
      if (!r.pts) continue;
      const path = new THREE.CurvePath();
      for (let i = 1; i < r.pts.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...r.pts[i - 1], 12), new THREE.Vector3(...r.pts[i], 12)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, r.pts.length * 12, 1.2, 6, false),
        new THREE.MeshStandardMaterial({ color: COLOURS[r.wire.colour] ?? "#d62f2f", roughness: .6 }));
      group.add(tube);
    }
    this.scene.remove(this.content);
    this.content = group;
    this.scene.add(group);
  }
}

// Parts people add from their own STEP files. They never leave the browser: kept in IndexedDB,
// and written into a saved layout (gzipped STEP) so a shared layout brings them along.
//
// A stored upload: { id, name, up, holes, step: ArrayBuffer, meshes } with the meshes as read
// (the file's own axes). `up` picks which of the file's axes points up in the bay.

export const UP = { "+Z": "Z up (as drawn)", "-Z": "Z down", "+Y": "Y up", "-Y": "Y down", "+X": "X up", "-X": "X down" };

// --- reading a STEP file (in a worker) ----------------------------------------------------------

let worker = null;
export function readStep(buffer) {
  worker ??= new Worker(new URL("./stepworker.js", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = e => (e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.meshes));
    worker.onerror = e => reject(new Error(e.message || "could not start the STEP reader"));
    worker.postMessage(buffer.slice(0));
  });
}

// --- orientation and size -----------------------------------------------------------------------

// [x, y, z] in the file's axes -> the bay's (Z up), for each choice of up.
const TURN = {
  "+Z": (x, y, z) => [x, y, z],
  "-Z": (x, y, z) => [x, -y, -z],
  "+Y": (x, y, z) => [x, -z, y],
  "-Y": (x, y, z) => [x, z, -y],
  "+X": (x, y, z) => [-z, y, x],
  "-X": (x, y, z) => [z, y, -x],
};

// The meshes turned so `up` points up and moved so the part's box starts at 0, 0, 0 (it stands on
// the panel, its footprint's front-left corner at the origin). Returns { meshes, size }.
export function orient(meshes, up) {
  const f = TURN[up] ?? TURN["+Z"];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const turned = meshes.map(m => {
    const p = new Float32Array(m.position.length), n = m.normal ? new Float32Array(m.normal.length) : null;
    for (let i = 0; i < p.length; i += 3) {
      const q = f(m.position[i], m.position[i + 1], m.position[i + 2]);
      for (let k = 0; k < 3; k++) { p[i + k] = q[k]; lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
      if (n) { const r = f(m.normal[i], m.normal[i + 1], m.normal[i + 2]); n[i] = r[0]; n[i + 1] = r[1]; n[i + 2] = r[2]; }
    }
    return { ...m, position: p, normal: n };
  });
  for (const m of turned) for (let i = 0; i < m.position.length; i += 3) for (let k = 0; k < 3; k++) m.position[i + k] -= lo[k];
  return { meshes: turned, size: [0, 1, 2].map(k => Math.round((hi[k] - lo[k]) * 10) / 10) };
}

// A first guess at up: a board or a power supply is thinnest top to bottom.
export function guessUp(meshes) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let i = 0; i < m.position.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], m.position[i + k]); hi[k] = Math.max(hi[k], m.position[i + k]);
  }
  const span = [0, 1, 2].map(k => hi[k] - lo[k]);
  return ["+X", "+Y", "+Z"][span.indexOf(Math.min(...span))];
}

// The planner's part for a stored upload (bay.js reads size and holes; view3d draws `meshes`).
export function toPart(u) {
  const { meshes, size } = orient(u.meshes, u.up);
  return {
    id: u.id, kind: "upload", name: u.name, category: "Custom", size, holes: u.holes ?? [], meshes,
    notes: "Your own STEP file. It stays in this browser and goes into saved layouts.", source: "Uploaded",
  };
}

// --- storage ------------------------------------------------------------------------------------

const DB = "siboor-bay-planner", STORE = "uploads";
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, f) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), req = f(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export const allUploads = () => tx("readonly", s => s.getAll());
export const putUpload = u => tx("readwrite", s => s.put(u));
export const deleteUpload = id => tx("readwrite", s => s.delete(id));

// A short id from the file's bytes, so the same file added twice is the same part.
export async function fileId(buffer) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", buffer));
  return "u-" + [...h.slice(0, 6)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- in a saved layout --------------------------------------------------------------------------

async function gzip(buffer) {
  const s = new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(s).arrayBuffer();
}
const toB64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export async function packUpload(u) {
  return { id: u.id, name: u.name, up: u.up, holes: u.holes, stepGz: toB64(await gzip(u.step)) };
}

// A packed upload back into a stored one (reads its STEP again).
export async function unpackUpload(p) {
  const step = await gunzip(fromB64(p.stepGz));
  return { id: p.id, name: p.name, up: p.up, holes: p.holes ?? [], step, meshes: await readStep(step) };
}

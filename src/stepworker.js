// Reads a STEP file off the main thread with OpenCascade (occt-import-js, LGPL-2.1) and returns
// its triangle meshes in millimetres: [{ position, normal, index, color }].
import occtimportjs from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

let occt = null;

self.onmessage = async e => {
  try {
    occt ??= await occtimportjs({ locateFile: () => wasmUrl });
    const res = occt.ReadStepFile(new Uint8Array(e.data), {
      linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.002, angularDeflection: 0.5,
    });
    if (!res.success || !res.meshes.length) throw new Error("no shapes found in this file");
    const meshes = res.meshes.map(m => ({
      position: new Float32Array(m.attributes.position.array),
      normal: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null,
      index: new Uint32Array(m.index.array),
      color: m.color ?? null,
    }));
    self.postMessage({ meshes }, meshes.flatMap(m => [m.position.buffer, m.index.buffer, ...(m.normal ? [m.normal.buffer] : [])]));
  } catch (err) {
    self.postMessage({ error: String(err?.message ?? err) });
  }
};

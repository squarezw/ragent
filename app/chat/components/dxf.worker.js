import { DxfViewer } from "dxf-viewer";
import { DxfScene } from "dxf-viewer/src/DxfScene.js";

// Some CAD exporters produce hatch spline knots this renderer cannot interpret.
// Isolate that entity, keeping the rest of the drawing usable and reporting the omission.
const decomposeHatch = DxfScene.prototype._DecomposeHatch;
DxfScene.prototype._DecomposeHatch = function* (...args) {
  try {
    yield* decomposeHatch.apply(this, args);
  } catch {
    self.postMessage({ type: "dxf-preview-omitted-hatch" });
  }
};
DxfViewer.SetupWorker();

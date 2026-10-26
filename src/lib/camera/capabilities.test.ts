import test from "node:test";
import assert from "node:assert/strict";
import { cameraErrorMessage, recorderMimeType } from "./capabilities";

test("camera failures retain an actionable upload fallback", () => {
  for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "SecurityError"]) {
    assert.match(cameraErrorMessage(new DOMException("unavailable", name)), /upload/i);
  }
  assert.equal(recorderMimeType(), undefined); // No browser recorder in Node; this is not a hardware test.
});

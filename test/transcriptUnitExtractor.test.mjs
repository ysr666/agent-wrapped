import test from "node:test";
import assert from "node:assert/strict";

import { extractSentenceLikeUnits, extractTranscriptUnits } from "../dist/transcript/unitExtractor.js";
import { createWrappedReport } from "../dist/wrapped/wrappedReport.js";

test("keeps dotted filenames, package versions, and ordered-list content in one readable unit", () => {
  const units = extractSentenceLikeUnits([
    "1. `tests/core.test.js` 107/107 全绿。",
    "2. v1.2.0 改成 peerDependency 后，`package.json` 不再重复安装。",
    "- `node --check index.js` 通过。",
  ].join("\n"));

  assert.deepEqual(units, [
    "`tests/core.test.js` 107/107 全绿。",
    "v1.2.0 改成 peerDependency 后，`package.json` 不再重复安装。",
    "`node --check index.js` 通过。",
  ]);
  assert.ok(!units.includes("test."));
  assert.ok(!units.includes("4."));
});

test("does not turn repeated code fragments into transcript events", () => {
  const units = extractTranscriptUnits([
    { role: "assistant", host: "dsh", text: "1. `tests/core.test.js` 107/107 全绿。" },
    { role: "assistant", host: "dsh", text: "2. `tests/core.test.js` 107/107 全绿。" },
  ]);

  assert.equal(units.length, 2);
  assert.ok(units.every((unit) => unit.text.includes("tests/core.test.js")));
  assert.ok(units.every((unit) => unit.text !== "test."));
});

test("repeated verification prose is not promoted as a catchphrase card", () => {
  const report = createWrappedReport([
    { role: "assistant", host: "dsh", text: "1. `tests/core.test.js` 107/107 全绿。" },
    { role: "assistant", host: "dsh", text: "2. `tests/core.test.js` 107/107 全绿。" },
    { role: "assistant", host: "dsh", text: "3. `tests/core.test.js` 107/107 全绿。" },
  ]);

  assert.ok(!report.awards.some((award) => award.kind === "catchphrase"));
});

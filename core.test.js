import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRecord, mergeRecords, backup, parseBackup, summarize, csv, makeQrParts, acceptQrPart } from "./core.js";

const record = {
  id: "one", event: "Regional", scout: "Scout", notes: "Good robot", createdAt: "2026-03-01T12:00:00.000Z",
  team: 123, match: 1, autoFuel: 2, teleopFuel: 30, alliance: "Red", autoClimb: "Level 1",
  teleopClimb: "Level 2", defense: "No", issues: "No"
};

test("validates fields and rejects malformed data", () => {
  assert.deepEqual(validateRecord(record), record);
  assert.throws(() => validateRecord({ ...record, team: 0 }));
  assert.throws(() => validateRecord({ ...record, autoFuel: -1 }));
  assert.throws(() => validateRecord({ ...record, teleopClimb: "Level 4" }));
  assert.throws(() => parseBackup('{"format":"wrong","version":1,"records":[]}'));
});

test("backup imports deduplicate and reject conflicts without changing originals", () => {
  const existing = [record];
  const result = mergeRecords(existing, parseBackup(backup([record, { ...record, id: "two" }])));
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.throws(() => mergeRecords(existing, [{ ...record, team: 999 }]), /Conflicting/);
  assert.equal(existing.length, 1);
});

test("summaries group event case and team, and CSV protects spreadsheet formulas", () => {
  const records = [record, { ...record, id: "two", event: "regional", autoFuel: 4, notes: "=1+1", teleopClimb: "None" }];
  assert.deepEqual(summarize(records), [{ event: "Regional", team: 123, matches: 2, auto: 6, teleop: 60, climbed: 1 }]);
  assert.match(csv(records), /"'=1\+1"/);
});

test("QR transfer reassembles unicode records out of order and skips repeated frames", () => {
  const original = [{ ...record, notes: "🚀".repeat(300) }];
  const parts = makeQrParts(original, "transfer");
  assert.ok(parts.length > 1);
  let state = null;
  for (const part of [parts[1], parts[1], parts[0], ...parts.slice(2)]) {
    const result = acceptQrPart(part, state);
    state = result.state;
    if (state.parts.size === parts.length) assert.deepEqual(result.records, original);
  }
  assert.throws(() => acceptQrPart(makeQrParts(original, "another")[0], state), /different transfer/);
});

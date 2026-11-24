import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRecord, mergeRecords, backup, parseBackup, summarize, sortSummary, csv, makeQrParts, acceptQrPart } from "./core.js";

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

test("summary sorts numerical averages and climb rates rather than totals or formatted strings", () => {
  const groups = [
    { event: "Event", team: 2, matches: 10, auto: 20, teleop: 90, climbed: 5 },
    { event: "Event", team: 10, matches: 2, auto: 6, teleop: 20, climbed: 2 },
    { event: "Event", team: 3, matches: 1, auto: 0, teleop: 2, climbed: 0 }
  ];
  const teams = (key, direction) => sortSummary(groups, key, direction).map(group => group.team);
  assert.deepEqual(teams("team", "ascending"), [2, 3, 10]);
  assert.deepEqual(teams("teleop", "descending"), [10, 2, 3]);
  assert.deepEqual(teams("auto", "ascending"), [3, 2, 10]);
  assert.deepEqual(teams("climbed", "descending"), [10, 2, 3]);
  assert.deepEqual(teams("matches", "ascending"), [3, 10, 2]);
  assert.deepEqual(groups.map(group => group.team), [2, 10, 3]);
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

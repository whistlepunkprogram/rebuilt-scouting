export const FORMAT = "rebuilt-scouting";
export const VERSION = 2;
const textFields = { id: 100, event: 80, scout: 80, notes: 2000, createdAt: 40 };
const numbers = ["team", "match", "autoFuel", "teleopFuel"];
const choices = {
  alliance: ["Red", "Blue"],
  autoClimb: ["None", "Level 1", "Attempted / failed"],
  teleopClimb: ["None", "Level 1", "Level 2", "Level 3", "Attempted / failed"],
  defense: ["No", "Yes"],
  issues: ["No", "Yes"]
};

export function validateRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid record.");
  for (const [field, max] of Object.entries(textFields)) {
    if (typeof value[field] !== "string" || value[field].length > max ||
        (field !== "notes" && !value[field].trim())) throw new Error(`Invalid ${field}.`);
  }
  if (!Number.isFinite(Date.parse(value.createdAt))) throw new Error("Invalid creation date.");
  for (const field of numbers) {
    const min = field === "team" || field === "match" ? 1 : 0;
    if (!Number.isSafeInteger(value[field]) || value[field] < min || value[field] > 99999) {
      throw new Error(`Invalid ${field}.`);
    }
  }
  for (const [field, allowed] of Object.entries(choices)) {
    if (!allowed.includes(value[field])) throw new Error(`Invalid ${field}.`);
  }
  if (value.prediction !== undefined && !["Red", "Blue"].includes(value.prediction)) throw new Error("Invalid prediction.");
  // Retain only the known fields, so imports cannot add unexpected properties.
  const record = Object.fromEntries([...Object.keys(textFields), ...numbers, ...Object.keys(choices)].map(key => [key, value[key]]));
  if (value.prediction !== undefined) record.prediction = value.prediction;
  return record;
}

export function mergeRecords(existing, incoming) {
  const merged = existing.map(validateRecord);
  const byId = new Map(merged.map(record => [record.id, record]));
  if (byId.size !== merged.length) throw new Error("Existing data contains duplicate IDs.");
  let added = 0;
  for (const value of incoming) {
    const record = validateRecord(value);
    const previous = byId.get(record.id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`Conflicting record ID: ${record.id}`);
    } else {
      merged.push(record);
      byId.set(record.id, record);
      added++;
    }
  }
  return { records: merged, added, skipped: incoming.length - added };
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The file is not valid JSON."); }
  if (!data || data.format !== FORMAT || ![1, VERSION].includes(data.version) || !Array.isArray(data.records) ||
      (data.version === VERSION && !Array.isArray(data.results))) {
    throw new Error("Unsupported scouting file or version.");
  }
  return { records: data.records, results: data.version === 1 ? [] : data.results };
}

export function backup(records, results = []) {
  return JSON.stringify({ format: FORMAT, version: VERSION, records, results }, null, 2);
}

function matchKey(event, match) {
  return JSON.stringify([event.trim().toLowerCase(), match]);
}

export function validateResult(value) {
  if (!value || typeof value !== "object" || typeof value.event !== "string" ||
      !value.event.trim() || value.event.length > 80 || !Number.isSafeInteger(value.match) ||
      value.match < 1 || value.match > 99999 || !["Red", "Blue", "Tie"].includes(value.winner)) {
    throw new Error("Invalid match result.");
  }
  return { event: value.event.trim(), match: value.match, winner: value.winner };
}

export function mergeResults(existing, incoming) {
  const merged = existing.map(validateResult);
  const byMatch = new Map(merged.map(result => [matchKey(result.event, result.match), result]));
  if (byMatch.size !== merged.length) throw new Error("Duplicate match results.");
  for (const item of incoming) {
    const result = validateResult(item);
    const key = matchKey(result.event, result.match);
    const previous = byMatch.get(key);
    if (previous && previous.winner !== result.winner) throw new Error(`Conflicting result for ${result.event}, match ${result.match}.`);
    if (!previous) { merged.push(result); byMatch.set(key, result); }
  }
  return merged;
}

export function onlineResults(matches, eventKey, eventName) {
  if (!Array.isArray(matches)) throw new Error("The online match list is invalid.");
  const winners = { red: "Red", blue: "Blue", tie: "Tie" };
  const found = [];
  let unavailable = 0;
  for (const match of matches) {
    if (!match || match.event !== eventKey || typeof match.comp_level !== "string" || typeof match.status !== "string") {
      throw new Error("The online match list contains invalid or unexpected data.");
    }
    if (match.comp_level !== "qm" || match.status !== "Completed") continue;
    if (match.result?.winner == null) { unavailable++; continue; }
    if (!Object.hasOwn(winners, match.result.winner)) throw new Error("An online match has an unrecognized result.");
    found.push(validateResult({ event: eventName, match: match.match_number, winner: winners[match.result.winner] }));
  }
  return { results: mergeResults([], found), unavailable };
}

export function applyOnlineResults(existing, incoming) {
  const updates = mergeResults([], incoming);
  const keys = new Set(updates.map(item => matchKey(item.event, item.match)));
  return mergeResults(existing.filter(item => !keys.has(matchKey(item.event, item.match))), updates);
}

export function scoutAwards(records, results) {
  const winners = new Map(mergeResults([], results).map(result => [matchKey(result.event, result.match), result.winner]));
  const scouts = new Map();
  for (const record of [...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))) {
    const key = record.scout.trim().toLowerCase();
    if (!scouts.has(key)) scouts.set(key, { name: record.scout.trim(), matches: new Map() });
    const matches = scouts.get(key).matches;
    const match = matchKey(record.event, record.match);
    if (!matches.has(match)) matches.set(match, record.prediction);
  }
  const rows = [...scouts.values()].map(scout => {
    let correct = 0, judged = 0;
    for (const [match, prediction] of scout.matches) {
      const winner = winners.get(match);
      if (prediction && winner && winner !== "Tie") {
        judged++;
        if (prediction === winner) correct++;
      }
    }
    return { name: scout.name, matches: scout.matches.size, correct, judged };
  });
  return {
    accuracy: rows.filter(row => row.judged).sort((a, b) => b.correct / b.judged - a.correct / a.judged || b.judged - a.judged || a.name.localeCompare(b.name)).slice(0, 2),
    participation: [...rows].sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name)).slice(0, 2)
  };
}

export function summarize(records) {
  const groups = new Map();
  for (const r of records) {
    const key = JSON.stringify([r.event.trim().toLowerCase(), r.team]);
    if (!groups.has(key)) groups.set(key, { event: r.event, team: r.team, matches: 0, auto: 0, teleop: 0, climbed: 0 });
    const g = groups.get(key);
    g.matches++;
    g.auto += r.autoFuel;
    g.teleop += r.teleopFuel;
    if (r.teleopClimb.startsWith("Level")) g.climbed++;
  }
  return [...groups.values()].sort((a, b) => a.event.localeCompare(b.event) || a.team - b.team);
}

export function sortSummary(groups, category, direction) {
  const values = {
    event: group => group.event,
    team: group => group.team,
    matches: group => group.matches,
    auto: group => group.auto / group.matches,
    teleop: group => group.teleop / group.matches,
    climbed: group => group.climbed / group.matches
  };
  if (!Object.hasOwn(values, category) || !["ascending", "descending"].includes(direction)) {
    throw new Error("Invalid summary sort.");
  }
  const value = values[category];
  return [...groups].sort((a, b) => {
    const av = value(a), bv = value(b);
    const comparison = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return comparison * (direction === "ascending" ? 1 : -1) ||
      a.event.localeCompare(b.event) || a.team - b.team;
  });
}

export function csv(records) {
  const fields = ["event", "match", "team", "alliance", "scout", "prediction", "autoFuel", "autoClimb", "teleopFuel", "teleopClimb", "defense", "issues", "notes", "createdAt", "id"];
  const cell = value => {
    let text = String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [fields.join(","), ...records.map(r => fields.map(field => cell(r[field] ?? "")).join(","))].join("\r\n");
}

export function makeQrParts(records, transferId, results = []) {
  const bytes = new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: VERSION, records, results }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  const total = Math.ceil(encoded.length / 400);
  if (total > 2000) throw new Error("Too much data for QR transfer; use a scouting file instead.");
  return Array.from({ length: total }, (_, index) => JSON.stringify({
    format: "rebuilt-qr", version: 1, transferId, index, total, data: encoded.slice(index * 400, (index + 1) * 400)
  }));
}

export function acceptQrPart(text, current) {
  let part;
  try { part = JSON.parse(text); } catch { throw new Error("Not a REBUILT scouting QR code."); }
  if (!part || part.format !== "rebuilt-qr" || part.version !== 1 ||
      typeof part.transferId !== "string" || !part.transferId || part.transferId.length > 100 ||
      !Number.isInteger(part.total) || part.total < 1 || part.total > 2000 ||
      !Number.isInteger(part.index) || part.index < 0 || part.index >= part.total ||
      typeof part.data !== "string" || !/^[A-Za-z0-9+/=]{1,400}$/.test(part.data)) {
    throw new Error("Invalid REBUILT scouting QR code.");
  }
  if (current && (current.transferId !== part.transferId || current.total !== part.total)) {
    throw new Error("This code belongs to a different transfer. Finish or stop the current transfer first.");
  }
  const state = current || { transferId: part.transferId, total: part.total, parts: new Map() };
  if (state.parts.has(part.index) && state.parts.get(part.index) !== part.data) throw new Error("Conflicting QR code.");
  state.parts.set(part.index, part.data);
  if (state.parts.size !== state.total) return { state, data: null };
  try {
    const binary = atob(Array.from({ length: state.total }, (_, i) => state.parts.get(i)).join(""));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { state, data: parseBackup(json) };
  } catch {
    throw new Error("QR transfer is incomplete or corrupted. Stop scanning and try again.");
  }
}

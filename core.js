export const FORMAT = "rebuilt-scouting";
export const VERSION = 1;
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
  // Retain only the known fields, so imports cannot add unexpected properties.
  return Object.fromEntries([...Object.keys(textFields), ...numbers, ...Object.keys(choices)].map(key => [key, value[key]]));
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
  if (!data || data.format !== FORMAT || data.version !== VERSION || !Array.isArray(data.records)) {
    throw new Error("Unsupported scouting file or version.");
  }
  return data.records;
}

export function backup(records) {
  return JSON.stringify({ format: FORMAT, version: VERSION, records }, null, 2);
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
  const fields = ["event", "match", "team", "alliance", "scout", "autoFuel", "autoClimb", "teleopFuel", "teleopClimb", "defense", "issues", "notes", "createdAt", "id"];
  const cell = value => {
    let text = String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [fields.join(","), ...records.map(r => fields.map(field => cell(r[field])).join(","))].join("\r\n");
}

export function makeQrParts(records, transferId) {
  const bytes = new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: VERSION, records }));
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
  if (state.parts.size !== state.total) return { state, records: null };
  try {
    const binary = atob(Array.from({ length: state.total }, (_, i) => state.parts.get(i)).join(""));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { state, records: parseBackup(json) };
  } catch {
    throw new Error("QR transfer is incomplete or corrupted. Stop scanning and try again.");
  }
}

import { validateRecord, mergeRecords, parseBackup, backup, summarize, sortSummary, csv, makeQrParts, acceptQrPart } from "./core.js";

const $ = selector => document.querySelector(selector);
const STORAGE = "rebuilt-scouting-records-v1";
let records = [];
let storageAvailable = false;
let qrParts = [];
let qrIndex = 0;
let scanState = null;
let stream = null;
let scanSession = 0;
let summarySort = { category: "event", direction: "ascending" };

function message(text, error = false) {
  $("#message").textContent = text;
  $("#message").classList.toggle("error", error);
}

function save(next) {
  if (!storageAvailable) throw new Error("Local storage is unavailable. Your data was not changed.");
  localStorage.setItem(STORAGE, JSON.stringify(next));
  records = next;
  render();
}

function importRecords(incoming) {
  const result = mergeRecords(records, incoming);
  save(result.records);
  message(`Imported ${result.added} record(s); skipped ${result.skipped} already present.`);
}

function render() {
  $("#record-count").textContent = `(${records.length})`;
  const list = $("#record-list");
  list.replaceChildren();
  if (!records.length) list.textContent = "No records saved yet.";
  for (const record of [...records].reverse()) {
    const row = document.createElement("div");
    row.className = "record";
    const description = document.createElement("p");
    const title = document.createElement("strong");
    title.textContent = `${record.event} · Match ${record.match} · Team ${record.team} (${record.alliance})`;
    description.append(title, document.createElement("br"), `${record.scout} — auto fuel ${record.autoFuel}, teleop fuel ${record.teleopFuel}, tower ${record.teleopClimb}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${record.event} match ${record.match} team ${record.team}`);
    remove.addEventListener("click", () => {
      if (!confirm("Delete this record from this device? Export a backup first if needed.")) return;
      try { save(records.filter(r => r.id !== record.id)); message("Record deleted."); }
      catch (error) { message(`Could not delete record: ${error.message}`, true); }
    });
    row.append(description, remove);
    list.append(row);
  }
  const body = $("#summary");
  body.replaceChildren();
  const groups = sortSummary(summarize(records), summarySort.category, summarySort.direction);
  $("#summary-empty").hidden = groups.length > 0;
  for (const g of groups) {
    const tr = document.createElement("tr");
    for (const value of [g.event, g.team, g.matches, (g.auto / g.matches).toFixed(1), (g.teleop / g.matches).toFixed(1), `${g.climbed} / ${g.matches}`]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
}

try {
  const stored = localStorage.getItem(STORAGE);
  const parsed = stored === null ? [] : JSON.parse(stored);
  if (!Array.isArray(parsed)) throw new Error("Stored data is not a record list.");
  records = mergeRecords([], parsed).records;
  storageAvailable = true;
} catch (error) {
  message(`Could not read local data: ${error.message}. Saving is disabled to protect it.`, true);
}
render();

document.querySelectorAll(".sort-button").forEach(button => {
  button.addEventListener("click", () => {
    const category = button.dataset.sort;
    const direction = category === summarySort.category
      ? (summarySort.direction === "ascending" ? "descending" : "ascending")
      : (category === "event" || category === "team" ? "ascending" : "descending");
    summarySort = { category, direction };
    document.querySelectorAll(".sort-button").forEach(heading => {
      const active = heading === button;
      if (active) heading.parentElement.setAttribute("aria-sort", direction);
      else heading.parentElement.removeAttribute("aria-sort");
      heading.querySelector("span").textContent = active ? (direction === "ascending" ? "▲" : "▼") : "";
    });
    render();
  });
});

$("#scout-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    for (const name of ["event", "scout", "notes"]) data[name] = data[name].trim();
    for (const name of ["team", "match", "autoFuel", "teleopFuel"]) data[name] = Number(data[name]);
    const record = validateRecord({ ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    save([...records, record]);
    const { event: eventName, scout } = record;
    event.currentTarget.reset();
    event.currentTarget.elements.event.value = eventName;
    event.currentTarget.elements.scout.value = scout;
    message(`Saved match ${record.match} for team ${record.team} on this device.`);
  } catch (error) { message(`Could not save record: ${error.message}`, true); }
});

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#export").addEventListener("click", () => {
  if (!storageAvailable) return message("Cannot export: local data could not be read.", true);
  download(backup(records), "rebuilt-scouting.json", "application/json");
});
$("#csv").addEventListener("click", () => {
  if (!storageAvailable) return message("Cannot export: local data could not be read.", true);
  download(csv(records), "rebuilt-scouting.csv", "text/csv;charset=utf-8");
});
$("#import").addEventListener("change", async event => {
  try {
    const files = [...event.target.files];
    if (!files.length) return;
    if (files.some(file => file.size > 10 * 1024 * 1024)) throw new Error("A file exceeds the 10 MB limit.");
    const incoming = (await Promise.all(files.map(file => file.text().then(parseBackup)))).flat();
    importRecords(incoming);
  } catch (error) { message(`Import failed; no records were changed: ${error.message}`, true); }
  finally { event.target.value = ""; }
});

function showPart() {
  const qr = qrcode(0, "M");
  qr.addData(qrParts[qrIndex]);
  qr.make();
  const img = document.createElement("img");
  img.src = qr.createDataURL(5, 20);
  img.alt = `Transfer QR code ${qrIndex + 1} of ${qrParts.length}`;
  $("#qr-image").replaceChildren(img);
  $("#qr-position").textContent = `Code ${qrIndex + 1} of ${qrParts.length}`;
  $("#qr-prev").disabled = qrIndex === 0;
  $("#qr-next").disabled = qrIndex === qrParts.length - 1;
}
$("#show-qr").addEventListener("click", () => {
  try {
    if (!records.length) throw new Error("There are no records to transfer.");
    qrParts = makeQrParts(records, crypto.randomUUID());
    qrIndex = 0;
    showPart();
    $("#qr-display").hidden = false;
  } catch (error) { message(`Could not generate QR codes: ${error.message}`, true); }
});
$("#qr-prev").addEventListener("click", () => { qrIndex--; showPart(); });
$("#qr-next").addEventListener("click", () => { qrIndex++; showPart(); });
$("#qr-close").addEventListener("click", () => { $("#qr-display").hidden = true; qrParts = []; });

function stopScan() {
  scanSession++;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  $("#camera").srcObject = null;
  $("#qr-scanner").hidden = true;
  scanState = null;
}
$("#stop-scan").addEventListener("click", stopScan);
$("#scan-qr").addEventListener("click", async () => {
  stopScan();
  const session = scanSession;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser.");
    const cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    if (session !== scanSession) { cameraStream.getTracks().forEach(track => track.stop()); return; }
    stream = cameraStream;
    $("#qr-scanner").hidden = false;
    $("#scan-status").textContent = "Ready to scan.";
    const video = $("#camera");
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const scan = () => {
      if (session !== scanSession) return;
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height);
        if (code) {
          try {
            const result = acceptQrPart(code.data, scanState);
            scanState = result.state;
            $("#scan-status").textContent = `Scanned ${scanState.parts.size} of ${scanState.total} codes.`;
            if (result.records) {
              importRecords(result.records);
              stopScan();
              return;
            }
          } catch (error) { $("#scan-status").textContent = error.message; }
        }
      }
      requestAnimationFrame(scan);
    };
    requestAnimationFrame(scan);
  } catch (error) {
    stopScan();
    message(`Could not start camera: ${error.message}`, true);
  }
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready).then(() => {
    $("#offline-status").textContent = "Ready for offline use on this device.";
  }).catch(error => {
    $("#offline-status").textContent = `Offline setup failed: ${error.message}. Stay online and reload.`;
  });
} else {
  $("#offline-status").textContent = "Offline setup unavailable. Open this app over HTTPS or localhost.";
}

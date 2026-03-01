/* Schulbegleitung • Personalmanager (Offline-first PWA)
   Single-device (localStorage) version v2.
   Keyboard: Up/Down select person, V mark available, A mark absent, U clear mark.
   
   Version 2.0 - 03.02.2026
   - Datenpersistenz mit Datum für alle Markierungen
   - Import-Funktion für JSON-Daten
   - Keine doppelten Zuweisungen im gleichen Zeitslot
   - Reset nur für aktuelles Datum mit Bestätigung
   - Alphabetische Sortierung aller Listen
   - Demodaten und Wochenansicht entfernt
   - Arbeitsminuten-Anzeige im Raster
   - "Kind da" Option für Vertretungsbedarf
   - Dauerhafte Stunden-Zuweisung an andere Personen
*/

// ===== SUPABASE CONFIG (Cloud Sync) =====
const SUPABASE_URL = "https://aepeardhempzfqczifca.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EEsqqG0d-V7vknw44WENVA_ldta7hhW";

// ===== CLOUD SYNC =====
let cloudSyncEnabled = false;
let cloudId = null;
let syncDebounceTimer = null;

async function cloudLoad(id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/schulbegleitung_data?id=eq.${encodeURIComponent(id)}&select=data`, {
      headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length > 0 ? rows[0].data : null;
  } catch(e) {
    console.warn("Cloud load failed:", e);
    return null;
  }
}

async function cloudSave(id, data) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/schulbegleitung_data`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ id, data, updated_at: new Date().toISOString() })
    });
    return res.ok;
  } catch(e) {
    console.warn("Cloud save failed:", e);
    return false;
  }
}

function debouncedCloudSave() {
  if (!cloudSyncEnabled || !cloudId) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(async () => {
    const ok = await cloudSave(cloudId, state);
    const indicator = document.getElementById("syncIndicator");
    if (indicator) {
      indicator.textContent = ok ? "☁️" : "⚠️";
      indicator.title = ok ? "Cloud-Sync aktiv" : "Sync fehlgeschlagen";
      if (ok) { setTimeout(() => { indicator.textContent = "☁️"; }, 1500); }
    }
  }, 2000);
}

// ===== PASSWORD GATE =====
const APP_PASSWORD = "RabenNathan26";
const PASSWORD_STORAGE_KEY = "sbpm_authenticated";

function initPasswordGate() {
  const gate = document.getElementById("passwordGate");
  const app = document.getElementById("app");
  const input = document.getElementById("passwordInput");
  const submit = document.getElementById("passwordSubmit");
  const error = document.getElementById("passwordError");

  // Check if already authenticated this session
  if (sessionStorage.getItem(PASSWORD_STORAGE_KEY) === "true") {
    cloudId = APP_PASSWORD;
    cloudSyncEnabled = true;
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    // Silently sync from cloud in background
    cloudLoad(cloudId).then(cloudData => {
      if (cloudData && cloudData.people && cloudData.people.length > 0) {
        Object.assign(state, cloudData);
        state.people.forEach(p => ensurePersonScheduleFromTemplate(p));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
      }
    });
    return;
  }

  const checkPassword = async () => {
    const pw = input.value.trim();
    if (pw === APP_PASSWORD) {
      sessionStorage.setItem(PASSWORD_STORAGE_KEY, "true");
      cloudId = pw;
      cloudSyncEnabled = true;
      // Try loading from cloud
      submit.disabled = true;
      submit.textContent = "☁️ Lade Daten...";
      const cloudData = await cloudLoad(cloudId);
      if (cloudData && cloudData.people && cloudData.people.length > 0) {
        // Cloud has data — use it (cloud is source of truth)
        Object.assign(state, cloudData);
        state.people.forEach(p => ensurePersonScheduleFromTemplate(p));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } else if (!cloudData || !cloudData.people) {
        // No cloud data yet — push local to cloud
        const localRaw = localStorage.getItem(STORAGE_KEY);
        if (localRaw) await cloudSave(cloudId, JSON.parse(localRaw));
      }
      gate.classList.add("hidden");
      app.classList.remove("hidden");
      render();
    } else {
      error.classList.remove("hidden");
      input.value = "";
      input.focus();
    }
  };

  submit.addEventListener("click", checkPassword);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") checkPassword();
  });

  input.focus();
}


// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initPasswordGate();
});

const STORAGE_KEY = "sbpm_state_v2";

const DAYS = ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag"];
const DAY_KEYS = ["mon","tue","wed","thu","fri"];

const DEFAULT_TEMPLATE = {
  startTime: "08:00",
  slots: [
    { type: "lesson", duration: 45, label: "1. Stunde" },
    { type: "break",  duration: 15, label: "Pause" },
    { type: "lesson", duration: 45, label: "2. Stunde" },
    { type: "break",  duration: 5,  label: "Kurzpause" },
    { type: "lesson", duration: 45, label: "3. Stunde" },
    { type: "break",  duration: 30, label: "Mittag" },
    { type: "lesson", duration: 45, label: "4. Stunde" },
    { type: "break",  duration: 10, label: "Pause" },
    { type: "lesson", duration: 45, label: "5. Stunde" },
    { type: "break",  duration: 5,  label: "Kurzpause" },
    { type: "lesson", duration: 45, label: "6. Stunde" },
  ],
  templateNotes: { mon:{}, tue:{}, wed:{}, thu:{}, fri:{} }
};

const DEFAULT_SETTINGS = {
  colors: { available: "#2ecc71", absent: "#ff4d4d" }
};

// Selected date (default today)
var selectedDate = new Date();


function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function nowISO(){
  return new Date().toISOString();
}

function dateKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function formatTime(d){
  return d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
}

function weekdayIndex(d){
  const js = d.getDay();
  return (js + 6) % 7;
}

function clamp(n,min,max){return Math.max(min,Math.min(max,n));}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    console.warn("State load failed", e);
    return null;
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  debouncedCloudSave();
}

function log(action, details){
  const entry = { ts: nowISO(), date: dateKey(selectedDate || new Date()), action, details };
  state.logs.unshift(entry);
  if(state.logs.length > 20000) state.logs.length = 20000;
}

function ensurePersonScheduleFromTemplate(person){
  if(!person.schedule) person.schedule = {};
  for(const dk of DAY_KEYS){
    if(!person.schedule[dk]) person.schedule[dk] = { notes: {}, disabled: {}, childPresent: {} };
    if(!person.schedule[dk].disabled) person.schedule[dk].disabled = {};
    if(!person.schedule[dk].childPresent) person.schedule[dk].childPresent = {};
  }
  // Ensure permanentAssignments exists
  if(!person.permanentAssignments) person.permanentAssignments = {};
}

// Check if a specific slot is active for a person (not disabled)
function isSlotActive(person, dk, slotIndex){
  if(!person.schedule?.[dk]?.disabled) return true;
  return !person.schedule[dk].disabled[slotIndex];
}

// Check if child is present for a specific slot
function isChildPresent(person, dk, slotIndex){
  if(!person.schedule?.[dk]?.childPresent) return false;
  return !!person.schedule[dk].childPresent[slotIndex];
}

// Toggle slot active/disabled for a person
function toggleSlotActive(person, dk, slotIndex){
  ensurePersonScheduleFromTemplate(person);
  if(person.schedule[dk].disabled[slotIndex]){
    delete person.schedule[dk].disabled[slotIndex];
  } else {
    person.schedule[dk].disabled[slotIndex] = true;
  }
}

// Toggle child present for a person
function toggleChildPresent(person, dk, slotIndex){
  ensurePersonScheduleFromTemplate(person);
  if(person.schedule[dk].childPresent[slotIndex]){
    delete person.schedule[dk].childPresent[slotIndex];
  } else {
    person.schedule[dk].childPresent[slotIndex] = true;
  }
}

// Get permanent assignment for a slot
function getPermanentAssignment(person, dk, slotIndex){
  if(!person.permanentAssignments) return null;
  const key = `${dk}_${slotIndex}`;
  return person.permanentAssignments[key] || null;
}

// Set permanent assignment for a slot
function setPermanentAssignment(person, dk, slotIndex, assignedPersonId){
  ensurePersonScheduleFromTemplate(person);
  const key = `${dk}_${slotIndex}`;
  if(assignedPersonId){
    person.permanentAssignments[key] = assignedPersonId;
  } else {
    delete person.permanentAssignments[key];
  }
}

function applyTemplateToPerson(person, mode="missing"){
  ensurePersonScheduleFromTemplate(person);
  for(const dk of DAY_KEYS){
    const dayNotes = person.schedule[dk].notes || {};
    for(const [idxStr, note] of Object.entries(state.template.templateNotes[dk] || {})){
      const idx = Number(idxStr);
      if(mode==="overwrite" || (dayNotes[idx] == null || dayNotes[idx] === "")){
        dayNotes[idx] = note;
      }
    }
    person.schedule[dk].notes = dayNotes;
  }
}

function computeTimeline(template){
  const [h,m] = template.startTime.split(":").map(Number);
  let minutes = h*60 + m;
  const out = [];
  template.slots.forEach((s, i)=>{
    const start = minutes;
    minutes += Number(s.duration || 0);
    const end = minutes;
    out.push({...s, start, end, slotIndex:i});
  });
  return out;
}

function mmToHHMM(min){
  const h = Math.floor(min/60);
  const m = min%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function getDayKeyForDate(d){
  const idx = weekdayIndex(d);
  if(idx < 0 || idx > 4) return null;
  return DAY_KEYS[idx];
}

function findPerson(id){
  return state.people.find(p=>p.id===id) || null;
}

function filteredPeople(){
  const q = (ui.searchNames.value || "").trim().toLowerCase();
  let list = state.people;
  if(q) list = list.filter(p=>p.name.toLowerCase().includes(q));
  // Sort alphabetically (Feature #5)
  return list.sort((a,b) => a.name.localeCompare(b.name, "de"));
}

function statusLabel(s){
  if(s==="available") return "Verfügbar";
  if(s==="absent") return "Abwesend";
  return "—";
}

function applyColorVars(){
  document.documentElement.style.setProperty("--good", state.settings.colors.available);
  document.documentElement.style.setProperty("--bad", state.settings.colors.absent);
}

// ===== DATE-BASED MARKS (Feature #1) =====
function getMarkForDate(personId, dateK){
  if(!state.marks[dateK]) return null;
  return state.marks[dateK][personId] || null;
}

function setMarkForDate(personId, dateK, status){
  if(!state.marks[dateK]) state.marks[dateK] = {};
  if(status){
    state.marks[dateK][personId] = status;
  } else {
    delete state.marks[dateK][personId];
  }
}

function getCurrentMark(personId){
  return getMarkForDate(personId, dateKey(selectedDate));
}

// ===== GET ALREADY ASSIGNED PEOPLE FOR A SLOT (Feature #3) =====
function getAssignedPeopleForSlot(dateK, dk, slotIndex){
  const assigned = new Set();
  const subs = state.substitutions[dateK] || {};
  for(const absentId of Object.keys(subs)){
    const daySubs = subs[absentId]?.[dk] || {};
    if(daySubs[slotIndex]){
      assigned.add(daySubs[slotIndex]);
    }
  }
  return assigned;
}

// --- UI refs
const ui = {
  datePicker: document.getElementById("datePicker"),
  weekday: document.getElementById("weekday"),
  clock: document.getElementById("clock"),

  btnAdd: document.getElementById("btnAdd"),
  btnRemove: document.getElementById("btnRemove"),
  btnMarkAvailable: document.getElementById("btnMarkAvailable"),
  btnMarkAbsent: document.getElementById("btnMarkAbsent"),
  btnClearMark: document.getElementById("btnClearMark"),
  btnResetAllMarks: document.getElementById("btnResetAllMarks"),
  btnPrint: document.getElementById("btnPrint"),
  btnOptions: document.getElementById("btnOptions"),

  searchNames: document.getElementById("searchNames"),
  nameList: document.getElementById("nameList"),

  tabDashboard: document.getElementById("tabDashboard"),
  tabAbsent: document.getElementById("tabAbsent"),
  tabEdit: document.getElementById("tabEdit"),
  tabLog: document.getElementById("tabLog"),
  btnEditStandard: document.getElementById("btnEditStandard"),
  filterUnassigned: document.getElementById("filterUnassigned"),
  viewDashboard: document.getElementById("viewDashboard"),
  viewAbsent: document.getElementById("viewAbsent"),
  viewEdit: document.getElementById("viewEdit"),
  viewLog: document.getElementById("viewLog"),

  backdrop: document.getElementById("modalBackdrop"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalFoot: document.getElementById("modalFoot"),
  modalClose: document.getElementById("modalClose"),
  
  printArea: document.getElementById("printArea"),
};

// --- State
let state = loadState();
if(!state){
  state = {
    version: 2,
    settings: DEFAULT_SETTINGS,
    template: DEFAULT_TEMPLATE,
    people: [],
    marks: {}, // dateKey -> personId -> "available" | "absent" (Feature #1)
    substitutions: {}, // dateKey -> absentId -> dayKey -> slotIndex -> personId
    logs: [],
    selectedPersonId: null,
  };
  log("init", { message: "App initialisiert (v2)" });
  saveState();
}

// Migration from v1 to v2 (marks per date)
if(state.version === 1 || !state.version){
  // Check if old marks format (personId -> status directly)
  const oldMarks = state.marks || {};
  const hasOldFormat = Object.values(oldMarks).some(v => typeof v === 'string');
  if(hasOldFormat){
    // Migrate: assume old marks are for today
    const todayK = dateKey(new Date());
    const newMarks = { [todayK]: {} };
    for(const [personId, status] of Object.entries(oldMarks)){
      if(typeof status === 'string'){
        newMarks[todayK][personId] = status;
      }
    }
    state.marks = newMarks;
  }
  state.version = 2;
  saveState();
}

// Selected date (default today)
ui.datePicker.value = dateKey(selectedDate);

// focus handling for modals
let lastFocusEl = null;

function openModal(title, bodyNode, footNode){
  lastFocusEl = document.activeElement;
  ui.modalTitle.textContent = title;
  ui.modalBody.innerHTML = "";
  ui.modalBody.appendChild(bodyNode);
  ui.modalFoot.innerHTML = "";
  if(footNode) ui.modalFoot.appendChild(footNode);
  ui.backdrop.classList.remove("hidden");
  ui.modal.classList.remove("hidden");
  ui.backdrop.setAttribute("aria-hidden","false");
  setTimeout(()=>{
    const focusable = ui.modal.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    (focusable || ui.modalClose).focus();
  }, 0);
}

function closeModal(){
  ui.backdrop.classList.add("hidden");
  ui.modal.classList.add("hidden");
  ui.backdrop.setAttribute("aria-hidden","true");
  if(lastFocusEl) lastFocusEl.focus();
}

ui.modalClose.addEventListener("click", closeModal);
ui.backdrop.addEventListener("click", closeModal);
document.addEventListener("keydown", (e)=>{
  if(e.key==="Escape" && !ui.modal.classList.contains("hidden")) closeModal();
});

function setTab(which){
  const tabs = [
    [ui.tabDashboard, ui.viewDashboard],
    [ui.tabAbsent, ui.viewAbsent],
    [ui.tabEdit, ui.viewEdit],
    [ui.tabLog, ui.viewLog]
  ];
  for(const [tab, view] of tabs){
    if(!tab || !view) continue;
    const active = tab === which;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    view.classList.toggle("hidden", !active);
  }
  render();
}

ui.tabDashboard?.addEventListener("click", ()=>setTab(ui.tabDashboard));
ui.tabAbsent?.addEventListener("click", ()=>setTab(ui.tabAbsent));
ui.tabEdit?.addEventListener("click", ()=>setTab(ui.tabEdit));
ui.tabLog?.addEventListener("click", ()=>setTab(ui.tabLog));

function setSelectedPerson(id){
  state.selectedPersonId = id;
  saveState();
  renderNameList();
  renderEditView();
}

function markSelected(status){
  const id = state.selectedPersonId;
  if(!id) return toast("Bitte zuerst eine Person auswählen.");
  const dateK = dateKey(selectedDate);
  const prev = getCurrentMark(id);
  setMarkForDate(id, dateK, status);
  log("mark", { personId: id, name: findPerson(id)?.name, from: prev, to: status, date: dateK });
  saveState();
  render();
}

function clearMarkSelected(){
  const id = state.selectedPersonId;
  if(!id) return toast("Bitte zuerst eine Person auswählen.");
  const dateK = dateKey(selectedDate);
  const prev = getCurrentMark(id);
  setMarkForDate(id, dateK, null);
  log("unmark", { personId: id, name: findPerson(id)?.name, from: prev, date: dateK });
  saveState();
  render();
}

// Feature #4: Reset with confirmation, only current date
function resetAllMarks(){
  const dateK = dateKey(selectedDate);
  const dateFormatted = selectedDate.toLocaleDateString("de-DE", {day: "2-digit", month: "2-digit", year: "numeric"});
  
  if(!confirm(`Möchtest du wirklich alle Markierungen und Zuweisungen für ${dateFormatted} zurücksetzen?`)){
    return;
  }
  
  const markCount = Object.keys(state.marks[dateK] || {}).length;
  const subCount = Object.keys(state.substitutions[dateK] || {}).length;
  
  // Only delete current date's data
  delete state.marks[dateK];
  delete state.substitutions[dateK];
  
  log("reset_day", { date: dateK, marksCleared: markCount, substitutionsCleared: subCount });
  saveState();
  render();
  toast(`Daten für ${dateFormatted} wurden zurückgesetzt.`);
}

function addPerson(name){
  const clean = (name || "").trim();
  if(!clean) return;
  const p = { id: uid(), name: clean, schedule: {}, permanentAssignments: {} };
  ensurePersonScheduleFromTemplate(p);
  applyTemplateToPerson(p, "missing");
  state.people.push(p);
  state.selectedPersonId = p.id;
  log("add_person", { name: clean, id: p.id });
  saveState();
  render();
}

function removeSelectedPerson(){
  const id = state.selectedPersonId;
  if(!id) return toast("Bitte zuerst eine Person auswählen.");
  const p = findPerson(id);
  if(!p) return;
  if(!confirm(`"${p.name}" wirklich entfernen?`)) return;
  state.people = state.people.filter(x=>x.id!==id);
  // Clean marks for this person across all dates
  for(const dateK of Object.keys(state.marks)){
    delete state.marks[dateK][id];
  }
  // Clean substitutions references
  for(const dk of Object.keys(state.substitutions)){
    if(state.substitutions[dk][id]) delete state.substitutions[dk][id];
    for(const absentId of Object.keys(state.substitutions[dk] || {})){
      for(const dayKey of Object.keys(state.substitutions[dk][absentId] || {})){
        for(const slotIdx of Object.keys(state.substitutions[dk][absentId][dayKey] || {})){
          if(state.substitutions[dk][absentId][dayKey][slotIdx] === id){
            delete state.substitutions[dk][absentId][dayKey][slotIdx];
          }
        }
      }
    }
  }
  // Clean permanent assignments referencing this person
  for(const person of state.people){
    if(person.permanentAssignments){
      for(const key of Object.keys(person.permanentAssignments)){
        if(person.permanentAssignments[key] === id){
          delete person.permanentAssignments[key];
        }
      }
    }
  }
  log("remove_person", { id, name: p.name });
  state.selectedPersonId = state.people[0]?.id || null;
  saveState();
  render();
}

function toast(msg){
  const el = document.createElement("div");
  el.className = "card";
  el.style.position = "fixed";
  el.style.right = "14px";
  el.style.bottom = "14px";
  el.style.width = "min(420px, calc(100vw - 28px))";
  el.style.zIndex = "100";
  el.style.background = "rgba(16,26,46,.96)";
  el.style.backdropFilter = "blur(10px)";
  el.innerHTML = `<div style="font-weight:900;margin-bottom:4px">Hinweis</div><div class="small">${escapeHtml(msg)}</div>`;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .25s ease"; }, 2300);
  setTimeout(()=>{ el.remove(); }, 2700);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// --- Renderers
function renderDatetime(){
  ui.clock.textContent = formatTime(new Date());
  ui.weekday.textContent = (() => {
    const d = new Date(ui.datePicker.value + "T00:00:00");
    const idx = weekdayIndex(d);
    const label = d.toLocaleDateString("de-DE",{weekday:"long", year:"numeric", month:"2-digit", day:"2-digit"});
    if(idx > 4) return `${label} (Wochenende)`;
    return label;
  })();
}

function renderNameList(){
  ui.nameList.innerHTML = "";
  const list = filteredPeople(); // Already sorted alphabetically (Feature #5)
  const dateK = dateKey(selectedDate);
  
  if(list.length===0){
    const empty = document.createElement("div");
    empty.className = "notice";
    empty.innerHTML = `Noch keine Namen. Klicke oben auf <b>+ Name</b>.`;
    ui.nameList.appendChild(empty);
    return;
  }

  list.forEach((p, idx)=>{
    const card = document.createElement("div");
    card.className = "name-card";
    card.setAttribute("role","option");
    card.setAttribute("tabindex","0");
    card.dataset.personId = p.id;

    const selected = state.selectedPersonId === p.id;
    card.classList.toggle("selected", selected);
    if(selected) card.setAttribute("aria-selected","true");

    const st = getCurrentMark(p.id);
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = st ? statusLabel(st) : "Ohne Markierung";
    if(st==="available") pill.classList.add("good");
    if(st==="absent") pill.classList.add("bad");

    const left = document.createElement("div");
    left.className = "name-meta";
    left.innerHTML = `<div class="name">${escapeHtml(p.name)}</div>
                      <div class="status">${escapeHtml(st ? statusLabel(st) : "—")}</div>`;

    card.appendChild(left);
    card.appendChild(pill);

    card.addEventListener("click", ()=>setSelectedPerson(p.id));
    card.addEventListener("keydown",(e)=>{
      if(e.key==="Enter" || e.key===" "){
        e.preventDefault();
        setSelectedPerson(p.id);
      }
    });

    ui.nameList.appendChild(card);
  });
}

function renderAbsentView(){
  ui.viewAbsent.innerHTML = "";
  const dk = getDayKeyForDate(selectedDate);
  const dateK = dateKey(selectedDate);
  const timeline = computeTimeline(state.template);
  const filterUnassigned = ui.filterUnassigned?.checked || false;

  // Get people marked absent for this date
  const absentIds = state.people
    .filter(p => getCurrentMark(p.id) === "absent")
    .sort((a,b) => a.name.localeCompare(b.name, "de")) // Alphabetical (Feature #5)
    .map(p => p.id);

  // Also check for "Kind da" but not active (Feature #9)
  const needsSubstitution = [];
  for(const person of state.people){
    if(getCurrentMark(person.id) === "absent") continue; // Already handled above
    if(!dk) continue;
    
    for(const slot of timeline){
      if(slot.type !== "lesson") continue;
      const childPresent = isChildPresent(person, dk, slot.slotIndex);
      const isActive = isSlotActive(person, dk, slot.slotIndex);
      
      if(childPresent && !isActive){
        // Check if covered by permanent assignment
        const permKey = `${dk}_${slot.slotIndex}`;
        const permAssignedId = person.permanentAssignments?.[permKey];
        if(permAssignedId){
          const permPerson = findPerson(permAssignedId);
          if(permPerson && getCurrentMark(permAssignedId) !== "absent"){
            continue; // Skip - covered by permanent assignment
          }
        }
        needsSubstitution.push({
          person,
          slot,
          reason: "Kind da, Person nicht aktiv"
        });
      }
    }
  }

  // Check for permanent assignments where the assigned person is absent
  const permanentSubNeeded = [];
  for(const person of state.people){
    if(!person.permanentAssignments || !dk) continue;
    
    for(const slot of timeline){
      if(slot.type !== "lesson") continue;
      const key = `${dk}_${slot.slotIndex}`;
      const assignedId = person.permanentAssignments[key];
      if(assignedId){
        const assignedPerson = findPerson(assignedId);
        if(assignedPerson && getCurrentMark(assignedId) === "absent"){
          // Check if a daily substitution has already been assigned for this slot
          const dailySub = (((state.substitutions[dateK]||{})[assignedId]||{})[dk]||{})[slot.slotIndex];
          if(!dailySub){
            permanentSubNeeded.push({
              originalPerson: person,
              assignedPerson,
              slot,
              reason: "Dauerhafte Zuweisung, Person abwesend"
            });
          }
        }
      }
    }
  }

  if(!dk){
    const n = document.createElement("div");
    n.className = "notice";
    n.innerHTML = `Für Wochenenden gibt es kein Raster. Wähle ein Datum von Montag bis Freitag.`;
    ui.viewAbsent.appendChild(n);
    return;
  }

  if(absentIds.length === 0 && needsSubstitution.length === 0 && permanentSubNeeded.length === 0){
    const n = document.createElement("div");
    n.className = "notice";
    n.innerHTML = `Kein Vertretungsbedarf für diesen Tag. Markiere links jemanden als <b>Abwesend</b>, oder setze im Raster "Kind da" ohne "Aktiv".`;
    ui.viewAbsent.appendChild(n);
    return;
  }
  
  // Build dropdown options for quick assign (available people first, then unmarked) - sorted alphabetically (Feature #5)
  const availablePeople = state.people
    .filter(p => getCurrentMark(p.id) === "available")
    .sort((a,b) => a.name.localeCompare(b.name, "de"));
  const otherPeople = state.people
    .filter(p => !getCurrentMark(p.id) && getCurrentMark(p.id) !== "absent")
    .sort((a,b) => a.name.localeCompare(b.name, "de"));

  // Regular absent people section
  absentIds.forEach(absentId=>{
    const p = findPerson(absentId);
    if(!p) return;

    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<div>
        <div class="card-title">${escapeHtml(p.name)}</div>
        <div class="subtle">Raster: ${DAYS[DAY_KEYS.indexOf(dk)]} · ${escapeHtml(dateK)}</div>
      </div>
      <div class="pill bad">Abwesend</div>`;
    card.appendChild(head);

    const table = document.createElement("div");
    table.innerHTML = `<table class="table" aria-label="Stundenraster">
      <tbody></tbody>
    </table>`;
    const tbody = table.querySelector("tbody");

    let hasVisibleRows = false;

    timeline.forEach(slot=>{
      if(slot.type === "break") return;
      
      if(!isSlotActive(p, dk, slot.slotIndex)) return;
      
      const assignedId = (((state.substitutions[dateK]||{})[absentId]||{})[dk]||{})[slot.slotIndex] || null;
      const assigned = assignedId ? findPerson(assignedId) : null;
      
      if(filterUnassigned && assigned) return;
      
      hasVisibleRows = true;

      const tr = document.createElement("tr");
      tr.className = "tr";
      
      if(!assigned){
        tr.classList.add("row-warning");
      }

      const timeTd = document.createElement("td");
      timeTd.className = "td";
      timeTd.textContent = `${mmToHHMM(slot.start)}–${mmToHHMM(slot.end)}`;

      const infoTd = document.createElement("td");
      infoTd.className = "td";
      const note = (p.schedule?.[dk]?.notes?.[slot.slotIndex] ?? "");
      infoTd.innerHTML = `<div style="font-weight:900">${escapeHtml(slot.label || "Stunde")}</div>
                          <div class="small">${note ? escapeHtml(note) : "—"}</div>`;

      const actionTd = document.createElement("td");
      actionTd.className = "td";
      
      // Get already assigned people for this slot (Feature #3)
      const alreadyAssigned = getAssignedPeopleForSlot(dateK, dk, slot.slotIndex);
      
      const select = document.createElement("select");
      select.className = "quick-select";
      select.innerHTML = `<option value="">— Vertretung wählen —</option>`;
      
      if(availablePeople.length > 0){
        const availableNotAssigned = availablePeople.filter(person => 
          !alreadyAssigned.has(person.id) || assignedId === person.id
        );
        if(availableNotAssigned.length > 0){
          select.innerHTML += `<optgroup label="✅ Verfügbar">`;
          for(const person of availableNotAssigned){
            const selected = assignedId === person.id ? "selected" : "";
            select.innerHTML += `<option value="${person.id}" ${selected}>${escapeHtml(person.name)}</option>`;
          }
          select.innerHTML += `</optgroup>`;
        }
      }
      
      if(otherPeople.length > 0){
        const otherNotAssigned = otherPeople.filter(person =>
          !alreadyAssigned.has(person.id) || assignedId === person.id
        );
        if(otherNotAssigned.length > 0){
          select.innerHTML += `<optgroup label="Anwesend">`;
          for(const person of otherNotAssigned){
            const selected = assignedId === person.id ? "selected" : "";
            select.innerHTML += `<option value="${person.id}" ${selected}>${escapeHtml(person.name)}</option>`;
          }
          select.innerHTML += `</optgroup>`;
        }
      }
      
      select.value = assignedId || "";
      
      select.addEventListener("change", () => {
        ensureSubPath(dateK, absentId, dk);
        if(select.value){
          state.substitutions[dateK][absentId][dk][slot.slotIndex] = select.value;
          const assignedPerson = findPerson(select.value);
          log("assign", {
            date: dateK,
            dayKey: dk,
            absent: p.name,
            absentId,
            slotIndex: slot.slotIndex,
            slotLabel: slot.label,
            assignedTo: assignedPerson?.name,
            assignedToId: select.value
          });
        } else {
          delete state.substitutions[dateK][absentId][dk][slot.slotIndex];
          log("unassign", { date: dateK, dayKey: dk, absent: p.name, absentId, slotIndex: slot.slotIndex, slotLabel: slot.label });
        }
        saveState();
        render();
      });
      
      actionTd.appendChild(select);
      
      const status = document.createElement("span");
      status.className = assigned ? "status-ok" : "status-warning";
      status.textContent = assigned ? "✓" : "⚠️";
      status.title = assigned ? `Zugewiesen: ${assigned.name}` : "Noch nicht zugewiesen!";
      actionTd.appendChild(status);

      tr.appendChild(timeTd);
      tr.appendChild(infoTd);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });

    if(hasVisibleRows){
      card.appendChild(table);
      ui.viewAbsent.appendChild(card);
    } else if(filterUnassigned){
      const allDone = document.createElement("div");
      allDone.className = "card";
      allDone.innerHTML = `<div class="card-head">
        <div><div class="card-title">${escapeHtml(p.name)}</div></div>
        <div class="pill good">✓ Alle Stunden besetzt</div>
      </div>`;
      ui.viewAbsent.appendChild(allDone);
    }
  });

  // Feature #10: Permanent assignments where assigned person is absent
  if(permanentSubNeeded.length > 0){
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="card-head">
      <div class="card-title">⚠️ Dauerhafte Zuweisung - Person abwesend</div>
      <div class="subtle">Die dauerhaft zugewiesene Person ist heute nicht da</div>
    </div>`;
    
    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = "<tbody></tbody>";
    const tbody = table.querySelector("tbody");
    
    for(const item of permanentSubNeeded){
      const tr = document.createElement("tr");
      tr.className = "tr row-warning";
      tr.innerHTML = `
        <td class="td">${mmToHHMM(item.slot.start)}–${mmToHHMM(item.slot.end)}</td>
        <td class="td"><strong>${escapeHtml(item.assignedPerson.name)}</strong> → ${escapeHtml(item.originalPerson.name)}<br><span class="small">${escapeHtml(item.slot.label)}</span></td>
        <td class="td"><span class="pill bad">${escapeHtml(item.assignedPerson.name)} abwesend</span></td>
      `;
      tbody.appendChild(tr);
    }
    
    card.appendChild(table);
    ui.viewAbsent.appendChild(card);
  }

  // Feature #9: "Kind da" but not active - needs substitution (at the end)
  if(needsSubstitution.length > 0){
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="card-head">
      <div class="card-title">⚠️ Kind da, Person nicht aktiv</div>
      <div class="subtle">Diese Stunden brauchen Vertretung</div>
    </div>`;
    
    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = "<tbody></tbody>";
    const tbody = table.querySelector("tbody");
    
    for(const item of needsSubstitution){
      const tr = document.createElement("tr");
      tr.className = "tr row-warning";
      tr.innerHTML = `
        <td class="td">${mmToHHMM(item.slot.start)}–${mmToHHMM(item.slot.end)}</td>
        <td class="td"><strong>${escapeHtml(item.person.name)}</strong><br><span class="small">${escapeHtml(item.slot.label)}</span></td>
        <td class="td"><span class="pill bad">Vertretung nötig</span></td>
      `;
      tbody.appendChild(tr);
    }
    
    card.appendChild(table);
    ui.viewAbsent.appendChild(card);
  }

  const tip = document.createElement("div");
  tip.className = "notice";
  tip.innerHTML = `<b>Tipp:</b> Bereits zugewiesene Personen werden automatisch ausgeblendet. Verfügbare Personen werden zuerst angezeigt.`;
  ui.viewAbsent.appendChild(tip);
}

function renderEditView(){
  ui.viewEdit.innerHTML = "";
  const p = findPerson(state.selectedPersonId);
  if(!p){
    const n = document.createElement("div");
    n.className = "notice";
    n.innerHTML = `Wähle links eine Person aus, um deren Raster zu bearbeiten.`;
    ui.viewEdit.appendChild(n);
    return;
  }
  ensurePersonScheduleFromTemplate(p);

  const dkToday = getDayKeyForDate(selectedDate) || "mon";
  const wrapper = document.createElement("div");
  wrapper.className = "card";

  // Feature #8: Calculate work minutes for this day
  const timeline = computeTimeline(state.template);
  let workMinutes = 0;
  timeline.forEach(slot => {
    if(slot.type === "lesson" && isSlotActive(p, dkToday, slot.slotIndex)){
      workMinutes += slot.duration;
    }
  });
  
  const workHours = Math.floor(workMinutes / 60);
  const workMins = workMinutes % 60;
  const workTimeStr = workHours > 0 ? `${workHours}h ${workMins}min` : `${workMins} min`;

  const head = document.createElement("div");
  head.className = "card-head";
  const status = getCurrentMark(p.id);
  head.innerHTML = `<div>
      <div class="card-title">${escapeHtml(p.name)}</div>
      <div class="subtle">Raster bearbeiten · Standard kann später erneut angewendet werden</div>
    </div>
    <div style="display: flex; gap: 10px; align-items: center;">
      <div class="work-minutes" title="Aktive Arbeitszeit heute">⏱ ${workTimeStr}</div>
      <div class="pill ${status==="absent" ? "bad" : status==="available" ? "good" : ""}">${status ? escapeHtml(statusLabel(status)) : "Ohne Markierung"}</div>
    </div>`;
  wrapper.appendChild(head);

  const dayRow = document.createElement("div");
  dayRow.style.display = "flex";
  dayRow.style.gap = "8px";
  dayRow.style.flexWrap = "wrap";
  dayRow.style.marginBottom = "12px";

  let activeDay = dkToday;

  const dayButtons = {};
  DAY_KEYS.forEach((dk, i)=>{
    const b = document.createElement("button");
    b.className = "tab" + (dk===activeDay ? " active" : "");
    b.textContent = DAYS[i];
    b.addEventListener("click", ()=>{
      activeDay = dk;
      Object.entries(dayButtons).forEach(([k, btn])=>{
        btn.classList.toggle("active", k===activeDay);
      });
      renderDayEditor();
    });
    dayButtons[dk] = b;
    dayRow.appendChild(b);
  });
  wrapper.appendChild(dayRow);

  const editor = document.createElement("div");
  wrapper.appendChild(editor);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "10px";
  controls.style.flexWrap = "wrap";
  controls.style.marginTop = "12px";

  const btnResetDay = document.createElement("button");
  btnResetDay.className = "btn btn-ghost";
  btnResetDay.textContent = "Tag auf Standard zurücksetzen";
  btnResetDay.addEventListener("click", ()=>{
    const notes = p.schedule[activeDay].notes || {};
    for(const idx of Object.keys(notes)) delete notes[idx];
    for(const [idxStr, note] of Object.entries(state.template.templateNotes[activeDay] || {})){
      notes[Number(idxStr)] = note;
    }
    p.schedule[activeDay].notes = notes;
    log("reset_person_day", { personId: p.id, name: p.name, dayKey: activeDay });
    saveState();
    renderDayEditor();
  });

  const btnApplyStandardAll = document.createElement("button");
  btnApplyStandardAll.className = "btn";
  btnApplyStandardAll.textContent = "Standard (fehlendes) auffüllen – alle Tage";
  btnApplyStandardAll.addEventListener("click", ()=>{
    applyTemplateToPerson(p, "missing");
    log("apply_template_missing", { personId: p.id, name: p.name });
    saveState();
    renderDayEditor();
    toast("Standardraster wurde (fehlendes) aufgefüllt.");
  });

  const btnApplyStandardOverwrite = document.createElement("button");
  btnApplyStandardOverwrite.className = "btn btn-ghost";
  btnApplyStandardOverwrite.textContent = "Standard überschreiben – alle Tage";
  btnApplyStandardOverwrite.addEventListener("click", ()=>{
    if(!confirm("Dadurch werden alle Texte überschrieben. Fortfahren?")) return;
    applyTemplateToPerson(p, "overwrite");
    log("apply_template_overwrite", { personId: p.id, name: p.name });
    saveState();
    renderDayEditor();
    toast("Standardraster wurde überschrieben.");
  });

  controls.appendChild(btnResetDay);
  controls.appendChild(btnApplyStandardAll);
  controls.appendChild(btnApplyStandardOverwrite);
  wrapper.appendChild(controls);

  function renderDayEditor(){
    editor.innerHTML = "";

    const timeline = computeTimeline(state.template);
    
    // Recalculate work minutes for the selected day
    let dayWorkMinutes = 0;
    timeline.forEach(slot => {
      if(slot.type === "lesson" && isSlotActive(p, activeDay, slot.slotIndex)){
        dayWorkMinutes += slot.duration;
      }
    });
    const dayWorkHours = Math.floor(dayWorkMinutes / 60);
    const dayWorkMins = dayWorkMinutes % 60;
    const dayWorkTimeStr = dayWorkHours > 0 ? `${dayWorkHours}h ${dayWorkMins}min` : `${dayWorkMins} min`;
    
    // Update the work minutes display
    const workMinutesEl = wrapper.querySelector('.work-minutes');
    if(workMinutesEl){
      workMinutesEl.textContent = `⏱ ${dayWorkTimeStr}`;
      workMinutesEl.title = `Aktive Arbeitszeit ${DAYS[DAY_KEYS.indexOf(activeDay)]}`;
    }
    
    const grid = document.createElement("div");
    grid.className = "card";
    grid.style.background = "rgba(255,255,255,.02)";
    grid.style.boxShadow = "none";
    grid.style.margin = "0";
    grid.style.borderRadius = "16px";

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `<tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    timeline.forEach(slot=>{
      const tr = document.createElement("tr");
      tr.className = "tr";
      if(slot.type==="break") tr.classList.add("row-break");

      const t1 = document.createElement("td");
      t1.className = "td";
      t1.textContent = `${mmToHHMM(slot.start)}–${mmToHHMM(slot.end)}`;

      const t2 = document.createElement("td");
      t2.className = "td";
      t2.innerHTML = `<span class="tag ${slot.type}">${slot.type==="lesson" ? "Stunde" : "Pause"}</span>`;

      const t3 = document.createElement("td");
      t3.className = "td";
      t3.innerHTML = `<div style="font-weight:900">${escapeHtml(slot.label || (slot.type==="lesson" ? "Stunde" : "Pause"))}</div>`;

      const t4 = document.createElement("td");
      t4.className = "td";

      if(slot.type==="break"){
        t4.innerHTML = `<span class="small">${slot.duration} Minuten</span>`;
      }else{
        const isActive = isSlotActive(p, activeDay, slot.slotIndex);
        const childPresent = isChildPresent(p, activeDay, slot.slotIndex);
        const permanentAssignedId = getPermanentAssignment(p, activeDay, slot.slotIndex);
        const permanentAssigned = permanentAssignedId ? findPerson(permanentAssignedId) : null;
        
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.gap = "10px";
        wrapper.style.flexWrap = "wrap";
        
        // Active checkbox
        const activeLabel = document.createElement("label");
        activeLabel.className = "slot-toggle";
        activeLabel.title = isActive ? "Person arbeitet in dieser Stunde" : "Person arbeitet nicht in dieser Stunde";
        
        const activeCheck = document.createElement("input");
        activeCheck.type = "checkbox";
        activeCheck.checked = isActive;
        activeCheck.addEventListener("change", ()=>{
          toggleSlotActive(p, activeDay, slot.slotIndex);
          log("toggle_slot", { personId: p.id, name: p.name, dayKey: activeDay, slotIndex: slot.slotIndex, active: activeCheck.checked });
          saveState();
          renderDayEditor();
        });
        
        const activeText = document.createElement("span");
        activeText.textContent = "Aktiv";
        activeText.className = isActive ? "slot-active" : "slot-inactive";
        
        activeLabel.appendChild(activeCheck);
        activeLabel.appendChild(activeText);
        wrapper.appendChild(activeLabel);
        
        // Feature #9: Child present checkbox
        const childLabel = document.createElement("label");
        childLabel.className = "slot-toggle";
        childLabel.title = childPresent ? "Kind ist in dieser Stunde anwesend" : "Kind ist nicht in dieser Stunde";
        
        const childCheck = document.createElement("input");
        childCheck.type = "checkbox";
        childCheck.checked = childPresent;
        childCheck.addEventListener("change", ()=>{
          toggleChildPresent(p, activeDay, slot.slotIndex);
          log("toggle_child_present", { personId: p.id, name: p.name, dayKey: activeDay, slotIndex: slot.slotIndex, childPresent: childCheck.checked });
          saveState();
          renderDayEditor();
        });
        
        const childText = document.createElement("span");
        childText.textContent = "Kind da";
        childText.className = childPresent ? "slot-active" : "slot-inactive";
        
        childLabel.appendChild(childCheck);
        childLabel.appendChild(childText);
        wrapper.appendChild(childLabel);
        
        // Warning if child present but not active
        if(childPresent && !isActive){
          // Check if covered by permanent assignment
          const permKey = `${activeDay}_${slot.slotIndex}`;
          const permAssignedId = p.permanentAssignments?.[permKey];
          const permCovered = permAssignedId && findPerson(permAssignedId) && getCurrentMark(permAssignedId) !== "absent";
          
          if(!permCovered){
            const warning = document.createElement("span");
            warning.className = "slot-warning";
            warning.textContent = "⚠️ Braucht Vertretung";
            wrapper.appendChild(warning);
          }
        }
        
        // Note input (only if active)
        if(isActive){
          const value = (p.schedule?.[activeDay]?.notes?.[slot.slotIndex] ?? "");
          const inp = document.createElement("input");
          inp.className = "input";
          inp.type = "text";
          inp.placeholder = "Kurzer Text (z.B. Klasse/Ort/Notiz)…";
          inp.value = value;
          inp.style.flex = "1";
          inp.style.minWidth = "150px";
          inp.addEventListener("change", ()=>{
            if(!p.schedule[activeDay]) p.schedule[activeDay] = {notes:{}, disabled:{}, childPresent:{}};
            if(!p.schedule[activeDay].notes) p.schedule[activeDay].notes = {};
            p.schedule[activeDay].notes[slot.slotIndex] = inp.value;
            log("edit_note", { personId: p.id, name: p.name, dayKey: activeDay, slotIndex: slot.slotIndex, value: inp.value });
            saveState();
          });
          wrapper.appendChild(inp);
        } else {
          const disabledText = document.createElement("span");
          disabledText.className = "small";
          disabledText.textContent = "Person arbeitet nicht in dieser Stunde";
          wrapper.appendChild(disabledText);
        }
        
        // Feature #10: Permanent assignment
        const permWrapper = document.createElement("div");
        permWrapper.style.display = "flex";
        permWrapper.style.alignItems = "center";
        permWrapper.style.gap = "5px";
        permWrapper.style.marginTop = "5px";
        permWrapper.style.width = "100%";
        
        const permLabel = document.createElement("span");
        permLabel.className = "small";
        permLabel.textContent = "Dauerhaft an:";
        permWrapper.appendChild(permLabel);
        
        const permSelect = document.createElement("select");
        permSelect.className = "quick-select";
        permSelect.style.flex = "1";
        permSelect.innerHTML = `<option value="">— Keine dauerhafte Zuweisung —</option>`;
        
        // Get all other people, sorted alphabetically (Feature #5)
        const otherPeople = state.people
          .filter(other => other.id !== p.id)
          .sort((a,b) => a.name.localeCompare(b.name, "de"));
        
        for(const other of otherPeople){
          const selected = permanentAssignedId === other.id ? "selected" : "";
          permSelect.innerHTML += `<option value="${other.id}" ${selected}>${escapeHtml(other.name)}</option>`;
        }
        
        permSelect.value = permanentAssignedId || "";
        
        permSelect.addEventListener("change", ()=>{
          setPermanentAssignment(p, activeDay, slot.slotIndex, permSelect.value || null);
          const assignedPerson = permSelect.value ? findPerson(permSelect.value) : null;
          log("permanent_assignment", {
            personId: p.id,
            name: p.name,
            dayKey: activeDay,
            slotIndex: slot.slotIndex,
            slotLabel: slot.label,
            assignedTo: assignedPerson?.name || null
          });
          saveState();
          renderDayEditor();
        });
        
        permWrapper.appendChild(permSelect);
        
        if(permanentAssigned){
          const permInfo = document.createElement("span");
          permInfo.className = "pill good";
          permInfo.style.marginLeft = "5px";
          permInfo.textContent = `→ ${permanentAssigned.name}`;
          permWrapper.appendChild(permInfo);
        }
        
        t4.appendChild(wrapper);
        t4.appendChild(permWrapper);
      }
      
      if(slot.type === "lesson" && !isSlotActive(p, activeDay, slot.slotIndex)){
        tr.classList.add("row-disabled");
      }

      tr.appendChild(t1);tr.appendChild(t2);tr.appendChild(t3);tr.appendChild(t4);
      tbody.appendChild(tr);
    });

    grid.appendChild(table);
    editor.appendChild(grid);
    
    // Show slots that are permanently assigned TO this person
    const assignedToMe = [];
    for(const other of state.people){
      if(other.id === p.id || !other.permanentAssignments) continue;
      for(const [key, assignedId] of Object.entries(other.permanentAssignments)){
        if(assignedId === p.id){
          const [dk, slotIdxStr] = key.split("_");
          if(dk === activeDay){
            const slotIdx = parseInt(slotIdxStr);
            const slot = timeline.find(s => s.slotIndex === slotIdx);
            if(slot){
              assignedToMe.push({ from: other, slot });
            }
          }
        }
      }
    }
    
    if(assignedToMe.length > 0){
      const assignedCard = document.createElement("div");
      assignedCard.className = "card";
      assignedCard.style.marginTop = "12px";
      assignedCard.style.background = "rgba(46, 204, 113, 0.1)";
      assignedCard.innerHTML = `<div class="card-head">
        <div class="card-title">📥 Dauerhaft übernommene Stunden</div>
      </div>`;
      
      const assignedList = document.createElement("ul");
      assignedList.style.margin = "0";
      assignedList.style.paddingLeft = "20px";
      
      for(const item of assignedToMe){
        const li = document.createElement("li");
        li.innerHTML = `<strong>${mmToHHMM(item.slot.start)}–${mmToHHMM(item.slot.end)}</strong> ${escapeHtml(item.slot.label)} <span class="small">(von ${escapeHtml(item.from.name)})</span>`;
        assignedList.appendChild(li);
      }
      
      assignedCard.appendChild(assignedList);
      editor.appendChild(assignedCard);
    }
  }

  renderDayEditor();
  ui.viewEdit.appendChild(wrapper);
}

function renderLogView(){
  ui.viewLog.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "card";

  wrap.innerHTML = `<div class="card-head">
      <div>
        <div class="card-title">Log</div>
        <div class="subtle">Änderungen, Abwesenheiten und Zuweisungen pro Datum</div>
      </div>
      <div class="subtle">${state.logs.length} Einträge</div>
    </div>`;

  const tools = document.createElement("div");
  tools.style.display = "flex";
  tools.style.gap = "10px";
  tools.style.flexWrap = "wrap";
  tools.style.marginBottom = "12px";

  const filter = document.createElement("input");
  filter.className = "input";
  filter.type = "search";
  filter.placeholder = "Filtern (Datum, Name, Aktion)…";
  filter.style.maxWidth = "340px";

  const btnClear = document.createElement("button");
  btnClear.className = "btn btn-ghost";
  btnClear.textContent = "Log leeren";
  btnClear.addEventListener("click", ()=>{
    if(!confirm("Log wirklich löschen?")) return;
    state.logs = [];
    log("log_cleared", {});
    saveState();
    renderLogView();
  });

  tools.appendChild(filter);
  tools.appendChild(btnClear);

  const list = document.createElement("div");
  list.className = "card";
  list.style.margin = "0";
  list.style.background = "rgba(255,255,255,.02)";
  list.style.boxShadow = "none";
  list.style.borderRadius = "16px";

  function renderRows(){
    list.innerHTML = "";
    const q = filter.value.trim().toLowerCase();
    const entries = state.logs.filter(e=>{
      if(!q) return true;
      const text = `${e.ts} ${e.date} ${e.action} ${JSON.stringify(e.details||{})}`.toLowerCase();
      return text.includes(q);
    }).slice(0, 800);

    if(entries.length===0){
      list.innerHTML = `<div class="notice">Keine passenden Einträge.</div>`;
      return;
    }

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `<tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    entries.forEach(e=>{
      const tr = document.createElement("tr");
      tr.className = "tr";
      tr.innerHTML = `
        <td class="td" style="white-space:nowrap">${escapeHtml(new Date(e.ts).toLocaleString("de-DE"))}</td>
        <td class="td" style="white-space:nowrap">${escapeHtml(e.date)}</td>
        <td class="td"><span class="tag lesson">${escapeHtml(e.action)}</span></td>
        <td class="td"><div class="small">${escapeHtml(JSON.stringify(e.details||{}))}</div></td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    list.appendChild(table);

    const more = document.createElement("div");
    more.className = "small";
    more.style.marginTop = "10px";
    more.textContent = entries.length >= 800 ? "Hinweis: Anzeige auf 800 Einträge begrenzt (Export enthält alles)." : "";
    list.appendChild(more);
  }

  filter.addEventListener("input", renderRows);
  wrap.appendChild(tools);
  wrap.appendChild(list);
  ui.viewLog.appendChild(wrap);
  renderRows();
}

function downloadBlob(blob, filename){
  // Safari/iOS detection
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if(isSafari || isIOS){
    const reader = new FileReader();
    reader.onload = function(){
      const newTab = window.open();
      if(newTab){
        newTab.document.write(`
          <html><head><title>${filename}</title>
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <style>body{font-family:system-ui;padding:20px;background:#1a1a2e;color:#eee}
          .hint{background:#16213e;padding:16px;border-radius:8px;margin-bottom:16px}
          pre{white-space:pre-wrap;word-break:break-all;background:#0f0f23;padding:12px;border-radius:8px;font-size:12px;max-height:70vh;overflow:auto}
          </style></head><body>
          <div class="hint">📱 <b>Speichern:</b> Tippe auf "Teilen" (□↑) → "In Dateien sichern"</div>
          <pre>${reader.result.replace(/</g,'&lt;')}</pre>
          </body></html>
        `);
        newTab.document.close();
      }
    };
    reader.readAsText(blob);
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
}

function ensureSubPath(dateK, absentId, dayKey){
  if(!state.substitutions[dateK]) state.substitutions[dateK] = {};
  if(!state.substitutions[dateK][absentId]) state.substitutions[dateK][absentId] = {};
  if(!state.substitutions[dateK][absentId][dayKey]) state.substitutions[dateK][absentId][dayKey] = {};
}

// Feature #2: Import function
function openImportModal(){
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="notice" style="background: rgba(255, 77, 77, 0.1); border-left: 3px solid #ff4d4d;">
      <strong>⚠️ Achtung:</strong> Beim Import werden alle bestehenden Daten überschrieben! 
      Exportiere vorher deine aktuellen Daten, wenn du sie behalten möchtest.
    </div>
    <div style="margin-top: 16px;">
      <label class="small">JSON-Datei auswählen</label>
      <input id="importFile" type="file" accept=".json,application/json" class="input" style="margin-top: 8px;" />
    </div>
    <div style="margin-top: 16px;">
      <label class="small">Oder JSON-Text einfügen</label>
      <textarea id="importText" class="input" rows="6" placeholder="JSON hier einfügen..." style="margin-top: 8px; width: 100%; font-family: monospace; font-size: 12px; resize: vertical;"></textarea>
    </div>
    <div id="importPreview" style="margin-top: 16px; display: none;">
      <div class="small">Vorschau:</div>
      <div id="importStats" class="notice" style="margin-top: 8px;"></div>
    </div>
  `;
  
  const fileInput = body.querySelector("#importFile");
  const textArea = body.querySelector("#importText");
  const preview = body.querySelector("#importPreview");
  const stats = body.querySelector("#importStats");
  
  let importData = null;
  
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    
    try {
      const text = await file.text();
      importData = JSON.parse(text);
      
      // Validate structure
      if(!importData.people || !Array.isArray(importData.people)){
        throw new Error("Ungültiges Format: 'people' Array fehlt");
      }
      
      // Show preview
      preview.style.display = "block";
      stats.innerHTML = `
        <strong>Datei:</strong> ${escapeHtml(file.name)}<br>
        <strong>Personen:</strong> ${importData.people.length}<br>
        <strong>Markierungen:</strong> ${Object.keys(importData.marks || {}).length} Tage<br>
        <strong>Zuweisungen:</strong> ${Object.keys(importData.substitutions || {}).length} Tage<br>
        <strong>Log-Einträge:</strong> ${(importData.logs || []).length}
      `;
    } catch(err) {
      preview.style.display = "block";
      stats.innerHTML = `<span style="color: #ff4d4d;">❌ Fehler: ${escapeHtml(err.message)}</span>`;
      importData = null;
    }
  });

  function tryParseImport(text) {
    importData = JSON.parse(text);
    if(!importData.people || !Array.isArray(importData.people)){
      throw new Error("Ungültiges Format: 'people' Array fehlt");
    }
    preview.style.display = "block";
    stats.innerHTML = `
      <strong>Personen:</strong> ${importData.people.length}<br>
      <strong>Markierungen:</strong> ${Object.keys(importData.marks || {}).length} Tage<br>
      <strong>Zuweisungen:</strong> ${Object.keys(importData.substitutions || {}).length} Tage<br>
      <strong>Log-Einträge:</strong> ${(importData.logs || []).length}
    `;
  }

  textArea.addEventListener("input", () => {
    const val = textArea.value.trim();
    if(!val) { preview.style.display = "none"; importData = null; return; }
    try {
      tryParseImport(val);
    } catch(err) {
      preview.style.display = "block";
      stats.innerHTML = `<span style="color: #ff4d4d;">❌ Fehler: ${escapeHtml(err.message)}</span>`;
      importData = null;
    }
  });

  const foot = document.createElement("div");
  
  const cancel = document.createElement("button");
  cancel.className = "btn btn-ghost";
  cancel.textContent = "Abbrechen";
  cancel.addEventListener("click", closeModal);
  
  const importBtn = document.createElement("button");
  importBtn.className = "btn btn-bad";
  importBtn.textContent = "Daten importieren";
  importBtn.addEventListener("click", () => {
    if(!importData){
      toast("Bitte zuerst eine JSON-Datei auswählen oder JSON-Text einfügen.");
      return;
    }
    
    if(!confirm("Wirklich alle Daten überschreiben? Diese Aktion kann nicht rückgängig gemacht werden!")){
      return;
    }
    
    // Perform import
    state.people = importData.people || [];
    state.marks = importData.marks || {};
    state.substitutions = importData.substitutions || {};
    state.template = importData.template || DEFAULT_TEMPLATE;
    state.settings = importData.settings || DEFAULT_SETTINGS;
    // Keep logs, just add import entry
    log("data_imported", { 
      peopleCount: state.people.length,
      marksCount: Object.keys(state.marks).length,
      substitutionsCount: Object.keys(state.substitutions).length
    });
    
    // Ensure all people have proper structure
    state.people.forEach(p => {
      ensurePersonScheduleFromTemplate(p);
    });
    
    state.selectedPersonId = state.people[0]?.id || null;
    state.version = 2;
    saveState();
    closeModal();
    render();
    toast("Daten erfolgreich importiert!");
  });
  
  foot.appendChild(cancel);
  foot.appendChild(importBtn);
  
  openModal("Daten importieren", body, foot);
}

function openAddPersonModal(){
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="notice">Aus Datenschutzgründen wird nur der Name gespeichert.</div>
    <div style="margin-top:12px">
      <label class="small" for="newName">Name</label>
      <input id="newName" class="input" type="text" placeholder="z.B. Müller" autocomplete="off" />
    </div>
    <div class="small" style="margin-top:10px">Tipp: <b>Enter</b> bestätigt.</div>
  `;
  const input = body.querySelector("#newName");

  const foot = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.className = "btn btn-ghost";
  cancel.textContent = "Abbrechen";
  cancel.addEventListener("click", closeModal);

  const ok = document.createElement("button");
  ok.className = "btn";
  ok.textContent = "Hinzufügen";
  ok.addEventListener("click", ()=>{
    const v = input.value.trim();
    if(!v) return;
    addPerson(v);
    closeModal();
  });

  input.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){
      ok.click();
    }
  });

  foot.appendChild(cancel);
  foot.appendChild(ok);
  openModal("Name hinzufügen", body, foot);
}

function openOptionsModal(){
  const body = document.createElement("div");

  body.innerHTML = `
    <button id="btnHardRefresh" class="btn" style="width:100%;margin-bottom:16px;background:#e74c3c;color:white">🔄 App aktualisieren (Cache leeren)</button>
    <div class="notice">
      Offline-Nutzung: Alle Daten bleiben lokal auf diesem Gerät (localStorage). Du kannst sie jederzeit exportieren.
    </div>

    <h3 style="margin:14px 0 8px">Farben (Barrierefreiheit)</h3>
    <div class="grid">
      <div>
        <div class="small">Verfügbar</div>
        <input id="colAvail" class="input" type="color" value="${escapeHtml(state.settings.colors.available)}" />
      </div>
      <div>
        <div class="small">Abwesend</div>
        <input id="colAbs" class="input" type="color" value="${escapeHtml(state.settings.colors.absent)}" />
      </div>
      <div>
        <div class="small">Presets</div>
        <select id="preset" class="select">
          <option value="">—</option>
          <option value="default">Standard</option>
          <option value="cb1">Farbenblind-freundlich (Blau/Orange)</option>
          <option value="cb2">Hoher Kontrast (Gelb/Magenta)</option>
        </select>
      </div>
      <div>
        <div class="small">Daten</div>
        <button id="btnExportAll" class="btn">Daten exportieren (JSON)</button>
        <button id="btnCopyJSON" class="btn btn-ghost" style="margin-top:6px">📋 JSON in Zwischenablage kopieren</button>
        <button id="btnExportCSV" class="btn btn-ghost" style="margin-top:6px">Log exportieren (CSV)</button>
        <button id="btnImportData" class="btn btn-ghost" style="margin-top:6px">Daten importieren</button>
      </div>
    </div>

    <hr />

    <h3 style="margin:0 0 8px">Quality of Life</h3>
    <ul class="small" style="margin:0;padding-left:18px;line-height:1.6">
      <li>Suche in Namensliste</li>
      <li>Keyboard-Shortcuts (↑/↓, A, V, U)</li>
      <li>Vertretungen werden im Log gespeichert</li>
      <li>Abwesende werden im Zuweisungs-Popup ausgeblendet</li>
      <li>Standardraster kann zentral bearbeitet werden</li>
      <li>Markierungen werden pro Datum gespeichert</li>
      <li>"Kind da" Option für Vertretungsbedarf</li>
      <li>Dauerhafte Stunden-Zuweisungen möglich</li>
    </ul>

    <div style="margin-top:12px" class="small">
      <b>Hinweis iOS:</b> Für Offline-PWA im Safari "Teilen" → "Zum Home-Bildschirm". Danach wie eine App öffnen.
    </div>
  `;

  const colAvail = body.querySelector("#colAvail");
  const colAbs = body.querySelector("#colAbs");
  const preset = body.querySelector("#preset");
  const btnExportAll = body.querySelector("#btnExportAll");
  const btnExportCSV = body.querySelector("#btnExportCSV");
  const btnImportData = body.querySelector("#btnImportData");
  const btnCopyJSON = body.querySelector("#btnCopyJSON");

  function applyColors(){
    state.settings.colors.available = colAvail.value;
    state.settings.colors.absent = colAbs.value;
    applyColorVars();
    saveState();
    renderNameList();
    renderAbsentView();
    renderEditView();
  }

  const btnHardRefresh = body.querySelector("#btnHardRefresh");
  btnHardRefresh.addEventListener("click", async ()=>{
    btnHardRefresh.textContent = "⏳ Aktualisiere...";
    btnHardRefresh.disabled = true;
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
      location.reload(true);
    } catch(e) {
      location.reload(true);
    }
  });

  colAvail.addEventListener("input", applyColors);
  colAbs.addEventListener("input", applyColors);

  preset.addEventListener("change", ()=>{
    if(preset.value==="default"){
      colAvail.value = "#2ecc71";
      colAbs.value = "#ff4d4d";
    }
    if(preset.value==="cb1"){
      colAvail.value = "#1f77b4";
      colAbs.value = "#ff7f0e";
    }
    if(preset.value==="cb2"){
      colAvail.value = "#ffd60a";
      colAbs.value = "#ff2d95";
    }
    applyColors();
  });

  btnExportAll.addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    downloadBlob(blob, `sbpm-data-${dateKey(new Date())}.json`);
  });
  btnCopyJSON.addEventListener("click", async ()=>{
    const json = JSON.stringify(state, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      btnCopyJSON.textContent = "✅ Kopiert!";
      setTimeout(()=>{ btnCopyJSON.textContent = "📋 JSON in Zwischenablage kopieren"; }, 2000);
    } catch(e) {
      const ta = document.createElement("textarea");
      ta.value = json;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      btnCopyJSON.textContent = "✅ Kopiert!";
      setTimeout(()=>{ btnCopyJSON.textContent = "📋 JSON in Zwischenablage kopieren"; }, 2000);
    }
  });

  btnExportCSV.addEventListener("click", ()=>{
    const rows = [["ts","date","action","details"]];
    for(const e of state.logs){
      rows.push([e.ts, e.date, e.action, JSON.stringify(e.details)]);
    }
    const csv = rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    downloadBlob(blob, `sbpm-log-${dateKey(new Date())}.csv`);
  });

  btnImportData.addEventListener("click", ()=>{
    closeModal();
    openImportModal();
  });

  const foot = document.createElement("div");
  const close = document.createElement("button");
  close.className = "btn";
  close.textContent = "Schließen";
  close.addEventListener("click", closeModal);
  foot.appendChild(close);

  openModal("Optionen", body, foot);
}

function openEditTemplateModal(){
  const template = structuredClone(state.template);

  const body = document.createElement("div");
  const timeline = computeTimeline(template);

  body.innerHTML = `
    <div class="notice">
      Standardraster gilt Montag–Freitag. Du kannst beliebig viele Pausen mit unterschiedlichen Längen einfügen.
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
      <div style="min-width:220px">
        <div class="small">Startzeit</div>
        <input id="tplStart" class="input" type="time" value="${escapeHtml(template.startTime)}" />
      </div>
      <div style="min-width:220px">
        <div class="small">Schnellaktionen</div>
        <button id="btnAddLesson" class="btn">+ Stunde (45)</button>
        <button id="btnAddBreak" class="btn btn-ghost">+ Pause</button>
      </div>
    </div>

    <div style="margin-top:12px" class="card" id="slotList" style="margin:0"></div>

    <hr />
    <h3 style="margin:0 0 8px">Standard-Texte (optional)</h3>
    <div class="small">Diese Texte werden neuen Personen als Standard zugewiesen (und können pro Person überschrieben werden).</div>
    <div style="margin-top:10px" id="tplNotes"></div>
  `;

  const slotList = body.querySelector("#slotList");
  const tplStart = body.querySelector("#tplStart");
  const btnAddLesson = body.querySelector("#btnAddLesson");
  const btnAddBreak = body.querySelector("#btnAddBreak");
  const tplNotes = body.querySelector("#tplNotes");

  function renderSlots(){
    slotList.innerHTML = "";
    const tl = computeTimeline(template);

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `<tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    tl.forEach((s, idx)=>{
      const tr = document.createElement("tr");
      tr.className = "tr";
      if(s.type==="break") tr.classList.add("row-break");

      const td1 = document.createElement("td");
      td1.className = "td";
      td1.textContent = `${mmToHHMM(s.start)}–${mmToHHMM(s.end)}`;

      const td2 = document.createElement("td");
      td2.className = "td";
      const sel = document.createElement("select");
      sel.className = "select";
      sel.innerHTML = `<option value="lesson">Stunde</option><option value="break">Pause</option>`;
      sel.value = s.type;
      sel.addEventListener("change", ()=>{
        template.slots[idx].type = sel.value;
        renderSlots();
      });
      td2.appendChild(sel);

      const td3 = document.createElement("td");
      td3.className = "td";
      const lab = document.createElement("input");
      lab.className = "input";
      lab.type = "text";
      lab.value = template.slots[idx].label || "";
      lab.placeholder = s.type==="lesson" ? "z.B. 1. Stunde" : "z.B. Pause";
      lab.addEventListener("change", ()=>template.slots[idx].label = lab.value);
      td3.appendChild(lab);

      const td4 = document.createElement("td");
      td4.className = "td";
      td4.style.display = "flex";
      td4.style.gap = "8px";
      td4.style.alignItems = "center";

      const dur = document.createElement("input");
      dur.className = "input";
      dur.type = "number";
      dur.min = "1";
      dur.step = "1";
      dur.value = template.slots[idx].duration;
      dur.style.maxWidth = "120px";
      dur.addEventListener("change", ()=>{
        template.slots[idx].duration = clamp(Number(dur.value||45), 1, 240);
        renderSlots();
      });

      const up = document.createElement("button");
      up.className = "btn btn-ghost";
      up.textContent = "↑";
      up.title = "Nach oben";
      up.disabled = idx===0;
      up.addEventListener("click", ()=>{
        const tmp = template.slots[idx-1];
        template.slots[idx-1] = template.slots[idx];
        template.slots[idx] = tmp;
        renderSlots();
      });

      const down = document.createElement("button");
      down.className = "btn btn-ghost";
      down.textContent = "↓";
      down.title = "Nach unten";
      down.disabled = idx===template.slots.length-1;
      down.addEventListener("click", ()=>{
        const tmp = template.slots[idx+1];
        template.slots[idx+1] = template.slots[idx];
        template.slots[idx] = tmp;
        renderSlots();
      });

      const del = document.createElement("button");
      del.className = "btn btn-ghost";
      del.textContent = "–";
      del.title = "Löschen";
      del.addEventListener("click", ()=>{
        if(template.slots.length <= 1) return;
        template.slots.splice(idx,1);
        for(const dk of DAY_KEYS){
          const notes = template.templateNotes[dk] || {};
          const newNotes = {};
          Object.entries(notes).forEach(([k,v])=>{
            const i = Number(k);
            if(i===idx) return;
            newNotes[i > idx ? i-1 : i] = v;
          });
          template.templateNotes[dk] = newNotes;
        }
        renderSlots();
        renderNotes();
      });

      td4.appendChild(dur);
      td4.appendChild(document.createTextNode("Min"));
      td4.appendChild(up);
      td4.appendChild(down);
      td4.appendChild(del);

      tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tr.appendChild(td4);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    slotList.appendChild(table);
  }

  function renderNotes(){
    tplNotes.innerHTML = "";
    const tl = computeTimeline(template);
    const lessonIndices = tl.filter(s=>s.type==="lesson").map(s=>s.slotIndex);

    if(lessonIndices.length===0){
      tplNotes.innerHTML = `<div class="notice">Keine Stunden vorhanden – füge mindestens eine "Stunde" hinzu, um Standard-Texte zu nutzen.</div>`;
      return;
    }

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "10px";
    row.style.flexWrap = "wrap";
    row.style.marginBottom = "10px";
    tplNotes.appendChild(row);

    const dayBtns = {};
    let activeDay = getDayKeyForDate(selectedDate) || "mon";

    DAY_KEYS.forEach((dk, i)=>{
      const b = document.createElement("button");
      b.className = "tab" + (dk===activeDay ? " active" : "");
      b.textContent = DAYS[i];
      b.addEventListener("click", ()=>{
        activeDay = dk;
        Object.entries(dayBtns).forEach(([k,btn])=>btn.classList.toggle("active", k===activeDay));
        renderNotes();
      });
      dayBtns[dk]=b;
      row.appendChild(b);
    });

    const box = document.createElement("div");
    box.className = "card";
    box.style.margin="0";
    box.style.background="rgba(255,255,255,.02)";
    box.style.boxShadow="none";
    box.style.borderRadius="16px";
    tplNotes.appendChild(box);

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `<tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    tl.forEach(s=>{
      if(s.type!=="lesson") return;
      const tr = document.createElement("tr");
      tr.className = "tr";
      tr.innerHTML = `
        <td class="td" style="white-space:nowrap">${escapeHtml(mmToHHMM(s.start))}–${escapeHtml(mmToHHMM(s.end))}</td>
        <td class="td">${escapeHtml(s.label || "Stunde")}</td>
        <td class="td"></td>
      `;
      const td = tr.querySelectorAll("td")[2];
      const inp = document.createElement("input");
      inp.className = "input";
      inp.type = "text";
      inp.placeholder = "Standard-Text…";
      inp.value = (template.templateNotes?.[activeDay]?.[s.slotIndex] ?? "");
      inp.addEventListener("change", ()=>{
        if(!template.templateNotes[activeDay]) template.templateNotes[activeDay] = {};
        template.templateNotes[activeDay][s.slotIndex] = inp.value;
      });
      td.appendChild(inp);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    box.appendChild(table);

    const hint = document.createElement("div");
    hint.className = "small";
    hint.style.marginTop = "10px";
    hint.textContent = 'Hinweis: Standard-Texte werden neuen Personen sofort zugewiesen. Für bestehende Personen kannst du in "Raster bearbeiten" Standard anwenden.';
    tplNotes.appendChild(hint);
  }

  tplStart.addEventListener("change", ()=>{
    template.startTime = tplStart.value || "08:00";
    renderSlots();
  });

  btnAddLesson.addEventListener("click", ()=>{
    template.slots.push({ type:"lesson", duration:45, label:`Stunde ${template.slots.filter(s=>s.type==="lesson").length+1}` });
    renderSlots();
    renderNotes();
  });

  btnAddBreak.addEventListener("click", ()=>{
    template.slots.push({ type:"break", duration:10, label:"Pause" });
    renderSlots();
    renderNotes();
  });

  renderSlots();
  renderNotes();

  const foot = document.createElement("div");

  const cancel = document.createElement("button");
  cancel.className = "btn btn-ghost";
  cancel.textContent = "Abbrechen";
  cancel.addEventListener("click", closeModal);

  const save = document.createElement("button");
  save.className = "btn";
  save.textContent = "Speichern";
  save.addEventListener("click", ()=>{
    state.template = template;
    log("edit_template", { startTime: template.startTime, slots: template.slots });
    state.people.forEach(p=>{
      ensurePersonScheduleFromTemplate(p);
      for(const dk of DAY_KEYS){
        const notes = p.schedule[dk].notes || {};
        const newNotes = {};
        Object.entries(notes).forEach(([k,v])=>{
          const i = Number(k);
          if(i >= 0 && i < state.template.slots.length) newNotes[i]=v;
        });
        p.schedule[dk].notes = newNotes;
      }
    });
    saveState();
    closeModal();
    render();
    toast("Standardraster gespeichert.");
  });

  foot.appendChild(cancel);
  foot.appendChild(save);

  openModal("Standardraster bearbeiten", body, foot);
}

function render(){
  applyColorVars();
  renderDatetime();
  renderNameList();
  renderDashboard();
  renderAbsentView();
  renderEditView();
  renderLogView();
}

// ===== DASHBOARD VIEW =====
function renderDashboard(){
  if(!ui.viewDashboard) return;
  ui.viewDashboard.innerHTML = "";
  
  const dk = getDayKeyForDate(selectedDate);
  const dateK = dateKey(selectedDate);
  const timeline = computeTimeline(state.template);
  const lessonSlots = timeline.filter(s => s.type === "lesson");
  
  // Calculate statistics for the selected date
  const absentPeople = state.people.filter(p => getCurrentMark(p.id) === "absent");
  const availablePeople = state.people.filter(p => getCurrentMark(p.id) === "available");
  const unmarkedPeople = state.people.filter(p => !getCurrentMark(p.id));
  
  // Count unassigned slots
  let unassignedCount = 0;
  let assignedCount = 0;
  
  if(dk){
    for(const absent of absentPeople){
      for(const slot of lessonSlots){
        if(!isSlotActive(absent, dk, slot.slotIndex)) continue;
        
        const assignedId = (((state.substitutions[dateK]||{})[absent.id]||{})[dk]||{})[slot.slotIndex];
        if(assignedId) assignedCount++;
        else unassignedCount++;
      }
    }
    
    // "Kind da" but not active: shown in Absent view for info,
    // but NOT counted as unassigned in dashboard
    
    // Also count permanent assignments where assigned person is absent
    for(const person of state.people){
      if(!person.permanentAssignments) continue;
      for(const slot of lessonSlots){
        const key = `${dk}_${slot.slotIndex}`;
        const assignedId = person.permanentAssignments[key];
        if(assignedId && getCurrentMark(assignedId) === "absent"){
          const dailySub = (((state.substitutions[dateK]||{})[assignedId]||{})[dk]||{})[slot.slotIndex];
          if(!dailySub){
            unassignedCount++;
          }
        }
      }
    }
  }
  
  const wrap = document.createElement("div");
  wrap.className = "dashboard-grid";
  
  // Stats cards
  wrap.innerHTML = `
    <div class="dash-card dash-card-bad">
      <div class="dash-number">${absentPeople.length}</div>
      <div class="dash-label">Abwesend ${dk ? DAYS[DAY_KEYS.indexOf(dk)] : "heute"}</div>
      <div class="dash-names">${absentPeople.sort((a,b) => a.name.localeCompare(b.name, "de")).map(p => escapeHtml(p.name)).join(", ") || "—"}</div>
    </div>
    <div class="dash-card dash-card-good">
      <div class="dash-number">${availablePeople.length}</div>
      <div class="dash-label">Verfügbar</div>
      <div class="dash-names">${availablePeople.sort((a,b) => a.name.localeCompare(b.name, "de")).map(p => escapeHtml(p.name)).join(", ") || "—"}</div>
    </div>
    <div class="dash-card ${unassignedCount > 0 ? 'dash-card-warning' : 'dash-card-ok'}">
      <div class="dash-number">${unassignedCount}</div>
      <div class="dash-label">Stunden unbesetzt</div>
      <div class="dash-sub">${assignedCount} von ${assignedCount + unassignedCount} zugewiesen</div>
    </div>
    <div class="dash-card">
      <div class="dash-number">${state.people.length}</div>
      <div class="dash-label">Schulbegleiter total</div>
      <div class="dash-sub">${unmarkedPeople.length} ohne Markierung</div>
    </div>
  `;
  
  ui.viewDashboard.appendChild(wrap);
  
  // Quick actions
  if(unassignedCount > 0 && dk){
    const alert = document.createElement("div");
    alert.className = "dash-alert";
    alert.innerHTML = `
      <div class="dash-alert-icon">⚠️</div>
      <div class="dash-alert-text">
        <strong>${unassignedCount} Stunde${unassignedCount > 1 ? 'n' : ''} noch ohne Vertretung!</strong><br>
        <span class="small">Wechsle zu "Abwesende" um Vertretungen zuzuweisen.</span>
      </div>
      <button class="btn btn-bad" id="dashGoToAbsent">Jetzt zuweisen →</button>
    `;
    ui.viewDashboard.appendChild(alert);
    
    document.getElementById("dashGoToAbsent")?.addEventListener("click", () => setTab(ui.tabAbsent));
  }
  
  // Today's schedule overview
  if(dk && absentPeople.length > 0){
    const overview = document.createElement("div");
    overview.className = "card";
    overview.innerHTML = `<div class="card-head"><div class="card-title">Vertretungen für ${DAYS[DAY_KEYS.indexOf(dk)]}</div></div>`;
    
    const table = document.createElement("table");
    table.className = "table";
    let rows = "<tbody>";
    
    for(const slot of lessonSlots){
      const assignments = [];
      for(const absent of absentPeople){
        if(!isSlotActive(absent, dk, slot.slotIndex)) continue;
        
        const assignedId = (((state.substitutions[dateK]||{})[absent.id]||{})[dk]||{})[slot.slotIndex];
        const assigned = assignedId ? findPerson(assignedId) : null;
        if(assigned){
          assignments.push(`<span class="dash-assign">${escapeHtml(assigned.name)} <span class="small">→ ${escapeHtml(absent.name)}</span></span>`);
        } else {
          assignments.push(`<span class="dash-unassigned">⚠️ ${escapeHtml(absent.name)} unbesetzt</span>`);
        }
      }
      
      if(assignments.length > 0){
        rows += `<tr class="tr"><td class="td" style="font-weight:900">${mmToHHMM(slot.start)}–${mmToHHMM(slot.end)}</td>`;
        rows += `<td class="td">${assignments.join("<br>")}</td></tr>`;
      }
    }
    
    rows += "</tbody>";
    table.innerHTML = rows;
    overview.appendChild(table);
    ui.viewDashboard.appendChild(overview);
  }
}

// ===== PRINT FUNCTION =====
function printSubstitutionPlan(){
  const dk = getDayKeyForDate(selectedDate);
  const dateK = dateKey(selectedDate);
  
  if(!dk){
    toast("Drucken nur für Wochentage möglich.");
    return;
  }
  
  const absentPeople = state.people.filter(p => getCurrentMark(p.id) === "absent");
  if(absentPeople.length === 0){
    toast("Keine abwesenden Personen zum Drucken.");
    return;
  }
  
  const timeline = computeTimeline(state.template);
  const lessonSlots = timeline.filter(s => s.type === "lesson");
  
  let html = `
    <div class="print-header">Vertretungsplan – Schulbegleitung</div>
    <div class="print-date">${DAYS[DAY_KEYS.indexOf(dk)]}, ${new Date(selectedDate).toLocaleDateString("de-DE", {day: "2-digit", month: "2-digit", year: "numeric"})}</div>
    <table>
      <thead>
        <tr>
          <th>Zeit</th>
          <th>Stunde</th>
          <th>Abwesend</th>
          <th>Vertretung</th>
          <th>Notiz</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  for(const slot of lessonSlots){
    for(const absent of absentPeople){
      if(!isSlotActive(absent, dk, slot.slotIndex)) continue;
      
      const assignedId = (((state.substitutions[dateK]||{})[absent.id]||{})[dk]||{})[slot.slotIndex];
      const assigned = assignedId ? findPerson(assignedId) : null;
      const note = absent.schedule?.[dk]?.notes?.[slot.slotIndex] || "";
      
      html += `
        <tr>
          <td>${mmToHHMM(slot.start)}–${mmToHHMM(slot.end)}</td>
          <td>${escapeHtml(slot.label)}</td>
          <td>${escapeHtml(absent.name)}</td>
          <td class="${!assigned ? 'warning' : ''}">${assigned ? escapeHtml(assigned.name) : '⚠️ UNBESETZT'}</td>
          <td>${escapeHtml(note)}</td>
        </tr>
      `;
    }
  }
  
  html += `</tbody></table>`;
  
  ui.printArea.innerHTML = html;
  ui.printArea.style.display = "block";
  
  window.print();
  
  setTimeout(() => {
    ui.printArea.style.display = "none";
  }, 1000);
}

// --- events
ui.btnAdd.addEventListener("click", openAddPersonModal);
ui.btnRemove.addEventListener("click", removeSelectedPerson);
ui.btnMarkAvailable.addEventListener("click", ()=>markSelected("available"));
ui.btnMarkAbsent.addEventListener("click", ()=>markSelected("absent"));
ui.btnClearMark.addEventListener("click", clearMarkSelected);
ui.btnResetAllMarks.addEventListener("click", resetAllMarks);
ui.btnPrint?.addEventListener("click", printSubstitutionPlan);
ui.btnOptions.addEventListener("click", openOptionsModal);
ui.btnEditStandard.addEventListener("click", openEditTemplateModal);
ui.filterUnassigned?.addEventListener("change", render);

ui.searchNames.addEventListener("input", renderNameList);

ui.datePicker.addEventListener("change", ()=>{
  selectedDate = new Date(ui.datePicker.value + "T00:00:00");
  log("change_date", { date: dateKey(selectedDate) });
  saveState();
  render();
});

// Keyboard shortcuts
document.addEventListener("keydown", (e)=>{
  if(!ui.modal.classList.contains("hidden")) return;
  const list = filteredPeople();
  if(list.length===0) return;

  const idx = Math.max(0, list.findIndex(p=>p.id===state.selectedPersonId));
  if(e.key==="ArrowDown"){
    e.preventDefault();
    const next = list[Math.min(list.length-1, idx+1)];
    setSelectedPerson(next.id);
  }
  if(e.key==="ArrowUp"){
    e.preventDefault();
    const prev = list[Math.max(0, idx-1)];
    setSelectedPerson(prev.id);
  }
  if(e.key.toLowerCase()==="v"){
    markSelected("available");
  }
  if(e.key.toLowerCase()==="a"){
    markSelected("absent");
  }
  if(e.key.toLowerCase()==="u"){
    clearMarkSelected();
  }
});

// clock tick
setInterval(renderDatetime, 1000);

// initial
if(!state.selectedPersonId && state.people[0]) state.selectedPersonId = state.people[0].id;
render();

// Register service worker for offline usage
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}

(function () {
"use strict";
const CFG = window.M2_CONFIG || {};
const API_OK = /^https:\/\//.test(CFG.API_URL || "");
const LOOPS = ["UK 1-9", "UK 10-18", "US 1-9", "US 10-18"];
const COMBOS = [["UK 1-9", "UK 10-18"], ["US 1-9", "US 10-18"], ["UK 1-9", "US 1-9"], ["UK 1-9", "US 10-18"], ["UK 10-18", "US 1-9"], ["UK 10-18", "US 10-18"]];
const SC9 = ["1 up", "2 up", "2&1", "3&1", "3&2", "4&2", "4&3", "5&3", "5&4"];
const SC18 = SC9.concat(["6&4", "6&5", "7&5", "7&6", "8&6", "9&7", "10&8"]);
const DEADLINE = "2027-04-11";
const FALLBACK = [["mikael", "Mikael"], ["denis", "Denis"], ["dennis", "Dennis"], ["david", "David"], ["borja", "Borja"], ["mathieu", "Mathieu"], ["jeremy", "Jeremy"], ["maxl", "Maxime L."], ["maxt", "Maxime T."], ["marc", "Marc"], ["alex", "Alex"], ["dider", "Didier"], ["andre", "André"], ["yves", "Yves"]].map(p => ({ id: p[0], name: p[1] }));

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = n => String(n).padStart(2, "0");
const keyOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parse = s => { const [a, b, c] = s.split("-").map(Number); return new Date(a, b - 1, c, 12); };
const fmtDay = s => s ? new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(parse(s)) : "";
const fmtShort = s => s ? new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "short" }).format(parse(s)) : "";
const fmtWhen = iso => { try { return new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return ""; } };
const hh = t => t ? t.replace(":", "h") : "";
const pts = v => { const w = Math.floor(v), h = v - w > 0; return (w || !h ? String(w) : "") + (h ? "½" : ""); };
const uid = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const comboLabel = l => l.length === 2 && l[0] === "UK 1-9" && l[1] === "UK 10-18" ? "UK 1-18 complet" : l.length === 2 && l[0] === "US 1-9" && l[1] === "US 10-18" ? "US 1-18 complet" : l.join(" + ");

const S = {
  player: null, code: null, name: "", players: FALLBACK, pmap: {},
  server: { matches: [], events: [], log: [] }, queue: [], errors: [],
  editMatch: null, editEvent: null, selected: "", busy: false, offline: false, lastSync: 0, loaded: false
};
function setPlayers(list) { S.players = list && list.length ? list : FALLBACK; S.pmap = {}; S.players.forEach(p => S.pmap[p.id] = p.name); }
const nameOf = id => S.pmap[id] || (id === "import" ? "Import initial" : id) || "Quelqu'un";

/* ---------- réseau ---------- */
async function api(action, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(CFG.API_URL, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, signal: ctl.signal,
      body: JSON.stringify(Object.assign({ action, player: S.player, code: S.code }, body || {}))
    });
    return await r.json();
  } finally { clearTimeout(t); }
}
function applyServer(r) {
  S.server = { matches: r.matches || [], events: r.events || [], log: r.log || [] };
  setPlayers(r.players);
  if (r.me) S.name = r.me.name;
  S.lastSync = Date.now(); S.offline = false;
  ls.set("m2_cache", { server: S.server, players: S.players, name: S.name, ts: S.lastSync });
}

/* ---------- file d'attente : saisies visibles tout de suite, envoyées dès que possible ---------- */
function saveQueue() { ls.set("m2_queue", S.queue); }
function enqueue(action, payload) {
  S.queue.push({ qid: uid(), player: S.player, action, payload });
  saveQueue(); renderAll(); flush();
}
function view() {
  const v = { matches: S.server.matches.map(m => Object.assign({}, m)), events: S.server.events.map(e => Object.assign({}, e)) };
  const now = new Date().toISOString();
  for (const q of S.queue) {
    const p = q.payload;
    if (q.action === "addMatch") { if (!v.matches.some(m => m.id === p.id)) v.matches.push(Object.assign({}, p, { by: S.player, at: now, _pending: true })); }
    else if (q.action === "updateMatch") { const i = v.matches.findIndex(m => m.id === p.id); if (i >= 0) v.matches[i] = Object.assign({}, v.matches[i], p, { uby: S.player, uat: now, _pending: true }); }
    else if (q.action === "deleteMatch") v.matches = v.matches.filter(m => m.id !== p.id);
    else if (q.action === "addEvent") { if (!v.events.some(e => e.id === p.id)) v.events.push(Object.assign({}, p, { by: S.player, at: now, _pending: true })); }
    else if (q.action === "updateEvent") { const i = v.events.findIndex(e => e.id === p.id); if (i >= 0) v.events[i] = Object.assign({}, v.events[i], p, { uby: S.player, uat: now, _pending: true }); }
    else if (q.action === "deleteEvent") v.events = v.events.filter(e => e.id !== p.id);
  }
  return v;
}
async function flush() {
  if (S.busy || !S.player || !API_OK) return;
  S.busy = true; renderStatus();
  let fetched = false;
  try {
    while (S.queue.length) {
      const q = S.queue[0]; let r;
      try { r = await api(q.action, q.payload); } catch (e) { S.offline = true; break; }
      if (r.ok) { S.queue.shift(); saveQueue(); applyServer(r); fetched = true; }
      else if (r.code === "auth" || r.code === "locked") { forceLogout(r.error); return; }
      else { S.queue.shift(); saveQueue(); S.errors.push(r.error || "Une modification a été refusée."); }
    }
    if (!S.queue.length && !S.offline && !fetched) {
      try { const r = await api("state"); if (r.ok) applyServer(r); else if (r.code === "auth" || r.code === "locked") { forceLogout(r.error); return; } }
      catch (e) { S.offline = true; }
    }
  } finally { S.busy = false; renderAll(); }
}

/* ---------- connexion ---------- */
function showLogin(msg) {
  $("#appView").hidden = true; $("#loginView").hidden = false;
  $("#lmsg").textContent = msg || ""; $("#lmsg").className = "msg" + (msg ? " err" : "");
  fillPlayers();
  if (!API_OK) { $("#lmsg").textContent = "L'application n'est pas encore reliée à la feuille Google (voir config.js)."; $("#lmsg").className = "msg err"; $("#lbtn").disabled = true; return; }
  api("players").then(r => { if (r.ok) { setPlayers(r.players); fillPlayers(); } }).catch(() => {});
}
function showApp() { $("#loginView").hidden = true; $("#appView").hidden = false; fillPlayers(); renderAll(); }
function forceLogout(msg) {
  ls.del("m2_auth"); ls.del("m2_cache");
  S.player = null; S.code = null; S.server = { matches: [], events: [], log: [] };
  S.busy = false; showLogin(msg || "Votre code n'est plus valide. Reconnectez-vous.");
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const player = $("#lplayer").value, code = $("#lcode").value.trim();
  $("#lbtn").disabled = true; $("#lmsg").textContent = "Connexion…"; $("#lmsg").className = "msg";
  S.player = player; S.code = code;
  try {
    const r = await api("state");
    if (r.ok) {
      ls.set("m2_auth", { player, code });
      const dropped = S.queue.filter(q => q.player !== player).length;
      S.queue = S.queue.filter(q => q.player === player); saveQueue();
      if (dropped) S.errors.push(dropped + " modification(s) en attente d'un autre joueur ont été abandonnées.");
      applyServer(r); $("#lcode").value = ""; showApp(); flush();
    } else { S.player = null; S.code = null; $("#lmsg").textContent = r.error || "Connexion refusée."; $("#lmsg").className = "msg err"; }
  } catch (err) { S.player = null; S.code = null; $("#lmsg").textContent = "Pas de connexion. Réessayez avec du réseau."; $("#lmsg").className = "msg err"; }
  $("#lbtn").disabled = false;
});
$("#logoutBtn").addEventListener("click", () => {
  if (S.queue.length) { S.errors.push("Des modifications sont en attente d'envoi. Attendez qu'elles soient envoyées avant de changer de joueur."); renderNotices(); return; }
  ls.del("m2_auth"); ls.del("m2_cache"); S.player = null; S.code = null; showLogin();
});
$("#refreshBtn").addEventListener("click", () => flush());

/* ---------- calculs ---------- */
function compute(matches) {
  const T = S.players.map(p => ({ id: p.id, name: p.name, p: 0, w: 0, h: 0, l: 0, pts: 0, opp: {} }));
  const by = {}; T.forEach(s => by[s.id] = s);
  for (const m of matches) {
    const A = by[m.a], B = by[m.b]; if (!A || !B) continue;
    const u = m.n / 9;
    const pa = m.w === "h" ? u / 2 : m.w === "a" ? u : 0, pb = m.w === "h" ? u / 2 : m.w === "b" ? u : 0;
    const ta = m.w === "h" ? "h" : m.w === "a" ? "w" : "l", tb = m.w === "h" ? "h" : m.w === "b" ? "w" : "l";
    [[A, m.b, pa, ta], [B, m.a, pb, tb]].forEach(([s, o, pp, t]) => { s.p++; s[t]++; s.pts += pp; (s.opp[o] = s.opp[o] || []).push({ t, pts: pp, units: u, m }); });
  }
  const groups = {}; T.forEach(s => (groups[s.pts] = groups[s.pts] || []).push(s));
  Object.values(groups).forEach(g => {
    const ids = new Set(g.map(s => s.id));
    g.forEach(s => { s.h2h = 0; for (const o in s.opp) if (ids.has(o)) s.opp[o].forEach(x => s.h2h += x.pts); });
  });
  const ranked = T.slice().sort((a, b) => b.pts - a.pts || b.h2h - a.h2h || b.w - a.w || a.name.localeCompare(b.name, "fr"));
  let rk = 0; ranked.forEach((s, k) => { const q = ranked[k - 1]; if (k === 0 || s.pts !== q.pts || s.h2h !== q.h2h || s.w !== q.w) rk = k + 1; s.rank = rk; });
  return { T, by, ranked };
}
function pairUnits(matches, a, b, exceptId) {
  return matches.reduce((u, m) => u + (m.id !== exceptId && ((m.a === a && m.b === b) || (m.a === b && m.b === a)) ? m.n / 9 : 0), 0);
}
const resultText = m => m.w === "h" ? "égalité" : nameOf(m.w === "a" ? m.a : m.b) + " gagne " + m.s;

/* ---------- affichage ---------- */
let C = null, V = null;
function renderAll() {
  if ($("#appView").hidden) return;
  V = view(); C = compute(V.matches);
  $("#meName").textContent = S.name || nameOf(S.player);
  renderStatus(); renderNotices(); renderStats(); renderTable(); renderFiche(); renderGrid(); renderResults(); renderLoops(); renderEvents(); renderHistory();
}
function renderStatus() {
  const el = $("#sync"); if (!el) return;
  el.textContent = S.busy ? "Synchronisation…" : S.offline ? "Hors connexion" : S.lastSync ? "À jour à " + new Date(S.lastSync).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" }) : "";
}
function renderNotices() {
  let h = "";
  if (S.queue.length) h += `<div class="notice"><span>${S.queue.length} modification${S.queue.length > 1 ? "s" : ""} en attente d'envoi${S.offline ? " (pas de réseau)" : ""}.</span><button class="link" data-retry type="button">Réessayer</button></div>`;
  S.errors.forEach((t, i) => h += `<div class="notice err"><span>${esc(t)}</span><button class="link" data-dismiss="${i}" type="button">Fermer</button></div>`);
  $("#notices").innerHTML = h;
}
function renderStats() {
  const ms = V.matches, played = ms.length;
  const pairs = new Set(ms.map(m => [m.a, m.b].sort().join("|"))).size, total = S.players.length * (S.players.length - 1) / 2;
  const n18 = ms.filter(m => m.n === 18).length, n9 = played - n18;
  const left = Math.max(0, Math.round((parse(DEADLINE) - parse(keyOf(new Date()))) / 864e5));
  const lead = C.ranked[0];
  $("#stats").innerHTML =
    `<div class="stat"><b>${pairs} / ${total}</b><span>paires qui ont joué (${played} match${played > 1 ? "s" : ""})</span><div class="bar"><i style="width:${(pairs / total * 100).toFixed(1)}%"></i></div></div>
     <div class="stat"><b>${left}</b><span>jours avant le 11 avril 2027</span></div>
     <div class="stat"><b>${n9} / ${n18}</b><span>matchs de 9 trous / de 18 trous</span></div>
     <div class="stat"><b>${lead && lead.p ? esc(lead.name) : "–"}</b><span>${lead && lead.p ? "en tête avec " + pts(lead.pts) + " pt" + (lead.pts > 1 ? "s" : "") : "aucun match joué pour l'instant"}</span></div>`;
}
function renderTable() {
  let h = `<thead><tr><th>#</th><th class="name">Joueur</th><th title="Matchs joués">J</th><th title="Victoires">V</th><th title="Égalités">AS</th><th title="Défaites">D</th><th>Pts</th><th title="Adversaires rencontrés">Adv.</th></tr></thead><tbody>`;
  C.ranked.forEach(s => {
    h += `<tr class="${s.p && s.rank === 1 ? "lead" : ""}"><td class="rank">${s.p ? s.rank : "–"}</td><td class="name"><button data-pick="${esc(s.id)}">${esc(s.name)}</button></td><td>${s.p}</td><td>${s.w}</td><td>${s.h}</td><td>${s.l}</td><td class="tot">${pts(s.pts)}</td><td>${Object.keys(s.opp).length} / ${S.players.length - 1}</td></tr>`;
  });
  $("#table").innerHTML = h + "</tbody>";
  const last = V.matches.map(m => m.d).sort().pop();
  $("#upd").textContent = last ? "dernier match le " + fmtShort(last) : "";
}
function renderFiche() {
  const box = $("#fiche-body");
  if (!S.selected || !C.by[S.selected]) { box.innerHTML = '<p class="muted">Choisissez un joueur pour voir ses matchs et ses adversaires restants.</p>'; return; }
  const s = C.by[S.selected];
  const done = []; for (const o in s.opp) s.opp[o].forEach(x => done.push([o, x]));
  done.sort((a, b) => (b[1].m.d || "").localeCompare(a[1].m.d || ""));
  const others = S.players.filter(p => p.id !== S.selected).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const never = others.filter(p => !s.opp[p.id]);
  const again = others.filter(p => s.opp[p.id] && s.opp[p.id].reduce((u, x) => u + x.units, 0) < 2);
  box.innerHTML = `<div class="fiche">
    <div><h3>Matchs joués (${s.p}) · ${pts(s.pts)} pt${s.pts > 1 ? "s" : ""}</h3><div class="chips">${done.length ? done.map(([o, x]) => `<span class="chip ${x.t}">${esc(nameOf(o))} · ${x.t === "h" ? "AS" : (x.t === "w" ? "gagné " : "perdu ") + esc(x.m.s)} · ${x.m.n} trous</span>`).join("") : '<span class="muted">Aucun match pour l\'instant.</span>'}</div></div>
    <div><h3>Pas encore rencontrés (${never.length})</h3><div class="chips">${never.length ? never.map(p => `<span class="chip">${esc(p.name)}</span>`).join("") : '<span class="muted">Tous les adversaires ont été rencontrés.</span>'}</div>
    ${again.length ? `<h3 style="margin-top:14px">Un second match de 9 trous possible (${again.length})</h3><div class="chips">${again.map(p => `<span class="chip">${esc(p.name)}</span>`).join("")}</div>` : ""}</div></div>`;
}
function sortedPlayers() { return S.players.slice().sort((a, b) => a.name.localeCompare(b.name, "fr")); }
function renderGrid() {
  const P = sortedPlayers();
  let h = `<thead><tr><th></th>${P.map(p => `<th class="v"><span>${esc(p.name)}</span></th>`).join("")}</tr></thead><tbody>`;
  P.forEach(r => {
    const s = C.by[r.id];
    h += `<tr><td class="name">${esc(r.name)}</td>`;
    P.forEach(c => {
      if (c.id === r.id) { h += '<td class="self"></td>'; return; }
      const xs = s && s.opp[c.id];
      if (!xs) { h += "<td></td>"; return; }
      const got = xs.reduce((u, x) => u + x.pts, 0), units = xs.reduce((u, x) => u + x.units, 0);
      const cls = got * 2 > units ? "w" : got * 2 < units ? "l" : "h";
      h += `<td class="${cls}" title="${esc(xs.map(x => resultText(x.m) + " · " + x.m.n + " trous").join(" | "))}">${pts(got)}</td>`;
    });
    h += "</tr>";
  });
  $("#grid").innerHTML = h + "</tbody>";
}
function renderResults() {
  const list = V.matches.slice().sort((a, b) => (b.d || "").localeCompare(a.d || "") || String(b.at).localeCompare(String(a.at)));
  $("#rcount").textContent = list.length ? list.length + " match" + (list.length > 1 ? "s" : "") : "";
  if (!list.length) { $("#results").innerHTML = '<li style="display:block"><div class="empty">Aucun résultat enregistré. Le premier match apparaîtra ici dès qu\'il sera saisi.</div></li>'; return; }
  $("#results").innerHTML = list.map(m => {
    const who = m.w === "h" ? `<b>${esc(nameOf(m.a))}</b> – <b>${esc(nameOf(m.b))}</b>` : `<b>${esc(nameOf(m.w === "a" ? m.a : m.b))}</b> bat ${esc(nameOf(m.w === "a" ? m.b : m.a))}`;
    const by = m.by ? `saisi par ${esc(nameOf(m.by))}${m.at ? " le " + esc(fmtWhen(m.at)) : ""}` : "";
    const up = m.uby ? ` · modifié par ${esc(nameOf(m.uby))} le ${esc(fmtWhen(m.uat))}` : "";
    return `<li><span class="d">${esc(fmtShort(m.d))}</span><span>${who}</span><span class="s">${m.w === "h" ? "AS" : esc(m.s)}</span>
      <span class="meta">${m.n} trous · ${esc(comboLabel(m.loops))} · ${by}${up}${m._pending ? ' <span class="pend">en attente</span>' : ""}
      <button class="sm" data-medit="${esc(m.id)}" type="button">Modifier</button><button class="sm del" data-mdel="${esc(m.id)}" type="button">Supprimer</button></span></li>`;
  }).join("");
}
function renderLoops() {
  const cnt = {}; LOOPS.forEach(l => cnt[l] = 0);
  V.matches.forEach(m => (m.loops || []).forEach(l => { if (l in cnt) cnt[l]++; }));
  const max = Math.max(1, ...Object.values(cnt));
  $("#loops").innerHTML = LOOPS.map(l => `<div class="loop"><b>${l}</b><div class="track"><i style="width:${(cnt[l] / max * 100).toFixed(1)}%;background:var(${l.startsWith("UK") ? "--uk" : "--us"})"></i></div><span class="n">${cnt[l]}</span></div>`).join("");
}

/* ---------- calendrier : liens Google, Outlook, Apple ---------- */
function brusselsUTC(d, t) {
  const [y, mo, da] = d.split("-").map(Number), [h, mi] = t.split(":").map(Number);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const want = Date.UTC(y, mo - 1, da, h, mi); let g = want;
  for (let k = 0; k < 2; k++) {
    const p = {}; f.formatToParts(new Date(g)).forEach(x => p[x.type] = x.value);
    g -= Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - want;
  }
  return new Date(g);
}
const stamp = dt => dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const d8 = s => s.replace(/-/g, "");
function nextDay(s) { const [y, m, d] = s.split("-").map(Number); const n = new Date(Date.UTC(y, m - 1, d + 1)); return n.getUTCFullYear() + "-" + pad(n.getUTCMonth() + 1) + "-" + pad(n.getUTCDate()); }
function evTimes(e) {
  if (e.t) { const s = brusselsUTC(e.d, e.t), en = new Date(s.getTime() + (e.dur || 60) * 6e4); return { s, en }; }
  return null;
}
function icsEsc(t) { return String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function buildIcs(e) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//M2 2027//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", "UID:" + e.id + "@m2-2027", "DTSTAMP:" + stamp(new Date())];
  const tm = evTimes(e);
  if (tm) { L.push("DTSTART:" + stamp(tm.s), "DTEND:" + stamp(tm.en)); }
  else { L.push("DTSTART;VALUE=DATE:" + d8(e.d), "DTEND;VALUE=DATE:" + d8(nextDay(e.d))); }
  L.push("SUMMARY:" + icsEsc(e.title));
  if (e.place) L.push("LOCATION:" + icsEsc(e.place));
  if (e.note) L.push("DESCRIPTION:" + icsEsc(e.note));
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}
function calLinks(e) {
  const tm = evTimes(e);
  const g = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(e.title) +
    "&dates=" + (tm ? stamp(tm.s) + "/" + stamp(tm.en) : d8(e.d) + "/" + d8(nextDay(e.d))) +
    "&details=" + encodeURIComponent(e.note || "") + "&location=" + encodeURIComponent(e.place || "");
  const o = "https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=" + encodeURIComponent(e.title) +
    (tm ? "&startdt=" + encodeURIComponent(tm.s.toISOString()) + "&enddt=" + encodeURIComponent(tm.en.toISOString()) : "&allday=true&startdt=" + e.d + "&enddt=" + nextDay(e.d)) +
    "&body=" + encodeURIComponent(e.note || "") + "&location=" + encodeURIComponent(e.place || "");
  const a = "data:text/calendar;charset=utf-8," + encodeURIComponent(buildIcs(e));
  const slug = (e.title || "evenement").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "evenement";
  return `<a href="${esc(g)}" target="_blank" rel="noopener">Google Agenda</a><a href="${esc(o)}" target="_blank" rel="noopener">Outlook</a><a href="${a}" download="${slug}.ics">Apple Calendar</a>`;
}
function renderEvents() {
  const today = keyOf(new Date());
  const list = V.events.slice().sort((a, b) => (a.d + (a.t || "")).localeCompare(b.d + (b.t || "")));
  const up = list.filter(e => e.d >= today), past = list.filter(e => e.d < today).reverse();
  const nextId = up[0] && up[0].id;
  const card = (e, isPast) => {
    const by = e.by ? `Ajouté par ${esc(nameOf(e.by))}${e.uby ? " · modifié par " + esc(nameOf(e.uby)) : ""}` : "";
    return `<div class="ev ${isPast ? "past" : ""} ${e.id === nextId ? "next" : ""}">
      <b>${esc(e.title)}</b><span class="w">${esc(fmtDay(e.d))}${e.t ? " · " + esc(hh(e.t)) : " · toute la journée"}</span>
      ${e.place ? `<span class="m">${esc(e.place)}</span>` : ""}${e.note ? `<span class="m">${esc(e.note)}</span>` : ""}
      ${isPast ? "" : `<span class="acts">${calLinks(e)}</span>`}
      <span class="acts"><button class="sm" data-eedit="${esc(e.id)}" type="button">Modifier</button><button class="sm del" data-edel="${esc(e.id)}" type="button">Supprimer</button>${e._pending ? '<span class="pend">en attente</span>' : ""}</span>
      <span class="by">${by}</span></div>`;
  };
  $("#events").innerHTML = list.length
    ? `<div class="evs">${up.map(e => card(e, false)).join("")}${past.map(e => card(e, true)).join("")}</div>`
    : '<div class="empty">Aucun événement pour l\'instant. Ajoutez le premier ci-dessous : entraînement avec Florian, match d\'équipe, repas…</div>';
}

/* ---------- historique ---------- */
const MLAB = { d: "date", a: "joueur 1", b: "joueur 2", w: "résultat", s: "score", n: "format", loops: "terrain" };
const ELAB = { d: "date", t: "heure", dur: "durée", title: "titre", place: "lieu", note: "précision" };
function mval(k, m) { return k === "d" ? fmtShort(m.d) : k === "a" || k === "b" ? nameOf(m[k]) : k === "w" ? resultText(m) : k === "n" ? m.n + " trous" : k === "loops" ? comboLabel(m.loops) : String(m[k]); }
function eval_(k, e) { return k === "d" ? fmtShort(e.d) : k === "t" ? (e.t ? hh(e.t) : "toute la journée") : k === "dur" ? e.dur + " min" : (e[k] || "–"); }
function descM(m) { return nameOf(m.a) + " – " + nameOf(m.b) + " (" + resultText(m) + ", " + m.n + " trous)"; }
function descE(e) { return "« " + e.title + " » le " + fmtShort(e.d) + (e.t ? " à " + hh(e.t) : ""); }
function renderHistory() {
  const log = S.server.log.slice(0, 100);
  if (!log.length) { $("#history").innerHTML = '<li style="display:block"><div class="empty">Aucune modification enregistrée pour l\'instant.</div></li>'; return; }
  $("#history").innerHTML = log.map(l => {
    const d = l.details || {}, isM = l.type === "match";
    const verb = l.action === "add" ? "a ajouté" : l.action === "update" ? "a modifié" : "a supprimé";
    const noun = isM ? "le match" : "l'événement";
    const subject = (d.after || d.before) ? (isM ? descM(d.after || d.before) : descE(d.after || d.before)) : "";
    let chg = "";
    if (l.action === "update" && d.before && d.after) {
      const keys = Object.keys(isM ? MLAB : ELAB), lab = isM ? MLAB : ELAB;
      const parts = keys.map(k => {
        const a = isM ? mval(k, d.before) : eval_(k, d.before), b = isM ? mval(k, d.after) : eval_(k, d.after);
        return a !== b ? `${lab[k]} : ${esc(a)} → ${esc(b)}` : "";
      }).filter(Boolean);
      if (parts.length) chg = `<span class="chg">${parts.join(" · ")}</span>`;
    }
    return `<li><span class="when">${esc(fmtWhen(l.when))}</span><span class="what"><b>${esc(nameOf(l.who))}</b> ${verb} ${noun} ${esc(subject)}${chg}</span></li>`;
  }).join("");
}

/* ---------- formulaires ---------- */
function fillPlayers() {
  const P = sortedPlayers();
  const opts = P.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  const keep = id => { const v = $(id).value; return v; };
  const vals = { fa: keep("#fa"), fb: keep("#fb"), pick: keep("#pick"), l: keep("#lplayer") };
  $("#fa").innerHTML = '<option value="">Choisir…</option>' + opts;
  $("#fb").innerHTML = '<option value="">Choisir…</option>' + opts;
  $("#pick").innerHTML = '<option value="">Choisir…</option>' + opts;
  $("#lplayer").innerHTML = '<option value="">Choisir…</option>' + opts;
  $("#fa").value = vals.fa || (S.player || ""); $("#fb").value = vals.fb; $("#pick").value = S.selected || vals.pick; $("#lplayer").value = vals.l;
  refreshResult();
}
function refreshResult() {
  const a = $("#fa").value, b = $("#fb").value, prev = $("#fres").value || "a";
  $("#fres").innerHTML = `<option value="a">${esc(S.pmap[a] || "Joueur 1")} gagne</option><option value="b">${esc(S.pmap[b] || "Joueur 2")} gagne</option><option value="h">Égalité (AS)</option>`;
  $("#fres").value = prev; $("#scorewrap").hidden = $("#fres").value === "h";
}
function refreshFormat() {
  const n = +$("#ffmt").value, prevScore = $("#fscore").value;
  $("#fscore").innerHTML = (n === 18 ? SC18 : SC9).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  if (prevScore && [...$("#fscore").options].some(o => o.value === prevScore)) $("#fscore").value = prevScore;
  const ch = n === 18 ? COMBOS : LOOPS.map(l => [l]);
  $("#floop").innerHTML = ch.map((c, i) => `<option value="${i}">${esc(comboLabel(c))}</option>`).join("");
}
function say(el, t, cls) { el.textContent = t || ""; el.className = "msg" + (cls ? " " + cls : ""); }
function resetMatchForm() {
  S.editMatch = null; $("#mtitle").textContent = "Saisir un résultat"; $("#fbtn").textContent = "Enregistrer"; $("#fcancel").hidden = true;
  $("#fa").value = S.player || ""; $("#fb").value = ""; $("#fdate").value = keyOf(new Date()); refreshResult();
}
function editMatch(m) {
  S.editMatch = m.id; $("#mtitle").textContent = "Corriger un résultat"; $("#fbtn").textContent = "Mettre à jour"; $("#fcancel").hidden = false;
  $("#fa").value = m.a; $("#fb").value = m.b; $("#ffmt").value = String(m.n); refreshFormat();
  const ch = m.n === 18 ? COMBOS : LOOPS.map(l => [l]);
  const i = ch.findIndex(c => c.join("+") === m.loops.join("+")); if (i >= 0) $("#floop").value = String(i);
  refreshResult(); $("#fres").value = m.w; $("#scorewrap").hidden = m.w === "h";
  if (m.w !== "h") $("#fscore").value = m.s;
  $("#fdate").value = m.d; say($("#fmsg"), "");
  $("#entry").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#mform").addEventListener("submit", e => {
  e.preventDefault();
  const m = $("#fmsg"), a = $("#fa").value, b = $("#fb").value;
  if (!a || !b) return say(m, "Choisissez les deux joueurs.", "err");
  if (a === b) return say(m, "Les deux joueurs doivent être différents.", "err");
  const n = +$("#ffmt").value, w = $("#fres").value;
  const ch = n === 18 ? COMBOS : LOOPS.map(l => [l]);
  const obj = { id: S.editMatch || uid(), d: $("#fdate").value, a, b, w, s: w === "h" ? "AS" : $("#fscore").value, n, loops: ch[+$("#floop").value] };
  if (!obj.d) return say(m, "Choisissez la date.", "err");
  if (pairUnits(V.matches, a, b, S.editMatch) + n / 9 > 2) return say(m, nameOf(a) + " et " + nameOf(b) + " ont déjà joué : un match de 18 trous ou deux matchs de 9 trous au maximum. Corrigez ou supprimez un match existant.", "err");
  enqueue(S.editMatch ? "updateMatch" : "addMatch", obj);
  say(m, S.editMatch ? "Résultat corrigé." : "Résultat enregistré : " + nameOf(a) + " – " + nameOf(b) + ".", "ok");
  resetMatchForm();
});
$("#fcancel").addEventListener("click", () => { resetMatchForm(); say($("#fmsg"), ""); });

function resetEventForm() {
  S.editEvent = null; $("#etitle").textContent = "Ajouter un événement"; $("#ebtn").textContent = "Ajouter"; $("#ecancel").hidden = true;
  $("#etitleIn").value = ""; $("#etime").value = ""; $("#edur").value = "60"; $("#eplace").value = "Golf Château de la Tournette, Nivelles"; $("#enote").value = ""; $("#edate").value = keyOf(new Date());
}
function editEvent(ev) {
  S.editEvent = ev.id; $("#etitle").textContent = "Modifier l'événement"; $("#ebtn").textContent = "Mettre à jour"; $("#ecancel").hidden = false;
  $("#etitleIn").value = ev.title; $("#edate").value = ev.d; $("#etime").value = ev.t || ""; $("#edur").value = String(ev.dur || 60);
  if (![...$("#edur").options].some(o => o.value === String(ev.dur))) $("#edur").insertAdjacentHTML("beforeend", `<option value="${esc(ev.dur)}">${esc(ev.dur)} min</option>`), $("#edur").value = String(ev.dur);
  $("#eplace").value = ev.place || ""; $("#enote").value = ev.note || ""; say($("#emsg"), "");
  $("#eentry").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#eform").addEventListener("submit", e => {
  e.preventDefault();
  const title = $("#etitleIn").value.trim(), d = $("#edate").value;
  if (!title || !d) return say($("#emsg"), "Indiquez un titre et une date.", "err");
  enqueue(S.editEvent ? "updateEvent" : "addEvent", { id: S.editEvent || uid(), d, t: $("#etime").value, dur: +$("#edur").value, title, place: $("#eplace").value.trim(), note: $("#enote").value.trim() });
  say($("#emsg"), S.editEvent ? "Événement modifié." : "Événement ajouté.", "ok");
  resetEventForm();
});
$("#ecancel").addEventListener("click", () => { resetEventForm(); say($("#emsg"), ""); });

$("#fa").addEventListener("change", refreshResult);
$("#fb").addEventListener("change", refreshResult);
$("#fres").addEventListener("change", () => { $("#scorewrap").hidden = $("#fres").value === "h"; });
$("#ffmt").addEventListener("change", refreshFormat);
$("#pick").addEventListener("change", e => { S.selected = e.target.value; renderFiche(); });

document.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.pick) { S.selected = t.dataset.pick; $("#pick").value = S.selected; renderFiche(); $("#fiche").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (t.dataset.medit) { const m = V.matches.find(x => x.id === t.dataset.medit); if (m) editMatch(m); return; }
  if (t.dataset.eedit) { const ev = V.events.find(x => x.id === t.dataset.eedit); if (ev) editEvent(ev); return; }
  if (t.dataset.dismiss !== undefined) { S.errors.splice(+t.dataset.dismiss, 1); renderNotices(); return; }
  if (t.dataset.retry !== undefined) { flush(); return; }
  const del = t.dataset.mdel || t.dataset.edel;
  if (del) {
    if (!t.classList.contains("armed")) {
      t.classList.add("armed"); t.textContent = "Confirmer ?";
      setTimeout(() => { if (t.isConnected) { t.classList.remove("armed"); t.textContent = "Supprimer"; } }, 3500);
      return;
    }
    enqueue(t.dataset.mdel ? "deleteMatch" : "deleteEvent", { id: del });
  }
});

/* ---------- démarrage ---------- */
function boot() {
  setPlayers(S.players);
  S.queue = ls.get("m2_queue", []);
  $("#fdate").value = keyOf(new Date()); $("#edate").value = keyOf(new Date());
  refreshFormat();
  const cache = ls.get("m2_cache", null);
  if (cache) { S.server = cache.server || S.server; setPlayers(cache.players); S.name = cache.name || ""; S.lastSync = cache.ts || 0; }
  const auth = ls.get("m2_auth", null);
  if (auth && API_OK) {
    S.player = auth.player; S.code = auth.code; S.queue = S.queue.filter(q => q.player === S.player);
    showApp(); flush();
  } else showLogin();
  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.player && Date.now() - S.lastSync > 30000) flush(); });
  setInterval(() => { if (document.visibilityState === "visible" && S.player) flush(); }, 90000);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
})();

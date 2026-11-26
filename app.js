(function () {
"use strict";
const CFG = window.M2_CONFIG || {};
const API_OK = /^https:\/\//.test(CFG.API_URL || "");
const LOOPS = ["UK 1-9", "UK 10-18", "US 1-9", "US 10-18"];
const COMBOS = [["UK 1-9", "UK 10-18"], ["US 1-9", "US 10-18"], ["UK 1-9", "US 1-9"], ["UK 1-9", "US 10-18"], ["UK 10-18", "US 1-9"], ["UK 10-18", "US 10-18"]];
const SC9 = ["1 up", "2 up", "2&1", "3&1", "3&2", "4&2", "4&3", "5&3", "5&4"];
const SC18 = SC9.concat(["6&4", "6&5", "7&5", "7&6", "8&6", "9&7", "10&8"]);
const DEADLINE = "2027-03-28";
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
  player: null, code: null, name: "", rights: [], players: FALLBACK, pmap: {},
  server: { matches: [], events: [], log: [] }, queue: [], errors: [],
  editMatch: null, editEvent: null, selected: "", busy: false, offline: false, lastSync: 0, loaded: false
};
function setPlayers(list) { S.players = list && list.length ? list : FALLBACK; S.pmap = {}; S.players.forEach(p => S.pmap[p.id] = p.name); }
const canCal = () => S.rights.indexOf("calendrier") >= 0;
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
  if (r.me) { S.name = r.me.name; S.rights = r.me.rights || []; }
  S.lastSync = Date.now(); S.offline = false;
  ls.set("m2_cache", { server: S.server, players: S.players, name: S.name, rights: S.rights, ts: S.lastSync });
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
  S.selected = ""; S.msel = null;
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
const initials = n => { const p = String(n || "?").split(/[\s.]+/).filter(Boolean); return (p.length > 1 ? p[0][0] + p[1][0] : (p[0] || "?").slice(0, 2)).toUpperCase(); };
const monthOf = s => new Intl.DateTimeFormat("fr-BE", { month: "short" }).format(parse(s));
const dowOf = s => new Intl.DateTimeFormat("fr-BE", { weekday: "short" }).format(parse(s));
const rankTxt = (r, same) => (r === 1 ? "1er" : r + "e") + (same ? " ex æquo" : "");
function renderAll() {
  if ($("#appView").hidden) return;
  V = view(); C = compute(V.matches);
  const sig = S.players.map(p => p.id + ":" + p.name).join("|");
  if (sig !== S.pSig) { S.pSig = sig; fillPlayers(); }
  const nm = S.name || nameOf(S.player);
  $("#meName").textContent = nm; $("#meFirst").textContent = nm.split(" ")[0];
  $("#meAv").textContent = initials(nm); $("#meAv2").textContent = initials(nm);
  $("#eAdd").hidden = !canCal(); $("#enote2").hidden = canCal();
  if (!canCal() && $("#eentry").open) $("#eentry").close();
  renderStatus(); renderNotices(); renderStats(); renderNext(); renderTable(); renderGrid(); renderResults(); renderEvents(); renderHistory();
  if ($("#fichedlg").open) renderFiche();
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
  const played = V.matches.length, total = S.players.length * (S.players.length - 1) / 2;
  const left = Math.max(0, Math.round((parse(DEADLINE) - parse(keyOf(new Date()))) / 864e5));
  $("#subCount").textContent = S.players.length + " joueurs, " + total + " paires";
  const me = C.by[S.player];
  if (!me) { $("#stats").innerHTML = ""; return; }
  const rk = me.p ? (me.rank === 1 ? `1<span>er</span>` : `${me.rank}<span>e</span>`) : "–";
  $("#stats").innerHTML =
    `<div class="eyebrow2">Ma situation</div>
     <div class="me-top"><div class="me-l"><div class="me-rank">${rk}</div><div class="me-of">sur ${S.players.length}<br>joueurs</div></div>
       <div class="me-r"><div class="me-pts">${pts(me.pts)} <span>pt${me.pts > 1 ? "s" : ""}</span></div><div class="me-sub">${me.p} match${me.p > 1 ? "s" : ""} joué${me.p > 1 ? "s" : ""}</div></div></div>
     <div class="me-hr"></div>
     <div class="me-team"><div class="l"><span>Équipe : ${played} / ${total} matchs joués</span><b>J-${left}</b></div>
       <div class="mebar"><i style="width:${Math.min(100, played / total * 100).toFixed(1)}%"></i></div>
       <div class="me-dl">Dernière date pour jouer : 28 mars 2027</div></div>`;
}
function upcoming() {
  const today = keyOf(new Date());
  return V.events.filter(e => e.d >= today).sort((a, b) => (a.d + (a.t || "")).localeCompare(b.d + (b.t || "")));
}
function renderNext() {
  const e = upcoming()[0];
  $("#nextEv").innerHTML = `<div class="chead"><div class="ct">Prochain événement</div><button class="cl" type="button" data-go="more">Tout voir</button></div>` + (e
    ? `<div class="evrow"><div class="dtile"><i>${esc(monthOf(e.d))}</i><b>${parse(e.d).getDate()}</b></div>
       <div class="evtxt"><div class="t">${esc(e.title)}</div><div class="w">${esc(dowOf(e.d))} · ${e.t ? esc(hh(e.t)) : "toute la journée"}${e.place ? " · " + esc(e.place) : ""}</div></div></div>
       <button class="btn out" type="button" data-agenda="${esc(e.id)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>Ajouter à l'agenda</button>`
    : '<p class="muted">Aucun événement à venir.</p>');
  const byDate = a => V.matches.filter(a).sort((x, y) => (y.d || "").localeCompare(x.d || "") || String(y.at).localeCompare(String(x.at)))[0];
  const m = byDate(x => x.a === S.player || x.b === S.player) || byDate(() => true);
  $("#sec-last").hidden = !m;
  if (m) $("#lastRes").innerHTML = `<div><div class="k">Dernier résultat · ${esc(fmtShort(m.d))}</div><div class="v">${m.w === "h" ? esc(nameOf(m.a)) + " – " + esc(nameOf(m.b)) : esc(nameOf(m.w === "a" ? m.a : m.b)) + " bat " + esc(nameOf(m.w === "a" ? m.b : m.a))}</div></div><div class="s">${m.w === "h" ? "AS" : esc(m.s)}</div>`;
}
function renderTable() {
  const last = V.matches.map(m => m.d).sort().pop();
  $("#upd").textContent = last ? "dernier match le " + fmtShort(last) : "";
  const R = C.ranked, played = R.filter(s => s.p), idle = R.filter(s => !s.p);
  const same = s => R.filter(x => x.p && x.rank === s.rank).length > 1;
  const top = played.slice(0, 3), order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  $("#podium").innerHTML = order.map(s => `<button type="button" class="pod${s === top[0] ? " first" : ""}" data-pick="${esc(s.id)}"><div class="pa">${esc(initials(s.name))}</div><div class="pn">${esc(s.name)}</div><div class="pp">${pts(s.pts)} pt${s.pts > 1 ? "s" : ""}</div><div class="pr">${rankTxt(s.rank, same(s))}</div></button>`).join("");
  const row = s => `<button type="button" class="lrow${s.id === S.player ? " me" : ""}" data-pick="${esc(s.id)}"><span class="rk">${s.rank}</span><span class="nm">${esc(s.name)}${s.id === S.player ? ' <span class="vous">vous</span>' : ""}</span><span>${s.w}</span><span>${s.h}</span><span>${s.l}</span><span class="pt2">${pts(s.pts)}</span></button>`;
  let h = `<div class="lhead"><span>#</span><span>Joueur</span><span>V</span><span>AS</span><span>D</span><span>Pts</span></div>` + played.slice(3).map(row).join("");
  if (!played.length) h += '<div class="empty" style="margin:14px">Aucun match joué pour l\'instant.</div>';
  if (idle.length) {
    h += `<button type="button" class="unp" data-unp aria-expanded="${S.unp ? "true" : "false"}"><span>Pas encore joué (${idle.length})</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`;
    if (S.unp) h += `<div class="unplist">${idle.map(s => `<button type="button" data-pick="${esc(s.id)}">${esc(s.name)}</button>`).join("")}</div>`;
  }
  $("#table").innerHTML = h;
}
function openFiche(id) { S.selected = id; renderFiche(); openModal("fichedlg"); }
function renderFiche() {
  const box = $("#fiche-body"), s = C.by[S.selected];
  if (!s) { box.innerHTML = ""; return; }
  const done = []; for (const o in s.opp) s.opp[o].forEach(x => done.push([o, x]));
  done.sort((a, b) => (b[1].m.d || "").localeCompare(a[1].m.d || ""));
  const others = S.players.filter(p => p.id !== S.selected).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const never = others.filter(p => !s.opp[p.id]);
  $("#ftitle").textContent = "Fiche joueur";
  box.innerHTML = `<div class="fiche"><div class="fhead"><span class="av" style="width:56px;height:56px;font-size:20px">${esc(initials(s.name))}</span><div><div class="nm">${esc(s.name)}</div><div class="st">${s.p ? rankTxt(s.rank, false) + " · " : ""}${pts(s.pts)} pt${s.pts > 1 ? "s" : ""} · ${s.p} match${s.p > 1 ? "s" : ""} joué${s.p > 1 ? "s" : ""}</div></div></div>
    <div><h3>Matchs joués (${s.p})</h3><div class="chips">${done.length ? done.map(([o, x]) => `<span class="chip ${x.t}">${esc(nameOf(o))} · ${x.t === "h" ? "AS" : (x.t === "w" ? "gagné " : "perdu ") + esc(x.m.s)}</span>`).join("") : '<span class="muted">Aucun match pour l\'instant.</span>'}</div></div>
    <div><h3>Pas encore rencontrés (${never.length})</h3><div class="chips">${never.length ? never.map(p => `<span class="chip">${esc(p.name)}</span>`).join("") : '<span class="muted">Tous les adversaires ont été rencontrés.</span>'}</div></div></div>`;
  const add = $("#ficheAdd"); add.hidden = S.selected === S.player || !!(C.by[S.player] && C.by[S.player].opp[S.selected]);
  add.textContent = "Saisir un résultat avec " + s.name;
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
      h += `<td class="${cls}" title="${esc(xs.map(x => resultText(x.m)).join(" | "))}">${pts(got)}</td>`;
    });
    h += "</tr>";
  });
  $("#grid").innerHTML = h + "</tbody>";
}
function renderResults() {
  const all = V.matches.slice().sort((a, b) => (b.d || "").localeCompare(a.d || "") || String(b.at).localeCompare(String(a.at)));
  const list = S.showAll ? all : all.slice(0, 5);
  $("#rcount").textContent = all.length ? all.length + " match" + (all.length > 1 ? "s" : "") : "";
  const more = $("#moreRes"); more.hidden = all.length <= 5;
  more.textContent = S.showAll ? "Voir seulement les 5 derniers" : "Voir tous les résultats (" + all.length + ")";
  if (!list.length) { $("#results").innerHTML = '<li><div class="empty" style="margin:14px">Aucun résultat enregistré. Le premier match apparaîtra ici dès qu\'il sera saisi.</div></li>'; return; }
  const pen = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
  const bin = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg>';
  $("#results").innerHTML = list.map(m => {
    const who = m.w === "h" ? `${esc(nameOf(m.a))} – ${esc(nameOf(m.b))}` : `${esc(nameOf(m.w === "a" ? m.a : m.b))} bat ${esc(nameOf(m.w === "a" ? m.b : m.a))}`;
    const by = m.by ? ` · saisi par ${esc(nameOf(m.by))}` : "";
    const up = m.uby ? ` · modifié par ${esc(nameOf(m.uby))}` : "";
    const sel = S.msel === m.id, d = parse(m.d);
    return `<li class="${sel ? "sel" : ""}"><button type="button" class="mrow" data-msel="${esc(m.id)}" aria-expanded="${sel}"><span class="d">${d.getDate()}<br>${esc(monthOf(m.d))}</span><span class="m"><b>${who}${m._pending ? ' <span class="pend">en attente</span>' : ""}</b><small>${esc(comboLabel(m.loops))}${by}${up}</small></span><span class="s${m.w === "h" ? " as" : ""}">${m.w === "h" ? "AS" : esc(m.s)}</span></button>
      ${sel ? `<div class="macts"><button type="button" data-medit="${esc(m.id)}">${pen}Modifier</button><button type="button" class="del" data-mdel="${esc(m.id)}">${bin}Supprimer</button></div>` : ""}</li>`;
  }).join("");
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
  const up = upcoming();
  const pen = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
  const bin = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg>';
  $("#events").innerHTML = up.length ? up.map((e, i) => {
    const by = e.by ? `Ajouté par ${esc(nameOf(e.by))}${e.uby ? " · modifié par " + esc(nameOf(e.uby)) : ""}` : "";
    return `<div class="ev"><div class="evline"><div class="dtile${i ? " alt" : ""}"><i>${esc(monthOf(e.d))}</i><b>${parse(e.d).getDate()}</b></div>
      <div class="evtxt"><div class="t">${esc(e.title)}${e._pending ? ' <span class="pend">en attente</span>' : ""}</div><div class="w">${esc(dowOf(e.d))} · ${e.t ? esc(hh(e.t)) : "toute la journée"}${e.place ? " · " + esc(e.place) : ""}${e.note ? " · " + esc(e.note) : ""}</div></div>
      <button class="agbtn" type="button" data-agenda="${esc(e.id)}">Agenda</button></div>
      ${canCal() ? `<div class="macts"><button type="button" data-eedit="${esc(e.id)}">${pen}Modifier</button><button type="button" class="del" data-edel="${esc(e.id)}">${bin}Supprimer</button></div>` : ""}
      <div class="by">${by}</div></div>`;
  }).join("") : `<div class="empty">Aucun événement à venir.${canCal() ? " Utilisez « + Événement » : entraînement avec Florian, match d'équipe, repas…" : ""}</div>`;
}

/* ---------- historique ---------- */
const MLAB = { d: "date", a: "joueur 1", b: "joueur 2", w: "résultat", s: "score", n: "format", loops: "terrain" };
const ELAB = { d: "date", t: "heure", dur: "durée", title: "titre", place: "lieu", note: "précision" };
function mval(k, m) { return k === "d" ? fmtShort(m.d) : k === "a" || k === "b" ? nameOf(m[k]) : k === "w" ? resultText(m) : k === "n" ? m.n + " trous" : k === "loops" ? comboLabel(m.loops) : String(m[k]); }
function eval_(k, e) { return k === "d" ? fmtShort(e.d) : k === "t" ? (e.t ? hh(e.t) : "toute la journée") : k === "dur" ? e.dur + " min" : (e[k] || "–"); }
function descM(m) { return nameOf(m.a) + " – " + nameOf(m.b) + " (" + resultText(m) + ")"; }
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
  const vals = { fa: keep("#fa"), fb: keep("#fb"), l: keep("#lplayer") };
  $("#fa").innerHTML = '<option value="">Choisir…</option>' + opts;
  $("#fb").innerHTML = '<option value="">Choisir…</option>' + opts;
  $("#lplayer").innerHTML = '<option value="">Choisir…</option>' + opts;
  $("#fa").value = vals.fa || (S.player || ""); $("#fb").value = vals.fb; $("#lplayer").value = vals.l;
  refreshResult();
}
function refreshResult() {
  const a = $("#fa").value, b = $("#fb").value, prev = $("#fres").value || "a";
  $("#fres").innerHTML = `<option value="a">${esc(S.pmap[a] || "Joueur 1")} gagne</option><option value="b">${esc(S.pmap[b] || "Joueur 2")} gagne</option><option value="h">Égalité (AS)</option>`;
  $("#fres").value = prev; $("#scorewrap").hidden = $("#fres").value === "h";
}
function refreshFormat() {
  const prevScore = $("#fscore").value;
  $("#fscore").innerHTML = SC18.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  if (prevScore && [...$("#fscore").options].some(o => o.value === prevScore)) $("#fscore").value = prevScore;
  $("#floop").innerHTML = COMBOS.map((c, i) => `<option value="${i}">${esc(comboLabel(c))}</option>`).join("");
}

/* ---------- fenêtres (formulaires) ---------- */
function openModal(id) {
  const d = document.getElementById(id);
  if (!d.open) d.showModal();
}
document.addEventListener("click", e => {
  const x = e.target.closest("[data-close]"); if (x) { document.getElementById(x.dataset.close).close(); return; }
  const d = e.target; // clic sur le fond sombre = fermer
  if (d instanceof HTMLDialogElement && d.open) {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  }
});
$("#entry").addEventListener("close", () => { resetMatchForm(); say($("#fmsg"), ""); });
$("#eentry").addEventListener("close", () => { resetEventForm(); say($("#emsg"), ""); });
let toastT;
function toast(t) {
  const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 3500);
}
function say(el, t, cls) { el.textContent = t || ""; el.className = "msg" + (cls ? " " + cls : ""); }
function resetMatchForm() {
  S.editMatch = null; $("#mtitle").textContent = "Saisir un résultat"; $("#fbtn").textContent = "Enregistrer"; $("#fcancel").hidden = false;
  $("#fa").value = S.player || ""; $("#fb").value = ""; $("#fdate").value = keyOf(new Date()); refreshResult();
}
function editMatch(m) {
  S.editMatch = m.id; $("#mtitle").textContent = "Corriger un résultat"; $("#fbtn").textContent = "Mettre à jour"; $("#fcancel").hidden = false;
  $("#fa").value = m.a; $("#fb").value = m.b; refreshFormat();
  const i = COMBOS.findIndex(c => c.join("+") === m.loops.join("+")); if (i >= 0) $("#floop").value = String(i);
  refreshResult(); $("#fres").value = m.w; $("#scorewrap").hidden = m.w === "h";
  if (m.w !== "h") $("#fscore").value = m.s;
  $("#fdate").value = m.d; say($("#fmsg"), "");
  openModal("entry");
}
$("#mform").addEventListener("submit", e => {
  e.preventDefault();
  const m = $("#fmsg"), a = $("#fa").value, b = $("#fb").value;
  if (!a || !b) return say(m, "Choisissez les deux joueurs.", "err");
  if (a === b) return say(m, "Les deux joueurs doivent être différents.", "err");
  const n = 18, w = $("#fres").value;
  const obj = { id: S.editMatch || uid(), d: $("#fdate").value, a, b, w, s: w === "h" ? "AS" : $("#fscore").value, n, loops: COMBOS[+$("#floop").value] };
  if (!obj.d) return say(m, "Choisissez la date.", "err");
  if (pairUnits(V.matches, a, b, S.editMatch) > 0) return say(m, nameOf(a) + " et " + nameOf(b) + " ont déjà joué : un seul match de 18 trous par paire. Corrigez ou supprimez le match existant.", "err");
  enqueue(S.editMatch ? "updateMatch" : "addMatch", obj);
  toast(S.editMatch ? "Résultat corrigé." : "Résultat enregistré : " + nameOf(a) + " – " + nameOf(b) + ".");
  resetMatchForm(); say(m, ""); $("#entry").close();
});
$("#fcancel").addEventListener("click", () => $("#entry").close());

function resetEventForm() {
  S.editEvent = null; $("#etitle").textContent = "Ajouter un événement"; $("#ebtn").textContent = "Ajouter"; $("#ecancel").hidden = false;
  $("#etitleIn").value = ""; $("#etime").value = ""; $("#edur").value = "60"; $("#eplace").value = "Golf Château de la Tournette, Nivelles"; $("#enote").value = ""; $("#edate").value = keyOf(new Date());
}
function editEvent(ev) {
  S.editEvent = ev.id; $("#etitle").textContent = "Modifier l'événement"; $("#ebtn").textContent = "Mettre à jour"; $("#ecancel").hidden = false;
  $("#etitleIn").value = ev.title; $("#edate").value = ev.d; $("#etime").value = ev.t || ""; $("#edur").value = String(ev.dur || 60);
  if (![...$("#edur").options].some(o => o.value === String(ev.dur))) $("#edur").insertAdjacentHTML("beforeend", `<option value="${esc(ev.dur)}">${esc(ev.dur)} min</option>`), $("#edur").value = String(ev.dur);
  $("#eplace").value = ev.place || ""; $("#enote").value = ev.note || ""; say($("#emsg"), "");
  openModal("eentry");
}
$("#eform").addEventListener("submit", e => {
  e.preventDefault();
  const title = $("#etitleIn").value.trim(), d = $("#edate").value;
  if (!title || !d) return say($("#emsg"), "Indiquez un titre et une date.", "err");
  enqueue(S.editEvent ? "updateEvent" : "addEvent", { id: S.editEvent || uid(), d, t: $("#etime").value, dur: +$("#edur").value, title, place: $("#eplace").value.trim(), note: $("#enote").value.trim() });
  toast(S.editEvent ? "Événement modifié." : "Événement ajouté.");
  resetEventForm(); say($("#emsg"), ""); $("#eentry").close();
});
$("#ecancel").addEventListener("click", () => $("#eentry").close());

$("#fa").addEventListener("change", refreshResult);
$("#fb").addEventListener("change", refreshResult);
$("#fres").addEventListener("change", () => { $("#scorewrap").hidden = $("#fres").value === "h"; });
$("#fab").addEventListener("click", () => { resetMatchForm(); say($("#fmsg"), ""); openModal("entry"); });
$("#eAdd").addEventListener("click", () => { resetEventForm(); say($("#emsg"), ""); openModal("eentry"); });
$("#moreRes").addEventListener("click", () => { S.showAll = !S.showAll; renderResults(); });

document.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.go) { setTab(t.dataset.go); return; }
  if (t.dataset.vs) { resetMatchForm(); say($("#fmsg"), ""); $("#fb").value = t.dataset.vs; refreshResult(); openModal("entry"); return; }
  if (t.dataset.pick) { openFiche(t.dataset.pick); return; }
  if (t.dataset.unp !== undefined) { S.unp = !S.unp; renderTable(); return; }
  if (t.dataset.msel) { S.msel = S.msel === t.dataset.msel ? null : t.dataset.msel; renderResults(); return; }
  if (t.dataset.mview) { S.mview = t.dataset.mview; document.querySelectorAll("[data-mview]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.mview === S.mview))); $("#sec-results").hidden = S.mview !== "res"; $("#sec-grid").hidden = S.mview !== "grid"; return; }
  if (t.dataset.agenda) { const ev = V.events.find(x => x.id === t.dataset.agenda); if (ev) { $("#agendaWhat").textContent = ev.title + " · " + fmtDay(ev.d) + (ev.t ? " · " + hh(ev.t) : ""); $("#agendaLinks").innerHTML = calLinks(ev); openModal("agenda"); } return; }
  if (t.id === "ficheAdd") { const id = S.selected; $("#fichedlg").close(); resetMatchForm(); say($("#fmsg"), ""); $("#fb").value = id; refreshResult(); openModal("entry"); return; }
  if (t.id === "userPill") { setTab("more"); return; }
  if (t.dataset.medit) { const m = V.matches.find(x => x.id === t.dataset.medit); if (m) editMatch(m); return; }
  if (t.dataset.eedit) { const ev = V.events.find(x => x.id === t.dataset.eedit); if (ev) editEvent(ev); return; }
  if (t.dataset.dismiss !== undefined) { S.errors.splice(+t.dataset.dismiss, 1); renderNotices(); return; }
  if (t.dataset.retry !== undefined) { flush(); return; }
  const del = t.dataset.mdel || t.dataset.edel;
  if (del) {
    if (!t.classList.contains("armed")) {
      const old = t.innerHTML; t.classList.add("armed"); t.textContent = "Confirmer ?";
      setTimeout(() => { if (t.isConnected) { t.classList.remove("armed"); t.innerHTML = old; } }, 3500);
      return;
    }
    enqueue(t.dataset.mdel ? "deleteMatch" : "deleteEvent", { id: del });
  }
});

/* ---------- démarrage ---------- */
/* ---------- onglets ---------- */
const TABS = ["home", "rank", "matches", "more"];
function setTab(t, keepScroll) {
  if (TABS.indexOf(t) < 0) t = "home";
  S.tab = t; document.body.dataset.tab = t; ls.set("m2_tab", t);
  document.querySelectorAll("#tabbar [data-go]").forEach(b => { if (b.dataset.go === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (!keepScroll) window.scrollTo(0, 0);
}
function boot() {
  setTab(ls.get("m2_tab", "home"), true);
  setPlayers(S.players);
  S.queue = ls.get("m2_queue", []);
  $("#fdate").value = keyOf(new Date()); $("#edate").value = keyOf(new Date());
  refreshFormat();
  const cache = ls.get("m2_cache", null);
  if (cache) { S.server = cache.server || S.server; setPlayers(cache.players); S.name = cache.name || ""; S.rights = cache.rights || []; S.lastSync = cache.ts || 0; }
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

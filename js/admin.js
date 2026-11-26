import { initAuth, onUserChange, db, functions, escapeHtml, showToast } from "../auth.js";
import { formatRupees, isOwnerUid } from "../app-config.js";
import {
  collection, collectionGroup, query, where, orderBy, limit, getDocs, getDoc, doc, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

initAuth();

const $ = (id) => document.getElementById(id);
const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);
const when = (ts, long) => ts && ts.toDate ? ts.toDate().toLocaleString("en-IN", long ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Just now";
const n = (v) => Number(v) || 0;
const empty = (cols, text) => `<tr><td colspan="${cols}" class="empty">${escapeHtml(text)}</td></tr>`;
const fail = (cols, err) => empty(cols, "Could not load: " + (err && err.message ? err.message : "unknown error"));

let started = false;
const loaded = {};

onUserChange((user, data, ok) => {
  if (!user || !ok || started) return;
  if (!isOwnerUid(user.uid)) return; // Firestore rules and Cloud Functions enforce this for real
  started = true;
  setTimeout(() => openTab("overview"), 0); // after the loaders below are defined
});

/* ---------------- Tabs ---------------- */
const tabs = [...document.querySelectorAll(".tab")];
function openTab(name) {
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  document.querySelectorAll(".tabpanel").forEach((p) => (p.hidden = p.id !== "tab-" + name));
  if (!loaded[name] || name === "withdrawals") { loaded[name] = true; LOADERS[name] && LOADERS[name](); }
}
tabs.forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));
tabs.forEach((t, i) => t.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  next.focus(); next.click();
}));

/* ---------------- Overview ---------------- */
async function loadOverview() {
  const set = (id, v, sub) => { $(id).textContent = v; if (sub !== undefined) $(id + "Sub").textContent = sub; };
  try {
    const [users, links, openReports, pendingW, stats] = await Promise.all([
      getCountFromServer(collection(db, "users")),
      getCountFromServer(collection(db, "links")),
      getCountFromServer(query(collection(db, "reports"), where("status", "==", "open"))),
      getDocs(query(collection(db, "withdrawals"), where("status", "==", "pending"))),
      getDocs(query(collection(db, "stats"), orderBy("day", "desc"), limit(14)))
    ]);
    let owed = 0;
    pendingW.forEach((d) => (owed += n(d.data().amountPaise)));
    set("kMembers", users.data().count.toLocaleString("en-IN"));
    set("kLinks", links.data().count.toLocaleString("en-IN"));
    set("kOwed", formatRupees(owed), `${pendingW.docs.length} ${pendingW.docs.length === 1 ? "request" : "requests"} waiting`);
    set("kReports", openReports.data().count, openReports.data().count ? "Needs a look" : "All clear");

    const days = stats.docs.map((d) => d.data()).reverse();
    let valid = 0, credited = 0, views = 0;
    days.forEach((d) => { valid += n(d.valid); views += n(d.views); credited += n(d.creditedPaise); });
    $("sViews").textContent = views.toLocaleString("en-IN");
    $("sValid").textContent = valid.toLocaleString("en-IN");
    $("sCredit").textContent = formatRupees(credited);
    const max = Math.max(1, ...days.map((d) => n(d.views)));
    $("chart").innerHTML = days.length
      ? days.map((d) => `<div class="col" title="${escapeHtml(d.day)}: ${n(d.views)} opens, ${n(d.valid)} counted"><div class="bar-v" style="height:${Math.max(3, Math.round((n(d.views) / max) * 140))}px"></div><div class="lab">${escapeHtml(String(d.day).slice(8))}</div></div>`).join("")
      : `<p class="muted" style="align-self:center;margin:auto">No link traffic yet.</p>`;
  } catch (err) {
    console.warn("overview", err);
    showToast("Overview could not load: " + err.message, "error");
  }
}

/* ---------------- Withdrawals ---------------- */
let wRows = [];
const wBody = $("adminTbody");
async function loadWithdrawals() {
  wBody.innerHTML = empty(7, "Loading requests");
  try {
    const snap = await getDocs(query(collection(db, "withdrawals"), orderBy("createdAt", "desc"), limit(300)));
    wRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let pc = 0, pt = 0, dc = 0, dt = 0;
    wRows.forEach((w) => {
      if (w.status === "pending") { pc++; pt += n(w.amountPaise); }
      else if (w.status === "paid") { dc++; dt += n(w.amountPaise); }
    });
    $("metricPendingAmount").textContent = formatRupees(pt);
    $("metricPendingCount").textContent = `${pc} ${pc === 1 ? "request" : "requests"} waiting`;
    $("metricPaidAmount").textContent = formatRupees(dt);
    $("metricPaidCount").textContent = `${dc} ${dc === 1 ? "payout" : "payouts"} completed`;
    renderWithdrawals();
  } catch (err) { wBody.innerHTML = fail(7, err); }
}
function renderWithdrawals() {
  const f = $("filterStatus").value;
  const list = f === "all" ? wRows : wRows.filter((w) => (w.status || "pending") === f);
  if (!list.length) { wBody.innerHTML = empty(7, "No matching requests."); return; }
  wBody.innerHTML = list.map((w) => {
    const status = (w.status || "pending").toLowerCase();
    const acts = status === "pending"
      ? `<div class="acts"><button type="button" class="btn btn-success" data-act="paid" data-id="${escapeHtml(w.id)}">Mark paid</button><button type="button" class="btn btn-danger" data-act="reject" data-id="${escapeHtml(w.id)}">Reject</button></div>`
      : `<span class="muted">Done</span>`;
    return `<tr><td class="num muted">${escapeHtml(when(w.createdAt))}</td><td class="num" title="${escapeHtml(w.id)}">${escapeHtml(w.id.slice(0, 8))}</td><td class="num muted" title="${escapeHtml(w.uid || "")}">${escapeHtml((w.uid || "").slice(0, 8))}</td><td class="num">${escapeHtml(w.upiId || "")}</td><td><span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span></td><td class="r num">${escapeHtml(formatRupees(w.amountPaise || 0))}</td><td class="r">${acts}</td></tr>`;
  }).join("");
}
$("filterStatus").addEventListener("change", renderWithdrawals);
$("btnRefreshAdmin").addEventListener("click", loadWithdrawals);
wBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const w = wRows.find((r) => r.id === btn.dataset.id);
  const verb = btn.dataset.act === "paid" ? "mark as PAID" : "REJECT and refund";
  if (!confirm(`${verb} ${formatRupees(w ? w.amountPaise : 0)} to ${w ? w.upiId : ""}?`)) return;
  btn.disabled = true;
  try {
    await call("processWithdrawalAdmin", { withdrawalId: btn.dataset.id, action: btn.dataset.act });
    showToast(btn.dataset.act === "paid" ? "Marked as paid." : "Rejected and refunded.", "success");
    loadWithdrawals();
  } catch (err) { showToast("Action failed: " + (err.message || "unknown error"), "error"); btn.disabled = false; }
});

/* ---------------- Members ---------------- */
let uRows = [];
const uBody = $("usersTbody");
async function loadUsers() {
  uBody.innerHTML = empty(6, "Loading members");
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(300)));
    uRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUsers();
  } catch (err) { uBody.innerHTML = fail(6, err); }
}
function renderUsers() {
  const q = $("userSearch").value.trim().toLowerCase();
  const list = q ? uRows.filter((u) => (u.email || "").toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q) || u.id.toLowerCase().includes(q)) : uRows;
  if (!list.length) { uBody.innerHTML = empty(6, uRows.length ? "No member matches that search." : "No members yet."); return; }
  uBody.innerHTML = list.map((u) => `<tr>
    <td class="num muted">${escapeHtml(when(u.createdAt, true))}</td>
    <td><b>${escapeHtml(u.displayName || "")}</b><div class="muted" style="font-size:13px">${escapeHtml(u.email || "")}</div></td>
    <td class="num muted" title="${escapeHtml(u.id)}">${escapeHtml(u.id.slice(0, 10))}</td>
    <td class="r num">${escapeHtml(formatRupees(u.confirmedBalancePaise || 0))}<div class="muted" style="font-size:12px">${escapeHtml(formatRupees(u.pendingBalancePaise || 0))} pending</div></td>
    <td><span class="badge ${u.banned ? "disabled" : "active"}">${u.banned ? "banned" : "ok"}</span>${u.reviewRequired ? ' <span class="badge neutral">review</span>' : ""}</td>
    <td class="r"><button type="button" class="btn ${u.banned ? "btn-ghost" : "btn-danger"} btn-sm" data-uid="${escapeHtml(u.id)}" data-ban="${u.banned ? "0" : "1"}">${u.banned ? "Unban" : "Ban"}</button></td></tr>`).join("");
}
$("userSearch").addEventListener("input", renderUsers);
$("btnRefreshUsers").addEventListener("click", loadUsers);
uBody.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-uid]");
  if (!b) return;
  const ban = b.dataset.ban === "1";
  if (!confirm(ban ? "Ban this member? Their links are disabled and they cannot earn or withdraw." : "Remove the ban on this member?")) return;
  b.disabled = true;
  try { await call("adminSetBan", { uid: b.dataset.uid, banned: ban }); showToast(ban ? "Member banned." : "Ban removed.", "success"); loadUsers(); }
  catch (err) { showToast(err.message || "Action failed", "error"); b.disabled = false; }
});

/* ---------------- Links ---------------- */
let lRows = [];
const lBody = $("linksAdminTbody");
async function loadLinks() {
  lBody.innerHTML = empty(7, "Loading links");
  try {
    const [snap, bl] = await Promise.all([
      getDocs(query(collection(db, "links"), orderBy("createdAt", "desc"), limit(300))),
      getDoc(doc(db, "config", "blocklist"))
    ]);
    lRows = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
    const hosts = bl.exists() ? bl.data().hosts || [] : [];
    $("blockedHosts").textContent = hosts.length ? hosts.join(", ") : "None yet";
    renderLinks();
  } catch (err) { lBody.innerHTML = fail(7, err); }
}
function renderLinks() {
  const q = $("linkSearch").value.trim().toLowerCase();
  const list = q ? lRows.filter((l) => l.code.toLowerCase().includes(q) || (l.host || "").includes(q) || (l.url || "").toLowerCase().includes(q) || (l.ownerUid || "").includes(q)) : lRows;
  if (!list.length) { lBody.innerHTML = empty(7, lRows.length ? "No link matches that search." : "No links yet."); return; }
  lBody.innerHTML = list.map((l) => {
    const status = l.status || "active";
    const off = status === "disabled";
    return `<tr>
      <td class="num"><a href="/l/${escapeHtml(l.code)}" target="_blank" rel="noopener">${escapeHtml(l.code)}</a></td>
      <td><span class="url" title="${escapeHtml(l.url || "")}">${escapeHtml(l.url || "")}</span></td>
      <td class="num muted" title="${escapeHtml(l.ownerUid || "")}">${escapeHtml((l.ownerUid || "").slice(0, 8))}</td>
      <td class="r num">${n(l.validClicks).toLocaleString("en-IN")} / ${n(l.clicks).toLocaleString("en-IN")}</td>
      <td class="r num">${escapeHtml(formatRupees(l.earnedPaise || 0))}</td>
      <td><span class="badge ${off ? "disabled" : status === "active" ? "active" : "neutral"}">${escapeHtml(status)}</span></td>
      <td class="r"><div class="acts"><button type="button" class="btn ${off ? "btn-ghost" : "btn-danger"} btn-sm" data-code="${escapeHtml(l.code)}" data-set="${off ? "active" : "disabled"}">${off ? "Enable" : "Disable"}</button><button type="button" class="btn btn-ghost btn-sm" data-block="${escapeHtml(l.host || "")}">Block site</button></div></td></tr>`;
  }).join("");
}
$("linkSearch").addEventListener("input", renderLinks);
$("btnRefreshLinks").addEventListener("click", loadLinks);
lBody.addEventListener("click", async (e) => {
  const s = e.target.closest("button[data-set]");
  const k = e.target.closest("button[data-block]");
  try {
    if (s) {
      const disabling = s.dataset.set === "disabled";
      const reason = disabling ? prompt("Reason (shown to the link owner):", "Breaks our link rules") : "";
      if (disabling && reason === null) return;
      s.disabled = true;
      await call("adminSetLinkStatus", { code: s.dataset.code, status: s.dataset.set, reason });
      loadLinks();
    } else if (k && k.dataset.block) {
      if (!confirm(`Block ${k.dataset.block}? Every link to this site is disabled and new links to it are refused.`)) return;
      k.disabled = true;
      const r = await call("adminBlockHost", { host: k.dataset.block });
      showToast(`Blocked. ${r.disabled} links disabled.`, "success");
      loadLinks();
    }
  } catch (err) { showToast(err.message || "Action failed", "error"); loadLinks(); }
});
$("blockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const host = $("blockInput").value.trim();
  if (!host) return;
  try {
    const r = await call("adminBlockHost", { host });
    $("blockInput").value = "";
    showToast(`Blocked ${host}. ${r.disabled} links disabled.`, "success");
    loadLinks();
  } catch (err) { showToast(err.message || "Could not block that site", "error"); }
});

/* ---------------- Reports ---------------- */
const rBody = $("reportsTbody");
async function loadReports() {
  rBody.innerHTML = empty(4, "Loading reports");
  try {
    const snap = await getDocs(query(collection(db, "reports"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(100)));
    if (snap.empty) { rBody.innerHTML = empty(4, "No open reports."); return; }
    rBody.innerHTML = snap.docs.map((d) => {
      const r = d.data();
      return `<tr><td class="num muted">${escapeHtml(when(r.createdAt))}</td><td class="num"><a href="/l/${escapeHtml(r.code)}" target="_blank" rel="noopener">${escapeHtml(r.code)}</a></td><td>${escapeHtml(r.reason || "")}</td><td class="r"><div class="acts"><button type="button" class="btn btn-danger btn-sm" data-rcode="${escapeHtml(r.code)}" data-rid="${escapeHtml(d.id)}">Disable link</button><button type="button" class="btn btn-ghost btn-sm" data-rid="${escapeHtml(d.id)}">Dismiss</button></div></td></tr>`;
    }).join("");
  } catch (err) { rBody.innerHTML = fail(4, err); }
}
$("btnRefreshReports").addEventListener("click", loadReports);
rBody.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-rid]");
  if (!b) return;
  b.disabled = true;
  try {
    if (b.dataset.rcode) await call("adminSetLinkStatus", { code: b.dataset.rcode, status: "disabled", reason: "Reported and reviewed" });
    await call("adminResolveReport", { id: b.dataset.rid });
    loadReports();
  } catch (err) { showToast(err.message || "Action failed", "error"); b.disabled = false; }
});

/* ---------------- Postback log ---------------- */
async function loadPostbacks() {
  const body = $("postbackTbody");
  body.innerHTML = empty(6, "Loading log");
  try {
    const snap = await getDocs(query(collection(db, "processedPostbacks"), orderBy("processedAt", "desc"), limit(100)));
    if (snap.empty) { body.innerHTML = empty(6, "No partner notices received yet."); return; }
    body.innerHTML = snap.docs.map((d) => {
      const p = d.data();
      const good = p.outcome === "earn" || p.outcome === "reversal";
      return `<tr><td class="num muted">${escapeHtml(when(p.processedAt))}</td><td>${escapeHtml(p.network || "")}</td><td class="num muted" title="${escapeHtml(p.txId || "")}">${escapeHtml(String(p.txId || "").slice(0, 14))}</td><td class="num muted" title="${escapeHtml(p.uid || "")}">${escapeHtml(String(p.uid || "").slice(0, 8))}</td><td class="r num">${escapeHtml(formatRupees(p.amountPaise || 0))}</td><td><span class="badge ${good ? "active" : "neutral"}">${escapeHtml(p.outcome || "")}</span></td></tr>`;
    }).join("");
  } catch (err) { body.innerHTML = fail(6, err); }
}

/* ---------------- CSV export ---------------- */
function csvText(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
function download(name, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
const today = () => new Date().toISOString().slice(0, 10);
$("btnExportWithdrawals").addEventListener("click", () => {
  if (!wRows.length) return showToast("No records to export.", "info");
  const lines = wRows.map((w) => [csvText(w.id), csvText(w.createdAt?.toDate ? w.createdAt.toDate().toISOString() : ""), csvText(w.uid), csvText(w.upiId), csvText(w.status), (n(w.amountPaise) / 100).toFixed(2)].join(","));
  download(`anticash-withdrawals-${today()}.csv`, ["Withdrawal_ID,Date,UID,UPI_ID,Status,Amount_INR", ...lines].join("\r\n"));
});
$("btnExportTransactions").addEventListener("click", async (e) => {
  const btn = e.currentTarget, label = btn.textContent;
  btn.disabled = true; btn.textContent = "Exporting";
  try {
    const snap = await getDocs(query(collectionGroup(db, "transactions"), orderBy("createdAt", "desc")));
    const lines = snap.docs.map((d) => { const t = d.data(); return [csvText(d.id), csvText(t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : ""), csvText(t.type), csvText(t.description), csvText(t.network || t.method), csvText(t.status), (n(t.amountPaise) / 100).toFixed(2)].join(","); });
    download(`anticash-transactions-${today()}.csv`, ["Transaction_ID,Date,Type,Description,Network,Status,Amount_INR", ...lines].join("\r\n"));
  } catch (err) { showToast("Export failed: " + err.message, "error"); }
  finally { btn.disabled = false; btn.textContent = label; }
});

const LOADERS = { overview: loadOverview, withdrawals: loadWithdrawals, members: loadUsers, links: loadLinks, reports: loadReports, postbacks: loadPostbacks };

import { initAuth, onUserChange, db, functions, escapeHtml, showToast } from "../auth.js";
import { formatRupees, LINK_RATES, LINK_BASE } from "../app-config.js";
import { collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

initAuth();

const $ = (id) => document.getElementById(id);
const form = $("shortenForm");
const input = $("urlInput");
const btn = $("btnShorten");
const msg = $("shortenMsg");
const out = $("linkOut");
const tbody = $("linksTbody");
let rows = [];
let uid = null;
let busy = false;

// Rates shown on the page come from one place (app-config.js)
document.querySelectorAll("[data-rate]").forEach((el) => {
  const per1000 = LINK_RATES[el.dataset.rate];
  if (per1000) el.textContent = formatRupees(per1000).replace(".00", "");
});

onUserChange((user, data, loaded) => {
  if (!user || !loaded) return;
  if (uid !== user.uid) { uid = user.uid; load(); }
  const banned = Boolean(data && data.banned);
  btn.disabled = banned || busy;
  if (banned) say("Your account is suspended, so you cannot create links.", false);
});

function say(text, ok) {
  msg.textContent = text;
  msg.className = "alert " + (text ? (ok ? "is-success" : "is-error") : "");
}

function shortUrl(code) { return LINK_BASE + code; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  say("", true);
  let url = input.value.trim();
  if (!url) { say("Paste the web address you want to shorten.", false); input.focus(); return; }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
  busy = true; btn.disabled = true; btn.textContent = "Creating";
  try {
    if (!functions) throw new Error("The service is not connected yet.");
    const res = await httpsCallable(functions, "createLink")({ url });
    const code = res.data.code;
    $("newShort").textContent = shortUrl(code).replace("https://", "");
    $("newShort").dataset.full = shortUrl(code);
    out.classList.add("on");
    input.value = "";
    showToast("Short link created.", "success");
    load();
  } catch (err) {
    say(err.message || "Could not create the link.", false);
  } finally {
    busy = false; btn.disabled = false; btn.textContent = "Shorten";
  }
});

async function copy(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    const old = el.textContent;
    el.textContent = "Copied";
    setTimeout(() => (el.textContent = old), 1500);
  } catch (e) { showToast("Could not copy. Select the link and copy it by hand.", "error"); }
}
$("btnCopyNew").addEventListener("click", (e) => copy($("newShort").dataset.full || "", e.currentTarget));

async function load() {
  if (!db || !uid) return;
  try {
    const snap = await getDocs(query(collection(db, "links"), where("ownerUid", "==", uid), orderBy("createdAt", "desc"), limit(100)));
    rows = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
    render();
  } catch (err) {
    console.warn("links load failed", err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty">We could not load your links. Please refresh the page.</td></tr>`;
  }
}

function render() {
  let views = 0, valid = 0, earned = 0;
  rows.forEach((l) => { views += Number(l.clicks) || 0; valid += Number(l.validClicks) || 0; earned += Number(l.earnedPaise) || 0; });
  $("statLinks").textContent = rows.length;
  $("statViews").textContent = valid.toLocaleString("en-IN");
  $("statEarned").textContent = formatRupees(earned);
  $("statViewsHint").textContent = views ? `${views.toLocaleString("en-IN")} total opens, ${valid.toLocaleString("en-IN")} counted` : "Counted views only";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty"><p>You have not created any links yet.</p></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((l) => {
    const status = l.status || "active";
    const canToggle = status !== "disabled";
    const toggle = canToggle
      ? `<button type="button" class="btn btn-ghost btn-sm" data-act="${status === "active" ? "paused" : "active"}" data-code="${escapeHtml(l.code)}">${status === "active" ? "Pause" : "Resume"}</button>`
      : `<span class="muted" title="${escapeHtml(l.disabledReason || "")}">Disabled</span>`;
    return `<tr>
      <td class="num"><a href="${escapeHtml(shortUrl(l.code))}" target="_blank" rel="noopener">anticash.tech/l/${escapeHtml(l.code)}</a></td>
      <td><span class="url" title="${escapeHtml(l.url || "")}">${escapeHtml(l.host || l.url || "")}</span></td>
      <td class="r num">${(Number(l.validClicks) || 0).toLocaleString("en-IN")}</td>
      <td class="r num pos">${escapeHtml(formatRupees(l.earnedPaise || 0))}</td>
      <td><span class="badge ${status === "active" ? "active" : status === "disabled" ? "disabled" : "neutral"}">${escapeHtml(status)}</span></td>
      <td class="r"><div class="acts"><button type="button" class="btn btn-ghost btn-sm" data-copy="${escapeHtml(shortUrl(l.code))}">Copy</button>${toggle}</div></td>
    </tr>`;
  }).join("");
}

tbody.addEventListener("click", async (e) => {
  const c = e.target.closest("button[data-copy]");
  if (c) return copy(c.dataset.copy, c);
  const t = e.target.closest("button[data-act]");
  if (!t) return;
  t.disabled = true;
  try {
    await httpsCallable(functions, "updateMyLink")({ code: t.dataset.code, status: t.dataset.act });
    load();
  } catch (err) {
    showToast(err.message || "Could not update the link.", "error");
    t.disabled = false;
  }
});

import { initAuth, onUserChange, db, escapeHtml, showToast } from "../auth.js";
import { formatRupees } from "../app-config.js";
import { collection, query, orderBy, limit, getDocs, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

initAuth();

const $ = (id) => document.getElementById(id);
const panel = $("onboardingPanel");
const filterSelect = $("statementStatusFilter");
let transactions = [];
let loadedFor = null;
let hasWithdrawal = false;
let confirmedPaise = 0;

try {
  if (panel && localStorage.getItem("anticash_onboarding_dismissed") !== "true") panel.hidden = false;
} catch (e) { if (panel) panel.hidden = false; }

$("btnDismissOnboarding")?.addEventListener("click", () => {
  panel.hidden = true;
  try { localStorage.setItem("anticash_onboarding_dismissed", "true"); } catch (e) {}
});

$("btnCopyUid")?.addEventListener("click", async (e) => {
  const uid = document.querySelector("[data-user-uid]")?.textContent || "";
  try {
    await navigator.clipboard.writeText(uid);
    e.target.textContent = "Copied";
    setTimeout(() => (e.target.textContent = "Copy"), 1600);
  } catch (err) {
    showToast("Could not copy. Select the ID and copy it by hand.", "error");
  }
});

function flag(key) {
  try { return localStorage.getItem(key) === "true"; } catch (e) { return false; }
}

function updateChecklist() {
  $("taskBrowseOffersItem")?.classList.toggle("done", flag("anticash_has_browsed_offers"));
  $("taskThresholdItem")?.classList.toggle("done", confirmedPaise >= 30000 || hasWithdrawal);
  $("taskUpiItem")?.classList.toggle("done", hasWithdrawal);
}

onUserChange((user, data, loaded) => {
  if (!user || !loaded) return;
  confirmedPaise = Number(data?.confirmedBalancePaise) || 0;
  updateChecklist();
  if (loadedFor !== user.uid) {
    loadedFor = user.uid;
    loadActivity(user.uid);
  }
});

async function loadActivity(uid) {
  const tbody = $("statementTbody");
  if (!db) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Activity is unavailable right now.</td></tr>`;
    return;
  }
  try {
    const wSnap = await getDocs(query(collection(db, "withdrawals"), where("uid", "==", uid)));
    let paid = 0;
    wSnap.forEach((d) => {
      const w = d.data();
      if (w.status === "paid") paid += Number(w.amountPaise) || 0;
    });
    hasWithdrawal = !wSnap.empty;
    const el = $("valTotalWithdrawn");
    el.classList.remove("skeleton");
    el.removeAttribute("style");
    el.textContent = formatRupees(paid);
    updateChecklist();

    const snap = await getDocs(query(collection(db, "users", uid, "transactions"), orderBy("createdAt", "desc"), limit(50)));
    transactions = [];
    snap.forEach((d) => transactions.push({ id: d.id, ...d.data() }));
    render();
  } catch (err) {
    console.warn("Failed to load wallet activity:", err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty">We could not load your activity. Please refresh the page.</td></tr>`;
  }
}

const LABELS = { earn: "Offer completed", reversal: "Offer reversed by partner", withdrawal: "UPI withdrawal", refund: "Withdrawal returned" };
function describe(tx) { return tx.description || LABELS[tx.type] || "Activity"; }
function partner(tx) { return tx.network || (tx.method === "upi" ? "UPI" : "AntiCash"); }
function dateOf(tx, iso) {
  const d = tx.createdAt && tx.createdAt.toDate ? tx.createdAt.toDate() : null;
  if (!d) return iso ? "" : "Just now";
  return iso ? d.toISOString().slice(0, 10) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function render() {
  const tbody = $("statementTbody");
  const f = filterSelect.value;
  const list = f === "all" ? transactions : transactions.filter((t) => (t.status || "pending").toLowerCase() === f);
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty"><p>${transactions.length ? "Nothing matches this filter." : "No activity yet. Start with an offer or share a short link."}</p>${transactions.length ? "" : '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a href="earn.html" class="btn btn-primary btn-sm">Find offers</a><a href="links.html" class="btn btn-ghost btn-sm">Make a short link</a></div>'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((tx) => {
    const paise = Number(tx.amountPaise) || 0;
    const status = (tx.status || "pending").toLowerCase();
    return `<tr>
      <td class="num muted">${escapeHtml(dateOf(tx))}</td>
      <td>${escapeHtml(describe(tx))}</td>
      <td class="muted">${escapeHtml(partner(tx))}</td>
      <td><span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
      <td class="r num ${paise >= 0 ? "pos" : ""}">${paise >= 0 ? "+" : ""}${escapeHtml(formatRupees(paise))}</td>
    </tr>`;
  }).join("");
}

filterSelect.addEventListener("change", render);

function csvText(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}

$("btnDownloadStatementCsv").addEventListener("click", () => {
  if (!transactions.length) { showToast("There is nothing to export yet.", "info"); return; }
  const rows = transactions.map((tx) =>
    [dateOf(tx, true), csvText(describe(tx)), csvText(partner(tx)), csvText(tx.status || "pending"), ((Number(tx.amountPaise) || 0) / 100).toFixed(2)].join(","));
  const csv = ["Date,Activity,Partner,Status,Amount_INR", ...rows].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `anticash-statement-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

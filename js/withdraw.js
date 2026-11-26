import { initAuth, onUserChange, db, functions, escapeHtml } from "../auth.js";
import { formatRupees, getWithdrawalProgress, MIN_WITHDRAWAL_PAISE } from "../app-config.js";
import { collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

initAuth();

const $ = (id) => document.getElementById(id);
const balance = $("withdrawConfirmedDisplay");
const notice = $("thresholdNotice");
const fieldset = $("withdrawFieldset");
const upiInput = $("upiInput");
const amountInput = $("amountInput");
const confirmBox = $("confirmCheckbox");
const form = $("withdrawForm");
const submitBtn = $("btnSubmitWithdraw");
const alertBox = $("alertBox");
const tbody = $("userWithdrawalsTbody");

let confirmedPaise = 0;
let uid = null;
let busy = false;
let listLoadedFor = null;

onUserChange((user, data, loaded) => {
  if (!user || !loaded) return;
  uid = user.uid;
  confirmedPaise = Number(data?.confirmedBalancePaise) || 0;
  balance.textContent = formatRupees(confirmedPaise);
  balance.classList.remove("skeleton");
  balance.removeAttribute("style");

  const prog = getWithdrawalProgress(confirmedPaise);
  const banned = Boolean(data?.banned);
  const locked = !prog.isReady || banned;
  notice.hidden = !locked;
  $("thresholdFractionText").textContent = `${prog.currentFormatted} of ${prog.targetFormatted}`;
  $("thresholdProgressBar").style.width = prog.percent + "%";
  $("thresholdNoticeMsg").textContent = banned
    ? "Your account is suspended, so withdrawals are disabled."
    : `You have ${prog.currentFormatted}. You need ${prog.formattedNeeded} more in Available to withdraw.`;
  if (!busy) {
    fieldset.disabled = locked;
    submitBtn.disabled = locked;
  }
  if (!locked && !amountInput.value) amountInput.value = toInput(confirmedPaise);

  if (listLoadedFor !== uid) { listLoadedFor = uid; loadPast(uid); }
});

function toInput(paise) {
  const s = (paise / 100).toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

$("btnMaxWithdraw").addEventListener("click", () => { amountInput.value = toInput(confirmedPaise); });

function say(msg, ok) {
  alertBox.textContent = msg;
  alertBox.className = "alert " + (ok ? "is-success" : "is-error");
}
function clearMsg() { alertBox.className = "alert"; alertBox.textContent = ""; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  clearMsg();

  const upi = upiInput.value.trim();
  if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upi)) {
    say("Enter a valid UPI ID, such as name@bank or 9876543210@paytm.", false);
    upiInput.focus();
    return;
  }
  const rupees = Number(amountInput.value);
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || paise < MIN_WITHDRAWAL_PAISE) {
    say(`The minimum withdrawal is ₹${MIN_WITHDRAWAL_PAISE / 100}.`, false);
    amountInput.focus();
    return;
  }
  if (paise > confirmedPaise) {
    say(`You only have ${formatRupees(confirmedPaise)} available.`, false);
    amountInput.focus();
    return;
  }
  if (!confirmBox.checked) {
    say("Please tick the box to confirm your UPI ID is correct.", false);
    confirmBox.focus();
    return;
  }

  busy = true;
  submitBtn.disabled = true;
  const label = submitBtn.textContent;
  submitBtn.textContent = "Sending request";
  try {
    if (!functions) throw new Error("The payout service is not connected yet.");
    await httpsCallable(functions, "createWithdrawal")({ method: "upi", upiId: upi, amountPaise: paise });
    try { localStorage.setItem("anticash_upi_configured", "true"); } catch (e2) {}
    say(`Request for ${formatRupees(paise)} sent. We review it within 24 to 48 business hours.`, true);
    form.reset();
    amountInput.value = "";
    if (uid) loadPast(uid);
  } catch (err) {
    say(err && err.message ? err.message : "The request did not go through. Please try again.", false);
  } finally {
    busy = false;
    submitBtn.textContent = label;
    const prog = getWithdrawalProgress(confirmedPaise);
    submitBtn.disabled = !prog.isReady;
  }
});

async function loadPast(u) {
  if (!db) return;
  try {
    const snap = await getDocs(query(collection(db, "withdrawals"), where("uid", "==", u), orderBy("createdAt", "desc")));
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">No requests yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs.map((d) => {
      const w = d.data();
      const date = w.createdAt && w.createdAt.toDate ? w.createdAt.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Just now";
      const status = (w.status || "pending").toLowerCase();
      return `<tr><td class="num muted">${escapeHtml(date)}</td><td class="num">${escapeHtml(w.upiId || "")}</td><td><span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span></td><td class="r num">${escapeHtml(formatRupees(w.amountPaise || 0))}</td></tr>`;
    }).join("");
  } catch (err) {
    console.warn("Error loading withdrawals:", err);
    tbody.innerHTML = `<tr><td colspan="4" class="empty">We could not load your requests. Please refresh.</td></tr>`;
  }
}

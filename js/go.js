import { functions } from "../auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { ADS, injectSnippet } from "./ads.js";

const $ = (id) => document.getElementById(id);
const CODE_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{5,12}$/i;
const params = new URLSearchParams(location.search);
const code = (params.get("c") || "").trim();

injectSnippet($("adTop"), ADS.goTopSnippet);
injectSnippet($("adBottom"), ADS.goBottomSnippet);

const ring = document.querySelector(".ring .fg");
const num = $("count");
const btn = $("btnContinue");
const title = $("goTitle");
const dest = $("dest");
const note = $("goNote");

function fail(text) {
  title.textContent = "This link is not available";
  note.textContent = text;
  document.querySelector(".ring").hidden = true;
  btn.hidden = true;
  dest.hidden = true;
}

async function start() {
  if (!CODE_RE.test(code)) return fail("The address looks incomplete. Check the link you were given.");
  if (!functions) return fail("The service is not connected right now. Please try again later.");
  let s;
  try {
    s = (await httpsCallable(functions, "startView")({ code })).data;
  } catch (err) {
    return fail(err.code === "functions/not-found" ? "This link was removed, paused or never existed." : "We could not load this link. Please try again in a moment.");
  }
  dest.textContent = s.host;
  title.textContent = "Your link is almost ready";
  note.textContent = "Wait for the timer, then continue. You are about to leave AntiCash.";
  let left = s.wait;
  num.textContent = left;
  requestAnimationFrame(() => { ring.style.strokeDashoffset = "0"; ring.style.transitionDuration = s.wait + "s"; });
  const timer = setInterval(() => {
    left -= 1;
    num.textContent = Math.max(left, 0);
    if (left <= 0) { clearInterval(timer); ready(s); }
  }, 1000);
}

function ready(s) {
  btn.disabled = false;
  btn.textContent = "Continue to link";
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Opening";
    try {
      const r = await httpsCallable(functions, "finishView")({ code, token: s.token, ts: s.ts });
      location.href = r.data.url;
    } catch (err) {
      note.textContent = err.message || "Something went wrong. Please open the link again.";
      btn.textContent = "Try again";
      btn.disabled = false;
    }
  };
}

$("btnReport").addEventListener("click", async () => {
  const reason = prompt("What is wrong with this link? (for example: phishing, malware, adult content)");
  if (!reason || reason.trim().length < 3) return;
  try {
    await httpsCallable(functions, "reportLink")({ code, reason });
    note.textContent = "Thank you. We will review this link.";
  } catch (err) { note.textContent = err.message || "Could not send the report."; }
});

start();

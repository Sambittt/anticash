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
const step1 = $("goStep1");
const step2 = $("goStep2");
const step3 = $("goStep3");

/* Ambient particle backdrop for countdown page */
(function initGoParticles() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = $("goParticles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let w = 0, h = 0, dpr = 1, pts = [], raf = null, running = false;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed() {
    pts = [];
    for (let i = 0; i < 26; i++) {
      pts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.4 + 0.9,
        a: Math.random() * 0.25 + 0.15
      });
    }
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; else if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; else if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(45, 226, 166, ${p.a})`;
      ctx.fill();
    }
    if (running) raf = requestAnimationFrame(draw);
  }
  function start() { if (!running) { running = true; draw(); } }
  function stop() { running = false; if (raf) { cancelAnimationFrame(raf); raf = null; } }
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  resize(); seed(); start();
})();

function setStep(active) {
  [step1, step2, step3].forEach((el, idx) => {
    if (el) el.classList.toggle("on", idx + 1 <= active);
  });
}

function fail(text) {
  title.textContent = "This link is not available";
  note.textContent = text;
  document.querySelector(".ring").hidden = true;
  btn.hidden = true;
  dest.hidden = true;
  const stepsEl = $("goSteps");
  if (stepsEl) stepsEl.hidden = true;
}

async function start() {
  setStep(1);
  if (!CODE_RE.test(code)) return fail("The address looks incomplete. Check the link you were given.");
  if (!functions) return fail("The service is not connected right now. Please try again later.");
  let s;
  try {
    s = (await httpsCallable(functions, "startView")({ code })).data;
  } catch (err) {
    return fail(err.code === "functions/not-found" ? "This link was removed, paused or never existed." : "We could not load this link. Please try again in a moment.");
  }
  setStep(2);
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
  setStep(3);
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

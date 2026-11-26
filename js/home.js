/* AntiCash landing page: phone loop, 3D tilt, link earnings estimate. */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function inr(n) { return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ---- Sample phone: balance counts up, rows slide in, then it loops ---- */
  var amt = $("#phAmt"), bar = $("#phBar");
  var rows = $$("#phList .ph-row");
  var stage = $("#stage");
  var visible = true;
  if (stage && "IntersectionObserver" in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }, { threshold: 0.1 }).observe(stage);
  }
  function tween(from, to, ms, cb) {
    if (reduced) { cb(to); return; }
    var t0 = performance.now();
    (function f(now) {
      var t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
      cb(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(f);
    })(t0);
  }
  var values = [35, 120, 62];
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function loop() {
    if (!amt) return;
    var bal = 0;
    for (;;) {
      while (!visible) await wait(500);
      rows.forEach(function (r) { r.classList.remove("on"); });
      bar.style.width = "0%";
      tween(bal, 0, 400, function (v) { amt.textContent = inr(v); });
      bal = 0;
      await wait(700);
      for (var i = 0; i < 3; i++) {
        rows[i].classList.add("on");
        var from = bal; bal += values[i];
        tween(from, bal, 900, function (v) { amt.textContent = inr(v); });
        bar.style.width = Math.min(100, Math.round(bal / 300 * 100)) + "%";
        await wait(1300);
      }
      bal = 300;
      tween(217, 300, 900, function (v) { amt.textContent = inr(v); });
      bar.style.width = "100%";
      rows[3].classList.add("on");
      await wait(4200);
    }
  }
  loop();

  /* ---- 3D tilt on the phone ---- */
  var phone = $("#phone");
  if (phone && stage && !reduced && window.matchMedia("(hover: hover)").matches) {
    stage.addEventListener("pointermove", function (e) {
      var r = stage.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      phone.style.animation = "none";
      phone.style.transform = "rotateY(" + (-14 + x * 22) + "deg) rotateX(" + (6 - y * 18) + "deg) rotateZ(2deg)";
    });
    stage.addEventListener("pointerleave", function () {
      phone.style.transform = "";
      phone.style.animation = "";
    });
  }

  /* ---- Link earnings estimate. Keep these rates equal to LINK_RATES in app-config.js and functions/index.js ---- */
  var RATES = { india: 50, tier1: 200, other: 80 }; // rupees per 1,000 valid views
  var tier = "india";
  var range = $("#calcRange"), views = $("#calcViews"), out = $("#calcOut"), rates = $("#calcRates");
  var shown = 0;
  function calc() {
    if (!range) return;
    var v = Number(range.value);
    views.textContent = v.toLocaleString("en-IN");
    var total = v / 1000 * RATES[tier];
    rates.textContent = "₹" + RATES[tier];
    tween(shown, total, 500, function (x) { out.textContent = "₹" + Math.round(x).toLocaleString("en-IN"); });
    shown = total;
  }
  if (range) {
    range.addEventListener("input", calc);
    $$("[data-tier]").forEach(function (b) {
      b.addEventListener("click", function () {
        tier = b.getAttribute("data-tier");
        $$("[data-tier]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        calc();
      });
    });
    calc();
  }
})();

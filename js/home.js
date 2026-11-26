/* AntiCash landing page: constellation canvas, damped 3D spring tilt, phone loop, steps choreography, FAQ filter, calculator. */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(s, ctx) { return (ctx || document).querySelector(s); }
  function $$(s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); }
  function inr(n) { return "\u20B9" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ---- 1. Ambient Constellation Particle Canvas in Hero ---- */
  (function initParticles() {
    var canvas = $("#heroParticles");
    if (!canvas || reduced) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var hero = canvas.closest(".hero-dark") || canvas.parentElement;
    var w = 0, h = 0, dpr = 1, nodes = [], raf = null, running = false;
    var pointer = { x: -9999, y: -9999, active: false };
    var palette = ["45, 226, 166", "53, 201, 255", "124, 92, 255"];
    var mobile = window.innerWidth < 768;
    var count = mobile ? 24 : 46;
    var linkDist = mobile ? 105 : 145;

    function resize() {
      if (!hero) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = hero.clientWidth;
      h = hero.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      nodes = [];
      for (var i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.42,
          vy: (Math.random() - 0.5) * 0.42,
          r: Math.random() * 1.4 + 1.1,
          c: palette[i % palette.length],
          a: Math.random() * 0.35 + 0.25
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < nodes.length; i++) {
        var p = nodes[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; else if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; else if (p.y > h) p.y = 0;

        var glow = 0;
        if (pointer.active) {
          var dxp = pointer.x - p.x, dyp = pointer.y - p.y;
          var dp = Math.sqrt(dxp * dxp + dyp * dyp);
          if (dp < 160 && dp > 0) {
            var push = (1 - dp / 160) * 0.65;
            p.x -= (dxp / dp) * push;
            p.y -= (dyp / dp) * push;
            glow = (1 - dp / 160) * 0.35;
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + glow * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + p.c + ", " + Math.min(0.9, p.a + glow) + ")";
        ctx.fill();

        for (var j = i + 1; j < nodes.length; j++) {
          var q = nodes[j];
          var dx = p.x - q.x, dy = p.y - q.y;
          var distSq = dx * dx + dy * dy;
          if (distSq < linkDist * linkDist) {
            var d = Math.sqrt(distSq);
            var alpha = (1 - d / linkDist) * 0.16;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = "rgba(45, 226, 166, " + alpha.toFixed(3) + ")";
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      if (running) raf = requestAnimationFrame(frame);
    }

    function start() { if (!running) { running = true; frame(); } }
    function stop() { running = false; if (raf) { cancelAnimationFrame(raf); raf = null; } }

    if (hero) {
      hero.addEventListener("pointermove", function (e) {
        var r = hero.getBoundingClientRect();
        pointer.x = e.clientX - r.left;
        pointer.y = e.clientY - r.top;
        pointer.active = true;
      }, { passive: true });
      hero.addEventListener("pointerleave", function () { pointer.active = false; });
    }
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });

    if ("IntersectionObserver" in window && hero) {
      new IntersectionObserver(function (e) {
        e[0].isIntersecting && !document.hidden ? start() : stop();
      }, { threshold: 0.05 }).observe(hero);
    } else {
      start();
    }

    resize();
    seed();
    start();
  })();

  /* ---- 2. Sample phone: balance counts up, rows slide in with Pending->Confirmed pill, loops ---- */
  var amt = $("#phAmt"), bar = $("#phBar");
  var rows = $$("#phList .ph-row");
  var stage = $("#stage");
  var stageGlow = $("#stageGlow");
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
      rows.forEach(function (r) {
        r.classList.remove("on", "confirmed");
        var st = r.querySelector(".st-pill");
        if (st) st.textContent = "Pending";
      });
      bar.style.width = "0%";
      if (stageGlow) stageGlow.style.opacity = "0.5";
      tween(bal, 0, 400, function (v) { amt.textContent = inr(v); });
      bal = 0;
      await wait(700);
      for (var i = 0; i < 3; i++) {
        rows[i].classList.add("on");
        var from = bal; bal += values[i];
        tween(from, bal, 900, function (v) { amt.textContent = inr(v); });
        bar.style.width = Math.min(100, Math.round(bal / 300 * 100)) + "%";
        await wait(650);
        rows[i].classList.add("confirmed");
        var st = rows[i].querySelector(".st-pill");
        if (st) st.textContent = "Confirmed";
        await wait(650);
      }
      bal = 300;
      tween(217, 300, 900, function (v) { amt.textContent = inr(v); });
      bar.style.width = "100%";
      if (stageGlow) stageGlow.style.opacity = "0.95";
      rows[3].classList.add("on", "confirmed");
      var st3 = rows[3].querySelector(".st-pill");
      if (st3) st3.textContent = "Paid";
      await wait(4200);
    }
  }
  loop();

  /* ---- 3. Damped Spring LERP 3D tilt on the phone + multi-plane parallax for floating cards ---- */
  var phone = $("#phone");
  var floats = $$(".float-card", stage || document);
  if (phone && stage && !reduced && window.matchMedia("(hover: hover)").matches) {
    var targetRX = 6, targetRY = -14, targetX = 0, targetY = 0;
    var curRX = 6, curRY = -14, curX = 0, curY = 0;
    var hovering = false, springRaf = null;

    function tickSpring() {
      curRX += (targetRX - curRX) * 0.12;
      curRY += (targetRY - curRY) * 0.12;
      curX += (targetX - curX) * 0.12;
      curY += (targetY - curY) * 0.12;

      phone.style.transform = "rotateY(" + curRY.toFixed(2) + "deg) rotateX(" + curRX.toFixed(2) + "deg) rotateZ(2deg)";
      floats.forEach(function (fc, idx) {
        var mult = idx === 0 ? 18 : idx === 1 ? -14 : 12;
        fc.style.transform = "translate3d(" + (curX * mult).toFixed(1) + "px, " + (curY * mult).toFixed(1) + "px, 0)";
      });
      if (stageGlow) {
        stageGlow.style.transform = "translate3d(" + (curX * 26).toFixed(1) + "px, " + (curY * 26).toFixed(1) + "px, 0)";
      }

      var settled = !hovering &&
        Math.abs(targetRX - curRX) < 0.05 &&
        Math.abs(targetRY - curRY) < 0.05 &&
        Math.abs(curX) < 0.01 &&
        Math.abs(curY) < 0.01;
      if (settled) {
        phone.style.transform = "";
        phone.style.animation = "";
        floats.forEach(function (fc) { fc.style.transform = ""; });
        springRaf = null;
      } else {
        springRaf = requestAnimationFrame(tickSpring);
      }
    }

    stage.addEventListener("pointermove", function (e) {
      var r = stage.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      hovering = true;
      phone.style.animation = "none";
      targetRY = -14 + x * 24;
      targetRX = 6 - y * 18;
      targetX = x;
      targetY = y;
      if (!springRaf) springRaf = requestAnimationFrame(tickSpring);
    });
    stage.addEventListener("pointerleave", function () {
      hovering = false;
      targetRY = -14; targetRX = 6; targetX = 0; targetY = 0;
      if (!springRaf) springRaf = requestAnimationFrame(tickSpring);
    });
  }

  /* ---- 4. Step highlight choreography in #how ---- */
  var steps = $$("#how .step");
  var howSec = $("#how");
  if (steps.length && howSec && !reduced && "IntersectionObserver" in window) {
    var howVis = false, activeStep = 0;
    new IntersectionObserver(function (e) { howVis = e[0].isIntersecting; }, { threshold: 0.2 }).observe(howSec);
    setInterval(function () {
      if (!howVis) return;
      steps.forEach(function (s, idx) { s.classList.toggle("is-lit", idx === activeStep); });
      activeStep = (activeStep + 1) % steps.length;
    }, 1200);
  }

  /* ---- 5. FAQ Category Filters ---- */
  var faqPills = $$(".faq-pill");
  var faqItems = $$("#faq details.qa");
  if (faqPills.length && faqItems.length) {
    faqPills.forEach(function (pill) {
      pill.addEventListener("click", function () {
        var cat = pill.getAttribute("data-faq-filter");
        faqPills.forEach(function (p) { p.setAttribute("aria-pressed", String(p === pill)); });
        faqItems.forEach(function (item) {
          var itemCat = item.getAttribute("data-cat") || "all";
          item.hidden = !(cat === "all" || itemCat === cat);
        });
      });
    });
  }

  /* ---- 6. Link earnings estimate. Keep these rates equal to LINK_RATES in app-config.js and functions/index.js ---- */
  var RATES = { india: 50, tier1: 200, other: 80 }; // rupees per 1,000 valid views
  var tier = "india";
  var range = $("#calcRange"), views = $("#calcViews"), out = $("#calcOut"), rates = $("#calcRates");
  var shown = 0;
  function calc() {
    if (!range) return;
    var v = Number(range.value);
    var min = Number(range.min) || 1000;
    var max = Number(range.max) || 500000;
    var pct = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    range.style.setProperty("--p", pct.toFixed(1) + "%");
    views.textContent = v.toLocaleString("en-IN");
    var total = v / 1000 * RATES[tier];
    rates.textContent = "\u20B9" + RATES[tier];
    tween(shown, total, 450, function (x) { out.textContent = "\u20B9" + Math.round(x).toLocaleString("en-IN"); });
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

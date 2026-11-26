/* AntiCash shared behavior: header, drawer, user menu, reveal, count-up, zero-reflow scroll, tooltips. */
(function () {
  "use strict";

  // EDIT ME: wording used in the copy, in one place.
  var CONFIG = {
    pendingText: "up to 7 days",
    processingText: "24 to 48 business hours"
  };

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  $$("[data-config]").forEach(function (el) {
    var k = el.getAttribute("data-config");
    if (CONFIG[k]) el.textContent = CONFIG[k];
  });

  /* Header + scroll progress with cached layout dimensions (zero forced reflow during scroll) */
  var header = $("#siteHeader");
  var sp = document.createElement("div");
  sp.className = "scroll-progress";
  sp.setAttribute("aria-hidden", "true");
  document.body.appendChild(sp);

  var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  function measureScroll() {
    maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }
  window.addEventListener("resize", measureScroll, { passive: true });
  window.addEventListener("load", measureScroll, { passive: true });
  if ("ResizeObserver" in window) {
    new ResizeObserver(measureScroll).observe(document.body);
  }

  var scrollTicking = false;
  function paintScroll() {
    scrollTicking = false;
    var y = window.scrollY || 0;
    if (header) header.classList.toggle("scrolled", y > 8);
    sp.style.transform = "scaleX(" + (maxScroll > 0 ? Math.min(1, y / maxScroll) : 0) + ")";
  }
  window.addEventListener("scroll", function () {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(paintScroll);
    }
  }, { passive: true });
  paintScroll();

  /* Mobile drawer */
  var menuToggle = $("#menuToggle");
  var drawer = $("#drawer");
  function setDrawer(open) {
    if (!menuToggle || !drawer) return;
    menuToggle.setAttribute("aria-expanded", String(open));
    drawer.classList.toggle("open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }
  if (menuToggle && drawer) {
    menuToggle.addEventListener("click", function () { setDrawer(menuToggle.getAttribute("aria-expanded") !== "true"); });
    $$("#drawer a").forEach(function (a) { a.addEventListener("click", function () { setDrawer(false); }); });
  }

  /* User dropdown */
  var userMenu = $("#userMenu");
  var userBtn = $("#userBtn");
  function closeUserMenu() {
    if (!userMenu) return;
    userMenu.classList.remove("open");
    if (userBtn) userBtn.setAttribute("aria-expanded", "false");
  }
  if (userBtn && userMenu) {
    userBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !userMenu.classList.contains("open");
      userMenu.classList.toggle("open", open);
      userBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", closeUserMenu);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeUserMenu(); setDrawer(false); }
  });

  /* Active nav link */
  var page = (location.pathname.split("/").pop() || "index.html");
  $$(".nav a, .drawer a.dl").forEach(function (a) {
    var href = a.getAttribute("href") || "";
    if (href === page) a.setAttribute("aria-current", "page");
  });

  /* Spotlight follows the pointer on .spot cards (rAF throttled) */
  if (!reduced && window.matchMedia("(hover: hover)").matches) {
    var spotTarget = null, spotX = 0, spotY = 0, spotRaf = false;
    document.addEventListener("pointermove", function (e) {
      var el = e.target.closest && e.target.closest(".spot");
      if (!el) return;
      spotTarget = el;
      var r = el.getBoundingClientRect();
      spotX = e.clientX - r.left;
      spotY = e.clientY - r.top;
      if (!spotRaf) {
        spotRaf = true;
        requestAnimationFrame(function () {
          spotRaf = false;
          if (spotTarget) {
            spotTarget.style.setProperty("--mx", spotX + "px");
            spotTarget.style.setProperty("--my", spotY + "px");
          }
        });
      }
    }, { passive: true });
  }

  /* Safety net: never stay on the loading skeleton forever */
  setTimeout(function () {
    if (document.documentElement.getAttribute("data-auth") === "loading") {
      document.documentElement.setAttribute("data-auth", "out");
    }
  }, 10000);

  /* Table of contents highlight on legal pages */
  var tocLinks = $$(".toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var tio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (a) { a.classList.toggle("on", a.getAttribute("href") === "#" + en.target.id); });
        }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    $$(".prose section").forEach(function (s) { tio.observe(s); });
  }

  /* Scroll reveal */
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -4% 0px" });
    $$(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    $$(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  /* Count up for static numbers */
  function countUp(el) {
    var target = Number(el.getAttribute("data-count"));
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    if (reduced) { el.textContent = prefix + target.toLocaleString("en-IN") + suffix; return; }
    var start = performance.now(), dur = 1200;
    (function tick(now) {
      var t = Math.min(1, (now - start) / dur);
      var val = Math.round(target * (1 - Math.pow(1 - t, 3)));
      el.textContent = prefix + val.toLocaleString("en-IN") + suffix;
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  }
  if ("IntersectionObserver" in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { countUp(en.target); cio.unobserve(en.target); } });
    }, { threshold: 0.5 });
    $$("[data-count]").forEach(function (el) { cio.observe(el); });
  } else {
    $$("[data-count]").forEach(countUp);
  }
})();

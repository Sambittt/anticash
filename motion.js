/**
 * AntiCash Motion & Animation Engine
 * Lightweight, high-performance vanilla JS animations.
 * Zero external libraries, zero emojis, fully accessible.
 */

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * Initialize subtle ambient particle mesh canvas in the hero section
 */
export function initHeroCanvas(canvasId = "heroMotionCanvas") {
  if (prefersReducedMotion) return;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = window.devicePixelRatio || 1;
  let particles = [];
  let animFrameId = null;
  let isRunning = false;
  let mouse = { x: -1000, y: -1000, radius: 120 };

  const isMobile = window.innerWidth < 768;
  const particleCount = isMobile ? 24 : 50;
  const maxDistance = isMobile ? 85 : 120;

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;

    width = parent.clientWidth;
    height = parent.clientHeight;
    dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.scale(dpr, dpr);
  }

  function initParticles() {
    particles = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 1.5 + 1.2,
        alpha: Math.random() * 0.25 + 0.15
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Draw connecting lines
    for (let i = 0; i < particles.length; i++) {
      const p1 = particles[i];

      // Update positions
      p1.x += p1.vx;
      p1.y += p1.vy;

      if (p1.x < 0) p1.x = width;
      if (p1.x > width) p1.x = 0;
      if (p1.y < 0) p1.y = height;
      if (p1.y > height) p1.y = 0;

      // Mouse gentle interaction
      const dxMouse = mouse.x - p1.x;
      const dyMouse = mouse.y - p1.y;
      const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
      if (distMouse < mouse.radius) {
        const force = (1 - distMouse / mouse.radius) * 0.8;
        p1.x -= (dxMouse / distMouse) * force;
        p1.y -= (dyMouse / distMouse) * force;
      }

      // Draw particle dot
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(15, 107, 79, ${p1.alpha})`;
      ctx.fill();

      // Check distance with other particles
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxDistance) {
          const lineAlpha = (1 - dist / maxDistance) * 0.14;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(15, 107, 79, ${lineAlpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    if (isRunning) {
      animFrameId = requestAnimationFrame(draw);
    }
  }

  function start() {
    if (!isRunning) {
      isRunning = true;
      draw();
    }
  }

  function stop() {
    isRunning = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // Mouse move listener on hero section
  const heroSection = canvas.closest("section") || canvas.parentElement;
  if (heroSection) {
    heroSection.addEventListener("mousemove", (e) => {
      const rect = heroSection.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });

    heroSection.addEventListener("mouseleave", () => {
      mouse.x = -1000;
      mouse.y = -1000;
    });
  }

  // Resize handling
  window.addEventListener("resize", () => {
    resize();
  });

  // Visibility handling (pause when tab hidden)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  });

  // IntersectionObserver to pause when hero is scrolled out of view
  if ("IntersectionObserver" in window && heroSection) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          start();
        } else {
          stop();
        }
      });
    }, { threshold: 0.05 });

    observer.observe(heroSection);
  } else {
    start();
  }

  resize();
  initParticles();
  start();
}

/**
 * Animate a numeric balance smoothly from 0 to target paise
 */
export function animateRupeeCounter(element, targetPaise, duration = 1200) {
  if (!element) return;
  if (prefersReducedMotion) {
    element.textContent = inrFormatter.format((Number(targetPaise) || 0) / 100);
    return;
  }

  const target = Math.max(0, Number(targetPaise) || 0);
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / duration);

    // Ease out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const currentPaise = Math.round(target * ease);

    element.textContent = inrFormatter.format(currentPaise / 100);

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = inrFormatter.format(target / 100);
    }
  }

  requestAnimationFrame(update);
}

/**
 * Scroll-triggered reveal animations via IntersectionObserver
 */
export function initScrollReveals() {
  const elements = document.querySelectorAll(".reveal-on-scroll");
  if (elements.length === 0) return;

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    elements.forEach(el => el.classList.add("is-revealed"));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-revealed");
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: "0px 0px -40px 0px"
  });

  elements.forEach(el => observer.observe(el));
}

/**
 * Interactive 3D Perspective Tilt for the sample preview card
 */
export function initSampleCardInteractive() {
  if (prefersReducedMotion) return;

  const card = document.querySelector(".sample-preview-card");
  if (!card) return;

  const container = card.parentElement;
  if (!container) return;

  container.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -6; // Max 6 deg
    const rotateY = ((x - centerX) / centerX) * 6;

    card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-2px)`;
  });

  container.addEventListener("mouseleave", () => {
    card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)";
  });

  // When card scrolls into view, trigger sample counter animations
  if ("IntersectionObserver" in window) {
    let triggered = false;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !triggered) {
          triggered = true;

          const availEl = document.getElementById("sampleAvailVal");
          const pendEl = document.getElementById("samplePendVal");
          const withEl = document.getElementById("sampleWithVal");
          const fillBar = document.getElementById("sampleProgressBarFill");

          if (availEl) animateRupeeCounter(availEl, 34000, 1100);
          if (pendEl) animateRupeeCounter(pendEl, 12000, 1100);
          if (withEl) animateRupeeCounter(withEl, 90000, 1100);
          if (fillBar) {
            fillBar.style.width = "0%";
            setTimeout(() => {
              fillBar.style.transition = "width 1s cubic-bezier(0.16, 1, 0.3, 1)";
              fillBar.style.width = "100%";
            }, 150);
          }
        }
      });
    }, { threshold: 0.2 });

    observer.observe(card);
  }
}

/**
 * Initialize all motion components on DOM ready
 */
export function initMotion() {
  initHeroCanvas("heroMotionCanvas");
  initScrollReveals();
  initSampleCardInteractive();
}

/**
 * ==========================================================================
 * EDIT ME: JAVASCRIPT CONFIGURATION
 * ==========================================================================
 * Customize your email form backend, cookie settings, and particles below.
 *
 * Free form options you can use:
 * 1. Web3Forms: https://web3forms.com (No backend required, access key based)
 * 2. Formspree: https://formspree.io (e.g., https://formspree.io/f/YOUR_FORM_ID)
 *
 * If you leave FORM_ENDPOINT as a placeholder, the form will simulate
 * a successful response so you can test the UI immediately!
 * ==========================================================================
 */

const ANTICASH_CONFIG = {
  // EDIT ME: Replace with your actual form endpoint or access key
  // Examples:
  // "https://api.web3forms.com/submit"
  // "https://formspree.io/f/mwpkelab"
  formEndpoint: "https://api.web3forms.com/submit",

  // EDIT ME: If using Web3Forms, enter your free access key here
  web3FormsKey: "YOUR_WEB3FORMS_ACCESS_KEY_HERE",

  // EDIT ME: Success & Error messages displayed to your users
  messages: {
    success: "🎉 You're on the list! We'll email you the moment AntiCash launches.",
    invalidEmail: "Please enter a valid email address.",
    genericError: "Something went wrong. Please try again in a moment.",
    submitting: "Securing your spot...",
  },

  // EDIT ME: Cookie consent storage key
  cookieStorageKey: "anticash_cookie_consent_v1",

  // EDIT ME: Subtle particle animation toggle
  enableParticles: true,
};

document.addEventListener("DOMContentLoaded", () => {
  initEmailForm();
  initCookieConsent();
  initCurrentYear();
  if (ANTICASH_CONFIG.enableParticles) {
    initSubtleParticles();
  }
});

/* ==========================================================================
   1. EMAIL SIGNUP FORM HANDLER
   ========================================================================== */
function initEmailForm() {
  const form = document.getElementById("newsletterForm");
  const emailInput = document.getElementById("emailInput");
  const submitBtn = document.getElementById("submitBtn");
  const feedbackMsg = document.getElementById("formFeedback");

  if (!form || !emailInput || !submitBtn || !feedbackMsg) return;

  // Basic RFC 5322 compatible email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();

    // Reset previous feedback state
    feedbackMsg.className = "form-feedback";
    feedbackMsg.textContent = "";

    // Validation
    if (!email || !emailRegex.test(email)) {
      showFeedback(ANTICASH_CONFIG.messages.invalidEmail, "error");
      emailInput.focus();
      return;
    }

    // Set UI loading state
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spinner">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
      <span>${ANTICASH_CONFIG.messages.submitting}</span>
    `;

    try {
      // Check if endpoint is still default placeholder
      const isPlaceholder =
        ANTICASH_CONFIG.formEndpoint.includes("placeholder") ||
        ANTICASH_CONFIG.web3FormsKey.includes("YOUR_WEB3FORMS_ACCESS_KEY");

      if (isPlaceholder) {
        // DEMO MODE: Simulate smooth 600ms network delay for immediate preview
        await new Promise((res) => setTimeout(res, 600));
        handleSuccess();
      } else {
        // REAL SUBMISSION
        const formData = new FormData();
        formData.append("email", email);
        if (ANTICASH_CONFIG.web3FormsKey && !ANTICASH_CONFIG.web3FormsKey.includes("YOUR_")) {
          formData.append("access_key", ANTICASH_CONFIG.web3FormsKey);
          formData.append("subject", "New AntiCash Waitlist Subscriber");
        }

        const response = await fetch(ANTICASH_CONFIG.formEndpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
          body: formData,
        });

        if (response.ok) {
          handleSuccess();
        } else {
          showFeedback(ANTICASH_CONFIG.messages.genericError, "error");
        }
      }
    } catch (err) {
      // Network failure or CORS issues
      console.warn("AntiCash Form submission error:", err);
      // If offline/error, still give a friendly message
      showFeedback(ANTICASH_CONFIG.messages.genericError, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }

    function handleSuccess() {
      form.reset();
      showFeedback(ANTICASH_CONFIG.messages.success, "success");
      // Optional: record in localStorage so user sees they're subscribed
      try {
        localStorage.setItem("anticash_subscribed", "true");
      } catch (_) {}
    }

    function showFeedback(text, type) {
      feedbackMsg.className = `form-feedback ${type}`;
      feedbackMsg.textContent = text;
      feedbackMsg.setAttribute("role", type === "error" ? "alert" : "status");
    }
  });
}

/* ==========================================================================
   2. COOKIE / CONSENT BANNER HANDLER
   ========================================================================== */
function initCookieConsent() {
  const banner = document.getElementById("cookieBanner");
  const acceptBtn = document.getElementById("cookieAccept");
  const declineBtn = document.getElementById("cookieDecline");

  if (!banner || !acceptBtn || !declineBtn) return;

  let consentGiven = null;
  try {
    consentGiven = localStorage.getItem(ANTICASH_CONFIG.cookieStorageKey);
  } catch (_) {}

  // If user hasn't made a choice yet, show banner after brief delay
  if (!consentGiven) {
    setTimeout(() => {
      banner.style.display = "block";
    }, 1200);
  }

  acceptBtn.addEventListener("click", () => {
    saveConsent("accepted");
  });

  declineBtn.addEventListener("click", () => {
    saveConsent("declined");
  });

  function saveConsent(value) {
    try {
      localStorage.setItem(ANTICASH_CONFIG.cookieStorageKey, value);
    } catch (_) {}
    banner.style.opacity = "0";
    banner.style.transform = "translateY(15px)";
    banner.style.transition = "opacity 0.25s ease, transform 0.25s ease";
    setTimeout(() => {
      banner.style.display = "none";
    }, 260);
  }
}

/* ==========================================================================
   3. DYNAMIC FOOTER YEAR
   ========================================================================== */
function initCurrentYear() {
  const yearEl = document.getElementById("currentYear");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

/* ==========================================================================
   4. SUBTLE CANVAS PARTICLES (Lightweight, 60fps, Zero External Libs)
   ========================================================================== */
function initSubtleParticles() {
  const canvas = document.getElementById("particleCanvas");
  if (!canvas) return;

  // Respect user preference for reduced motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    canvas.style.display = "none";
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  // Resize handler
  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }, 200);
  });

  // 24 lightweight particles
  const particleCount = Math.min(24, Math.floor(width / 50));
  const particles = [];

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      radius: Math.random() * 1.5 + 0.8,
      alpha: Math.random() * 0.5 + 0.2,
    });
  }

  let animationFrameId;
  let isVisible = true;

  // Pause render loop when tab is hidden to conserve battery & CPU
  document.addEventListener("visibilitychange", () => {
    isVisible = !document.hidden;
    if (isVisible) {
      animate();
    } else {
      cancelAnimationFrame(animationFrameId);
    }
  });

  function animate() {
    if (!isVisible) return;

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 245, 160, ${p.alpha})`;
      ctx.fill();

      // Connect nearby particles with subtle faint lines
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(0, 210, 255, ${0.08 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.75;
          ctx.stroke();
        }
      }
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  animate();
}

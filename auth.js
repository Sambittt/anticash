/**
 * AntiCash auth and wallet state.
 *
 * One source of truth: onAuthStateChanged, then a live listener on users/{uid}.
 * This file also drives the shared UI. The only thing the pages need is:
 *   <html data-auth="loading|out|in" data-owner="yes|no">
 * and [data-show="..."] / [data-field="..."] attributes in the markup.
 * No balance is ever shown until the Firestore document has loaded, so a
 * signed-in user never sees a fake zero.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { APP_CONFIG, formatRupees, getWithdrawalProgress, isOwnerUid } from "./app-config.js";

let app = null;
let auth = null;
let db = null;
let functions = null;

if (isFirebaseConfigured()) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, "asia-south1"); // must match REGION in functions/index.js
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
}

export { app, auth, db, functions };

const root = document.documentElement;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export let isAuthResolved = false;
export let isFirestoreLoaded = false;
export let currentUser = null;

const EMPTY_DATA = { confirmedBalancePaise: 0, pendingBalancePaise: 0, banned: false, email: "", displayName: "" };
export let currentUserData = { ...EMPTY_DATA };

let userDocUnsubscribe = null;
const callbacks = [];

/* ---------- Public helpers ---------- */

export function onUserChange(callback) {
  callbacks.push(callback);
  if (isAuthResolved) callback(currentUser, currentUserData, isFirestoreLoaded);
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

export function showToast(message, kind = "info") {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "app-toast " + kind;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  }, 4800);
}

/* ---------- Sign in / out ---------- */

export async function loginWithGoogle() {
  if (!auth) {
    showToast("Sign-in is not configured yet. Check firebase-config.js.", "error");
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
    // The user document is created by the live listener below.
  } catch (error) {
    const quiet = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];
    if (!quiet.includes(error.code)) {
      const msg = error.code === "auth/popup-blocked"
        ? "Your browser blocked the sign-in window. Allow pop-ups for this site and try again."
        : "Sign-in did not complete. Please try again.";
      showToast(msg, "error");
      console.warn("Sign in error:", error);
    }
  }
}

export async function logoutUser() {
  if (!auth) return;
  if (userDocUnsubscribe) {
    userDocUnsubscribe();
    userDocUnsubscribe = null;
  }
  await signOut(auth);
  window.location.href = "index.html";
}

/* ---------- Shell painting ---------- */

function firstName(user) {
  const n = (user && user.displayName) || "";
  return n.trim().split(/\s+/)[0] || "there";
}

function setMoney(el, paise) {
  const to = Number(paise) || 0;
  const had = el.dataset.painted === "1" ? Number(el.dataset.paise || 0) : 0;
  el.dataset.paise = String(to);
  el.dataset.painted = "1";
  el.classList.remove("skeleton");
  el.removeAttribute("style");
  if (reduced || had === to) {
    el.textContent = formatRupees(to);
    return;
  }
  const start = performance.now();
  const dur = 900;
  (function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = formatRupees(Math.round(had + (to - had) * e));
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

function paintShell() {
  const state = !isAuthResolved ? "loading" : currentUser ? "in" : "out";
  root.setAttribute("data-auth", state);
  root.setAttribute("data-owner", currentUser && isOwnerUid(currentUser.uid) ? "yes" : "no");

  const q = (sel) => Array.from(document.querySelectorAll(sel));

  if (currentUser) {
    const name = firstName(currentUser);
    q("[data-user-name]").forEach((el) => (el.textContent = name));
    q("[data-user-fullname]").forEach((el) => (el.textContent = currentUser.displayName || "Member"));
    q("[data-user-initial]").forEach((el) => (el.textContent = name.charAt(0).toUpperCase()));
    q("[data-user-email]").forEach((el) => (el.textContent = currentUser.email || ""));
    q("[data-user-uid]").forEach((el) => (el.textContent = currentUser.uid));
  }

  const banner = document.getElementById("bannedBanner");
  if (banner) banner.hidden = !(currentUser && isFirestoreLoaded && currentUserData.banned);

  if (currentUser && isFirestoreLoaded) {
    const confirmed = Number(currentUserData.confirmedBalancePaise) || 0;
    const pending = Number(currentUserData.pendingBalancePaise) || 0;
    const prog = getWithdrawalProgress(confirmed);

    q('[data-field="available"]').forEach((el) => setMoney(el, confirmed));
    q('[data-field="available-chip"]').forEach((el) => setMoney(el, confirmed));
    q('[data-field="pending"]').forEach((el) => setMoney(el, pending));
    q('[data-field="remaining"]').forEach((el) => setMoney(el, prog.paiseNeeded));

    q("[data-field-bar]").forEach((el) => requestAnimationFrame(() => (el.style.width = prog.percent + "%")));
    q("[data-field-pct]").forEach((el) => (el.textContent = prog.percent + "%"));
    q("[data-field-meta]").forEach((el) => {
      el.textContent = prog.isReady
        ? "You can request a withdrawal."
        : `${prog.currentFormatted} of ${prog.targetFormatted} to your next withdrawal`;
    });
    q("[data-field-detail]").forEach((el) => {
      el.textContent = prog.isReady
        ? "Minimum reached. You can request a payout."
        : `${prog.formattedNeeded} more confirmed balance to reach the minimum.`;
    });
  }
}

function notify() {
  paintShell();
  callbacks.forEach((cb) => {
    try {
      cb(currentUser, currentUserData, isFirestoreLoaded);
    } catch (e) {
      console.error("Error in auth callback:", e);
    }
  });
}

/* ---------- Init ---------- */

let uiWired = false;
function wireUi() {
  if (uiWired) return;
  uiWired = true;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "signin") {
      e.preventDefault();
      btn.setAttribute("aria-busy", "true");
      loginWithGoogle().finally(() => btn.removeAttribute("aria-busy"));
    } else if (action === "signout") {
      e.preventDefault();
      logoutUser();
    }
  });
}

export function initAuth() {
  wireUi();
  paintShell();

  if (!auth) {
    isAuthResolved = true;
    isFirestoreLoaded = true;
    notify();
    return;
  }

  onAuthStateChanged(auth, (user) => {
    isAuthResolved = true;
    currentUser = user;

    if (userDocUnsubscribe) {
      userDocUnsubscribe();
      userDocUnsubscribe = null;
    }

    if (!user) {
      isFirestoreLoaded = true;
      currentUserData = { ...EMPTY_DATA };
      notify();
      return;
    }

    isFirestoreLoaded = false;
    notify();

    const userRef = doc(db, "users", user.uid);
    userDocUnsubscribe = onSnapshot(
      userRef,
      async (snap) => {
        if (!snap.exists()) {
          try {
            await setDoc(userRef, {
              email: user.email || "",
              displayName: user.displayName || "Member",
              createdAt: serverTimestamp(),
              confirmedBalancePaise: 0,
              pendingBalancePaise: 0,
              banned: false
            });
          } catch (err) {
            console.warn("User document creation error:", err);
            showToast("We could not set up your wallet. Please refresh and try again.", "error");
            isFirestoreLoaded = true;
            notify();
          }
          // On success the listener fires again once the document exists.
          return;
        }
        currentUserData = { ...EMPTY_DATA, ...snap.data() };
        isFirestoreLoaded = true;
        notify();
      },
      (error) => {
        console.warn("Firestore user sync error:", error);
        isFirestoreLoaded = true;
        notify();
      }
    );
  });
}

export { APP_CONFIG };

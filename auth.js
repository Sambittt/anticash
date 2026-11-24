/**
 * ==========================================================================
 * ANTICASH FIREBASE AUTH & FIRESTORE STATE MANAGER
 * ==========================================================================
 * Uses official Firebase Web SDK v10 (modular) loaded via Google's official CDN.
 * ==========================================================================
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
  serverTimestamp, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { 
  getFunctions, 
  httpsCallable 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { APP_CONFIG, pointsToInr } from "./app-config.js";

// Initialize Firebase
let app = null;
let auth = null;
let db = null;
let functions = null;

if (isFirebaseConfigured()) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app);
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
} else {
  console.warn("AntiCash: Firebase config is still using placeholders. Please edit firebase-config.js.");
}

export { app, auth, db, functions };

// Reactive state
export let currentUser = null;
export let currentUserData = {
  confirmedPoints: 0,
  pendingPoints: 0,
  banned: false,
  email: "",
  displayName: ""
};

let userDocUnsubscribe = null;
const authCallbacks = [];

/**
 * Register listener for auth state changes
 */
export function onUserChange(callback) {
  authCallbacks.push(callback);
  if (currentUser) {
    callback(currentUser, currentUserData);
  }
}

function notifyCallbacks() {
  authCallbacks.forEach((cb) => {
    try {
      cb(currentUser, currentUserData);
    } catch (e) {
      console.error("Error in auth callback:", e);
    }
  });
}

/**
 * Sign in with Google
 */
export async function loginWithGoogle() {
  if (!isFirebaseConfigured()) {
    showConfigNoticeModal();
    return;
  }
  
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    // Ensure user document exists in Firestore
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    
    if (!snap.exists()) {
      await setDoc(userRef, {
        email: user.email || "",
        displayName: user.displayName || "User",
        createdAt: serverTimestamp(),
        confirmedPoints: 0,
        pendingPoints: 0,
        banned: false
      });
    }
    
    return user;
  } catch (error) {
    console.error("Google Sign-In failed:", error);
    if (error.code !== "auth/popup-closed-by-user") {
      alert(`Sign in error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Sign out
 */
export async function logoutUser() {
  if (!auth) return;
  if (userDocUnsubscribe) {
    userDocUnsubscribe();
    userDocUnsubscribe = null;
  }
  await signOut(auth);
  window.location.href = "index.html";
}

/**
 * Setup Realtime Auth & Profile Listener
 */
export function initAuth() {
  // Show setup banner if Firebase is unconfigured
  renderConfigBannerIfNeeded();

  if (!auth) {
    updateNavbarUI(null, null);
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    
    if (userDocUnsubscribe) {
      userDocUnsubscribe();
      userDocUnsubscribe = null;
    }

    if (user) {
      // Listen to users/{uid} document in real-time
      const userRef = doc(db, "users", user.uid);
      userDocUnsubscribe = onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          currentUserData = {
            ...currentUserData,
            ...data
          };
          
          if (currentUserData.banned) {
            handleBannedUser();
          }
        }
        updateNavbarUI(currentUser, currentUserData);
        notifyCallbacks();
      }, (error) => {
        console.warn("Firestore user sync error:", error);
      });
    } else {
      currentUserData = {
        confirmedPoints: 0,
        pendingPoints: 0,
        banned: false,
        email: "",
        displayName: ""
      };
      updateNavbarUI(null, null);
      notifyCallbacks();
    }
  });
}

function handleBannedUser() {
  alert("Notice: This account has been flagged or suspended for terms violation (multiple accounts or VPN detected). Payouts and task participation are disabled.");
}

/**
 * Route protection for pages that require login (dashboard, tasks, withdraw, admin)
 */
export function requireAuth(options = { requireAdmin: false }) {
  if (!isFirebaseConfigured()) {
    renderConfigBannerIfNeeded();
    return;
  }

  if (!auth) return;

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // Redirect to home page with login prompt
      window.location.href = "index.html?auth_required=true";
      return;
    }

    if (options.requireAdmin) {
      if (user.uid !== APP_CONFIG.ownerUid) {
        alert("Access Denied: You must be the owner to view the admin area.");
        window.location.href = "dashboard.html";
      }
    }
  });
}

/**
 * Update Navbar based on user state
 */
export function updateNavbarUI(user, userData) {
  const navContainer = document.getElementById("navUserArea");
  if (!navContainer) return;

  if (user) {
    const isOwner = user.uid === APP_CONFIG.ownerUid;
    const confirmedPts = userData?.confirmedPoints || 0;
    const pendingPts = userData?.pendingPoints || 0;

    navContainer.innerHTML = `
      <div class="nav-user-logged">
        <a href="dashboard.html" class="nav-points-badge" title="Confirmed Points: ${confirmedPts} | Pending: ${pendingPts}">
          <span class="points-icon" aria-hidden="true">🪙</span>
          <span class="points-value">${confirmedPts.toLocaleString()} Pts</span>
          <span class="points-inr">(${pointsToInr(confirmedPts)})</span>
        </a>
        <div class="nav-user-dropdown-wrap">
          <button type="button" class="btn-user-profile" id="userMenuBtn" aria-label="User menu" aria-expanded="false">
            <span class="user-avatar-initial">${(user.displayName || "U").charAt(0).toUpperCase()}</span>
            <span class="user-name-short">${(user.displayName || "Account").split(" ")[0]}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="user-dropdown-menu" id="userDropdownMenu">
            <div class="dropdown-header">
              <span class="dropdown-user-name">${user.displayName || "User"}</span>
              <span class="dropdown-user-email">${user.email || ""}</span>
              <span class="dropdown-uid-tag">UID: ${user.uid.slice(0, 8)}...</span>
            </div>
            <hr class="dropdown-divider">
            <a href="dashboard.html" class="dropdown-item">📊 Dashboard</a>
            <a href="tasks.html" class="dropdown-item">🎯 Tasks & Offers</a>
            <a href="withdraw.html" class="dropdown-item">💸 Withdraw (UPI)</a>
            ${isOwner ? '<a href="admin.html" class="dropdown-item admin-link">⚡ Admin Panel</a>' : ''}
            <hr class="dropdown-divider">
            <button type="button" class="dropdown-item btn-signout-item" id="logoutBtn">🚪 Sign Out</button>
          </div>
        </div>
      </div>
    `;

    // Dropdown toggle
    const menuBtn = document.getElementById("userMenuBtn");
    const menu = document.getElementById("userDropdownMenu");
    const logoutBtn = document.getElementById("logoutBtn");

    if (menuBtn && menu) {
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const expanded = menu.classList.toggle("show");
        menuBtn.setAttribute("aria-expanded", String(expanded));
      });
      document.addEventListener("click", () => {
        menu.classList.remove("show");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => logoutUser());
    }
  } else {
    navContainer.innerHTML = `
      <button type="button" class="btn-google-login" id="googleLoginBtn">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Sign in with Google</span>
      </button>
    `;

    const loginBtn = document.getElementById("googleLoginBtn");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => loginWithGoogle());
    }
  }
}

/**
 * Setup Banner helper: Alerts owner if firebase-config.js is not yet filled in
 */
function renderConfigBannerIfNeeded() {
  if (isFirebaseConfigured()) return;
  const existing = document.getElementById("firebaseSetupBanner");
  if (existing) return;

  const banner = document.createElement("aside");
  banner.id = "firebaseSetupBanner";
  banner.className = "setup-alert-banner";
  banner.innerHTML = `
    <div class="container banner-inner">
      <span class="banner-icon">⚙️</span>
      <div class="banner-text">
        <strong>Setup Required:</strong> Firebase credentials are not yet configured. Please paste your Firebase web app keys into <code>firebase-config.js</code> to enable Google Sign-In and Firestore live points.
      </div>
      <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" class="btn-banner-action">Open Console</a>
    </div>
  `;
  document.body.prepend(banner);
}

function showConfigNoticeModal() {
  alert("Setup Notice:\n\nFirebase is not configured yet. To enable real Google Sign-In, please paste your Firebase Web App configuration inside 'firebase-config.js'.\n\nRefer to SETUP.md for simple instructions!");
}

/**
 * AntiCash Authentication and Firestore State Manager
 * Zero emojis, real rupees, modular Firebase v10 SDK.
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
import { 
  getFunctions 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { APP_CONFIG, formatRupees } from "./app-config.js";

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
}

export { app, auth, db, functions };

export let currentUser = null;
export let currentUserData = {
  confirmedBalancePaise: 0,
  pendingBalancePaise: 0,
  banned: false,
  email: "",
  displayName: ""
};

let userDocUnsubscribe = null;
const authCallbacks = [];

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

export async function loginWithGoogle() {
  if (!isFirebaseConfigured()) {
    alert("Configuration notice: Please enter your Firebase web app keys in firebase-config.js.");
    return;
  }
  
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    
    if (!snap.exists()) {
      await setDoc(userRef, {
        email: user.email || "",
        displayName: user.displayName || "User",
        createdAt: serverTimestamp(),
        confirmedBalancePaise: 0,
        pendingBalancePaise: 0,
        banned: false
      });
    }
    
    return user;
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user") {
      alert(`Sign in error: ${error.message}`);
    }
    throw error;
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

export function initAuth() {
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
      const userRef = doc(db, "users", user.uid);
      userDocUnsubscribe = onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          currentUserData = {
            ...currentUserData,
            ...data
          };
          
          if (currentUserData.banned) {
            alert("Your account has been suspended for violating terms of service (such as proxy usage or multiple accounts). Payouts and offer access are disabled.");
          }
        }
        updateNavbarUI(currentUser, currentUserData);
        notifyCallbacks();
      }, (error) => {
        console.warn("Firestore user sync error:", error);
      });
    } else {
      currentUserData = {
        confirmedBalancePaise: 0,
        pendingBalancePaise: 0,
        banned: false,
        email: "",
        displayName: ""
      };
      updateNavbarUI(null, null);
      notifyCallbacks();
    }
  });
}

export function requireAuth(options = { requireAdmin: false }) {
  if (!isFirebaseConfigured()) return;
  if (!auth) return;

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "index.html?auth_required=true";
      return;
    }

    if (options.requireAdmin) {
      if (user.uid !== APP_CONFIG.ownerUid && APP_CONFIG.ownerUid !== "EDIT_ME_OWNER_UID") {
        alert("Access restricted to owner account.");
        window.location.href = "dashboard.html";
      }
    }
  });
}

export function updateNavbarUI(user, userData) {
  const navContainer = document.getElementById("navUserArea");
  if (!navContainer) return;

  if (user) {
    const isOwner = user.uid === APP_CONFIG.ownerUid || APP_CONFIG.ownerUid === "EDIT_ME_OWNER_UID";
    const confirmedPaise = userData?.confirmedBalancePaise || 0;
    const formattedBalance = formatRupees(confirmedPaise);

    navContainer.innerHTML = `
      <div class="nav-user-logged">
        <a href="dashboard.html" class="nav-balance-badge" title="Confirmed balance available to withdraw">
          <span class="nav-balance-label">Balance</span>
          <span class="nav-balance-amount">${formattedBalance}</span>
        </a>
        <div class="user-dropdown-container">
          <button type="button" class="btn-user-avatar" id="userMenuBtn" aria-label="Open user menu" aria-expanded="false">
            <span class="user-avatar-initial">${(user.displayName || "U").charAt(0).toUpperCase()}</span>
            <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="user-dropdown-menu" id="userDropdownMenu">
            <div class="dropdown-header">
              <span class="dropdown-user-name">${escapeHtml(user.displayName || "Account")}</span>
              <span class="dropdown-user-email">${escapeHtml(user.email || "")}</span>
              <span class="dropdown-uid-tag">UID: ${user.uid.slice(0, 10)}...</span>
            </div>
            <div class="dropdown-divider"></div>
            <a href="dashboard.html" class="dropdown-link">Wallet</a>
            <a href="earn.html" class="dropdown-link">Earn</a>
            <a href="withdraw.html" class="dropdown-link">Withdraw</a>
            ${isOwner ? '<a href="admin.html" class="dropdown-link admin-nav-item">Admin Console</a>' : ''}
            <div class="dropdown-divider"></div>
            <button type="button" class="dropdown-link btn-signout-action" id="logoutBtn">Sign out</button>
          </div>
        </div>
      </div>
    `;

    const menuBtn = document.getElementById("userMenuBtn");
    const menu = document.getElementById("userDropdownMenu");
    const logoutBtn = document.getElementById("logoutBtn");

    if (menuBtn && menu) {
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const expanded = menu.classList.toggle("is-open");
        menuBtn.setAttribute("aria-expanded", String(expanded));
      });
      document.addEventListener("click", () => {
        menu.classList.remove("is-open");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => logoutUser());
    }
  } else {
    navContainer.innerHTML = `
      <button type="button" class="btn-signin-google" id="googleLoginBtn">
        <svg class="google-icon" width="16" height="16" viewBox="0 0 24 24">
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

function renderConfigBannerIfNeeded() {
  if (isFirebaseConfigured()) return;
  const existing = document.getElementById("configAlertBanner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.id = "configAlertBanner";
  banner.className = "alert-system-banner";
  banner.innerHTML = `
    <div class="container alert-banner-inner">
      <span>Setup required: Please enter your Firebase web app keys in <code>firebase-config.js</code> to enable authentication and balance storage.</span>
      <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" class="alert-banner-link">Console</a>
    </div>
  `;
  document.body.prepend(banner);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

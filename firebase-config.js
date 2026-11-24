/**
 * ==========================================================================
 * ANTICASH FIREBASE WEB SDK (v10+ MODULAR) CONFIGURATION
 * ==========================================================================
 * Active production Firebase project credentials for AntiCash.
 * ==========================================================================
 */

export const firebaseConfig = {
  apiKey: "AIzaSyCzpDOt6cP1xPxC__JyeJeHN5IbKShC00E",
  authDomain: "anticash-16001.firebaseapp.com",
  projectId: "anticash-16001",
  storageBucket: "anticash-16001.firebasestorage.app",
  messagingSenderId: "414696198643",
  appId: "1:414696198643:web:a28241653e1b758e8e0286",
  measurementId: "G-XSJGJ7H96N"
};

// Check if Firebase has been configured with real keys
export const isFirebaseConfigured = () => {
  return (
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes("YOUR_API_KEY") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes("YOUR_PROJECT_ID")
  );
};

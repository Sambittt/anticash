/**
 * ==========================================================================
 * EDIT ME: FIREBASE WEB SDK (v10+ MODULAR) CONFIGURATION
 * ==========================================================================
 * Replace the placeholder values below with your actual Firebase project settings.
 * Find these in the Firebase Console:
 * 1. Go to https://console.firebase.google.com/
 * 2. Select your project (or create one)
 * 3. Project Settings (Gear icon) -> General -> Your apps -> Web app (</>)
 * 4. Copy the firebaseConfig object properties and paste them below.
 * ==========================================================================
 */

export const firebaseConfig = {
  // EDIT ME: Your Firebase API Key
  apiKey: "AIzaSy_YOUR_API_KEY_HERE_EDIT_ME",
  
  // EDIT ME: Your Auth Domain (e.g., your-project-id.firebaseapp.com)
  authDomain: "anticash-rewards.firebaseapp.com",
  
  // EDIT ME: Your Project ID
  projectId: "anticash-rewards",
  
  // EDIT ME: Your Storage Bucket (e.g., your-project-id.appspot.com)
  storageBucket: "anticash-rewards.appspot.com",
  
  // EDIT ME: Messaging Sender ID
  messagingSenderId: "123456789012",
  
  // EDIT ME: App ID
  appId: "1:123456789012:web:abcdef1234567890"
};

// Check if Firebase has been configured with real keys or is still on placeholder
export const isFirebaseConfigured = () => {
  return (
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes("YOUR_API_KEY") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes("YOUR_PROJECT_ID")
  );
};

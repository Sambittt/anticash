# AntiCash (anticash.tech) — Setup & Deployment Guide

This guide walks you through connecting your Firebase backend, deploying Firestore security rules and Cloud Functions, configuring offerwall postbacks, and publishing updates to GitHub Pages.

---

## 📋 Checklist of Files Marked "EDIT ME"

Before deploying, ensure you customize these files:
- [firebase-config.js](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/firebase-config.js): Paste your Firebase Web App credentials.
- [app-config.js](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/app-config.js): Set your `ownerUid`, point conversion rate, minimum withdrawal, and offerwalls.
- [firestore.rules](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/firestore.rules): Replace `EDIT_ME_OWNER_UID` with your Firebase Auth UID.
- [functions/index.js](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/functions/index.js): Configure network postback secrets and parameter mappings.

---

## 1. Create Firebase Project & Paste Web Config

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project named **AntiCash** (e.g. `anticash-rewards`).
2. In the left sidebar:
   - Go to **Build → Authentication** → Click **Get Started** → Under Sign-in method, enable **Google**.
   - Go to **Build → Firestore Database** → Click **Create database** (choose a nearby region like `asia-south1` for India or `us-central1`). Start in production mode.
3. Click the **Project Overview (Gear icon) → Project settings**.
4. Scroll down to **Your apps**, click the **Web icon (`</>`)**, and register `AntiCash Web`.
5. Copy the values from `firebaseConfig` and paste them into [firebase-config.js](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/firebase-config.js):
   ```javascript
   export const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
6. **Authorized Domains**:
   - In Firebase Console → **Authentication → Settings → Authorized domains**, add:
     - `anticash.tech`
     - `sambittt.github.io`
     - `localhost`

---

## 2. Upgrade to Blaze Plan & Set Budget Alert

1. Cloud Functions (2nd Gen) and scheduled tasks require the Firebase **Blaze (Pay-as-you-go) Plan**.
2. Go to **Firebase Console → Bottom Left → Upgrade to Blaze**.
   > *Note:* The Blaze plan includes a generous monthly free tier (2 million Cloud Function invocations, 50,000 Firestore reads/day free).
3. **Set a Budget Alert**:
   - In Google Cloud Console or Firebase, go to **Billing → Budgets & alerts**.
   - Create an alert for **$1.00 (₹85)** or **$5.00** so you receive immediate email notifications if unexpected traffic occurs.

---

## 3. Install Firebase CLI & Login

Open PowerShell or Terminal on your computer:
```powershell
# Install Firebase CLI globally (if not already installed)
npm install -g firebase-tools

# Login to your Google account
firebase login

# Connect to your Firebase project
firebase use --add
# Select your anticash project from the list and give it alias 'default'
```

---

## 4. Find Your Owner UID & Set Permissions

1. Open your local site (or visit `https://anticash.tech/` once pushed) and click **Sign in with Google**.
2. Go to **Firebase Console → Authentication → Users tab**.
3. Copy your **User UID** (a string like `d4J92kLmOPqR3...`).
4. Update this UID in three places:
   - In [app-config.js](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/app-config.js):
     ```javascript
     ownerUid: "YOUR_ACTUAL_FIREBASE_UID_HERE",
     ```
   - In [firestore.rules](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/firestore.rules):
     ```rules
     function isOwner() {
       return request.auth != null && request.auth.uid == "YOUR_ACTUAL_FIREBASE_UID_HERE";
     }
     ```
   - In [functions/index.js](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/functions/index.js):
     ```javascript
     ownerUid: "YOUR_ACTUAL_FIREBASE_UID_HERE",
     ```

---

## 5. Deploy Firestore Rules and Cloud Functions

From the root directory of this project:
```powershell
# 1. Deploy Firestore Security Rules
firebase deploy --only firestore:rules

# 2. Deploy Cloud Functions
cd functions
npm install
cd ..
firebase deploy --only functions
```

Once deployment completes, Firebase CLI will output your HTTPS postback URL:
```text
Function URL (postback): https://us-central1-YOUR_PROJECT.cloudfunctions.net/postback
```

---

## 6. How to Register Postback URL in an Offerwall Dashboard

When you register as a publisher on offerwall networks (e.g. AdGate Media, OfferToro, Monlix, CPALead, Wannads, Lootably):

1. Go to the network's **Postback / Webhook Settings** tab.
2. Enter your Postback URL with network parameter placeholders:
   ```text
   https://us-central1-YOUR_PROJECT.cloudfunctions.net/postback?network=network1&uid={user_id}&tx_id={transaction_id}&reward={currency}&status={status}&sig={signature}&ip={user_ip}
   ```
   *(Replace `{user_id}`, `{transaction_id}`, `{currency}` with the specific macros provided in your network's documentation).*
3. **Copy the Secret Key** from the network dashboard and paste it into `functions/index.js` under `CONFIG.networks.network1.secret` (or set it via Firebase secret: `firebase functions:secrets:set OFFERWALL_SECRET_NET1`).
4. **Testing Your Postback**:
   Most networks have a "Test Postback" button in their portal.
   You can also test directly in your browser or with curl:
   ```bash
   curl "https://us-central1-YOUR_PROJECT.cloudfunctions.net/postback?network=network1&uid=YOUR_TEST_UID&tx_id=test_tx_001&reward=100&status=1"
   ```
   Check your user Dashboard: you should see **100 Pending Points** and a new entry under Recent Activity!

---

## 7. How to Push Updates to GitHub Pages

Once your changes are saved, commit and push to GitHub:
```powershell
git add .
git commit -m "Update AntiCash to full rewards platform with Firebase and Cloud Functions"
git push origin main
```

Because your [CNAME](file:///c:/Users/Sambit/OneDrive/Desktop/AntiCash/CNAME) file is configured with `anticash.tech`, GitHub Pages will automatically build and publish your site to [https://anticash.tech/](https://anticash.tech/).

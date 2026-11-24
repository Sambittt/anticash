# AntiCash Setup and Deployment Guide

This guide covers deployment of AntiCash (anticash.tech) using the Indian rupee and paise monetary architecture.

---

## Configuration Checklist (Marked "EDIT ME")

1. **app-config.js**: Set `ownerUid` to your Firebase Auth UID.
2. **firestore.rules**: Set `request.auth.uid == "EDIT_ME_OWNER_UID"` to your Firebase Auth UID.
3. **functions/index.js**: Set `ownerUid` and configure network secret keys and `rewardMultiplierToPaise`.
4. **firebase-config.js**: Verify Firebase web app keys are present.

---

## 1. Firebase Project Setup

1. Open the [Firebase Console](https://console.firebase.google.com/) and navigate to project `anticash-16001`.
2. Enable Authentication:
   - In **Build -> Authentication -> Sign-in method**, ensure **Google** is enabled.
   - In **Settings -> Authorized domains**, confirm that `anticash.tech`, `sambittt.github.io`, and `localhost` are present.
3. Enable Firestore Database:
   - In **Build -> Firestore Database**, start in production mode (location: `asia-south1` or `us-central1`).

---

## 2. Upgrade to Blaze and Set a Budget Alert

1. Cloud Functions (2nd Gen) and scheduled maturation require the **Blaze (Pay as you go)** plan.
2. In the Firebase console (bottom left corner), upgrade to Blaze.
3. In Google Cloud Console -> **Billing -> Budgets & alerts**, set an alert at **$1.00 (approximately ₹85)** to receive email notifications upon unexpected traffic.

---

## 3. Retrieve Your Owner UID

1. Visit [https://anticash.tech/](https://anticash.tech/) and click **Sign in with Google**.
2. Open Firebase Console -> **Authentication -> Users**.
3. Copy your **User UID** string.
4. Replace `"EDIT_ME_OWNER_UID"` with your UID in:
   - `app-config.js`
   - `firestore.rules`
   - `functions/index.js`

---

## 4. Deploy Rules and Cloud Functions

From the root project directory:
```bash
# 1. Deploy Firestore Security Rules
firebase deploy --only firestore:rules

# 2. Deploy Cloud Functions
cd functions
npm install
cd ..
firebase deploy --only functions
```

Upon completion, Firebase outputs your postback URL:
```text
https://us-central1-anticash-16001.cloudfunctions.net/postback
```

---

## 5. Register Postback URL in Partner Networks

In each offerwall publisher dashboard:
1. Go to the Postback / Webhook settings section.
2. Set the postback URL to:
   ```text
   https://us-central1-anticash-16001.cloudfunctions.net/postback?network=network1&uid={user_id}&tx_id={transaction_id}&reward={currency}&status={status}&sig={signature}&ip={user_ip}
   ```
   (Replace placeholder macros with the exact names used by your partner network).
3. Set `rewardMultiplierToPaise` in `functions/index.js` to match the network's reward currency:
   - If the network sends 1 unit = ₹1 (100 paise), multiplier is `100`.
   - If the network sends amount in paise directly, multiplier is `1`.
4. Copy the secret key from the network dashboard and paste it into `functions/index.js` under `CONFIG.networks.network1.secret`.

---

## 6. Publish Updates to GitHub Pages

To deploy changes to the live site:
```bash
git add .
git commit -m "Update AntiCash platform: real rupees architecture and refined design"
git push origin main
```
GitHub Pages will automatically build and serve the site on https://anticash.tech/.

# AntiCash setup (do these in order)

Folders: the website is the files in this folder (GitHub Pages). The server code is in `functions/` (Firebase). Nothing works for real money until step 5 is done.

## 1. Find your owner ID
1. Open the site, sign in with Google, open the Wallet page.
2. Under "Your account" copy the Member ID (28 characters).

## 2. Paste it in 3 places
1. `app-config.js`: replace `EDIT_ME_OWNER_UID`.
2. `firestore.rules`: replace `EDIT_ME_OWNER_UID` (top of the file).
3. `functions/.env`: copy `functions/.env.example` to `functions/.env` and fill in `OWNER_UID`.

## 3. Fill the other secrets in `functions/.env`
- `TOKEN_SECRET`: any long random text (run `openssl rand -hex 32`). Short links refuse to work without it.
- `IP_SALT`: any random text.
- `OFFERWALL_SECRET_NET1` / `OFFERWALL_SECRET_NET2`: from your offer partners.
Never put `functions/.env` on GitHub (it is already in `.gitignore`).

## 4. Billing safety
Firebase Cloud Functions need the Blaze plan. In Google Cloud Billing add a budget alert (for example Rs 500) so you get an email if usage jumps.

## 5. Deploy the server side (from this folder)
```
npm install --prefix functions
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```
Indexes take a few minutes to build. Until they finish, admin lists and "Your links" can show an error.

## 6. Publish the website
Push all files to the `Sambittt/anticash` repo (main branch). Wait 1 to 2 minutes, then hard refresh (Ctrl+Shift+R). `404.html` must be in the repo: it is what makes `anticash.tech/l/CODE` links work on GitHub Pages.

## 7. Offer partners
Put each network's URL in `app-config.js` under `networks` and set `active: true`. Give each partner this postback address pattern from the Firebase console (function `postback`).

## 8. Ads
Open `js/ads.js`.
- **AdSense** (About, Privacy, Terms, Contact pages only): paste your publisher id in `adsensePublisherId` (looks like `ca-pub-1234567890123456`) and put the same id in `ads.txt`. Apply for AdSense at adsense.google.com once the site has real content and traffic.
- **Short link page ads** (`go.html`): paste the ad code from a network that allows short links (for example Adsterra, Monetag, PropellerAds) into `goTopSnippet` and `goBottomSnippet`.

AdSense rules to know: it does not allow paying people for views or clicks, and it usually rejects pages built around a countdown before a link. That is why AdSense is never loaded on Earn, Wallet, Withdraw, Links or the visitor page.

## 9. Short link rates
Rates are in two places and must match: `LINK_RATES` in `app-config.js` (shown to users) and `RATES_PER_1000` in `functions/lib.js` (what is actually paid). Also `RATES` in `js/home.js` (the landing page calculator). Change them only when your ad network pays enough to cover them. Check your real ad earnings before promising any rate.

## 10. Running it
Admin page (menu, then Admin): Overview, Withdrawals (pay to UPI, then Mark paid), Members (ban), Links (disable, block a website), Reports, Partner log.
Block bad websites early. Phishing or malware links on your domain can get `anticash.tech` flagged by Google.

## Security notes
- Balances can only be changed by Cloud Functions; browser rules block everything else.
- Short link timer is checked on the server, so it cannot be skipped in the browser.
- Visitor IPs are stored only as a one-way hash.
- The Firebase web key in `firebase-config.js` is public by design. In Google Cloud Console, restrict it to your domain (HTTP referrers: `anticash.tech/*`).

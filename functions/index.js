/**
 * AntiCash Cloud Functions (2nd gen, Node.js 20).
 * All money is integer paise (100 paise = 1 rupee).
 *
 * Security model:
 *  - Browsers can never change balances (see firestore.rules). Only this file can.
 *  - Partner postbacks must carry a valid signature. If a network secret is not
 *    set, that network is rejected (fail closed).
 *  - Every postback is applied at most once (idempotency ledger).
 *  - The owner UID must be configured; with the placeholder nobody is admin.
 *
 * Config comes from functions/.env (copy .env.example). Never commit .env.
 */

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const REGION = "asia-south1"; // Mumbai
const MIN_WITHDRAWAL_PAISE = 30000; // 300 rupees
const HOLD_PERIOD_DAYS = 7;
const PLACEHOLDER = "EDIT_ME";

const OWNER_UID = process.env.OWNER_UID || "";
function isOwner(uid) {
  return Boolean(uid) && Boolean(OWNER_UID) && !OWNER_UID.includes(PLACEHOLDER) && uid === OWNER_UID;
}

/**
 * Partner networks. The key is what the partner puts in ?network=<key>.
 *
 * signatureFields uses LOGICAL names (userId, transactionId, reward, status)
 * and "secret". They are looked up through paramMap, so you only describe the
 * partner's parameter names once. Ask the partner exactly how their signature
 * is built and match it here. Include "status" if the partner signs it, so a
 * reversal cannot be forged.
 *
 * rewardMultiplierToPaise: network unit to paise. 100 if they send rupees,
 * 1 if they send paise.
 */
const NETWORKS = {
  network1: {
    name: "Partner Offerwall 1",
    secret: process.env.OFFERWALL_SECRET_NET1 || "",
    rewardMultiplierToPaise: 100,
    signatureMode: "md5_concat", // md5_concat | sha256_concat | hmac_sha256
    signatureFields: ["userId", "transactionId", "reward", "secret"],
    separator: ":",
    paramMap: { userId: "uid", reward: "reward", transactionId: "tx_id", status: "status", signature: "sig", ip: "ip" },
    reversalStatusValues: ["2", "reversed", "chargeback"],
    ipAllowlist: [] // optional exact IPs; empty = signature only
  },
  network2: {
    name: "Partner Offerwall 2",
    secret: process.env.OFFERWALL_SECRET_NET2 || "",
    rewardMultiplierToPaise: 100,
    signatureMode: "hmac_sha256",
    signatureFields: ["userId", "transactionId", "reward"],
    separator: ":",
    paramMap: { userId: "subId", reward: "amount", transactionId: "transId", status: "status", signature: "signature", ip: "user_ip" },
    reversalStatusValues: ["chargeback", "reversed", "0"],
    ipAllowlist: []
  }
};

/* ---------- helpers ---------- */

function secretConfigured(net) {
  return Boolean(net.secret) && !net.secret.includes(PLACEHOLDER);
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a).toLowerCase(), "utf8");
  const y = Buffer.from(String(b).toLowerCase(), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifySignature(query, net) {
  if (!secretConfigured(net)) return false; // fail closed
  const received = query[net.paramMap.signature];
  if (!received) return false;

  const parts = net.signatureFields.map((f) => {
    if (f === "secret") return net.secret;
    const key = net.paramMap[f] || f;
    return query[key] === undefined ? "" : String(query[key]);
  });
  const base = parts.join(net.separator === undefined ? ":" : net.separator);

  let expected;
  if (net.signatureMode === "md5_concat") expected = crypto.createHash("md5").update(base).digest("hex");
  else if (net.signatureMode === "sha256_concat") expected = crypto.createHash("sha256").update(base).digest("hex");
  else if (net.signatureMode === "hmac_sha256") expected = crypto.createHmac("sha256", net.secret).update(base).digest("hex");
  else return false;
  return safeEqualHex(expected, received);
}

// Firestore document ids cannot contain "/" and must be sane. Keep ids readable,
// and hash when something had to be changed so two different ids never collide.
function safeId(raw) {
  const s = String(raw);
  const clean = s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  if (clean === s) return clean;
  return clean + "_" + crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
}

const UID_RE = /^[A-Za-z0-9]{6,128}$/;

/* ==========================================================================
   1. POSTBACK (partner server to our server)
   Reply 200 only when the postback is handled (or deliberately ignored).
   Reply 5xx on our own failures so the partner retries.
   ========================================================================== */
exports.postback = onRequest({ region: REGION, cors: false }, async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const q = req.method === "GET" ? req.query : req.body || {};
  const networkKey = String(q.network || q.net || "network1");
  const net = NETWORKS[networkKey];
  if (!net) {
    logger.warn("[Postback] unknown network", { networkKey });
    return res.status(400).send("Unknown network");
  }

  // Secondary control only. The signature is the real protection.
  const clientIp = String(req.ip || "");
  if (net.ipAllowlist.length && !net.ipAllowlist.includes(clientIp)) {
    logger.error("[Postback] IP not allowed", { networkKey, clientIp });
    return res.status(403).send("Forbidden");
  }

  if (!secretConfigured(net)) {
    logger.error(`[Postback] ${networkKey} has no secret configured. Rejecting.`);
    return res.status(503).send("Network not configured");
  }

  if (!verifySignature(q, net)) {
    logger.error("[Postback] bad signature", { networkKey, clientIp });
    return res.status(403).send("Bad signature");
  }

  const pm = net.paramMap;
  const rawUid = q[pm.userId];
  const rawTx = q[pm.transactionId];
  const rawReward = q[pm.reward];
  const status = q[pm.status] !== undefined ? String(q[pm.status]).toLowerCase() : "1";
  const reportedIp = String(q[pm.ip] || clientIp);

  if (!rawUid || !rawTx || rawReward === undefined) {
    logger.warn("[Postback] missing parameters", { networkKey });
    return res.status(400).send("Missing parameters");
  }
  if (!UID_RE.test(String(rawUid))) {
    logger.warn("[Postback] malformed uid", { networkKey });
    return res.status(200).send("Ignored: bad uid"); // not retryable
  }
  const reward = Number(rawReward);
  if (!Number.isFinite(reward) || reward < 0) {
    logger.warn("[Postback] bad reward", { networkKey, rawReward });
    return res.status(200).send("Ignored: bad reward");
  }
  const amountPaise = Math.round(reward * (Number(net.rewardMultiplierToPaise) || 100));
  const isReversal = net.reversalStatusValues.includes(status);

  const uid = String(rawUid);
  const txKey = safeId(rawTx);
  const earnLedgerRef = db.collection("processedPostbacks").doc(`${networkKey}_${txKey}`);
  const reversalLedgerRef = db.collection("processedPostbacks").doc(`${networkKey}_${txKey}_reversal`);
  const userRef = db.collection("users").doc(uid);
  const earnTxRef = userRef.collection("transactions").doc(txKey);
  const reversalTxRef = userRef.collection("transactions").doc(`${txKey}_reversal`);

  const audit = { network: networkKey, txId: String(rawTx), uid, amountPaise, status, clientIp, reportedIp };

  try {
    const result = await db.runTransaction(async (t) => {
      const ledgerRef = isReversal ? reversalLedgerRef : earnLedgerRef;
      const [ledger, userSnap, earnTx] = await Promise.all([t.get(ledgerRef), t.get(userRef), t.get(earnTxRef)]);

      if (ledger.exists) return "duplicate";

      if (!userSnap.exists) {
        t.set(ledgerRef, { ...audit, outcome: "skipped_unknown_user", processedAt: FieldValue.serverTimestamp() });
        return "unknown_user";
      }
      const user = userSnap.data();
      let pending = Number(user.pendingBalancePaise) || 0;
      let confirmed = Number(user.confirmedBalancePaise) || 0;

      if (!isReversal) {
        if (user.banned) {
          t.set(ledgerRef, { ...audit, outcome: "skipped_banned", processedAt: FieldValue.serverTimestamp() });
          return "banned";
        }
        if (earnTx.exists) return "duplicate"; // same transaction id seen before
        t.update(userRef, { pendingBalancePaise: pending + amountPaise });
        t.set(earnTxRef, {
          type: "earn",
          amountPaise,
          network: net.name,
          description: "Offer completed",
          status: "pending",
          createdAt: FieldValue.serverTimestamp(),
          sourceIp: reportedIp
        });
        t.set(ledgerRef, { ...audit, outcome: "earn", processedAt: FieldValue.serverTimestamp() });
        return "earned";
      }

      // Reversal. Take the amount from the original credit, from the bucket it is in now.
      if (!earnTx.exists) {
        // Reversal for something we never credited: nothing to take back.
        t.set(ledgerRef, { ...audit, outcome: "reversal_without_original", processedAt: FieldValue.serverTimestamp() });
        return "reversal_without_original";
      }
      const orig = earnTx.data();
      if (orig.status === "reversed") return "duplicate";
      const origPaise = Number(orig.amountPaise) || 0;
      const update = {};
      let flagged = false;

      if (orig.status === "pending") {
        pending = Math.max(0, pending - origPaise);
        update.pendingBalancePaise = pending;
      } else {
        // Already confirmed: take it back from Available. If the member has already
        // withdrawn part of it, cap at zero and flag the account for review.
        if (confirmed < origPaise) flagged = true;
        confirmed = Math.max(0, confirmed - origPaise);
        update.confirmedBalancePaise = confirmed;
      }
      if (flagged) { update.negativeBalance = true; update.reviewRequired = true; }
      t.update(userRef, update);
      t.update(earnTxRef, { status: "reversed", reversedAt: FieldValue.serverTimestamp() });
      t.set(reversalTxRef, {
        type: "reversal",
        amountPaise: -origPaise,
        network: net.name,
        description: "Offer reversed by partner",
        status: "reversed",
        createdAt: FieldValue.serverTimestamp(),
        sourceIp: reportedIp
      });
      t.set(ledgerRef, { ...audit, outcome: "reversal", processedAt: FieldValue.serverTimestamp() });
      return "reversed";
    });

    logger.info(`[Postback] ${networkKey} ${rawTx}: ${result}`);
    return res.status(200).send("1");
  } catch (err) {
    logger.error("[Postback] processing error", { networkKey, tx: String(rawTx), err: String(err) });
    return res.status(500).send("Temporary error"); // partner should retry
  }
});

/* ==========================================================================
   2. DAILY JOB: move confirmed-after-hold earnings from Pending to Available
   ========================================================================== */
exports.processPendingBalance = onSchedule(
  { schedule: "every 24 hours", region: REGION, timeZone: "Asia/Kolkata", timeoutSeconds: 540 },
  async () => {
    const cutoff = admin.firestore.Timestamp.fromDate(new Date(Date.now() - HOLD_PERIOD_DAYS * 86400000));
    const users = await db.collection("users").where("pendingBalancePaise", ">", 0).get();

    for (const userDoc of users.docs) {
      try {
        if (userDoc.data().banned) continue;
        const due = await userDoc.ref.collection("transactions")
          .where("status", "==", "pending")
          .where("createdAt", "<=", cutoff)
          .get();
        const earnRefs = due.docs.filter((d) => d.data().type === "earn").map((d) => d.ref);
        if (!earnRefs.length) continue;

        await db.runTransaction(async (t) => {
          // Re-read inside the transaction so a reversal that just landed is respected.
          const [userSnap, ...txSnaps] = await Promise.all([t.get(userDoc.ref), ...earnRefs.map((r) => t.get(r))]);
          let matured = 0;
          const toConfirm = [];
          txSnaps.forEach((s) => {
            if (s.exists && s.data().status === "pending") {
              matured += Number(s.data().amountPaise) || 0;
              toConfirm.push(s.ref);
            }
          });
          if (matured <= 0) return;
          const u = userSnap.data();
          t.update(userDoc.ref, {
            pendingBalancePaise: Math.max(0, (Number(u.pendingBalancePaise) || 0) - matured),
            confirmedBalancePaise: (Number(u.confirmedBalancePaise) || 0) + matured
          });
          toConfirm.forEach((r) => t.update(r, { status: "confirmed", confirmedAt: FieldValue.serverTimestamp() }));
        });
      } catch (err) {
        logger.error("[Maturation] failed for user " + userDoc.id, { err: String(err) });
      }
    }
    logger.info("[Maturation] run complete");
  }
);

/* ==========================================================================
   3. CALLABLE: create a withdrawal
   ========================================================================== */
exports.createWithdrawal = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to request a withdrawal.");
  const uid = request.auth.uid;
  const { upiId, amountPaise } = request.data || {};

  const paise = Number(amountPaise);
  if (!Number.isInteger(paise) || paise < MIN_WITHDRAWAL_PAISE) {
    throw new HttpsError("invalid-argument", `The minimum withdrawal is ₹${MIN_WITHDRAWAL_PAISE / 100}.`);
  }
  const upi = typeof upiId === "string" ? upiId.trim() : "";
  if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upi)) {
    throw new HttpsError("invalid-argument", "Enter a valid UPI ID, such as name@bank.");
  }

  const userRef = db.collection("users").doc(uid);
  const withdrawalRef = db.collection("withdrawals").doc();
  const txRef = userRef.collection("transactions").doc(withdrawalRef.id);

  try {
    await db.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      if (!userSnap.exists) throw new HttpsError("not-found", "Account not found.");
      const user = userSnap.data();
      if (user.banned) throw new HttpsError("permission-denied", "This account cannot request payouts.");
      if (user.reviewRequired) throw new HttpsError("failed-precondition", "Your account is under review. Contact support.");

      // The one-pending-request check runs inside the transaction so two quick taps cannot both pass.
      const open = await t.get(db.collection("withdrawals").where("uid", "==", uid).where("status", "==", "pending").limit(1));
      if (!open.empty) throw new HttpsError("failed-precondition", "You already have a request waiting. Please wait until it is processed.");

      const confirmed = Number(user.confirmedBalancePaise) || 0;
      if (confirmed < paise) {
        throw new HttpsError("failed-precondition", `You only have ₹${(confirmed / 100).toFixed(2)} available.`);
      }

      t.update(userRef, { confirmedBalancePaise: confirmed - paise });
      t.set(withdrawalRef, { uid, method: "upi", upiId: upi, amountPaise: paise, status: "pending", createdAt: FieldValue.serverTimestamp() });
      t.set(txRef, {
        type: "withdrawal", amountPaise: -paise, method: "upi", upiId: upi,
        description: "UPI withdrawal", status: "pending", createdAt: FieldValue.serverTimestamp()
      });
    });
    logger.info(`[Withdrawal] ${uid} requested ${paise} paise`);
    return { success: true, withdrawalId: withdrawalRef.id };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("[Withdrawal] error", { err: String(err) });
    throw new HttpsError("internal", "Something went wrong. Please try again.");
  }
});

/* ==========================================================================
   4. CALLABLE (owner only): mark a withdrawal paid, or reject and refund
   ========================================================================== */
exports.processWithdrawalAdmin = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (!isOwner(request.auth.uid)) throw new HttpsError("permission-denied", "Only the owner can do this.");

  const { withdrawalId, action, reason } = request.data || {};
  if (typeof withdrawalId !== "string" || !withdrawalId || (action !== "paid" && action !== "reject")) {
    throw new HttpsError("invalid-argument", "Invalid request.");
  }

  const wRef = db.collection("withdrawals").doc(withdrawalId);
  await db.runTransaction(async (t) => {
    const wSnap = await t.get(wRef);
    if (!wSnap.exists) throw new HttpsError("not-found", "Withdrawal not found.");
    const w = wSnap.data();
    if (w.status !== "pending") throw new HttpsError("failed-precondition", `Already ${w.status}.`);

    const userRef = db.collection("users").doc(w.uid);
    const txRef = userRef.collection("transactions").doc(withdrawalId);
    const now = FieldValue.serverTimestamp();

    if (action === "paid") {
      t.update(wRef, { status: "paid", processedAt: now });
      t.update(txRef, { status: "paid", processedAt: now });
      return;
    }

    const userSnap = await t.get(userRef);
    const why = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : "Withdrawal rejected";
    if (userSnap.exists) {
      t.update(userRef, { confirmedBalancePaise: (Number(userSnap.data().confirmedBalancePaise) || 0) + (Number(w.amountPaise) || 0) });
    }
    t.update(wRef, { status: "rejected", rejectionReason: why, processedAt: now });
    t.update(txRef, { status: "rejected", processedAt: now });
    t.set(userRef.collection("transactions").doc(`${withdrawalId}_refund`), {
      type: "refund", amountPaise: Number(w.amountPaise) || 0, originalWithdrawalId: withdrawalId,
      description: why, status: "confirmed", createdAt: now
    });
  });

  logger.info(`[Admin] withdrawal ${withdrawalId} -> ${action}`);
  return { success: true };
});

/* ==========================================================================
   5. SHORT LINKS
   Flow: createLink (member) -> visitor opens /l/CODE -> startView (gets a signed
   token, no destination) -> page waits WAIT_SECONDS -> finishView (server checks
   the token age and only then returns the destination and counts the view).
   Because the wait is enforced here, the timer cannot be skipped in the browser.
   ========================================================================== */
const L = require("./lib");
let geo = null;
try { geo = require("geoip-lite"); } catch (e) { logger.warn("geoip-lite not installed: every visitor counts as 'other'"); }

const WAIT_SECONDS = 8;
const IP_DAILY_CAP = 40;       // counted views per visitor IP per day, across all links
const LINK_DAILY_CAP = 5000;   // counted views per link per day
const MEMBER_DAILY_LINKS = 30; // new links per member per day
const MEMBER_TOTAL_LINKS = 1000;

function needSecret() {
  const s = process.env.TOKEN_SECRET || "";
  if (s.length < 16 || s.includes(PLACEHOLDER)) throw new HttpsError("failed-precondition", "Short links are not configured yet.");
  return s;
}
const ipSalt = () => process.env.IP_SALT || "anticash";
const clientIpOf = (request) => String((request.rawRequest && request.rawRequest.ip) || "");
const uaOf = (request) => String((request.rawRequest && request.rawRequest.headers && request.rawRequest.headers["user-agent"]) || "");

async function blockedHosts() {
  const snap = await db.collection("config").doc("blocklist").get();
  return snap.exists && Array.isArray(snap.data().hosts) ? snap.data().hosts : [];
}

exports.createLink = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to create links.");
  const uid = request.auth.uid;

  const check = L.validateTargetUrl(request.data && request.data.url, await blockedHosts());
  if (!check.ok) throw new HttpsError("invalid-argument", check.reason);

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "Account not found.");
  if (userSnap.data().banned) throw new HttpsError("permission-denied", "This account cannot create links.");

  const startOfDay = new Date(L.dayKey() + "T00:00:00+05:30");
  const [today, total] = await Promise.all([
    db.collection("links").where("ownerUid", "==", uid).where("createdAt", ">=", startOfDay).count().get(),
    db.collection("links").where("ownerUid", "==", uid).count().get()
  ]);
  if (today.data().count >= MEMBER_DAILY_LINKS) throw new HttpsError("resource-exhausted", `You can create ${MEMBER_DAILY_LINKS} links a day. Try again tomorrow.`);
  if (total.data().count >= MEMBER_TOTAL_LINKS) throw new HttpsError("resource-exhausted", "You have reached the link limit.");

  for (let i = 0; i < 6; i++) {
    const code = L.makeCode(7);
    try {
      await db.collection("links").doc(code).create({
        ownerUid: uid, url: check.url, host: check.host, status: "active",
        clicks: 0, validClicks: 0, earnedPaise: 0, createdAt: FieldValue.serverTimestamp()
      });
      return { code };
    } catch (err) {
      if (err.code !== 6 && !/already exists/i.test(String(err))) throw new HttpsError("internal", "Could not create the link. Please try again.");
    }
  }
  throw new HttpsError("internal", "Could not create the link. Please try again.");
});

exports.updateMyLink = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { code, status } = request.data || {};
  if (!L.CODE_RE.test(String(code)) || !["active", "paused"].includes(status)) throw new HttpsError("invalid-argument", "Invalid request.");
  const ref = db.collection("links").doc(code);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists || s.data().ownerUid !== request.auth.uid) throw new HttpsError("not-found", "Link not found.");
    if (s.data().status === "disabled") throw new HttpsError("failed-precondition", "This link was disabled by an administrator.");
    t.update(ref, { status });
  });
  return { success: true };
});

exports.startView = onCall({ region: REGION }, async (request) => {
  const secret = needSecret();
  const code = String((request.data && request.data.code) || "");
  if (!L.CODE_RE.test(code)) throw new HttpsError("not-found", "This link is not available.");
  const snap = await db.collection("links").doc(code).get();
  if (!snap.exists || snap.data().status !== "active") throw new HttpsError("not-found", "This link is not available.");
  const ts = Date.now();
  const token = L.signToken(secret, code, ts, L.hashIp(clientIpOf(request), ipSalt()));
  return { token, ts, wait: WAIT_SECONDS, host: snap.data().host };
});

exports.finishView = onCall({ region: REGION }, async (request) => {
  const secret = needSecret();
  const { code, token, ts } = request.data || {};
  if (!L.CODE_RE.test(String(code)) || typeof token !== "string" || !Number.isFinite(Number(ts))) throw new HttpsError("invalid-argument", "Invalid request.");

  const ip = clientIpOf(request);
  const ipHash = L.hashIp(ip, ipSalt());
  if (!L.safeEq(token, L.signToken(secret, code, Number(ts), ipHash))) throw new HttpsError("permission-denied", "This page expired. Please open the link again.");
  const age = Date.now() - Number(ts);
  if (age < WAIT_SECONDS * 1000) throw new HttpsError("failed-precondition", "Please wait for the timer to finish.");
  if (age > 15 * 60 * 1000) throw new HttpsError("deadline-exceeded", "This page expired. Please open the link again.");

  const country = (geo && geo.lookup(ip) && geo.lookup(ip).country) || "";
  const tier = L.tierOf(country);
  const paise = L.paisePerView(tier);
  const isBot = L.BOT_RE.test(uaOf(request));
  const day = L.dayKey();

  const linkRef = db.collection("links").doc(code);
  const ledgerRef = db.collection("linkViews").doc(`${day}_${code}_${ipHash}`);
  const ipRef = db.collection("ipDaily").doc(`${day}_${ipHash}`);
  const statsRef = db.collection("stats").doc(day);

  const url = await db.runTransaction(async (t) => {
    const linkSnap = await t.get(linkRef);
    if (!linkSnap.exists || linkSnap.data().status !== "active") throw new HttpsError("not-found", "This link is not available.");
    const link = linkSnap.data();
    const ownerRef = db.collection("users").doc(link.ownerUid);
    const dailyTxRef = ownerRef.collection("transactions").doc(`link_${code}_${day}`);
    const [ledger, ipSnap, ownerSnap, dailyTx] = await Promise.all([t.get(ledgerRef), t.get(ipRef), t.get(ownerRef), t.get(dailyTxRef)]);

    const daily = link.daily && link.daily.day === day ? link.daily.n || 0 : 0;
    const selfView = request.auth && request.auth.uid === link.ownerUid;
    const counted = !isBot && !selfView && !ledger.exists
      && ownerSnap.exists && !ownerSnap.data().banned
      && (ipSnap.exists ? ipSnap.data().n || 0 : 0) < IP_DAILY_CAP
      && daily < LINK_DAILY_CAP;

    const linkUpdate = { clicks: FieldValue.increment(1) };
    if (counted) {
      linkUpdate.validClicks = FieldValue.increment(1);
      linkUpdate.earnedPaise = FieldValue.increment(paise);
      linkUpdate.daily = { day, n: daily + 1 };
      t.set(ledgerRef, { code, day, tier, country, at: FieldValue.serverTimestamp() });
      t.set(ipRef, { n: (ipSnap.exists ? ipSnap.data().n || 0 : 0) + 1, day }, { merge: true });
      t.update(ownerRef, { pendingBalancePaise: FieldValue.increment(paise) });
      if (dailyTx.exists) t.update(dailyTxRef, { amountPaise: FieldValue.increment(paise), views: FieldValue.increment(1) });
      else t.set(dailyTxRef, { type: "earn", amountPaise: paise, views: 1, network: "Short links", description: `Short link views (${code})`, status: "pending", createdAt: FieldValue.serverTimestamp() });
      t.set(statsRef, { day, views: FieldValue.increment(1), valid: FieldValue.increment(1), creditedPaise: FieldValue.increment(paise) }, { merge: true });
    } else {
      t.set(statsRef, { day, views: FieldValue.increment(1) }, { merge: true });
    }
    t.update(linkRef, linkUpdate);
    return link.url;
  });
  return { url };
});

exports.reportLink = onCall({ region: REGION }, async (request) => {
  const code = String((request.data && request.data.code) || "");
  const reason = String((request.data && request.data.reason) || "").trim().slice(0, 300);
  if (!L.CODE_RE.test(code) || reason.length < 3) throw new HttpsError("invalid-argument", "Tell us briefly what is wrong with this link.");
  const ipHash = L.hashIp(clientIpOf(request), ipSalt());
  const capRef = db.collection("ipDaily").doc(`report_${L.dayKey()}_${ipHash}`);
  await db.runTransaction(async (t) => {
    const c = await t.get(capRef);
    const n = c.exists ? c.data().n || 0 : 0;
    if (n >= 5) throw new HttpsError("resource-exhausted", "Too many reports today.");
    t.set(capRef, { n: n + 1 });
    t.set(db.collection("reports").doc(), { code, reason, status: "open", createdAt: FieldValue.serverTimestamp() });
  });
  return { success: true };
});

/* ---------- Owner-only moderation ---------- */
function ownerOnly(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (!isOwner(request.auth.uid)) throw new HttpsError("permission-denied", "Only the owner can do this.");
}

exports.adminSetBan = onCall({ region: REGION }, async (request) => {
  ownerOnly(request);
  const { uid, banned } = request.data || {};
  if (typeof uid !== "string" || !uid || typeof banned !== "boolean") throw new HttpsError("invalid-argument", "Invalid request.");
  if (uid === request.auth.uid) throw new HttpsError("failed-precondition", "You cannot ban yourself.");
  const userRef = db.collection("users").doc(uid);
  if (!(await userRef.get()).exists) throw new HttpsError("not-found", "User not found.");
  await userRef.update({ banned });
  if (banned) {
    const links = await db.collection("links").where("ownerUid", "==", uid).where("status", "in", ["active", "paused"]).limit(400).get();
    const batch = db.batch();
    links.forEach((d) => batch.update(d.ref, { status: "disabled", disabledReason: "Owner banned" }));
    await batch.commit();
  }
  logger.info(`[Admin] ${uid} banned=${banned}`);
  return { success: true };
});

exports.adminSetLinkStatus = onCall({ region: REGION }, async (request) => {
  ownerOnly(request);
  const { code, status, reason } = request.data || {};
  if (!L.CODE_RE.test(String(code)) || !["active", "disabled"].includes(status)) throw new HttpsError("invalid-argument", "Invalid request.");
  const ref = db.collection("links").doc(code);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Link not found.");
  await ref.update(status === "disabled" ? { status, disabledReason: String(reason || "Disabled by owner").slice(0, 200) } : { status, disabledReason: FieldValue.delete() });
  return { success: true };
});

exports.adminBlockHost = onCall({ region: REGION }, async (request) => {
  ownerOnly(request);
  const host = String((request.data && request.data.host) || "").toLowerCase().trim();
  if (!/^[a-z0-9.-]{4,253}$/.test(host) || !host.includes(".")) throw new HttpsError("invalid-argument", "Enter a domain such as example.com.");
  await db.collection("config").doc("blocklist").set({ hosts: FieldValue.arrayUnion(host) }, { merge: true });
  const links = await db.collection("links").where("host", "==", host).where("status", "in", ["active", "paused"]).limit(400).get();
  const batch = db.batch();
  links.forEach((d) => batch.update(d.ref, { status: "disabled", disabledReason: "Domain blocked" }));
  await batch.commit();
  return { success: true, disabled: links.size };
});

exports.adminResolveReport = onCall({ region: REGION }, async (request) => {
  ownerOnly(request);
  const id = String((request.data && request.data.id) || "");
  if (!id) throw new HttpsError("invalid-argument", "Invalid request.");
  await db.collection("reports").doc(id).update({ status: "resolved" });
  return { success: true };
});

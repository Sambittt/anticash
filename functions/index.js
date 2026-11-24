/**
 * AntiCash Cloud Functions (2nd Gen, Node.js)
 * All monetary amounts are handled as integer paise (100 paise = 1 Indian Rupee).
 * Zero emojis, strictly typed integer arithmetic, server-side idempotency.
 */

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

/**
 * EDIT ME: GLOBAL SERVICE CONFIGURATION
 */
const MIN_WITHDRAWAL_PAISE = 30000; // 30,000 paise = 300 INR
const HOLD_PERIOD_DAYS = 7; // Hold period before pending balance moves to confirmed

const CONFIG = {
  // EDIT ME: Set your Firebase Auth UID from Firebase Console
  ownerUid: process.env.OWNER_UID || "EDIT_ME_OWNER_UID",

  minWithdrawalPaise: MIN_WITHDRAWAL_PAISE,
  holdPeriodDays: HOLD_PERIOD_DAYS,

  /**
   * EDIT ME: PARTNER OFFERWALL NETWORK SETTINGS
   * rewardMultiplierToPaise: Multiplier that converts the network's incoming currency unit into paise.
   * Example:
   * If network sends reward in whole INR (1 = ₹1): multiplier is 100.
   * If network sends reward in paise (100 = ₹1): multiplier is 1.
   * If network sends USD cents (1 cent = 85 paise approx): multiplier is 85.
   */
  networks: {
    network1: {
      name: "Partner Offerwall 1",
      secret: process.env.OFFERWALL_SECRET_NET1 || "EDIT_ME_SECRET_NET1",
      // EDIT ME: Multiplier to convert incoming reward to integer paise
      rewardMultiplierToPaise: 100, // 1 network unit = 100 paise (1 INR)
      signatureMode: "md5_concat", // "md5_concat", "sha256_concat", or "hmac_sha256"
      signatureFields: ["uid", "txId", "reward", "secret"],
      paramMap: {
        userId: "uid",
        reward: "reward",
        transactionId: "tx_id",
        status: "status",
        signature: "sig",
        ip: "ip"
      },
      reversalStatusValues: ["2", "reversed", "chargeback"],
      ipAllowlist: [] // Optional allowlist of IP strings. Empty array allows all.
    },

    network2: {
      name: "Partner Offerwall 2",
      secret: process.env.OFFERWALL_SECRET_NET2 || "EDIT_ME_SECRET_NET2",
      rewardMultiplierToPaise: 100,
      signatureMode: "hmac_sha256",
      signatureFields: ["subId", "transId", "amount"],
      paramMap: {
        userId: "subId",
        reward: "amount",
        transactionId: "transId",
        status: "status",
        signature: "signature",
        ip: "user_ip"
      },
      reversalStatusValues: ["chargeback", "reversed", "0"],
      ipAllowlist: []
    }
  }
};

/* ==========================================================================
   1. POSTBACK HANDLER (HTTPS GET)
   ========================================================================== */
exports.postback = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const query = req.method === "GET" ? req.query : req.body;
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

  const networkKey = query.network || query.net || "network1";
  const netConfig = CONFIG.networks[networkKey];

  if (!netConfig) {
    logger.warn(`[Postback] Received request for unknown network identifier: ${networkKey}`, { query });
    return res.status(200).send("OK: Unknown network");
  }

  // 1. Check IP allowlist if configured
  if (netConfig.ipAllowlist && netConfig.ipAllowlist.length > 0) {
    const isAllowed = netConfig.ipAllowlist.some((ip) => clientIp.includes(ip));
    if (!isAllowed) {
      logger.error(`[Postback Security] IP address not in allowlist: ${clientIp}`, { networkKey, query });
      return res.status(403).send("Forbidden: IP not authorized");
    }
  }

  // Extract parameters
  const { paramMap } = netConfig;
  const rawUid = query[paramMap.userId];
  const rawReward = query[paramMap.reward];
  const rawTxId = query[paramMap.transactionId];
  const rawStatus = query[paramMap.status] !== undefined ? String(query[paramMap.status]) : "1";
  const rawSignature = query[paramMap.signature];
  const reportedUserIp = query[paramMap.ip] || clientIp;

  if (!rawUid || !rawTxId || rawReward === undefined) {
    logger.warn(`[Postback] Missing required parameters: uid=${rawUid}, txId=${rawTxId}`, { query });
    return res.status(200).send("OK: Missing parameters");
  }

  // Convert raw reward into integer paise using network multiplier
  const rawNumber = parseFloat(rawReward);
  if (isNaN(rawNumber) || rawNumber < 0) {
    logger.warn(`[Postback] Invalid reward format: ${rawReward}`);
    return res.status(200).send("OK: Invalid reward");
  }

  const multiplier = Number(netConfig.rewardMultiplierToPaise) || 100;
  const amountPaise = Math.round(rawNumber * multiplier);

  // 2. Signature verification
  const isSignatureValid = verifySignature(query, rawSignature, netConfig);
  if (!isSignatureValid) {
    logger.error(`[Postback Security] Signature mismatch for network ${networkKey}`, {
      query,
      receivedSignature: rawSignature
    });
    return res.status(403).send("Forbidden: Signature mismatch");
  }

  // 3. Idempotency ledger check: processedPostbacks/{network_txId}
  const postbackDocId = `${networkKey}_${rawTxId}`;
  const postbackRef = db.collection("processedPostbacks").doc(postbackDocId);
  const userRef = db.collection("users").doc(rawUid);

  try {
    const isDuplicate = await db.runTransaction(async (transaction) => {
      const postbackSnap = await transaction.get(postbackRef);
      if (postbackSnap.exists) {
        return true;
      }

      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        logger.warn(`[Postback] Unknown UID received: ${rawUid}. Recording postback without balance credit.`);
        transaction.set(postbackRef, {
          network: networkKey,
          txId: rawTxId,
          uid: rawUid,
          amountPaise,
          status: "skipped_unknown_user",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          rawQuery: query
        });
        return false;
      }

      const userData = userSnap.data();
      if (userData.banned) {
        logger.warn(`[Postback] Postback received for banned account: ${rawUid}`);
        transaction.set(postbackRef, {
          network: networkKey,
          txId: rawTxId,
          uid: rawUid,
          amountPaise,
          status: "skipped_banned_user",
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return false;
      }

      const isReversal = netConfig.reversalStatusValues.includes(rawStatus.toLowerCase());
      const txRef = userRef.collection("transactions").doc(rawTxId);

      if (isReversal) {
        const currentPending = userData.pendingBalancePaise || 0;
        const currentConfirmed = userData.confirmedBalancePaise || 0;

        let newPending = currentPending - amountPaise;
        let newConfirmed = currentConfirmed;
        let negativeFlag = false;

        if (newPending < 0) {
          const remainder = Math.abs(newPending);
          newPending = 0;
          newConfirmed = currentConfirmed - remainder;
          if (newConfirmed < 0) {
            newConfirmed = 0;
            negativeFlag = true;
          }
        }

        const userUpdate = {
          pendingBalancePaise: newPending,
          confirmedBalancePaise: newConfirmed
        };

        if (negativeFlag) {
          userUpdate.negativeBalance = true;
          userUpdate.reviewRequired = true;
          logger.warn(`[Postback] User ${rawUid} balance fell below zero after reversal of ${amountPaise} paise.`);
        }

        transaction.update(userRef, userUpdate);

        transaction.set(txRef, {
          type: "reversal",
          amountPaise: -amountPaise,
          network: netConfig.name || networkKey,
          description: "Offer reversal from partner",
          status: "reversed",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceIp: reportedUserIp,
          rawPostback: query
        });

      } else {
        const newPending = (userData.pendingBalancePaise || 0) + amountPaise;
        transaction.update(userRef, {
          pendingBalancePaise: newPending
        });

        transaction.set(txRef, {
          type: "earn",
          amountPaise,
          network: netConfig.name || networkKey,
          description: "Offer completion",
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceIp: reportedUserIp,
          rawPostback: query
        });
      }

      transaction.set(postbackRef, {
        network: networkKey,
        txId: rawTxId,
        uid: rawUid,
        amountPaise,
        type: isReversal ? "reversal" : "earn",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceIp: reportedUserIp,
        clientIp
      });

      return false;
    });

    if (isDuplicate) {
      logger.info(`[Postback] Duplicate postback safely ignored: ${postbackDocId}`);
    } else {
      logger.info(`[Postback] Processed ${networkKey} tx ${rawTxId} for user ${rawUid} (${amountPaise} paise)`);
    }

    return res.status(200).send("1");
  } catch (err) {
    logger.error(`[Postback Processing Error] ${postbackDocId}:`, err);
    return res.status(200).send("OK: Processed with warnings");
  }
});

function verifySignature(query, receivedSig, netConfig) {
  if (!netConfig.secret || netConfig.secret.includes("EDIT_ME")) {
    logger.warn(`[Signature Verification] Warning: Secret is unconfigured for ${netConfig.name}. Allowing request.`);
    return true;
  }

  if (!receivedSig) return false;

  const mode = netConfig.signatureMode || "md5_concat";
  const fields = netConfig.signatureFields || [];

  const values = fields.map((f) => {
    if (f === "secret") return netConfig.secret;
    return query[f] || "";
  });

  const baseString = values.join(":");

  try {
    if (mode === "md5_concat") {
      const hash = crypto.createHash("md5").update(baseString).digest("hex");
      return hash.toLowerCase() === receivedSig.toLowerCase();
    } else if (mode === "sha256_concat") {
      const hash = crypto.createHash("sha256").update(baseString).digest("hex");
      return hash.toLowerCase() === receivedSig.toLowerCase();
    } else if (mode === "hmac_sha256") {
      const hmac = crypto.createHmac("sha256", netConfig.secret).update(baseString).digest("hex");
      return hmac.toLowerCase() === receivedSig.toLowerCase();
    }
  } catch (err) {
    logger.error("[Signature Verification Error]:", err);
    return false;
  }

  return false;
}

/* ==========================================================================
   2. SCHEDULED JOB: DAILY PENDING TO CONFIRMED MATURATION
   ========================================================================== */
exports.processPendingBalance = onSchedule("every 24 hours", async (event) => {
  logger.info("[Scheduled Job] Running daily pending to confirmed balance maturation...");

  const holdDays = CONFIG.holdPeriodDays || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - holdDays);
  const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

  try {
    const usersSnap = await db.collection("users").where("pendingBalancePaise", ">", 0).get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();

      if (userData.banned) continue;

      const txSnap = await db.collection("users").doc(uid).collection("transactions")
        .where("status", "==", "pending")
        .where("createdAt", "<=", cutoffTimestamp)
        .get();

      if (txSnap.empty) continue;

      let maturedPaise = 0;
      const maturedTxRefs = [];

      txSnap.forEach((tDoc) => {
        const tx = tDoc.data();
        if (tx.amountPaise > 0) {
          maturedPaise += tx.amountPaise;
          maturedTxRefs.push(tDoc.ref);
        }
      });

      if (maturedPaise > 0) {
        await db.runTransaction(async (transaction) => {
          const freshUser = await transaction.get(userDoc.ref);
          const currentData = freshUser.data();

          const newPending = Math.max(0, (currentData.pendingBalancePaise || 0) - maturedPaise);
          const newConfirmed = (currentData.confirmedBalancePaise || 0) + maturedPaise;

          transaction.update(userDoc.ref, {
            pendingBalancePaise: newPending,
            confirmedBalancePaise: newConfirmed
          });

          maturedTxRefs.forEach((ref) => {
            transaction.update(ref, {
              status: "confirmed",
              confirmedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });
        });

        logger.info(`[Scheduled Job] Matured ${maturedPaise} paise for user ${uid}.`);
      }
    }
  } catch (err) {
    logger.error("[Scheduled Job Error]:", err);
  }
});

/* ==========================================================================
   3. CALLABLE FUNCTION: CREATE WITHDRAWAL
   ========================================================================== */
exports.createWithdrawal = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to request a withdrawal.");
  }

  const uid = request.auth.uid;
  const { upiId, amountPaise } = request.data;

  const requestedPaise = parseInt(amountPaise, 10);
  if (isNaN(requestedPaise) || requestedPaise < MIN_WITHDRAWAL_PAISE) {
    throw new HttpsError(
      "invalid-argument",
      `Minimum withdrawal threshold is ₹${(MIN_WITHDRAWAL_PAISE / 100).toFixed(2)} (${MIN_WITHDRAWAL_PAISE} paise).`
    );
  }

  const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
  if (!upiId || !upiRegex.test(upiId.trim())) {
    throw new HttpsError("invalid-argument", "Please enter a valid Indian UPI address (e.g. name@bank).");
  }

  // Enforce one active pending withdrawal limit per user
  const existingPending = await db.collection("withdrawals")
    .where("uid", "==", uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!existingPending.empty) {
    throw new HttpsError(
      "failed-precondition",
      "You already have a pending withdrawal request in queue. Please wait until it is processed."
    );
  }

  const userRef = db.collection("users").doc(uid);
  const withdrawalRef = db.collection("withdrawals").doc();
  const txRef = userRef.collection("transactions").doc(withdrawalRef.id);

  try {
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "User account not found.");
      }

      const userData = userSnap.data();
      if (userData.banned) {
        throw new HttpsError("permission-denied", "This account is restricted from requesting payouts.");
      }

      const confirmed = userData.confirmedBalancePaise || 0;
      if (confirmed < requestedPaise) {
        throw new HttpsError(
          "failed-precondition",
          `Insufficient confirmed balance. You have ₹${(confirmed / 100).toFixed(2)} available.`
        );
      }

      // Deduct from confirmed balance
      transaction.update(userRef, {
        confirmedBalancePaise: confirmed - requestedPaise
      });

      // Create withdrawal document
      transaction.set(withdrawalRef, {
        uid,
        method: "upi",
        upiId: upiId.trim(),
        amountPaise: requestedPaise,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Log transaction record
      transaction.set(txRef, {
        type: "withdrawal",
        amountPaise: -requestedPaise,
        method: "upi",
        upiId: upiId.trim(),
        description: "UPI withdrawal request",
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    logger.info(`[Withdrawal Created] User ${uid} requested ₹${(requestedPaise / 100).toFixed(2)} to ${upiId}`);
    return { success: true, withdrawalId: withdrawalRef.id };
  } catch (err) {
    logger.error("[Create Withdrawal Error]:", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "An error occurred while submitting your withdrawal.");
  }
});

/* ==========================================================================
   4. ADMIN CALLABLE FUNCTION: PROCESS WITHDRAWAL (Paid or Reject)
   ========================================================================== */
exports.processWithdrawalAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  if (request.auth.uid !== CONFIG.ownerUid && CONFIG.ownerUid !== "EDIT_ME_OWNER_UID") {
    throw new HttpsError("permission-denied", "Only the administrator account can process withdrawals.");
  }

  const { withdrawalId, action, reason } = request.data;
  if (!withdrawalId || (action !== "paid" && action !== "reject")) {
    throw new HttpsError("invalid-argument", "Invalid arguments provided.");
  }

  const wRef = db.collection("withdrawals").doc(withdrawalId);

  await db.runTransaction(async (transaction) => {
    const wSnap = await transaction.get(wRef);
    if (!wSnap.exists) {
      throw new HttpsError("not-found", "Withdrawal record not found.");
    }

    const wData = wSnap.data();
    if (wData.status !== "pending") {
      throw new HttpsError("failed-precondition", `Withdrawal already resolved as '${wData.status}'.`);
    }

    const userRef = db.collection("users").doc(wData.uid);
    const txRef = userRef.collection("transactions").doc(withdrawalId);

    if (action === "paid") {
      transaction.update(wRef, {
        status: "paid",
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      transaction.update(txRef, {
        status: "paid",
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else if (action === "reject") {
      // Refund amountPaise back to user's confirmedBalancePaise
      const userSnap = await transaction.get(userRef);
      if (userSnap.exists) {
        const currentConfirmed = userSnap.data().confirmedBalancePaise || 0;
        transaction.update(userRef, {
          confirmedBalancePaise: currentConfirmed + (wData.amountPaise || 0)
        });
      }

      transaction.update(wRef, {
        status: "rejected",
        rejectionReason: reason || "Invalid UPI address or terms violation",
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Record refund transaction
      const refundRef = userRef.collection("transactions").doc();
      transaction.set(refundRef, {
        type: "refund",
        amountPaise: wData.amountPaise || 0,
        originalWithdrawalId: withdrawalId,
        description: reason || "Rejected withdrawal refund",
        status: "confirmed",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });

  logger.info(`[Admin Action] Withdrawal ${withdrawalId} marked as ${action}`);
  return { success: true };
});

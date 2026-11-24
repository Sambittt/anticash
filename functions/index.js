/**
 * ==========================================================================
 * ANTICASH CLOUD FUNCTIONS (2nd Gen, Node.js)
 * ==========================================================================
 * Secure backend logic for:
 * 1. Postback endpoint (Offerwall callbacks with signature verification,
 *    IP allowlisting, idempotency, status handling, and anti-fraud logging)
 * 2. Daily scheduled job to mature pending points into confirmed points
 * 3. Callable createWithdrawal function (Strict atomic balance deduction)
 * 4. Admin processWithdrawalAdmin function (Approvals, rejections & refunds)
 * ==========================================================================
 */

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

/**
 * ==========================================================================
 * EDIT ME: CONFIGURATION & OFFERWALL NETWORK POSTBACK SETTINGS
 * ==========================================================================
 * Add or update your partner networks here.
 * Set the secret in Firebase environment secrets or directly below.
 * ==========================================================================
 */
const CONFIG = {
  // EDIT ME: Replace with your Firebase Auth UID from Firebase Console
  ownerUid: process.env.OWNER_UID || "EDIT_ME_OWNER_UID",

  // Point conversion & rules
  pointsPerInr: 10,
  minWithdrawalPoints: 500,
  holdPeriodDays: 7, // Days before pending points automatically confirm

  // Networks postback settings
  networks: {
    // Example Network 1: AdGate / Custom Partner (MD5 Concatenation)
    network1: {
      name: "Partner Offerwall 1",
      // EDIT ME: Secret provided by your offerwall dashboard
      secret: process.env.OFFERWALL_SECRET_NET1 || "EDIT_ME_SECRET_NET1",
      // Verification mode: "md5_concat", "sha256_concat", or "hmac_sha256"
      signatureMode: "md5_concat",
      // Field order used by the network when constructing the hash:
      // e.g. md5(uid + ":" + txId + ":" + reward + ":" + secret)
      signatureFields: ["uid", "txId", "reward", "secret"],
      // Parameter names in GET query string:
      paramMap: {
        userId: "uid",
        reward: "reward",
        transactionId: "tx_id",
        status: "status", // e.g. "1" = complete, "2" = chargeback/reversal
        signature: "sig",
        ip: "ip"
      },
      // Status values that indicate a chargeback or reversal
      reversalStatusValues: ["2", "reversed", "chargeback"],
      // Optional IP allowlist: Array of strings. Leave empty to allow all.
      ipAllowlist: [] // e.g. ["52.14.23.11", "54.89.21.4"]
    },

    // Example Network 2: OfferToro / Monlix / Wannads (SHA256 / HMAC)
    network2: {
      name: "Partner Offerwall 2",
      secret: process.env.OFFERWALL_SECRET_NET2 || "EDIT_ME_SECRET_NET2",
      signatureMode: "hmac_sha256",
      signatureFields: ["subId", "transId", "points"],
      paramMap: {
        userId: "subId",
        reward: "points",
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
   1. POSTBACK ENDPOINT (HTTPS GET)
   ========================================================================== */
exports.postback = onRequest({ cors: false }, async (req, res) => {
  // Always accept GET requests
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const query = req.method === "GET" ? req.query : req.body;
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

  // Identify which network sent the callback (via query param `network` or route)
  const networkKey = query.network || query.net || "network1";
  const netConfig = CONFIG.networks[networkKey];

  if (!netConfig) {
    logger.warn(`[Postback] Received postback for unknown network: ${networkKey}`, { query });
    // Always return 200 so network does not indefinitely retry invalid requests
    return res.status(200).send("OK: Unknown network");
  }

  // 1. Check IP allowlist if enabled
  if (netConfig.ipAllowlist && netConfig.ipAllowlist.length > 0) {
    const isAllowed = netConfig.ipAllowlist.some((allowed) => clientIp.includes(allowed));
    if (!isAllowed) {
      logger.error(`[Postback Fraud Alert] Request from unallowed IP: ${clientIp}`, { networkKey, query });
      return res.status(403).send("Forbidden: IP not authorized");
    }
  }

  // Extract mapped parameters
  const { paramMap } = netConfig;
  const rawUid = query[paramMap.userId];
  const rawReward = query[paramMap.reward];
  const rawTxId = query[paramMap.transactionId];
  const rawStatus = query[paramMap.status] !== undefined ? String(query[paramMap.status]) : "1";
  const rawSignature = query[paramMap.signature];
  const reportedUserIp = query[paramMap.ip] || clientIp;

  if (!rawUid || !rawTxId || rawReward === undefined) {
    logger.warn(`[Postback] Missing essential parameters: uid=${rawUid}, txId=${rawTxId}`, { query });
    return res.status(200).send("OK: Missing required fields");
  }

  const rewardPoints = parseInt(rawReward, 10);
  if (isNaN(rewardPoints)) {
    logger.warn(`[Postback] Invalid reward value: ${rawReward}`);
    return res.status(200).send("OK: Invalid reward value");
  }

  // 2. Signature Verification
  const isSignatureValid = verifySignature(query, rawSignature, netConfig);
  if (!isSignatureValid) {
    logger.error(`[Postback Fraud Alert] Invalid signature for network ${networkKey}`, {
      query,
      expectedMode: netConfig.signatureMode,
      receivedSignature: rawSignature
    });
    return res.status(403).send("Forbidden: Invalid signature");
  }

  // 3. Idempotency Check using processedPostbacks/{network_txId}
  const postbackDocId = `${networkKey}_${rawTxId}`;
  const postbackRef = db.collection("processedPostbacks").doc(postbackDocId);
  const userRef = db.collection("users").doc(rawUid);

  try {
    const isProcessed = await db.runTransaction(async (transaction) => {
      const postbackSnap = await transaction.get(postbackRef);
      if (postbackSnap.exists) {
        // Already processed: Do NOT credit again, but respond 200 OK immediately
        return true;
      }

      // Check user existence and ban status
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        logger.warn(`[Postback] Unknown UID received: ${rawUid}. Logging to processedPostbacks without credit.`);
        transaction.set(postbackRef, {
          network: networkKey,
          txId: rawTxId,
          uid: rawUid,
          points: rewardPoints,
          status: "skipped_unknown_user",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          rawQuery: query
        });
        return false;
      }

      const userData = userSnap.data();
      if (userData.banned) {
        logger.warn(`[Postback] Banned user attempted postback: ${rawUid}`, { rawTxId });
        transaction.set(postbackRef, {
          network: networkKey,
          txId: rawTxId,
          uid: rawUid,
          points: rewardPoints,
          status: "skipped_banned_user",
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return false;
      }

      // Determine if this is a completion or a reversal/chargeback
      const isReversal = netConfig.reversalStatusValues.includes(rawStatus.toLowerCase());
      const txRef = userRef.collection("transactions").doc(rawTxId);

      if (isReversal) {
        // Reversal handling: Deduct points
        const currentPending = userData.pendingPoints || 0;
        const currentConfirmed = userData.confirmedPoints || 0;
        const totalBalance = currentPending + currentConfirmed;

        // Ensure balances do not drop below zero silently
        let newPending = currentPending - rewardPoints;
        let newConfirmed = currentConfirmed;
        let flagNegative = false;

        if (newPending < 0) {
          const overflow = Math.abs(newPending);
          newPending = 0;
          newConfirmed = currentConfirmed - overflow;
          if (newConfirmed < 0) {
            newConfirmed = 0;
            flagNegative = true;
          }
        }

        const userUpdate = {
          pendingPoints: newPending,
          confirmedPoints: newConfirmed
        };

        if (flagNegative) {
          userUpdate.negativeBalance = true;
          userUpdate.reviewRequired = true;
          logger.warn(`[Postback Fraud Flag] User ${rawUid} balance fell below zero from reversal of ${rewardPoints} pts!`);
        }

        transaction.update(userRef, userUpdate);

        // Record reversal transaction
        transaction.set(txRef, {
          type: "reversal",
          points: -rewardPoints,
          network: netConfig.name || networkKey,
          status: "reversed",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceIp: reportedUserIp,
          rawPostback: query
        });

      } else {
        // Normal completion: Add to pendingPoints
        const newPending = (userData.pendingPoints || 0) + rewardPoints;
        transaction.update(userRef, {
          pendingPoints: newPending
        });

        // Record earn transaction
        transaction.set(txRef, {
          type: "earn",
          points: rewardPoints,
          network: netConfig.name || networkKey,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          sourceIp: reportedUserIp,
          rawPostback: query
        });
      }

      // Mark postback as processed
      transaction.set(postbackRef, {
        network: networkKey,
        txId: rawTxId,
        uid: rawUid,
        points: rewardPoints,
        type: isReversal ? "reversal" : "earn",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceIp: reportedUserIp,
        clientIp
      });

      return false;
    });

    if (isProcessed) {
      logger.info(`[Postback] Duplicate transaction ignored: ${postbackDocId}`);
    } else {
      logger.info(`[Postback] Successfully processed ${networkKey} transaction ${rawTxId} for user ${rawUid}`);
    }

    // Always respond 200 OK
    return res.status(200).send("1"); // Most networks treat "1" or "OK" as success
  } catch (err) {
    logger.error(`[Postback Error] Failed processing postback ${postbackDocId}:`, err);
    // Still send 200 to prevent offerwall from flooding retry requests if it was a data issue
    return res.status(200).send("OK: Processed with warnings");
  }
});

/**
 * Signature verification helper
 */
function verifySignature(query, receivedSig, netConfig) {
  // If no secret configured (development mode), skip check with warning
  if (!netConfig.secret || netConfig.secret.includes("EDIT_ME")) {
    logger.warn(`[Signature Verification] Warning: Secret is unconfigured for ${netConfig.name}. Allowing request for testing.`);
    return true;
  }

  if (!receivedSig) return false;

  const mode = netConfig.signatureMode || "md5_concat";
  const fields = netConfig.signatureFields || [];

  // Build concatenated string
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
   2. SCHEDULED FUNCTION: DAILY PENDING TO CONFIRMED MATURATION
   ========================================================================== */
exports.processPendingPoints = onSchedule("every 24 hours", async (event) => {
  logger.info("[Scheduled Matures] Running daily pending-to-confirmed point maturation...");

  const holdDays = CONFIG.holdPeriodDays || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - holdDays);
  const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

  try {
    // Find all users with pendingPoints > 0
    const usersSnap = await db.collection("users").where("pendingPoints", ">", 0).get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();

      if (userData.banned) continue;

      // Find unreversed pending transactions created before cutoff
      const txSnap = await db.collection("users").doc(uid).collection("transactions")
        .where("status", "==", "pending")
        .where("createdAt", "<=", cutoffTimestamp)
        .get();

      if (txSnap.empty) continue;

      let maturedPoints = 0;
      const maturedTxRefs = [];

      txSnap.forEach((tDoc) => {
        const tx = tDoc.data();
        if (tx.points > 0) {
          maturedPoints += tx.points;
          maturedTxRefs.push(tDoc.ref);
        }
      });

      if (maturedPoints > 0) {
        await db.runTransaction(async (transaction) => {
          const freshUser = await transaction.get(userDoc.ref);
          const currentData = freshUser.data();

          const newPending = Math.max(0, (currentData.pendingPoints || 0) - maturedPoints);
          const newConfirmed = (currentData.confirmedPoints || 0) + maturedPoints;

          transaction.update(userDoc.ref, {
            pendingPoints: newPending,
            confirmedPoints: newConfirmed
          });

          // Mark transactions as confirmed
          maturedTxRefs.forEach((ref) => {
            transaction.update(ref, {
              status: "confirmed",
              confirmedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });
        });

        logger.info(`[Scheduled Matures] Transferred ${maturedPoints} points from pending to confirmed for user ${uid}`);
      }
    }
  } catch (err) {
    logger.error("[Scheduled Matures Error]:", err);
  }
});

/* ==========================================================================
   3. CALLABLE FUNCTION: CREATE WITHDRAWAL
   ========================================================================== */
exports.createWithdrawal = onCall(async (request) => {
  // 1. Check Authentication
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to request a withdrawal.");
  }

  const uid = request.auth.uid;
  const { method, upiId, giftCardType, recipientEmail, points } = request.data;

  const pointsRequested = parseInt(points, 10);
  if (isNaN(pointsRequested) || pointsRequested < CONFIG.minWithdrawalPoints) {
    throw new HttpsError(
      "invalid-argument",
      `Minimum withdrawal threshold is ${CONFIG.minWithdrawalPoints} points (₹${CONFIG.minWithdrawalPoints / CONFIG.pointsPerInr}).`
    );
  }

  if (method === "upi") {
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
    if (!upiId || !upiRegex.test(upiId.trim())) {
      throw new HttpsError("invalid-argument", "Please provide a valid Indian UPI ID (e.g. name@bank).");
    }
  }

  // 2. Limit: Only 1 pending withdrawal at a time
  const existingPending = await db.collection("withdrawals")
    .where("uid", "==", uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!existingPending.empty) {
    throw new HttpsError(
      "failed-precondition",
      "You already have an active pending withdrawal request. Please wait until it is processed."
    );
  }

  // 3. Atomically deduct confirmed points and create withdrawal
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

      const confirmed = userData.confirmedPoints || 0;
      if (confirmed < pointsRequested) {
        throw new HttpsError(
          "failed-precondition",
          `Insufficient confirmed balance. You have ${confirmed} points, but requested ${pointsRequested}.`
        );
      }

      // Deduct points
      transaction.update(userRef, {
        confirmedPoints: confirmed - pointsRequested
      });

      // Create withdrawal document
      transaction.set(withdrawalRef, {
        uid,
        method: method || "upi",
        upiId: method === "upi" ? upiId.trim() : null,
        giftCardType: method !== "upi" ? giftCardType || method : null,
        recipientEmail: recipientEmail || userData.email || null,
        points: pointsRequested,
        amountInr: pointsRequested / CONFIG.pointsPerInr,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Log transaction
      transaction.set(txRef, {
        type: "withdrawal",
        points: -pointsRequested,
        method: method || "upi",
        destination: method === "upi" ? upiId.trim() : recipientEmail,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    logger.info(`[Withdrawal Created] User ${uid} requested withdrawal of ${pointsRequested} pts via ${method}`);
    return { success: true, withdrawalId: withdrawalRef.id };
  } catch (err) {
    logger.error("[Create Withdrawal Error]:", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "An error occurred while creating your withdrawal request.");
  }
});

/* ==========================================================================
   4. ADMIN CALLABLE FUNCTION: PROCESS WITHDRAWAL (Paid or Reject)
   ========================================================================== */
exports.processWithdrawalAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  // Verify that the caller is the owner
  if (request.auth.uid !== CONFIG.ownerUid && CONFIG.ownerUid !== "EDIT_ME_OWNER_UID") {
    throw new HttpsError("permission-denied", "Only the site owner can process withdrawals.");
  }

  const { withdrawalId, action, reason } = request.data;
  if (!withdrawalId || (action !== "paid" && action !== "reject")) {
    throw new HttpsError("invalid-argument", "Invalid parameters.");
  }

  const wRef = db.collection("withdrawals").doc(withdrawalId);

  await db.runTransaction(async (transaction) => {
    const wSnap = await transaction.get(wRef);
    if (!wSnap.exists) {
      throw new HttpsError("not-found", "Withdrawal document not found.");
    }

    const wData = wSnap.data();
    if (wData.status !== "pending") {
      throw new HttpsError("failed-precondition", `Withdrawal already has status '${wData.status}'.`);
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
      // Refund the points back to user's confirmedPoints
      const userSnap = await transaction.get(userRef);
      if (userSnap.exists) {
        const currentConfirmed = userSnap.data().confirmedPoints || 0;
        transaction.update(userRef, {
          confirmedPoints: currentConfirmed + (wData.points || 0)
        });
      }

      transaction.update(wRef, {
        status: "rejected",
        rejectionReason: reason || "Terms violation or invalid UPI",
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Record refund transaction
      const refundRef = userRef.collection("transactions").doc();
      transaction.set(refundRef, {
        type: "refund",
        points: wData.points || 0,
        originalWithdrawalId: withdrawalId,
        reason: reason || "Rejected withdrawal",
        status: "confirmed",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });

  logger.info(`[Admin Action] Withdrawal ${withdrawalId} marked as ${action} by owner.`);
  return { success: true };
});

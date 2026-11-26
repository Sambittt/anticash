/**
 * AntiCash Application Configuration
 * All monetary amounts are stored in integer paise (100 paise = 1 Indian Rupee).
 */

export const MIN_WITHDRAWAL_PAISE = 30000; // 30,000 paise = 300 INR

export const APP_CONFIG = {
  appName: "AntiCash",
  domain: "anticash.tech",
  supportEmail: "support@anticash.tech",
  
  // EDIT ME: Replace with your Firebase Auth UID from Firebase Console
  ownerUid: "EDIT_ME_OWNER_UID",

  // Minimum threshold in paise
  minWithdrawalPaise: MIN_WITHDRAWAL_PAISE,

  // Offerwall Networks Configuration
  networks: [
    {
      id: "network_sample_1",
      name: "Partner Offerwall 1",
      badge: "Surveys and app tests",
      description: "Answer market research questionnaires and try mobile applications.",
      type: "button", // "button" or "iframe"
      url: "https://example-offerwall.com/offers", // EDIT ME: Replace with your network URL
      userIdParam: "uid", // Parameter name for passing user UID
      active: false
    },
    {
      id: "network_sample_2",
      name: "Partner Offerwall 2",
      badge: "Fast tasks",
      description: "Short promotional tasks and brand surveys.",
      type: "iframe", // "button" or "iframe"
      url: "https://example-offerwall.com/embed", // EDIT ME: Replace with your embed URL
      userIdParam: "subId",
      active: false
    }
  ]
};

/**
 * True only when an owner UID has been configured AND it matches.
 * With the placeholder still in place, nobody is the owner (fail closed).
 * This is for showing or hiding admin UI only. Real protection lives in
 * firestore.rules and the Cloud Functions.
 */
export function isOwnerUid(uid) {
  const owner = APP_CONFIG.ownerUid;
  return Boolean(uid) && owner !== "EDIT_ME_OWNER_UID" && uid === owner;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * Format integer paise into Indian Rupee display (e.g. 125050 -> ₹1,250.50)
 * @param {number} paise 
 * @returns {string}
 */
export function formatRupees(paise) {
  const p = Number(paise) || 0;
  return inrFormatter.format(p / 100);
}

/**
 * Calculate progress toward the minimum withdrawal amount
 * @param {number} confirmedBalancePaise 
 */
export function getWithdrawalProgress(confirmedBalancePaise) {
  const current = Math.max(0, Number(confirmedBalancePaise) || 0);
  const target = APP_CONFIG.minWithdrawalPaise;
  const percent = Math.min(100, Math.round((current / target) * 100));
  const paiseNeeded = Math.max(0, target - current);
  
  return {
    percent,
    currentFormatted: formatRupees(current),
    targetFormatted: formatRupees(target),
    paiseNeeded,
    formattedNeeded: formatRupees(paiseNeeded),
    isReady: current >= target
  };
}

/**
 * Starting payout rates for short links, in paise per 1,000 valid views.
 * Keep equal to RATES_PER_1000 in functions/lib.js and RATES in js/home.js.
 */
export const LINK_RATES = { india: 5000, tier1: 20000, other: 8000 };
export const LINK_BASE = "https://anticash.tech/l/";

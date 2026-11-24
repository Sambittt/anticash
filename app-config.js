/**
 * ==========================================================================
 * EDIT ME: ANTICASH REWARDS & OFFERWALL CONFIGURATION
 * ==========================================================================
 * This file controls your reward conversion rates, minimum withdrawal threshold,
 * admin owner UID, and partner offerwall networks.
 * ==========================================================================
 */

export const APP_CONFIG = {
  // Brand info
  appName: "AntiCash",
  domain: "anticash.tech",
  supportEmail: "support@anticash.tech", // EDIT ME: Your support email
  
  // EDIT ME: Admin Owner UID
  // Once you sign in with Google the first time, copy your UID from Firebase Console
  // (or from your user profile on the Dashboard) and paste it here.
  // Only this UID can access the /admin page and approve/reject withdrawals.
  ownerUid: "EDIT_ME_OWNER_UID",

  // Point Conversion Rates
  // Example: 10 Points = 1 INR (100 Points = ₹10, 500 Points = ₹50, 1000 Points = ₹100)
  pointsPerInr: 10,

  // Minimum Points Required to Request a Withdrawal
  // 500 points = ₹50 minimum withdrawal threshold
  minWithdrawalPoints: 500,

  // Hold period (in days) before pending points are confirmed (handled by Cloud Function)
  holdPeriodDays: 7,

  /**
   * ========================================================================
   * EDIT ME: PARTNER OFFERWALL NETWORKS
   * ========================================================================
   * You can configure multiple offerwall networks below (AdGate, OfferToro,
   * CPALead, Wannads, Monlix, Lootably, etc.).
   * 
   * Modes:
   * - "button": Opens the network's offer link in a new tab with ?[userIdParam]=[uid]
   * - "iframe": Embeds the network inside a responsive container on the Tasks page
   * 
   * When active is false, the tasks page shows an "Offers are being set up" banner.
   * Set active: true once you register and obtain your partner URL.
   * ========================================================================
   */
  networks: [
    {
      id: "network_sample_1",
      name: "Partner Offerwall Alpha",
      badge: "Surveys & Quick Tasks",
      description: "Answer consumer opinion surveys and test mobile apps to earn points.",
      type: "button", // "button" or "iframe"
      url: "https://example-offerwall.com/offers", // EDIT ME: Replace with your offerwall URL
      userIdParam: "uid", // Parameter name that accepts the user's UID (e.g. ?uid=USER_ID)
      active: false // Set to true when you have connected this network
    },
    {
      id: "network_sample_2",
      name: "Partner Offerwall Beta",
      badge: "App Trials & Video Offers",
      description: "Discover new games, register for verified apps, and complete trial tasks.",
      type: "iframe", // "button" or "iframe"
      url: "https://example-offerwall.com/embed", // EDIT ME: Replace with your offerwall embed URL
      userIdParam: "subId", // Parameter name (e.g. ?subId=USER_ID)
      active: false // Set to true when you have connected this network
    }
  ]
};

/**
 * Utility: Convert points to formatted Rupee string (₹)
 */
export function pointsToInr(points) {
  const pts = Number(points) || 0;
  const inr = pts / APP_CONFIG.pointsPerInr;
  return `₹${inr.toFixed(2)}`;
}

/**
 * Utility: Calculate progress percentage towards minimum withdrawal
 */
export function getWithdrawalProgress(confirmedPoints) {
  const pts = Number(confirmedPoints) || 0;
  const min = APP_CONFIG.minWithdrawalPoints;
  const percent = Math.min(100, Math.round((pts / min) * 100));
  return {
    percent,
    pointsNeeded: Math.max(0, min - pts),
    inrNeeded: pointsToInr(Math.max(0, min - pts))
  };
}

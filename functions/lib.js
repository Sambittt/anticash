/** Pure helpers (no Firebase), so they can be unit tested with plain node. */
const crypto = require("crypto");

// Starting payout rates, paise per 1,000 valid views. Keep equal to LINK_RATES in app-config.js and RATES in js/home.js.
const RATES_PER_1000 = { india: 5000, tier1: 20000, other: 8000 };
const TIER1 = new Set(["US", "GB", "CA", "AU"]);

function tierOf(country) {
  if (country === "IN") return "india";
  if (TIER1.has(country)) return "tier1";
  return "other";
}
function paisePerView(tier) {
  return Math.floor((RATES_PER_1000[tier] || RATES_PER_1000.other) / 1000);
}

const OWN_HOSTS = ["anticash.tech", "www.anticash.tech", "sambittt.github.io"];
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rb.gy", "shorturl.at", "shrinkme.io", "shrinkearn.com", "shrtfly.com", "adf.ly", "ouo.io", "linkvertise.com"]);
const BLOCKED_TLDS = [".onion", ".local", ".internal", ".localhost"];

/** Returns { ok:true, url, host } or { ok:false, reason }. */
function validateTargetUrl(input, extraBlockedHosts) {
  if (typeof input !== "string") return { ok: false, reason: "Enter a web address." };
  let raw = input.trim();
  if (!raw || raw.length > 2048) return { ok: false, reason: "That address is empty or too long." };
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw; // allow "example.com/page"
  let u;
  try { u = new URL(raw); } catch (e) { return { ok: false, reason: "That does not look like a valid web address." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "Only http and https links are allowed." };
  if (u.username || u.password) return { ok: false, reason: "Links with a username or password are not allowed." };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return { ok: false, reason: "Enter a full domain such as example.com." };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return { ok: false, reason: "Links to IP addresses are not allowed." };
  if (BLOCKED_TLDS.some((t) => host.endsWith(t))) return { ok: false, reason: "That domain is not allowed." };
  if (OWN_HOSTS.includes(host) || OWN_HOSTS.some((h) => host.endsWith("." + h))) return { ok: false, reason: "You cannot shorten an AntiCash link." };
  if (SHORTENERS.has(host) || [...SHORTENERS].some((h) => host.endsWith("." + h))) return { ok: false, reason: "Links that are already shortened are not allowed." };
  if ((extraBlockedHosts || []).some((h) => host === h || host.endsWith("." + h))) return { ok: false, reason: "That domain is blocked." };
  return { ok: true, url: u.toString(), host };
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alike characters
function makeCode(len = 7) {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
const CODE_RE = /^[A-Za-z0-9]{5,12}$/;

function hashIp(ip, salt) {
  return crypto.createHash("sha256").update(String(salt || "") + "|" + String(ip || "")).digest("hex").slice(0, 24);
}
function signToken(secret, code, ts, ipHash) {
  return crypto.createHmac("sha256", secret).update(`${code}.${ts}.${ipHash}`).digest("hex");
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python-requests|httpclient|headless|phantom|scrapy|facebookexternalhit|preview/i;
const dayKey = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10); // India date

module.exports = { RATES_PER_1000, tierOf, paisePerView, validateTargetUrl, makeCode, CODE_RE, hashIp, signToken, safeEq, BOT_RE, dayKey };

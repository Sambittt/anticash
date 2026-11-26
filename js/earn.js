import { initAuth, onUserChange, escapeHtml } from "../auth.js";
import { APP_CONFIG } from "../app-config.js";

initAuth();
try { localStorage.setItem("anticash_has_browsed_offers", "true"); } catch (e) {}

const container = document.getElementById("offerwallContainer");
let drawnFor = null;

onUserChange((user, data, loaded) => {
  if (!user || !loaded || drawnFor === user.uid) return;
  drawnFor = user.uid;
  render(user, Boolean(data && data.banned));
});

const ICON = {
  survey: '<svg class="ico" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><polyline points="9 14 11 16 15 12"/></svg>',
  app: '<svg class="ico" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>',
  game: '<svg class="ico" viewBox="0 0 24 24"><path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 14h-4l-1 1.6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z"/><line x1="7" y1="10.5" x2="7" y2="13.5"/><line x1="5.5" y1="12" x2="8.5" y2="12"/></svg>',
  video: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z"/></svg>'
};

function offerUrl(net, uid) {
  try {
    const u = new URL(net.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.searchParams.set(net.userIdParam || "uid", uid);
    return u.toString();
  } catch (e) { return null; }
}

function render(user, banned) {
  if (banned) {
    container.innerHTML = `<div class="panel"><h2>Offers are unavailable</h2><p>Your account is suspended. Contact support@anticash.tech if you think this is a mistake.</p></div>`;
    return;
  }
  const active = (APP_CONFIG.networks || []).filter((n) => n.active);

  if (!active.length) {
    container.innerHTML = `
      <section class="status-panel rise">
        <div>
          <span class="badge pending">Not live yet</span>
          <h2>Offers open once our partners approve us.</h2>
          <p>Your account is ready, and nothing is lost by signing up early. We will not show offers until they are real and tracked, so you never complete one that cannot pay.</p>
        </div>
        <div class="radar" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
      </section>

      <section class="rise" style="--d:2">
        <div class="panel-head"><div><h2>What will be here</h2><p>Four kinds of offers, all paying into the same wallet.</p></div></div>
        <div class="format-grid">
          <article class="card"><span class="fmt-ico">${ICON.survey}</span><h3>Surveys</h3><p>Short questionnaires from research partners about products and habits.</p></article>
          <article class="card"><span class="fmt-ico">${ICON.app}</span><h3>App offers</h3><p>Install a partner app and complete the listed steps.</p></article>
          <article class="card"><span class="fmt-ico">${ICON.game}</span><h3>Game offers</h3><p>Reach a level or milestone in a partner game.</p></article>
          <article class="card"><span class="fmt-ico">${ICON.video}</span><h3>Video and others</h3><p>Quick content and sign-up tasks that pay a little less.</p></article>
        </div>
      </section>

      <section class="panel rise" style="--d:3">
        <div class="panel-head" style="margin-bottom:8px"><h2>How it will work</h2></div>
        <ol class="side-list">
          <li><span class="n">01</span><span><b>Pick an offer</b> that suits your phone and read every requirement.</span></li>
          <li><span class="n">02</span><span><b>Finish every step</b> without a VPN, emulator or second account.</span></li>
          <li><span class="n">03</span><span><b>Wait for confirmation.</b> Earnings sit in Pending, up to 7 days.</span></li>
          <li><span class="n">04</span><span><b>Withdraw from &#8377;300</b> to your UPI ID.</span></li>
        </ol>
      </section>`;
    return;
  }

  let html = `<div class="notice-box info rise"><span><b>Partner offers.</b> Complete every step shown on the offer and allow time for confirmation. Do not use a VPN.</span></div><div class="offer-list">`;
  active.forEach((net, i) => {
    const url = offerUrl(net, user.uid);
    if (!url) return;
    if (net.type === "iframe") {
      html += `<div class="rise" style="--d:${i + 1}">
        <div class="offer-frame-head"><div><span class="badge neutral">${escapeHtml(net.badge || "Partner")}</span><h3 style="font-size:20px;font-weight:800;letter-spacing:-0.02em;margin-top:8px">${escapeHtml(net.name)}</h3></div>
        <a class="btn btn-ghost btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open in new tab</a></div>
        <div class="offer-frame"><iframe src="${escapeHtml(url)}" title="${escapeHtml(net.name)}" loading="lazy" referrerpolicy="no-referrer"></iframe></div></div>`;
    } else {
      html += `<article class="offer-item rise" style="--d:${i + 1}">
        <div><span class="badge neutral">${escapeHtml(net.badge || "Offerwall")}</span><h3>${escapeHtml(net.name)}</h3><p>${escapeHtml(net.description || "Surveys and app offers.")}</p></div>
        <a class="btn btn-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open offers<svg class="arrow ico" viewBox="0 0 24 24"><use href="#i-arrow"/></svg></a></article>`;
    }
  });
  container.innerHTML = html + `</div>`;
}

/**
 * Ad setup. Everything you may want to edit is in the ADS object below.
 *
 * 1) Google AdSense (content pages only: About, Privacy, Terms, Contact, and any
 *    guides you add later). Put your publisher id here, for example "ca-pub-1234567890123456",
 *    and also put the same id into ads.txt. AdSense is NEVER loaded on the Earn,
 *    Wallet, Withdraw, Links or visitor (go) pages, because its policies forbid
 *    paying people for views or clicks and forbid ads on pages built around timers.
 *
 * 2) Visitor page ads (go.html). Paste the snippet from an ad network that allows
 *    short-link and interstitial traffic (many publishers use Adsterra, PropellerAds,
 *    Monetag or similar). Leave both as "" to show no ads there.
 */
export const ADS = {
  adsensePublisherId: "",
  goTopSnippet: "",
  goBottomSnippet: ""
};

const ID_RE = /^ca-pub-\d{10,20}$/;

/** Insert an ad snippet. Scripts inside the snippet are re-created so that they run. */
export function injectSnippet(el, html) {
  if (!el || !html) return false;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("script").forEach((old) => {
    const s = document.createElement("script");
    for (const a of old.attributes) s.setAttribute(a.name, a.value);
    s.text = old.text;
    old.replaceWith(s);
  });
  el.textContent = "";
  el.appendChild(tpl.content);
  el.classList.add("filled");
  return true;
}

export function loadAdsense() {
  if (document.body.dataset.ads !== "adsense") return;
  if (!ID_RE.test(ADS.adsensePublisherId)) return;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + ADS.adsensePublisherId;
  document.head.appendChild(s);
}

loadAdsense();

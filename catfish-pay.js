/* Catfish Pay — pay-to-play paywall + Stripe Checkout client (no dependencies).
   Set window.CATFISH_PAY (see pay-config.js) BEFORE loading this file.
   Nothing is locked until you set  api  (your deployed Worker URL)  AND  enforce:true. */
(function () {
  'use strict';
  var C = Object.assign({ api: '', site: '', item: '', title: 'THIS GAME', price: '', communityItem: 'community-pass', communityPrice: '', bundleItem: '', bundlePrice: '', enforce: false }, window.CATFISH_PAY || {});
  var KEY = 'catfish_access_v1', OKKEY = 'catfish_access_ok_' + C.site, COMMKEY = 'catfish_comm_until', GRACE = 30 * 864e5; // offline grace: 30 days after the last good check
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var tokens = function () { try { return JSON.parse(store.get(KEY) || '[]'); } catch (e) { return []; } };
  var saveToken = function (t) { var a = tokens(); if (a.indexOf(t) < 0) { a.push(t); store.set(KEY, JSON.stringify(a)); } };
  function api(path, opt) { return fetch(C.api.replace(/\/$/, '') + path, opt).then(function (r) { return r.json(); }); }
  function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

  // What does this browser own?  -> { access: game unlocked, community: pass active, communityUntil: ms }
  function status() {
    var list = tokens(), out = { access: false, community: false, communityUntil: 0 }, down = false;
    if (!list.length) return Promise.resolve(out);
    return Promise.all(list.map(function (t) {
      return post('/api/access', { token: t, site: C.site }).then(function (d) {
        if (d && d.access) out.access = true;
        if (d && d.communityUntil > out.communityUntil) out.communityUntil = d.communityUntil;
        if (d && d.community) out.community = true;
      }, function () { down = true; });
    })).then(function () {
      if (out.access) store.set(OKKEY, String(Date.now()));
      if (out.communityUntil) store.set(COMMKEY, String(out.communityUntil));
      if (down && !out.access && (Date.now() - (+store.get(OKKEY) || 0) < GRACE)) out.access = true;          // offline: trust a check from the last 30 days
      if (down && !out.community) { var u = +store.get(COMMKEY) || 0; if (u > Date.now()) { out.community = true; out.communityUntil = u; } }
      return out;
    });
  }
  function hasAccess() { return status().then(function (s) { return s.access; }); }
  function community() { return status().then(function (s) { return { active: s.community, until: s.communityUntil, daysLeft: s.community ? Math.max(0, Math.ceil((s.communityUntil - Date.now()) / 864e5)) : 0 }; }); }

  // ── UI ──────────────────────────────────────────────────────
  var root = null, statusEl = null, timer = null, polling = null, pollKind = null;
  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function setStatus(msg, bad) { if (statusEl) { statusEl.textContent = msg || ''; statusEl.style.color = bad ? '#ff8a8a' : '#9dffb0'; } }
  function btn(label, bg, onclick) {
    var b = el('button', 'display:block;width:100%;margin:10px 0 0;padding:15px 18px;border:0;border-radius:12px;font:800 17px system-ui,sans-serif;letter-spacing:.5px;color:#fff;background:' + bg + ';cursor:pointer;touch-action:manipulation', label);
    b.type = 'button'; b.className = 'cfp-btn'; b.onclick = onclick; return b;
  }
  function overlay() {
    if (root) return root;
    root = el('div', 'position:fixed;inset:0;z-index:2147483000;background:radial-gradient(ellipse at 50% 30%,#241033 0%,#08090f 75%);display:flex;padding:14px;overflow:auto;-webkit-overflow-scrolling:touch;font-family:system-ui,sans-serif;color:#fff');
    root.id = 'catfishPayWall'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    ['keydown', 'keyup', 'keypress'].forEach(function (ev) { root.addEventListener(ev, function (e) { e.stopPropagation(); }, true); });   // typing the restore code must not move the player
    document.body.appendChild(root); return root;
  }
  function showChecking() { var r = overlay(); r.innerHTML = ''; r.appendChild(el('div', 'margin:auto;text-align:center;font-size:18px;opacity:.85', '🔒 Checking your purchase…')); }
  function showPaywall() {
    var r = overlay(); r.innerHTML = '';
    var card = el('div', 'margin:auto;width:min(420px,100%);background:rgba(20,16,34,.92);border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:20px 20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)');
    card.appendChild(el('div', 'font-size:34px;line-height:1', '🔒'));
    card.appendChild(el('h1', 'margin:6px 0 4px;font-size:26px;letter-spacing:2px', C.title));
    card.appendChild(el('p', 'margin:0 0 6px;opacity:.8;font-size:15px', 'Pay once. Play forever on any device.'));
    card.appendChild(btn('🔓 UNLOCK — ' + C.price, 'linear-gradient(135deg,#e8174a,#b50f6b)', function () { startCheckout(C.item); }));
    if (C.bundlePrice) card.appendChild(btn('🎮 ALL GAMES PASS — ' + C.bundlePrice, 'linear-gradient(135deg,#5b3df0,#2a6df0)', function () { startCheckout(C.bundleItem); }));
    if (C.communityPrice) card.appendChild(el('p', 'margin:12px 0 0;font-size:13px;line-height:1.4;opacity:.8', 'Community Membership is separate from this game purchase. Optional renewal: ' + C.communityPrice + ' every 30 days — optional, cancel anytime.'));
    var link = el('div', 'margin-top:12px;min-height:20px;font-size:13px');
    card.appendChild(link); root.linkEl = link;
    statusEl = el('div', 'margin-top:8px;min-height:20px;font-size:14px;font-weight:600;color:#9dffb0'); card.appendChild(statusEl);
    var rs = el('a', 'display:inline-block;margin-top:14px;color:#9db4ff;font-size:14px;text-decoration:underline;cursor:pointer', 'Already bought it? Restore purchase');
    var box = el('div', 'display:none;margin-top:10px');
    var ta = el('textarea', 'width:100%;box-sizing:border-box;background:#0d0f1a;color:#9dffb0;border:1px solid #444;border-radius:8px;padding:8px;font:12px monospace', ''); ta.rows = 3; ta.placeholder = 'Paste your restore code (v1.…)';
    var go = btn('Restore', '#2f8f4e', function () {
      var t = ta.value.trim(); if (!t) return setStatus('Paste your code first.', true);
      setStatus('Checking…'); saveToken(t);
      hasAccess().then(function (ok) { if (ok) unlock(); else { setStatus('That code is not valid for this game.', true); } });
    });
    box.appendChild(ta); box.appendChild(go);
    rs.onclick = function () { box.style.display = box.style.display === 'none' ? 'block' : 'none'; };
    card.appendChild(rs); card.appendChild(box);
    card.appendChild(el('p', 'margin:16px 0 0;font-size:11px;opacity:.55', 'Secure payment by Stripe. We never see your card.'));
    r.appendChild(card);
  }
  function unlock() {
    clearTimeout(timer); polling = null;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; statusEl = null;
    try { window.dispatchEvent(new CustomEvent('catfishpay:unlocked', { detail: { site: C.site } })); } catch (e) {}
  }

  // ── checkout ────────────────────────────────────────────────
  function toast(msg) { var t = el('div', 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;background:#14341f;color:#9dffb0;border:1px solid #2f8f4e;border-radius:12px;padding:12px 18px;font:700 15px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6);max-width:90vw;text-align:center', msg); document.body.appendChild(t); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 6000); }
  function startCheckout(item, kind) {
    // Open the tab synchronously inside the click so mobile popup blockers allow it.
    var w = null; try { w = window.open('', '_blank'); if (w) w.document.write('<title>Checkout</title><body style="margin:0;background:#0d0f1a;color:#fff;font:18px system-ui;display:grid;place-items:center;height:100vh">Opening secure checkout…'); } catch (e) {}
    setStatus('Opening secure Stripe checkout…');
    post('/api/checkout', { site: C.site, item: item }).then(function (d) {
      if (!d || !d.url) { if (w) try { w.close(); } catch (e) {} return setStatus('⚠ ' + ((d && d.error) || 'Could not start checkout. Try again.'), true); }
      if (w) { try { w.location.href = d.url; } catch (e) { w = null; } }
      if (!w) { var a = el('a', 'color:#ffd34e;font-weight:700;text-decoration:underline', 'Tap here to open checkout'); a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; if (root && root.linkEl) { root.linkEl.innerHTML = ''; root.linkEl.appendChild(a); } }
      setStatus('Finish paying in the new tab — this screen unlocks by itself.'); if (kind === 'community') toast('Finish paying in the new tab — your Community Pass starts right after.');
      poll(d.id, kind);
    }, function () { if (w) try { w.close(); } catch (e) {} setStatus('⚠ Network error. Check your connection and try again.', true); });
  }
  function poll(id, kind) {
    var started = Date.now(); polling = id; pollKind = kind; clearTimeout(timer);
    (function tick() {
      if (polling !== id) return;
      if (Date.now() - started > 25 * 60e3) return setStatus('Checkout timed out — press unlock to try again.', true);
      api('/api/claim?session_id=' + encodeURIComponent(id)).then(function (d) {
        if (d && d.paid && d.token) {
          saveToken(d.token);
          if (kind === 'community') { polling = null; if (d.communityUntil) store.set(COMMKEY, String(d.communityUntil)); toast('✅ Community Pass active!'); try { window.dispatchEvent(new CustomEvent('catfishpay:community', { detail: { until: d.communityUntil } })); } catch (e) {} }
          else { store.set(OKKEY, String(Date.now())); unlock(); }
        }
        else timer = setTimeout(tick, 2500);
      }, function () { timer = setTimeout(tick, 4000); });
    })();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && polling) { clearTimeout(timer); poll(polling, pollKind); } });

  // ── boot ────────────────────────────────────────────────────
  function gate() {
    if (!C.enforce) return Promise.resolve(true);
    if (!C.api) { try { console.warn('[catfish-pay] enforce is on but no api URL is set — game left unlocked'); } catch (e) {} return Promise.resolve(true); }
    showChecking();
    return hasAccess().then(function (ok) { if (ok) { unlock(); return true; } showPaywall(); return false; });
  }
  function buyCommunity() { return startCheckout(C.communityItem, 'community'); }   // e.g. from an in-game "Community" button
  function manage() {                                                                // cancel / update card for the Community Pass
    var w = null; try { w = window.open('', '_blank'); } catch (e) {}
    var list = tokens(); if (!list.length) { if (w) w.close(); return toast('No Community Pass found on this device.'); }
    (function next(i) {
      if (i >= list.length) { if (w) try { w.close(); } catch (e) {} return toast('No active subscription found.'); }
      post('/api/portal', { token: list[i] }).then(function (d) { if (d && d.url) { if (w) w.location.href = d.url; else location.href = d.url; } else next(i + 1); }, function () { next(i + 1); });
    })(0);
  }
  window.CatfishPay = { gate: gate, hasAccess: hasAccess, status: status, community: community, buyCommunity: buyCommunity, manage: manage, open: showPaywall, config: C };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gate); else gate();
})();

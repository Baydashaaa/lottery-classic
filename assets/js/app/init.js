// ─── INIT ────────────────────────────────────────────────────────────────────
(async () => {
  // Restore last active tab
  try {
    const validTabs = ['home','draw','winners','verify','bag'];
    const pathTab = location.pathname.replace(/^\//, '') || '';
    const hashTab = location.hash.replace(/^#/, '') || '';
    const startTab = validTabs.includes(pathTab) ? pathTab
                   : validTabs.includes(hashTab) ? hashTab
                   : 'home';
    // Параметры адреса переживают нормализацию пути - см. пояснение в showTab.
    if (history.replaceState) {
      history.replaceState({ tab: startTab }, '', '/' + startTab + location.search);
    }
    showTab(startTab, true);
  } catch(e) { showTab('home', true); }

  // Restore wallet session (multi-layer: localStorage → sessionStorage → cookie)
  try {
    const persisted = loadPersistedWallet();
    if (persisted.address) {
      setConnectedWallet(persisted.address, persisted.provider || 'keplr');
    }
  } catch(e) {}

  startTimer();
  initAdminTrigger();
  await loadWinners();

  // ── Load balances first - update podium immediately ──
  const [_dBal, _wBal] = await Promise.all([
    getWalletBalance(DAILY_WALLET),
    getWalletBalance(WEEKLY_WALLET),
  ]);
  window._dailyPoolBalance  = _dBal;
  window._weeklyPoolBalance = _wBal;
  updatePodiumPrizes();
  updatePoolDisplay();

  // ── Then load everything else ──
  await loadAllData();

  // Apply correct UI state after data is ready (podium, pool display, etc.)
  updatePodiumPrizes();

  // Hide loader now that everything is ready
  const loader = document.getElementById('page-loader');
  if (loader) {
    setTimeout(() => loader.classList.add('hidden'), 600);
  }

  // If the user landed directly on /bag (wallet already restored earlier in
  // this boot sequence), do one final guaranteed re-render now that the full
  // boot sequence (loadWinners, loadAllData, etc.) has actually finished.
  // This matches exactly what happens when a user manually switches away
  // from and back to My Bag (which is confirmed to always work correctly) -
  // it just does that same successful pass automatically, without requiring
  // the user to click away first.
  try {
    const bagPage = document.getElementById('page-bag');
    if (bagPage && bagPage.style.display !== 'none' && (connectedWalletAddress || lotteryAddress)) {
      renderMyBag();
    }
  } catch(e) {}

  // Refresh every 60s
  setInterval(loadAllData, 60000);
  // Отсчёт, фазы и запуск колеса целиком у Draw V2 - старого таймера
  // с локальными часами больше нет.
})();

// ── MY BAG ────────────────────────────────────────────────────────────────────
// (NFT_API_BASE / DRAW_WORKER constants moved to top of file to avoid TDZ errors)

// Oracle Mask nft_ids on nft.lunc.tools:
//   134 = Common   (25,000 LUNC, 1 entry)
//   135 = Rare     (125,000 LUNC, 5 entries)
//   136 = Legendary (250,000 LUNC, 10 entries)
const NFT_ID_TO_TIER = { 134: 'common', 135: 'rare', 136: 'legendary' };

function detectNFTTier(nft) {
  // Contract tokens carry their tier explicitly in metadata - no guessing.
  if (nft.tier && ['common','rare','legendary'].includes(String(nft.tier).toLowerCase())) {
    return String(nft.tier).toLowerCase();
  }
  // Primary: nft_id (most reliable)
  const id = nft.nft_id || nft.nftId;
  if (id && NFT_ID_TO_TIER[id]) return NFT_ID_TO_TIER[id];

  // Fallback: match by name
  const name = (nft.name || nft.nft_name || '').toLowerCase();
  if (name.includes('legendary')) return 'legendary';
  if (name.includes('rare'))      return 'rare';
  return 'common';
}
function tierEntries(tier) {
  return tier === 'legendary' ? 10 : tier === 'rare' ? 5 : 1;
}

// Convert ipfs:// URL to https gateway
// Local NFT artwork (in repo /nfts/ folder).
// Much faster than IPFS gateways - served directly from GitHub Pages / Cloudflare CDN.
// `sm` (256x384, ~5-9KB WebP) used in My Bag cards.
// `md` (512x768, ~14-28KB WebP) used in modals / detail views.
const TIER_IMAGES = {
  common:    { sm: 'nfts/common-sm.webp',    md: 'nfts/common-md.webp',    fallback: 'nfts/common-sm.png' },
  rare:      { sm: 'nfts/rare-sm.webp',      md: 'nfts/rare-md.webp',      fallback: 'nfts/rare-sm.png' },
  legendary: { sm: 'nfts/legendary-sm.webp', md: 'nfts/legendary-md.webp', fallback: 'nfts/legendary-sm.png' },
};

// Returns local image URL for a given tier. Auto-fallback to PNG if WebP not supported.
function tierImage(tier, size) {
  const cfg = TIER_IMAGES[tier] || TIER_IMAGES.common;
  return cfg[size || 'sm'];
}

// BAG_CACHE_* constants moved to top of file (TDZ fix)
function renderMyBag() {
  const wallet = connectedWalletAddress || lotteryAddress;
  const notConn = document.getElementById('bag-not-connected');
  const conn    = document.getElementById('bag-connected');
  if (!notConn || !conn) return;

  if (!wallet) {
    notConn.style.display = 'block';
    conn.style.display    = 'none';
    return;
  }

  notConn.style.display = 'none';
  conn.style.display    = 'block';

  const el = id => document.getElementById(id);

  // ── Instant paint from cache (stale-while-revalidate, client-side) ──
  // If we have ANY cached NFT list for this wallet (even 30 min old), render
  // it immediately - no blank/"…" wait. loadMyBagNFTs() then refreshes in
  // the background and silently updates once fresh data arrives.
  const cachedNfts = loadBagCache(wallet, BAG_CACHE_MAX_AGE_MS);
  if (cachedNfts) {
    renderBagFromNFTs(wallet, cachedNfts, { fromCache: true });
  } else {
    // No cache at all - first-ever load for this wallet. Be explicit that
    // this is LOADING, not "no NFTs", so it doesn't look frozen/broken.
    if (el('bag-stat-nfts'))   el('bag-stat-nfts').textContent   = '…';
    if (el('bag-stat-won'))    el('bag-stat-won').textContent    = '-';
    if (el('bag-stat-daily'))  el('bag-stat-daily').textContent  = '…';
    if (el('bag-stat-weekly')) el('bag-stat-weekly').textContent = '…';
    if (el('bag-nft-count'))   el('bag-nft-count').textContent   = '…';
    const grid  = el('bag-nft-grid');
    const empty = el('bag-empty');
    if (grid)  grid.style.display  = 'none';
    if (empty) {
      empty.style.display = 'block';
      const msgDiv = empty.querySelector('div');
      if (msgDiv) msgDiv.innerHTML = `
        <div style="margin-bottom:8px;"><svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Loading your Oracle Masks…</div>
        <div style="font-size:11px;color:var(--muted);">First load can take up to ~60s if the marketplace API is slow. Later visits load instantly from cache.</div>`;
    }
  }

  loadMyBagNFTs(wallet);
}

// ── Robust fetch with retry + timeout ────────────────────────────
async function fetchWithRetry(url, options = {}, maxAttempts = 3, timeoutMs = 8000) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      // 5xx server errors → retry. 4xx → don't retry, return as-is
      if (res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch(e) {
      lastErr = e;
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s
    }
  }
  throw lastErr || new Error('All retry attempts failed');
}

// ── Bag NFTs cache (survives Paco API outages AND tab close) ────────

function saveBagCache(wallet, nftsRaw) {
  try {
    localStorage.setItem(BAG_CACHE_KEY, JSON.stringify({ wallet, nftsRaw, ts: Date.now() }));
  } catch(e) { /* storage full or disabled - ignore */ }
}

function loadBagCache(wallet, maxAgeMs = BAG_CACHE_TTL_MS) {
  try {
    const raw = localStorage.getItem(BAG_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.wallet !== wallet) return null;
    if (Date.now() - data.ts > maxAgeMs) return null;
    return data.nftsRaw;
  } catch(e) { return null; }
}

async function loadMyBagNFTs(wallet) {
  const el = id => document.getElementById(id);

  // Collection now comes 100% from our own contract (Paco removed).
  // allNFTs starts empty; the contract merge below fills it.
  let allNFTs   = [];
  let usedIds   = new Set();
  let pacoError = null;

  // Warm the round-stats cache (used elsewhere on the page); no NFT source here.
  try { await fetchWithRetry(`${DRAW_WORKER}/round-stats?pool=daily`, {}, 1, 5000); } catch(e) {}

  // Fetch active tokenIds for this wallet from Worker /my-entries
  let dailyActiveTokenIds = new Set();
  let weeklyActiveTokenIds = new Set();
  try {
    const [dailyRes, weeklyRes] = await Promise.all([
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=daily&wallet=${wallet}`, {}, 2, 5000),
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=weekly&wallet=${wallet}`, {}, 2, 5000),
    ]);
    if (dailyRes.ok) {
      const dd = await dailyRes.json();
      (dd.activations || []).forEach(a => dailyActiveTokenIds.add(String(a.tokenId)));
    }
    if (weeklyRes.ok) {
      const wd = await weeklyRes.json();
      (wd.activations || []).forEach(a => weeklyActiveTokenIds.add(String(a.tokenId)));
    }
  } catch(e) {}
  window._dailyActiveTokenIds  = dailyActiveTokenIds;
  window._weeklyActiveTokenIds = weeklyActiveTokenIds;
  // Keep wallet sets for backward compat
  window._dailyActiveWallets  = dailyActiveTokenIds.size > 0 ? new Set([wallet]) : new Set();
  window._weeklyActiveWallets = weeklyActiveTokenIds.size > 0 ? new Set([wallet]) : new Set();

  // Fallback to cache if Paco failed
  let usedCache = false;
  if (allNFTs === null) {
    const cached = loadBagCache(wallet);
    if (cached) {
      allNFTs = cached;
      usedCache = true;
      console.log('Using cached NFT list (Paco API unavailable)');
    } else {
      // No cache, no API → show error state
      console.warn('loadMyBagNFTs: Paco API failed:', pacoError);
      if (el('bag-stat-nfts'))   el('bag-stat-nfts').textContent   = '-';
      if (el('bag-stat-daily'))  el('bag-stat-daily').textContent  = '-';
      if (el('bag-stat-weekly')) el('bag-stat-weekly').textContent = '-';
      if (el('bag-nft-count'))   el('bag-nft-count').textContent   = '-';
      const grid  = el('bag-nft-grid');
      const empty = el('bag-empty');
      if (grid)  grid.style.display  = 'none';
      if (empty) {
        empty.style.display = 'block';
        const msgDiv = empty.querySelector('div');
        if (msgDiv) msgDiv.innerHTML = `
          <div style="margin-bottom:8px;"><svg class="oi oi--amber"><use href="#i-warning"/></svg> NFT marketplace temporarily unavailable</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">
            ${pacoError ? `Error: ${pacoError}` : ''}
          </div>
          <button onclick="loadMyBagNFTs('${wallet}')" style="
            padding:8px 16px;border-radius:8px;border:1px solid rgba(212,160,23,0.6);
            background:rgba(212,160,23,0.1);color:var(--gold-light);cursor:pointer;
            font-family:'Cinzel',serif;font-size:11px;">
            <svg class="oi oi--cyan"><use href="#i-refresh"/></svg> Retry
          </button>`;
      }
      // NB: раньше здесь стоял `return;`, из-за которого падение Paco скрывало
      // и новую контрактную коллекцию. Вместо выхода - пустой список, чтобы
      // рендер дошёл и показал контрактные NFT (их подмешиваем ниже).
      allNFTs = [];
    }
  }

  // ── Новая коллекция из собственного контракта ──────────────────────────────
  // Независимо от Paco: если контракт недоступен - вернётся [] и страница
  // отрисуется старой коллекцией; если Paco упал - отрисуется контрактной.
  try {
    if (window.OracleNFT && typeof OracleNFT.getContractTokensLegacy === 'function') {
      const contractNfts = await OracleNFT.getContractTokensLegacy(wallet);
      if (Array.isArray(contractNfts) && contractNfts.length) {
        allNFTs = contractNfts.concat(Array.isArray(allNFTs) ? allNFTs : []);
      }
    }
  } catch (e) {
    console.warn('[bag] contract collection unavailable:', e.message);
  }
  if (allNFTs === null) allNFTs = [];

  await renderBagFromNFTs(wallet, allNFTs, { usedIds, pacoError, usedCache });
}

// ── Pure render: takes an already-fetched NFT list and paints the whole
// My Bag page (masks grid, stat counters, history). Called both for an
// instant cache-paint (meta.fromCache=true) and after a real fetch resolves,
// so the UI never sits on ambiguous "…" placeholders longer than necessary.
async function renderBagFromNFTs(wallet, allNFTs, meta = {}) {
  const { usedIds = new Set(), pacoError = null, usedCache = false, fromCache = false } = meta;
  const el = id => document.getElementById(id);

  // Filter Oracle Mask only - match all 3 collection slugs (old + new)
  const masks = allNFTs.filter(n => {
    const slug = (n.slug || '').toLowerCase();
    // New architecture: separate Daily / Weekly collections
    if (slug === 'oracle-mask-daily' || slug === 'oracle-mask-weekly') return true;
    // Legacy: single Oracle Mask collection (kept for backward compat)
    if (slug === 'oracle-mask') return true;
    // Fallback: collection fields or name (for older API formats)
    const col = (n.collection_name || n.collection || '').toLowerCase();
    if (col.includes('oracle') && col.includes('mask')) return true;
    return false;
  });

  const nfts = masks.map(n => {
    const tokenId = String(n.token_id || n.id || n.tokenId || '');
    const tier    = detectNFTTier(n);
    const slug    = (n.slug || '').toLowerCase();
    // Pool detection from slug: oracle-mask-daily / oracle-mask-weekly
    // For legacy `oracle-mask` collection: pool unknown until activated (legacy flow)
    let pool = null;
    if (slug === 'oracle-mask-daily')  pool = 'daily';
    if (slug === 'oracle-mask-weekly') pool = 'weekly';
    // New-architecture NFTs are AUTO-ACTIVE - funds went directly to pool wallet at mint time.
    // No "Enter Draw" needed. Status is "Active in DAILY/WEEKLY" until round resets.
    const isNewArch = pool !== null;
    // Active = this specific tokenId is in current round (not consumed)
    const dailyActive  = window._dailyActiveTokenIds  ? window._dailyActiveTokenIds.has(String(tokenId))  : false;
    const weeklyActive = window._weeklyActiveTokenIds ? window._weeklyActiveTokenIds.has(String(tokenId)) : false;
    const used = isNewArch
      ? (pool === 'daily'  ? !dailyActive  : !weeklyActive)
      : usedIds.has(tokenId); // legacy fallback
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    return {
      id:      tokenId,
      type:    tier,
      pool,                                   // 'daily' | 'weekly' | null (legacy)
      isNewArch,
      entries: tierEntries(tier),
      name:    n.name || n.nft_name || `Oracle Mask ${tierLabel}`,
      image:    tierImage(tier, 'sm'),         // local artwork from /nfts/ folder
      imagePng: TIER_IMAGES[tier]?.fallback,   // PNG fallback for old browsers
      used,
      // For new-arch: NFT is in current round if not yet consumed by a draw
      // For legacy:    NFT is in current round if not used (= activated)
      inCurrentRound: !used,
    };
  });

  window._bagNFTs = nfts;

  // ── Counter cards: query Worker for actual per-pool active entries ──
  // Daily   = NFT activations for daily (from Worker)
  // Weekly  = NFT activations for weekly (from Worker) + free entries (from free-entries.json)
  let dailyEntries  = 0;
  let weeklyEntries = 0;
  try {
    const [dailyRes, weeklyRes] = await Promise.allSettled([
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=daily&wallet=${wallet}`, {}, 2, 5000),
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=weekly&wallet=${wallet}`, {}, 2, 5000),
    ]);
    if (dailyRes.status === 'fulfilled' && dailyRes.value.ok) {
      const d = await dailyRes.value.json();
      dailyEntries = d.myEntries || 0;
    }
    if (weeklyRes.status === 'fulfilled' && weeklyRes.value.ok) {
      const d = await weeklyRes.value.json();
      weeklyEntries = d.myEntries || 0;
    }
  } catch(e) { /* keep zero */ }

  // Add free entries (from Terra Oracle Q&A) to weekly only
  if (typeof getFreeEntries === 'function') {
    const free = getFreeEntries(wallet);
    weeklyEntries += (free.total || 0);
  }

  if (el('bag-stat-nfts'))   el('bag-stat-nfts').textContent   = nfts.length;
  if (el('bag-stat-daily'))  el('bag-stat-daily').textContent  = dailyEntries;
  if (el('bag-stat-weekly')) el('bag-stat-weekly').textContent = weeklyEntries;
  if (el('bag-nft-count'))   el('bag-nft-count').textContent   = nfts.length;

  // Fetch wins - count unique rounds won
  try {
    const winsRes = await fetch(`${DRAW_WORKER}/my-wins?wallet=${wallet}`);
    if (winsRes.ok) {
      const winsData = await winsRes.json();
      const wins = winsData.wins || [];
      const dailyRounds  = new Set(wins.filter(w => w.pool === 'daily').map(w => w.roundId));
      const weeklyRounds = new Set(wins.filter(w => w.pool === 'weekly').map(w => w.roundId));
      const total = dailyRounds.size + weeklyRounds.size;
      if (el('bag-stat-won'))  el('bag-stat-won').textContent  = total || 0;
      if (el('won-daily'))     el('won-daily').textContent     = dailyRounds.size || 0;
      if (el('won-weekly'))    el('won-weekly').textContent    = weeklyRounds.size || 0;
    } else {
      if (el('bag-stat-won')) el('bag-stat-won').textContent = '-';
    }
  } catch(e) {
    if (el('bag-stat-won')) el('bag-stat-won').textContent = '-';
  }

  const grid  = el('bag-nft-grid');
  const empty = el('bag-empty');
  if (grid) {
    if (!nfts.length) {
      grid.style.display = 'none';
      if (empty) {
        empty.style.display = 'block';
        const msgDiv = empty.querySelector('div');
        if (msgDiv) msgDiv.textContent = 'No Oracle Mask NFTs in your wallet';
      }
    } else {
      if (empty) empty.style.display = 'none';
      grid.style.display = 'grid';
      setTimeout(() => filterBagNFTs('all'), 0);
    }
  }

  // Show a "cached" indicator - instant-paint from cache still refreshing,
  // or fallback-to-cache because the live API failed.
  if (usedCache || fromCache) {
    const cnt = el('bag-nft-count');
    if (cnt) cnt.textContent = nfts.length + (fromCache ? ' (refreshing…)' : ' (cached)');
  }

  // History - fetch from Worker /my-history
  const histTable = el('bag-history-table');
  const histEmpty = el('bag-history-empty');
  try {
    const histRes = await fetch(`${DRAW_WORKER}/my-history?wallet=${wallet}`);
    if (histRes.ok) {
      const histData = await histRes.json();
      const history = histData.history || [];
      // Filter out admin resets, group by roundId
      const filtered = history.filter(h => !h.roundId.startsWith('admin_reset'));
      // Group by roundId+pool
      const roundMap = new Map();
      for (const h of filtered) {
        const key = h.pool + ':' + h.roundId;
        if (!roundMap.has(key)) {
          roundMap.set(key, { roundId: h.roundId, pool: h.pool, entries: 0, won: false, consumedAt: h.consumedAt, drawTxHash: h.drawTxHash });
        }
        const r = roundMap.get(key);
        r.entries += (h.entries || 1);
        if (h.won) r.won = true;
      }
      const rounds = Array.from(roundMap.values()).sort((a,b) => new Date(b.consumedAt) - new Date(a.consumedAt));

      if (rounds.length === 0) {
        if (histTable) histTable.style.display = 'none';
        if (histEmpty) histEmpty.style.display = 'block';
      } else {
        if (histEmpty) histEmpty.style.display = 'none';
        if (histTable) {
          histTable.style.display = 'block';
          const tbody = histTable.querySelector('tbody') || histTable;
          tbody.innerHTML = rounds.map(r => {
            const date    = r.consumedAt ? new Date(r.consumedAt).toLocaleDateString() : (r.roundId || '-');
            const pool    = r.pool === 'weekly' ? 'Weekly' : 'Daily';
            const won     = r.won
              ? `<span style="color:#66ffaa;font-weight:700;">✓ Won</span>`
              : `<span style="color:var(--muted);">-</span>`;
            return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:10px 12px;font-size:12px;color:var(--muted);">${date}</td>
              <td style="padding:10px 12px;font-size:12px;">${pool}</td>
              <td style="padding:10px 12px;font-size:12px;text-align:center;">${r.entries}</td>
              <td style="padding:10px 12px;text-align:center;">${won}</td>
            </tr>`;
          }).join('');
        }
      }
    } else {
      if (histTable) histTable.style.display = 'none';
      if (histEmpty) histEmpty.style.display = 'block';
    }
  } catch(e) {
    if (histTable) histTable.style.display = 'none';
    if (histEmpty) histEmpty.style.display = 'block';
  }
}

// ── ENTER DRAW with NFT ────────────────────────────────────────
function showEnterDrawModal(nftId, nftType, entries) {
  // Remove existing modal if any
  const existing = document.getElementById('enter-draw-modal');
  if (existing) existing.remove();

  const tier = nftType;
  const cfgs = {
    common:    { color:'#b0b8c8', icon:'<svg class="oi oi--muted"><use href="#i-mask"/></svg>', label:'Common'    },
    rare:      { color:'#60a5fa', icon:'<svg class="oi oi--cyan"><use href="#i-orb"/></svg>', label:'Rare'       },
    legendary: { color:'#fb923c', icon:'<svg class="oi oi--amber"><use href="#i-eye"/></svg>', label:'Legendary'  },
  };
  const cfg = cfgs[tier] || cfgs.common;

  const modal = document.createElement('div');
  modal.id = 'enter-draw-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div style="background:#1a1200;border:1px solid rgba(212,160,23,0.3);border-radius:20px;
      padding:32px;max-width:400px;width:100%;box-shadow:0 0 60px rgba(212,160,23,0.15);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:32px;margin-bottom:8px;">${cfg.icon}</div>
        <div style="font-family:'Cinzel',serif;font-size:18px;color:var(--gold-light);margin-bottom:4px;">Enter Draw</div>
        <div style="font-size:12px;color:var(--muted);">
          <span style="color:${cfg.color};font-weight:700;">${cfg.label} #${nftId}</span>
          · ${entries} ${entries===1?'entry':'entries'}
        </div>
      </div>

      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--gold-dim);
        font-family:'Cinzel',serif;margin-bottom:12px;">Choose your draw</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
        <button onclick="enterDraw('${nftId}','daily',${entries})" style="padding:16px;border-radius:12px;
          border:2px solid rgba(212,160,23,0.6);background:rgba(212,160,23,0.1);cursor:pointer;
          font-family:'Cinzel',serif;color:var(--gold-light);transition:all 0.2s;"
          onmouseover="this.style.background='rgba(212,160,23,0.2)'"
          onmouseout="this.style.background='rgba(212,160,23,0.1)'">
          <div style="font-size:20px;margin-bottom:4px;"><svg class="oi oi--gold"><use href="#i-reels"/></svg></div>
          <div style="font-size:12px;font-weight:700;">Daily Draw</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Daily 20:00 UTC · except Mon</div>
        </button>
        <button onclick="enterDraw('${nftId}','weekly',${entries})" style="padding:16px;border-radius:12px;
          border:2px solid rgba(74,144,217,0.4);background:rgba(74,144,217,0.06);cursor:pointer;
          font-family:'Cinzel',serif;color:#7eb8ff;transition:all 0.2s;"
          onmouseover="this.style.background='rgba(74,144,217,0.15)'"
          onmouseout="this.style.background='rgba(74,144,217,0.06)'">
          <div style="font-size:20px;margin-bottom:4px;"><svg class="oi oi--cyan"><use href="#i-trophy"/></svg></div>
          <div style="font-size:12px;font-weight:700;">Weekly Draw</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Every Monday 20:00 UTC</div>
        </button>
      </div>

      <div id="enter-draw-status" style="min-height:20px;text-align:center;margin-bottom:16px;font-size:12px;"></div>

      <button onclick="document.getElementById('enter-draw-modal').remove()"
        style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);
        background:transparent;color:var(--muted);cursor:pointer;font-family:'Cinzel',serif;font-size:12px;">
        Cancel
      </button>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function enterDraw(nftId, pool, entries) {
  const wallet = connectedWalletAddress || lotteryAddress;
  if (!wallet) { alert('Connect wallet first!'); return; }

  const statusEl = document.getElementById('enter-draw-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted);"><svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Waiting for signature…</span>';

  // Disable buttons
  const btns = document.querySelectorAll('#enter-draw-modal button');
  btns.forEach(b => b.disabled = true);

  try {
    const targetWallet = pool === 'daily' ? DAILY_WALLET_ADDR : WEEKLY_WALLET_ADDR;
    const memo = `NFT:${nftId}|${pool}|${entries}entries`;

    // Send 1 LUNC as verification tx (returned as entries to pool)
    const amountUluna = 1_000_000; // 1 LUNC
    const txHash = await sendLuncDirect(wallet, targetWallet, amountUluna, memo, 'columbus-5');

    // Register NFT as used in Worker KV
    try {
      const regRes = await fetch(`${DRAW_WORKER}/use-nft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: String(nftId), pool, wallet, txHash, entries }),
      });
      if (!regRes.ok) {
        const errData = await regRes.json().catch(() => ({ error: 'Unknown error' }));
        console.warn(`Worker /use-nft returned ${regRes.status}:`, errData.error);
        // Still proceed - tx is on-chain, Worker can be replayed later via admin tool
      }
    } catch(e) {
      console.warn('Worker registration failed:', e.message);
      // Non-fatal - tx is on-chain, Worker will catch it on next load
    }

    if (statusEl) statusEl.innerHTML = `
      <div style="color:#66ffaa;font-weight:700;margin-bottom:4px;"><svg class="oi oi--green"><use href="#i-check"/></svg> Entered ${pool} draw!</div>
      <div style="font-size:10px;color:var(--muted);">${entries} ${entries===1?'entry':'entries'} registered</div>
      <a href="https://finder.terraport.finance/mainnet/tx/${txHash}"
        target="_blank" style="font-size:10px;color:var(--muted);display:block;margin-top:4px;">
        <svg class="oi oi--cyan"><use href="#i-link"/></svg> ${txHash.slice(0,16)}…
      </a>`;

    // Mark NFT as used locally
    window._bagNFTs = (window._bagNFTs || []).map(n =>
      String(n.id) === String(nftId) ? { ...n, used: true, inCurrentRound: false } : n
    );

    setTimeout(() => {
      const modal = document.getElementById('enter-draw-modal');
      if (modal) modal.remove();
      filterBagNFTs(_bagCurrentFilter || 'all');
      // Reload bag stats
      const w = connectedWalletAddress || lotteryAddress;
      if (w) loadMyBagNFTs(w);
    }, 2500);

  } catch(err) {
    console.error('enterDraw error:', err);
    if (statusEl) statusEl.innerHTML = `<span style="color:#ff6b6b;"><svg class="oi oi--red"><use href="#i-cross"/></svg> ${err.message || 'Transaction failed'}</span>`;
    btns.forEach(b => b.disabled = false);
  }
}

// Re-render bag when wallet connects/disconnects
const _origSetConnected = window.setConnectedWallet;
window.setConnectedWallet = function(addr, provider) {
  if (typeof _origSetConnected === 'function') _origSetConnected(addr, provider);
  if (document.getElementById('page-bag') &&
      document.getElementById('page-bag').style.display !== 'none') {
    renderMyBag();
  }
};

// ── MY BAG FILTER ─────────────────────────────────────────────────────────────
let _bagCurrentFilter = 'all';

function filterBagNFTs(filter) {
  _bagCurrentFilter = filter;
  const nfts = window._bagNFTs || [];

  // Update button styles
  ['all','common','rare','legendary','used'].forEach(f => {
    const btn = document.getElementById('bag-filter-' + f);
    if (!btn) return;
    const colors = {
      all:       { active: 'rgba(212,160,23,0.12)', border: 'rgba(212,160,23,0.5)',   text: 'var(--gold-light)' },
      common:    { active: 'rgba(180,190,210,0.1)', border: 'rgba(180,190,210,0.5)',  text: '#b0b8c8'           },
      rare:      { active: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.5)',   text: '#60a5fa'           },
      legendary: { active: 'rgba(251,146,60,0.1)',  border: 'rgba(251,146,60,0.5)',   text: '#fb923c'           },
      used:      { active: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.35)', text: '#e2e8f0'           },
    };
    const c = colors[f];
    if (f === filter) {
      btn.style.background = c.active;
      btn.style.borderColor = c.border.replace('0.5','0.8');
      btn.style.color = c.text;
      btn.style.fontWeight = '700';
    } else {
      btn.style.background = 'transparent';
      btn.style.borderColor = c.border.replace('0.5','0.2');
      btn.style.color = c.text;
      btn.style.fontWeight = '400';
      btn.style.opacity = '0.6';
    }
    btn.style.opacity = f === filter ? '1' : '0.6';
  });

  // Filter and sort: active first, then used
  let filtered = nfts;
  if (filter === 'used')       filtered = nfts.filter(n => !n.inCurrentRound);
  else if (filter !== 'all')   filtered = nfts.filter(n => n.type === filter);

  // Sort: in current round first
  filtered = filtered.slice().sort((a, b) => {
    if (a.inCurrentRound && !b.inCurrentRound) return -1;
    if (!a.inCurrentRound && b.inCurrentRound) return 1;
    return 0;
  });

  renderBagGrid(filtered);
}

function renderBagGrid(nfts) {
  const grid  = document.getElementById('bag-nft-grid');
  const empty = document.getElementById('bag-empty');
  if (!grid) return;

  if (!nfts.length) {
    grid.style.display = 'none';
    if (empty) { empty.style.display = 'block'; }
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.style.display = 'grid';

  const cfgs = {
    common:    { color:'#b0b8c8', glow:'rgba(180,190,210,0.35)', bg:'rgba(180,190,210,0.05)', icon:'<svg class="oi oi--muted"><use href="#i-mask"/></svg>', label:'COMMON'    },
    rare:      { color:'#60a5fa', glow:'rgba(96,165,250,0.45)',  bg:'rgba(96,165,250,0.06)',  icon:'<svg class="oi oi--cyan"><use href="#i-orb"/></svg>', label:'RARE'       },
    legendary: { color:'#fb923c', glow:'rgba(251,146,60,0.45)',  bg:'rgba(251,146,60,0.07)',  icon:'<svg class="oi oi--amber"><use href="#i-eye"/></svg>', label:'LEGENDARY'  },
  };

  grid.innerHTML = nfts.map(nft => {
    const cfg = cfgs[nft.type];
    const used = nft.used || !nft.inCurrentRound;

    let statusHtml;
    // ── New architecture: NFT is auto-active in its pool, no manual activation ──
    if (nft.isNewArch && !used) {
      const poolLabel = (nft.pool || 'daily').toUpperCase();
      const poolColor = nft.pool === 'weekly' ? 'rgba(96,165,250,0.5)' : 'rgba(102,255,170,0.5)';
      const poolBg    = nft.pool === 'weekly' ? 'rgba(96,165,250,0.08)' : 'rgba(102,255,170,0.08)';
      const poolText  = nft.pool === 'weekly' ? '#60a5fa' : '#66ffaa';
      statusHtml = `
        <div style="width:100%;padding:10px 12px;border-radius:8px;
          background:${poolBg};border:1px solid ${poolColor};
          color:${poolText};font-family:'Cinzel',serif;font-size:11px;
          font-weight:700;letter-spacing:0.08em;text-align:center;">
          ✓ ACTIVE IN ${poolLabel}
        </div>`;
    }
    // ── Legacy NFT (no pool yet): show Enter Draw button ──
    else if (!used) {
      statusHtml = `
        <button onclick="showEnterDrawModal('${nft.id}','${nft.type}',${nft.entries})"
          style="width:100%;padding:10px 12px;border-radius:8px;border:none;cursor:pointer;
          background:linear-gradient(135deg,rgba(212,160,23,0.25),rgba(212,160,23,0.1));
          border:1px solid rgba(212,160,23,0.5);
          color:var(--gold-light);font-family:'Cinzel',serif;font-size:11px;
          font-weight:700;letter-spacing:0.06em;transition:all 0.2s;"
          onmouseover="this.style.background='linear-gradient(135deg,rgba(212,160,23,0.4),rgba(212,160,23,0.2))'"
          onmouseout="this.style.background='linear-gradient(135deg,rgba(212,160,23,0.25),rgba(212,160,23,0.1))'">
          <svg class="oi oi--violet"><use href="#i-mask"/></svg> Enter Draw
        </button>`;
    } else {
      statusHtml = `<div style="padding:10px 12px;border-radius:8px;
        background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);
        color:var(--muted);font-size:11px;text-align:center;">
        <svg class="oi oi--green"><use href="#i-check"/></svg> Round over
      </div>`;
    }

    const opacity = !used ? '1' : '0.5';
    // Local artwork (WebP from /nfts/ folder) with PNG fallback for older browsers.
    // <picture> tag automatically selects WebP if supported, falls back to PNG.
    const imgHtml = nft.image
      ? `<picture>
           <source srcset="${nft.image}" type="image/webp">
           <img src="${nft.imagePng || nft.image}"
                style="width:120px;height:180px;border-radius:10px;object-fit:cover;margin-bottom:12px;background:rgba(255,255,255,0.03);"
                onerror="this.style.display='none';const fb=this.parentElement.nextElementSibling;if(fb)fb.style.display='block';">
         </picture>
         <div style="font-size:40px;margin-bottom:10px;display:none;">${cfg.icon}</div>`
      : `<div style="font-size:40px;margin-bottom:10px;">${cfg.icon}</div>`;

    return `
    <div style="background:${cfg.bg};border:1px solid ${cfg.glow};border-radius:16px;padding:20px;
      text-align:center;box-shadow:0 0 20px ${cfg.glow};transition:transform 0.2s;opacity:${opacity};"
      onmouseover="this.style.transform='translateY(-3px)'"
      onmouseout="this.style.transform='translateY(0)'">
      ${imgHtml}
      <div style="font-size:9px;letter-spacing:0.2em;color:${cfg.color};font-weight:700;margin-bottom:4px;">${cfg.label}</div>
      <div style="font-family:'Cinzel',serif;font-size:16px;color:#fff;margin-bottom:4px;">${formatNFTLabel(nft.id)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${nft.entries} ${nft.entries===1?'entry':'entries'}</div>
      ${statusHtml}
    </div>`;
  }).join('');
}

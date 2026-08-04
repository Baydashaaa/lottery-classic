// ── HTML escape (для сообщений, вставляемых через innerHTML) ────────────────
function escHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// Core endpoints + bag-cache config — declared FIRST, before any function
// that might reference them during early init (setConnectedWallet →
// renderMyBag can fire before later declarations execute, which threw
// "Cannot access 'BAG_CACHE_MAX_AGE_MS' before initialization"). Kept here at
// the very top so they're always initialized before any use.
const NFT_API_BASE      = 'https://nft.lunc.tools/api';
const DRAW_WORKER       = 'https://oracle-draw.vladislav-baydan.workers.dev';
const BAG_CACHE_KEY     = 'oracle_draw_bag_cache_v1';
const BAG_CACHE_TTL_MS  = 5 * 60 * 1000;
const BAG_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

// Format NFT tokenId to a human-readable label.
// Contract tokens are "common-1" / "rare-7" / "legendary-2" → "Common #1" etc.
// Legacy Paco ids (Common_092528042026_ETME5) → their trailing code.
function formatNFTLabel(tokenId) {
  if (!tokenId) return '—';
  const str = String(tokenId);
  // Contract ids: common-1 → "Common #1"
  const m = str.match(/^(common|rare|legendary)-(\d+)$/i);
  if (m) {
    const tier = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return `${tier} #${m[2]}`;
  }
  // Legacy Paco ids: Common_092528042026_ETME5 → ETME5
  const parts = str.split('_');
  if (parts.length >= 3) return parts[parts.length - 1];
  return str.slice(0, 8);
}

// ── TAB NAVIGATION ────────────────────────────────────────────────────────────
function showTab(tab, skipHistory) {
  const tabs = ['home','draw','winners','verify','bag'];
  tabs.forEach(t => {
    const page = document.getElementById('page-' + t);
    const nav  = document.getElementById('nav-' + t);
    if (page) page.style.display = t === tab ? 'block' : 'none';
    if (nav)  nav.classList.toggle('active-tab', t === tab);
  });

  if (tab === 'bag') renderMyBag();

  if (tab === 'home') {
    const hDraws = document.getElementById('home-stat-draws');
    const hNfts  = document.getElementById('home-stat-nfts');
    if (hDraws) hDraws.textContent = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
    // Use cached all-time activation count if available
    if (hNfts && window._totalNFTsActivated !== undefined) {
      hNfts.textContent = window._totalNFTsActivated;
    }
  }

  if (tab === 'draw') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Re-init wheel if canvas wasn't ready on first load
        switchLottery(window.currentLottery || 'daily');
      });
    });
  }

  // Push to browser history so Back button works
  if (!skipHistory && history.pushState) {
    history.pushState({ tab }, '', '/' + tab);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Handle browser Back/Forward
window.addEventListener('popstate', function(e) {
  const path = location.pathname.replace(/^\//, '') || 'home';
  const tab = (e.state && e.state.tab) || path;
  const validTabs = ['home','draw','winners','verify','bag'];
  showTab(validTabs.includes(tab) ? tab : 'home', true);
});

const DAILY_WALLET   = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_WALLET  = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';
const BURN_WALLET    = 'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p';
const DEV_WALLET     = 'terra17g55uzkm6cr5fcl3vzcrmu73v8as4yvf2kktzr';
const CHAIN_ID       = 'columbus-5';
const LUNC_PER_TICKET = 25000;

// ── Free entries from Terra Oracle (GitHub JSON) ─────────────────────────────
// Free entries are computed on-chain  no static JSON needed
let freeEntriesData = {}; // { "terra1abc": { chat:1, questions:2, total:3 } }

const ORACLE_TREASURY = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const CHAT_ULUNA_FE   = 5000 * 1e6;
const QA_ULUNA_FE     = 100000 * 1e6; // 100k LUNC to Treasury (half of Q&A payment)
const TOLERANCE_FE    = 0.01;
const FCD_NODES_FE    = [
  'https://fcd.terra-classic.hexxagon.io',
  'https://terra-classic-fcd.publicnode.com',
];

async function loadFreeEntries() {
  // Read pre-computed free-entries.json (updated hourly by GitHub Actions)
  // This is more reliable than browser scraping and covers full history
  try {
    const res = await fetch('./free-entries.json?t=' + Math.floor(Date.now() / 3600000), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const entries = data.entries || {};

    freeEntriesData = {};
    for (const [wallet, info] of Object.entries(entries)) {
      const total = (info.total || 0);
      if (total > 0) {
        freeEntriesData[wallet] = {
          chat:      info.chat      || 0,
          questions: info.questions || 0,
          total,
        };
      }
    }
    console.log('[OracleDraw] Free entries loaded from JSON:', Object.keys(freeEntriesData).length, 'wallets');
  } catch(e) {
    console.warn('[OracleDraw] Could not load free-entries.json, falling back to on-chain scan:', e.message);
    // Fallback: on-chain scrape with 30 day window
    await loadFreeEntriesOnChain();
  }
}

// Fallback: scrape on-chain if JSON not available
// Start of the current weekly draw round (Mon 20:00 UTC) — mirrors the worker's
// getCurrentRoundId('weekly') so free entries reset when the weekly draw rolls over.
function weeklyRoundStartSec() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
  const diffToMon = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMon);
  if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 7);
  return Math.floor(d.getTime() / 1000);
}

async function loadFreeEntriesOnChain() {
  // Window = current weekly round (Mon 20:00 UTC → now), NOT a rolling 30 days,
  // so free entries clear after each weekly draw and are never double-counted.
  const cutoff = weeklyRoundStartSec();
  const days = {};
  const qa   = {};

  for (const base of FCD_NODES_FE) {
    try {
      let offset = 0, done = false;
      while (!done) {
        const url = `${base}/v1/txs?account=${ORACLE_TREASURY}&limit=100&offset=${offset}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) break;
        const data = await res.json();
        const txs = data.txs || [];
        if (!txs.length) break;

        for (const tx of txs) {
          const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
          if (ts < cutoff) { done = true; break; }
          const memo = tx.tx?.value?.memo || tx.tx?.body?.memo || '';
          const msgs = tx.tx?.value?.msg  || tx.tx?.body?.messages || [];
          for (const msg of msgs) {
            const type = msg['@type'] || msg.type || '';
            if (!type.includes('MsgSend')) continue;
            const val  = msg.value || msg;
            if ((val.to_address || '') !== ORACLE_TREASURY) continue;
            const sender = val.from_address || '';
            const coins  = val.amount || [];
            const lunc   = coins.find(c => c.denom === 'uluna');
            if (!lunc) continue;
            const amt = Number(lunc.amount);
            if (memo.trim().length > 0 && amt >= CHAT_ULUNA_FE * 0.99 && amt <= CHAT_ULUNA_FE * 1.01) {
              const day = new Date(tx.timestamp).toISOString().slice(0, 10);
              if (!days[sender]) days[sender] = {};
              days[sender][day] = (days[sender][day] || 0) + 1;
            }
            if (amt >= QA_ULUNA_FE * 0.99 && amt <= QA_ULUNA_FE * 1.01) {
              qa[sender] = (qa[sender] || 0) + 1;
            }
          }
        }
        if (txs.length < 100) break;
        offset += 100;
      }
      break;
    } catch(e) { continue; }
  }

  freeEntriesData = {};
  const allWallets = new Set([...Object.keys(days), ...Object.keys(qa)]);
  for (const wallet of allWallets) {
    let chatEntries = 0;
    if (days[wallet]) {
      for (const cnt of Object.values(days[wallet])) {
        chatEntries += Math.min(Math.floor(cnt / 10), 2);
      }
    }
    const qaEntries = (qa[wallet] || 0) * 2;
    const total = chatEntries + qaEntries;
    if (total > 0) freeEntriesData[wallet] = { chat: chatEntries, questions: qaEntries, total };
  }
  console.log('[OracleDraw] Free entries loaded on-chain (fallback):', Object.keys(freeEntriesData).length, 'wallets');
}


function getFreeEntries(wallet) {
  return freeEntriesData[wallet] || { chat: 0, questions: 0, total: 0 };
}
const MIN_TICKETS    = 5; // minimum to hold draw
const LCD_NODES      = [
  'https://terra-classic-fcd.publicnode.com',
  'https://fcd.terra-classic.hexxagon.io',
  'https://terra-classic-lcd.publicnode.com',
];
const RPC_NODES      = [
  'https://terra-classic-rpc.publicnode.com',
  'https://rpc.terra-classic.io',
];

// ─── STATE ──────────────────────────────────────────────────────────────────
let currentLottery = 'daily';
window.currentLottery = currentLottery; // 'daily' | 'weekly'
// selectedTier and selectedPool are defined in index.html  do not redeclare here
let lotteryAddress = null;
let ticketCount = 1;
let luncPrice = 0;
let ustcPrice = 0;
let dailyTickets = [];   // array of {address, txhash, time}
let weeklyTickets = [];
let winnersData = [];    // flat array loaded from winners.json (daily + weekly combined)
let winnersFilter = 'all';
let timerInterval = null;

// ─── PARTICLES ──────────────────────────────────────────────────────────────
const container = document.getElementById('particles');
for (let i = 0; i < 30; i++) {
  const p = document.createElement('div');
  p.className = 'particle';
  p.style.left = Math.random() * 100 + '%';
  p.style.animationDuration = (8 + Math.random() * 15) + 's';
  p.style.animationDelay = (Math.random() * 10) + 's';
  p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
  container.appendChild(p);
}

// ─── FORMAT HELPERS ─────────────────────────────────────────────────────────
function fmt(n) {
  if (n >= 1e9)  return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n/1e6).toFixed(2) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}
function fmtAddr(a) { return a ? a.slice(0,10) + '...' + a.slice(-4) : ''; }
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

// ─── LCD FETCH ──────────────────────────────────────────────────────────────
async function lcdFetch(path) {
  for (const base of LCD_NODES) {
    try {
      const r = await Promise.race([
        fetch(base + path),
        new Promise((_, rej) => setTimeout(() => rej(), 6000))
      ]);
      if (r && r.ok) return await r.json();
    } catch {}
  }
  return null;
}

// ─── PRICE FETCH ────────────────────────────────────────────────────────────
// Routed through the Draw Worker proxy — CryptoCompare's public API started
// returning 401/CORS-blocked for direct browser requests from this domain.
// Cloudflare → CryptoCompare is a server-to-server call (not subject to
// browser CORS), with CoinGecko as an automatic fallback worker-side.
async function fetchPrices() {
  try {
    const r = await fetch(`${DRAW_WORKER}/lunc-price`);
    const d = await r.json();
    luncPrice = d?.LUNC || 0;
    ustcPrice = d?.USTC || 0;
  } catch {}
}

// ─── FETCH TICKETS FROM BLOCKCHAIN ──────────────────────────────────────────
async function fetchTickets(wallet, isDaily) {
  const cutoff = isDaily
    ? Math.floor(Date.now()/1000) - 86400
    : Math.floor(Date.now()/1000) - 7 * 86400;

  const tickets = [];
  const LCD_BASE = 'https://terra-classic-lcd.publicnode.com';

  try {
    let offset = 0;
    const limit = 50;
    while (true) {
      // LCD returns txs[] (bodies) + tx_responses[] (metadata with timestamp)  parallel arrays
      const url = `${LCD_BASE}/cosmos/tx/v1beta1/txs?events=transfer.recipient=%27${wallet}%27&pagination.limit=${limit}&order_by=2&pagination.offset=${offset}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) break;
      const data = await res.json();
      const txBodies    = data.txs || [];
      const txResponses = data.tx_responses || [];
      const count = Math.max(txBodies.length, txResponses.length);
      if (!count) break;

      let done = false;
      for (let idx = 0; idx < count; idx++) {
        const txBody = txBodies[idx];
        const txMeta = txResponses[idx];

        // Get timestamp from tx_response
        const timeStr = txMeta?.timestamp || '';
        const ts = timeStr ? Math.floor(new Date(timeStr).getTime() / 1000) : 0;
        if (ts < cutoff) { done = true; break; }

        // Get sender and amount from body.messages
        const msgs = txBody?.body?.messages || [];
        let fromAddr = null;
        let receivedUluna = 0;

        for (const msg of msgs) {
          const type = msg['@type'] || '';
          if (!type.includes('MsgSend')) continue;
          if ((msg.to_address || '') !== wallet) continue;
          fromAddr = msg.from_address || null;
          const coins = msg.amount || [];
          const lunc = coins.find(c => c.denom === 'uluna');
          if (lunc) receivedUluna = parseInt(lunc.amount);
        }

        if (!fromAddr || !receivedUluna) continue;

        const luncReceived = receivedUluna / 1e6;
        const grossLunc    = luncReceived / 0.995; // reverse 0.5% tax

        // Strict tier match  skip non-NFT payments (Q&A=100k, Chat=5k)
        const tiers = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
        let entries = 0;
        if (tiers) {
          if (Math.abs(grossLunc - tiers.legendary.lunc) < tiers.legendary.lunc * 0.02) entries = tiers.legendary.entries;
          else if (Math.abs(grossLunc - tiers.rare.lunc) < tiers.rare.lunc * 0.02) entries = tiers.rare.entries;
          else if (Math.abs(grossLunc - tiers.common.lunc) < tiers.common.lunc * 0.02) entries = tiers.common.entries;
        }
        if (entries === 0) continue;

        const txhash = txMeta?.txhash || '';
        for (let i = 0; i < entries; i++) {
          tickets.push({ address: fromAddr, txhash, time: ts, entries, nft: i === 0 ? 1 : 0 });
        }
      }

      if (done || count < limit) break;
      offset += limit;
    }
  } catch(e) {
    console.warn('fetchTickets error:', e);
  }

  return tickets;
}


// ─── ROUND-BASED TICKETS from Worker /round-stats ───────────────────────────
// Source of truth for Daily/Weekly stats: Worker KV (activated NFTs in current round)
// Returns the same shape as fetchTickets() so wheel and stats code works unchanged.
async function fetchRoundStatsAsTickets(pool) {
  const DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';
  const tickets = [];
  try {
    const res = await fetch(`${DRAW_WORKER}/round-stats?pool=${pool}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('round-stats HTTP', res.status);
      return tickets;
    }
    const data = await res.json();

    // Store raw mints for wheel chronological order
    window._roundMints        = data.mints || null;
    window._roundTotalEntries = data.totalEntries || 0;

    const byWallet     = data.byWallet     || {};
    const nftsByWallet = data.nftsByWallet || {};

    // Use mints[] for chronological order + correct tier/entries per mint
    if (data.mints && data.mints.length > 0) {
      for (const mint of data.mints) {
        const addr    = mint.wallet;
        const entries = mint.entries || 1;
        const total   = parseInt(byWallet[addr]) || entries;
        const nftNum  = parseInt(nftsByWallet[addr]) || 1;
        for (let i = 0; i < entries; i++) {
          tickets.push({
            address:     addr,
            txhash:      `mint:${mint.tokenId}:${i}`,
            time:        mint.usedAt ? Math.floor(new Date(mint.usedAt).getTime()/1000) : Math.floor(Date.now()/1000),
            entries:     total,        // total entries for this wallet
            mintEntries: entries,      // entries for THIS specific mint
            tier:        mint.tier || 'common',
            nft:         i < nftNum ? 1 : 0,
          });
        }
      }
    } else {
      // Fallback: byWallet without chronology or tier
      for (const [addr, entryCount] of Object.entries(byWallet)) {
        const n      = parseInt(entryCount) || 0;
        const nftNum = parseInt(nftsByWallet[addr]) || 1;
        for (let i = 0; i < n; i++) {
          tickets.push({
            address:     addr,
            txhash:      `activation:${addr}:${i}`,
            time:        Math.floor(Date.now()/1000),
            entries:     n,
            mintEntries: n,
            tier:        'common',
            nft:         i < nftNum ? 1 : 0,
          });
        }
      }
    }
  } catch(e) {
    console.warn('fetchRoundStatsAsTickets error:', e);
  }
  return tickets;
}


// ─── WEEKLY TICKET PRICE (≈ daily in USTC) ──────────────────────────────────
function weeklyTicketPrice() {
  // Weekly uses same LUNC price as Daily
  return LUNC_PER_TICKET;
}

// ─── LOAD WINNERS FROM winners.json ─────────────────────────────────────────
async function loadWinners() {
  try {
    const r = await fetch('./winners.json?t=' + Date.now());
    if (r.ok) {
      const raw = await r.json();
      let entries = [];

      if (raw && !Array.isArray(raw) && (raw.daily || raw.weekly)) {
        const mapEntry = mapWinnerEntry;   // см. блок WINNERS v2 ниже

        const daily  = (raw.daily  || []).map(function(w,i){ return mapEntry(w,'daily',i);  }).filter(Boolean);
        const weekly = (raw.weekly || []).map(function(w,i){ return mapEntry(w,'weekly',i); }).filter(Boolean);
        entries = daily.concat(weekly).sort(function(a,b){ return (b.time||0)-(a.time||0); });
      } else if (Array.isArray(raw)) {
        entries = raw.filter(function(w){ return !w.skipped && w.winner; });
      }

      winnersData = entries;
    }
  } catch(e) { console.warn('loadWinners:', e); winnersData = []; }
  renderWinners();
  populateDrawVerifySelect();
}

// ─── UPDATE POOL DISPLAY ────────────────────────────────────────────────────
function updatePoolDisplay() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const count = tickets.length;
  const isDaily = currentLottery === 'daily';

  // Count unique NFTs (transactions) vs entries
  const nftCount     = tickets.filter(t => t.nft === 1 || t.nft === undefined).length;
  const entriesCount = count; // total entries (for wheel)

  // Calculate prize pool from actual LUNC received
  // NFTs without nft field = old format, count by LUNC_PER_TICKET
  const tiers = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
  let totalLunc = 0;
  const seen = new Set();
  for (const t of tickets) {
    if (seen.has(t.txhash)) continue;
    seen.add(t.txhash);
    if (tiers && t.entries) {
      if (t.entries === tiers.legendary.entries) totalLunc += tiers.legendary.lunc;
      else if (t.entries === tiers.rare.entries) totalLunc += tiers.rare.lunc;
      else totalLunc += tiers.common.lunc;
    } else {
      totalLunc += LUNC_PER_TICKET;
    }
  }

  // Use real wallet balance if available (includes Q&A + NFT contributions)
  const _realBalance = isDaily
    ? (window._dailyPoolBalance  || totalLunc)
    : (window._weeklyPoolBalance || totalLunc);
  let poolPrize = _realBalance * 0.80;
  let seededLunc = _realBalance * 0.10;
  let poolUsd = poolPrize * luncPrice;

  const _pl=document.getElementById('pool-lunc');if(_pl)_pl.textContent = fmt(poolPrize) + ' LUNC';
  const _pu=document.getElementById('pool-usd');if(_pu)_pu.textContent = luncPrice > 0 ? '≈ $' + poolUsd.toFixed(2) + ' USD' : '';

  // Seeded next round
  const _seed = document.getElementById('stat-seeded');if(_seed)_seed.textContent = fmt(seededLunc);

  const _pt=document.getElementById('pool-tickets');if(_pt)_pt.textContent = nftCount + ' NFT' + (nftCount !== 1 ? 's' : '') + ' minted this round';

  const minNotice = document.getElementById('pool-min-notice');
  if (count <= MIN_TICKETS && count > 0) {
    minNotice.style.display = 'block';
  } else {
    minNotice.style.display = 'none';
  }

  // Update stats
  // My Entries This Round - entries for connected wallet in current lottery
  const _myAddr = connectedWalletAddress || lotteryAddress;
  const _curTickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const _myNFTEntries = _myAddr ? _curTickets.filter(t => t.address === _myAddr).length : 0;
  const _myFreeEntries = (currentLottery === 'weekly' && _myAddr) ? (getFreeEntries(_myAddr).total || 0) : 0;
  const _myEntries = _myNFTEntries + _myFreeEntries;
  const _st=document.getElementById('stat-total');if(_st)_st.textContent = _myEntries > 0 ? _myEntries : '0';
  // stat-burned = Seeded Next Round = 10% of current pool LUNC
  const _sb=document.getElementById('stat-burned');if(_sb)_sb.textContent = fmt(Math.round(seededLunc)) + ' LUNC';
  // Draw page: completed draws for the CURRENT pool (matches the pool context shown)
  const _sd=document.getElementById('stat-draws');if(_sd)_sd.textContent = winnersData.filter(function(w){return w.type===(currentLottery||'daily');}).length;

  // ── Sync home page stat counters (always kept up to date) ──
  // Home: TOTAL completed draws across BOTH pools (independent of current tab)
  const _totalDraws = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
  const _hDraws = document.getElementById('home-stat-draws');
  const _hNfts  = document.getElementById('home-stat-nfts');
  if (_hDraws) _hDraws.textContent = _totalDraws;
  if (_hNfts) _hNfts.textContent = nftCount;

  // Refresh weekly prize split if on weekly tab - use real balance
  if (currentLottery === 'weekly') {
    const _wPool = window._weeklyPoolBalance || weeklyTickets.length * 25000;
    const pool80 = _wPool * 0.8;
    const p1 = document.getElementById('weekly-prize-1');
    const p2 = document.getElementById('weekly-prize-2');
    const p3 = document.getElementById('weekly-prize-3');
    if (p1) p1.textContent = fmt(Math.floor(pool80 * 0.60)) + ' LUNC';
    if (p2) p2.textContent = fmt(Math.floor(pool80 * 0.25)) + ' LUNC';
    if (p3) p3.textContent = fmt(Math.floor(pool80 * 0.15)) + ' LUNC';
  }

  // Weekly ticket price display
  const _tpd = document.getElementById('ticket-price-display');
  const _ms  = document.getElementById('modal-sub');
  if (!isDaily) {
    if (_tpd) _tpd.textContent = 'Common · Rare · Legendary';
    if (_ms)  _ms.textContent  = 'Choose your NFT tier · Activate to enter draw';
  } else {
    if (_tpd) _tpd.textContent = 'Common · Rare · Legendary';
    if (_ms)  _ms.textContent  = 'Choose your NFT tier · Activate to enter draw';
  }
  // Update buy button with current tier price
  if (typeof updateBuyBtn === 'function') updateBuyBtn();
}

// ─── DRAW SCHEDULE ──────────────────────────────────────────────────────────
// Расписание и формат отсчёта живут в assets/js/draw-schedule.js — это общий
// файл, побайтово одинаковый в репо terra-oracle и oracle-draw. Он грузится
// обычным <script> ДО app.js. Здесь только потребление, своей арифметики нет:
// именно три независимые копии этой логики и разъехались 3 авг 2026.
if (!window.DRAW_SCHEDULE) {
  console.error('[schedule] assets/js/draw-schedule.js не загружен — счётчики ' +
    'розыгрыша считать нечем. Проверь порядок <script> в index.html: ' +
    'draw-schedule.js должен идти ДО app.js.');
}

// ─── TIMER ──────────────────────────────────────────────────────────────────
// Имя оставлено прежним — его зовёт startTimer и, возможно, внешний код
function getNextDrawTime(type) {
  return window.DRAW_SCHEDULE.next(type === 'weekly' ? 'weekly' : 'daily');
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const isBlue = currentLottery === 'weekly';

  // Apply blue color to timer if weekly
  ['t-days','t-hours','t-mins','t-secs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.toggle('blue', isBlue); }
  });

  function tick() {
    const ms = window.DRAW_SCHEDULE.msToNext(currentLottery);
    const p  = window.DRAW_SCHEDULE.parts(ms);
    document.getElementById('t-days').textContent  = String(p.d).padStart(2,'0');
    document.getElementById('t-hours').textContent = String(p.h).padStart(2,'0');
    document.getElementById('t-mins').textContent  = String(p.m).padStart(2,'0');
    document.getElementById('t-secs').textContent  = String(p.s).padStart(2,'0');
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

// ─── SWITCH LOTTERY ─────────────────────────────────────────────────────────
function switchLottery(type) {
  currentLottery = type;
  window.currentLottery = type;
  try { localStorage.setItem('activeLottery', type); } catch(e) {}
  const isDaily = type === 'daily';

  // Tabs
  const tabDaily  = document.getElementById('tab-daily');
  const tabWeekly = document.getElementById('tab-weekly');
  if (tabDaily)  tabDaily.className  = 'lottery-tab ' + (isDaily ? 'active-daily' : '');
  if (tabWeekly) tabWeekly.className = 'lottery-tab ' + (!isDaily ? 'active-weekly' : '');

  // Weekly body theme
  if (isDaily) {
    document.body.classList.remove('weekly-mode');
  } else {
    document.body.classList.add('weekly-mode');
  }

  // Page transition flash + hero animation
  const overlay = document.getElementById('page-transition');
  if (overlay) {
    overlay.classList.remove('flash-out');
    overlay.classList.add('flash');
    setTimeout(() => {
      overlay.classList.remove('flash');
      overlay.classList.add('flash-out');
    }, 120);
  }

  // Hero entrance animation
  const heroEl = document.getElementById('hero-title');
  const wheelEl = document.getElementById('wheel-panel-hero');
  if (heroEl) {
    heroEl.classList.remove('hero-switch-weekly', 'hero-switch-daily');
    void heroEl.offsetWidth; // force reflow
    heroEl.classList.add(isDaily ? 'hero-switch-daily' : 'hero-switch-weekly');
  }
  if (wheelEl) {
    wheelEl.classList.remove('wheel-switch');
    void wheelEl.offsetWidth;
    wheelEl.classList.add('wheel-switch');
  }

  // Hero
  const heroTitle = document.getElementById('hero-title');
  const heroSub   = document.getElementById('hero-sub');
  if (heroTitle) heroTitle.innerHTML   = isDaily ? 'DAILY <span class="gold" id="hero-subtitle">DRAW</span>' : 'WEEKLY <span class="blue-text" id="hero-subtitle">DRAW</span>';
  if (heroSub)   heroSub.textContent   = isDaily ? 'Mint an NFT. Activate it. Win the daily pool.' : 'Mint an NFT. Activate it. Win the weekly pool.';

  // Steps
  const wp = weeklyTicketPrice();
  const step1El = document.getElementById('step1-text');
  const step2El = document.getElementById('step2-text');
  if (step1El) step1El.textContent = isDaily
    ? 'Choose your tier - Common, Rare or Legendary. Activate to enter draw.'
    : 'Choose your tier - Common, Rare or Legendary. Activate to enter draw.';
  if (step2El) step2El.textContent = isDaily
    ? 'Mint an NFT to enter - your purchase is automatically registered. Draw happens at 20:00 UTC every day except Monday (Monday is the Weekly Draw).'
    : 'Mint an NFT to enter - your purchase is automatically registered. Pool accumulates all week until Monday 20:00 UTC.';

  // Pool display
  const poolDisplayEl = document.getElementById('pool-display');
  const poolLuncEl    = document.getElementById('pool-lunc');
  if (poolDisplayEl) poolDisplayEl.className = 'pool-display' + (isDaily ? '' : ' weekly-pool');
  if (poolLuncEl)    poolLuncEl.className    = 'pool-amount'  + (isDaily ? '' : ' blue');

  // Buy button
  const btn = document.getElementById('btn-buy-main');
  if (btn) btn.className = 'btn-buy' + (isDaily ? '' : ' weekly');

  // Modal
  const modalInner = document.getElementById('modal-inner');
  const modalTitle = document.getElementById('modal-title');
  const modalBtn   = document.getElementById('lottery-buy-btn');
  if (modalInner) modalInner.className = 'modal' + (isDaily ? '' : ' weekly-modal');
  if (modalTitle) modalTitle.className = 'modal-title' + (isDaily ? '' : ' blue');
  if (modalBtn)   modalBtn.className   = 'btn-confirm' + (isDaily ? '' : ' weekly');

  // Switch wheel panel style
  const wheelPanel = document.getElementById('wheel-panel-hero');
  if (wheelPanel) {
    wheelPanel.className = 'wheel-panel' + (isDaily ? '' : ' weekly-panel');
  }
  const wheelPanelLabel = document.getElementById('wheel-panel-label');
  if (wheelPanelLabel) wheelPanelLabel.textContent = isDaily ? 'ORACLE WHEEL' : 'COUNCIL OF ORACLES';

  startTimer();
  updatePoolDisplay();
  // Прячем карточку прошлого пула — Draw V2 вернёт её с данными нового,
  // либо оставит скрытой, если у пула ещё не было розыгрышей.
  const wwCard = document.getElementById('wheel-winner-card');
  if (wwCard) { wwCard.style.display = 'none'; wwCard.classList.remove('show'); }
  updateWheelTickets();

  // ── Toggle ALL Daily / Weekly elements via JS (reliable) ────
  const dailyExtra     = document.getElementById('daily-extra');
  const weeklyExtra    = document.getElementById('weekly-extra');
  const weeklyPodium   = document.getElementById('weekly-podium');
  const weeklyPoolSum  = document.getElementById('weekly-pool-summary-card') || document.querySelector('.weekly-pool-summary');
  const poolDisplay    = document.getElementById('pool-display');

  // Daily elements
  if (dailyExtra)    dailyExtra.style.display   = isDaily ? 'block' : 'none';
  if (poolDisplay)   poolDisplay.style.display  = isDaily ? 'block' : 'none';

  // Weekly elements
  if (weeklyExtra)   weeklyExtra.style.display  = isDaily ? 'none' : 'block';
  if (weeklyPodium)  weeklyPodium.style.display = isDaily ? 'none' : 'grid';
  if (weeklyPoolSum) weeklyPoolSum.style.display = isDaily ? 'none' : 'block';

  // Update podium prizes AFTER elements are visible
  if (!isDaily) updatePodiumPrizes();

  // ── Populate Daily: last winner ───────────────────────────────
  if (isDaily) {
    const last = winnersData.find(function(w){return w.type==='daily' && w.winner && !w.skipped;});
    const addrEl  = document.getElementById('last-winner-addr');
    const prizeEl = document.getElementById('last-winner-prize');
    const dateEl  = document.getElementById('last-winner-date');
    if (last && addrEl) {
      const addr = last.winner;
      addrEl.textContent  = addr.slice(0,10) + '...' + addr.slice(-6);
      if (prizeEl) prizeEl.textContent = fmt(last.prize) + ' LUNC';
      if (dateEl)  dateEl.textContent  = last.time ? new Date(last.time * 1000).toLocaleDateString() : '-';
    } else if (addrEl) {
      addrEl.textContent  = 'No draws yet';
      if (prizeEl) prizeEl.textContent = '-';
      if (dateEl)  dateEl.textContent  = '-';
    }
  }

  // ── Populate Weekly: prize split + free entries ───────────────
  if (!isDaily) {
    const pool80 = weeklyTickets.length > 0
      ? weeklyTickets.length * 25000 * 0.8
      : 0;
    const p1 = document.getElementById('weekly-prize-1');
    const p2 = document.getElementById('weekly-prize-2');
    const p3 = document.getElementById('weekly-prize-3');
    if (p1) p1.textContent = fmt(Math.floor(pool80 * 0.60)) + ' LUNC';
    if (p2) p2.textContent = fmt(Math.floor(pool80 * 0.25)) + ' LUNC';
    if (p3) p3.textContent = fmt(Math.floor(pool80 * 0.15)) + ' LUNC';

    // Free entries - total from GitHub JSON (all wallets this week)
    const freeEl = document.getElementById('weekly-free-entries');
    if (freeEl) {
      const totalFree = Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0);
      freeEl.textContent = totalFree > 0 ? totalFree : '0';
    }
  }

  // ── Update podium prizes ──────────────────────────────────────
  if (!isDaily) {
    const tickets = weeklyTickets;
    const pool = tickets.length * 25000;
    const prize80 = Math.floor(pool * 0.80);
    const p1El = document.getElementById('podium-prize-1');
    const p2El = document.getElementById('podium-prize-2');
    const p3El = document.getElementById('podium-prize-3');
    const totalEl = document.getElementById('weekly-pool-total');
    const tickEl  = document.getElementById('weekly-pool-tickets');
    if (p1El) p1El.textContent = fmt(Math.floor(prize80 * 0.60)) + ' LUNC';
    if (p2El) p2El.textContent = fmt(Math.floor(prize80 * 0.25)) + ' LUNC';
    if (p3El) p3El.textContent = fmt(Math.floor(prize80 * 0.15)) + ' LUNC';
    if (totalEl) totalEl.textContent = fmt(window._weeklyPoolBalance || pool) + ' LUNC';
    if (tickEl)  tickEl.textContent  = tickets.length + ' NFTs minted this round';
  }

  // Switch animated rings color
  const r1 = document.getElementById('wheel-ring-1');
  const r2 = document.getElementById('wheel-ring-2');
  const r3 = document.getElementById('wheel-ring-3');
  if (r1) r1.style.borderColor = isDaily ? 'rgba(244,208,63,0.2)' : 'rgba(74,144,217,0.15)';
  if (r2) r2.style.borderColor = isDaily ? 'rgba(244,208,63,0.35)' : 'rgba(74,144,217,0.25)';
  if (r3) r3.style.background = isDaily
    ? 'conic-gradient(from 0deg,transparent 0%,rgba(244,208,63,0.35) 15%,transparent 30%,rgba(200,80,0,0.3) 50%,transparent 65%,rgba(244,208,63,0.2) 80%,transparent 100%)'
    : 'conic-gradient(from 0deg,transparent 0%,rgba(0,200,255,0.3) 15%,transparent 30%,rgba(100,0,255,0.3) 50%,transparent 65%,rgba(0,200,255,0.2) 80%,transparent 100%)';

  // Restore canvas glow (inline style takes priority over CSS)

  // Switch pointer color
  const ptrStop0 = document.querySelector('#ptr-grad stop:first-child');
  const ptrStop1 = document.querySelector('#ptr-grad stop:last-child');
  const ptrPoly  = document.querySelector('#ptr-grad ~ polygon') || document.querySelector('[points="12,32 0,0 24,0"]');
  if (ptrStop0) ptrStop0.style.stopColor = isDaily ? '#ffe066' : '#00c8ff';
  if (ptrStop1) ptrStop1.style.stopColor = isDaily ? '#e67e22' : '#6400ff';
  if (ptrPoly)  ptrPoly.style.filter = 'none';
}

// ─── MODAL ──────────────────────────────────────────────────────────────────
function openModal() {
  const _mo=document.getElementById('modal');if(_mo)_mo.classList.add('open');
document.body.classList.add('modal-open');
  const _ts=document.getElementById('lottery-tx-status');if(_ts)_ts.style.display='none';
  const _tss=document.getElementById('lottery-tx-success');if(_tss)_tss.style.display='none';
  ticketCount = 1;
  const _cd = document.getElementById('count-display'); if (_cd) _cd.value = 1;

  /* Sync wallet state - always use global wallet if available */
  if (connectedWalletAddress) {
    lotteryAddress = connectedWalletAddress;
  }
  const notConn = document.getElementById('lottery-not-connected');
  const conn    = document.getElementById('lottery-connected');
  const buyBtn  = document.getElementById('lottery-buy-btn');
  const addrEl  = document.getElementById('lottery-addr-display');
  syncDrawWalletUI(lotteryAddress || null);

  updateBuyBtn();
  /* Re-apply selected tier to fix price display after tab switch */
  if (typeof selectTier === 'function') selectTier(selectedTier || 'common');
  /* Пул берём из состояния страницы, а не из прошлого выбора в модалке.
     Второй аргумент — не транслировать обратно в switchLottery. */
  if (typeof selectPool === 'function') selectPool(window.currentLottery || 'daily', true);
}
function closeModal() { const _mo2=document.getElementById('modal');if(_mo2)_mo2.classList.remove('open'); document.body.classList.remove('modal-open'); }
document.getElementById('modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

// ── NFT Mint iframe modal ─────────────────────────────────────
const NFT_MINT_URLS = {
  // Daily pool — funds go directly to DAILY_WALLET (terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px)
  common_daily:     'https://nft.lunc.tools/nft/150/mint?embed=1',
  rare_daily:       'https://nft.lunc.tools/nft/151/mint?embed=1',
  legendary_daily:  'https://nft.lunc.tools/nft/152/mint?embed=1',
  // Weekly pool — funds go directly to WEEKLY_WALLET (terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz)
  common_weekly:    'https://nft.lunc.tools/nft/147/mint?embed=1',
  rare_weekly:      'https://nft.lunc.tools/nft/148/mint?embed=1',
  legendary_weekly: 'https://nft.lunc.tools/nft/149/mint?embed=1',
};
// REP awarded per tier on mint
const NFT_TIER_REP = { common: 25, rare: 125, legendary: 250 };
// Paco NFT ids per tier+pool (must match worker's NFT_IDS). Used for the
// browser-side mint call that bypasses the Cloudflare-IP block on Paco.
const NFT_IDS_FRONT = {
  common_daily: 150, rare_daily: 151, legendary_daily: 152,
  common_weekly: 147, rare_weekly: 148, legendary_weekly: 149,
};
const NFT_TIER_LABELS = {
  common:    'Common · 25,000 LUNC · 1 entry',
  rare:      'Rare · 125,000 LUNC · 5 entries',
  legendary: 'Legendary · 250,000 LUNC · 10 entries',
};
const NFT_TIER_ENTRIES = { common: 1, rare: 5, legendary: 10 };


// Polls LCD until TX is confirmed (code=0) or failed (code!=0). Returns true if success.
async function waitForTxConfirm(txHash, timeoutMs = 180000) { // 3 minutes
  // Route through our Cloudflare Worker to avoid CORS/403 issues with LCD nodes
  const WORKER_TX_URL = `https://oracle-draw.vladislav-baydan.workers.dev/check-tx?hash=${txHash}`;
  // Fallback: direct LCD calls
  const LCD_LIST = [
    'https://terra-classic-lcd.publicnode.com',
    'https://rest.cosmos.directory/terraclassic',
  ];

  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt++;
    console.log(`[waitForTxConfirm] attempt ${attempt}, elapsed ${Math.round((Date.now()-start)/1000)}s`);

    // Try Worker first (no CORS issues)
    try {
      const r = await fetch(WORKER_TX_URL, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        if (d.code === 0) { console.log('[waitForTxConfirm] ✅ confirmed via Worker'); return true; }
        if (d.code > 0)  { console.error('[waitForTxConfirm] TX failed:', d.raw_log); return false; }
        // d.pending = true → keep waiting
        console.log('[waitForTxConfirm] TX pending...');
      }
    } catch(e) {
      console.log('[waitForTxConfirm] Worker error:', e.message);
    }

    // Fallback: direct LCD
    for (const lcd of LCD_LIST) {
      try {
        const r = await fetch(`${lcd}/cosmos/tx/v1beta1/txs/${txHash}`, { signal: AbortSignal.timeout(6000) });
        if (r.status === 404) continue;
        if (!r.ok) continue;
        const d = await r.json();
        const code = d.tx_response?.code ?? 0;
        if (code === 0) { console.log('[waitForTxConfirm] ✅ confirmed via LCD'); return true; }
        if (code !== 0) { console.error('[waitForTxConfirm] TX failed:', d.tx_response?.raw_log); return false; }
      } catch(e) { /* try next */ }
    }

    await new Promise(r => setTimeout(r, 4000));
  }
  console.warn('[waitForTxConfirm] timeout — TX not confirmed');
  return false;
}

// ── NATIVE MINT (replaces iframe) ────────────────────────────────────────────
// Paco fee wallet — receives 2.5% of mint price (confirmed from TX analysis)
const PACO_FEE_WALLET = 'terra12v5pxjv76hydvlj46kccqe362cky5rps92kqgg';

// NFT tier prices in LUNC
const NFT_MINT_PRICES = {
  common:    25000,
  rare:      125000,
  legendary: 250000,
};

// ── Mint service health check ────────────────────────────────────────────────
// Probes Paco (nft.lunc.tools) DIRECTLY FROM THE BROWSER. Paco blocks
// Cloudflare Worker datacenter IPs (the worker times out → "unreachable"),
// but browsers reach Paco fine — and since the mint itself now also runs from
// the browser, this checks the exact same path the mint will use.
async function isMintServiceUp(wallet) {
  // Contract mint has no external backend to probe — the chain is always the
  // backend. Kept only so any stray caller still resolves. Always true.
  return true;
}

async function _isMintServiceUp_OLD_worker(wallet) {
  try {
    const r = await fetch(`${DRAW_WORKER}/mint-health?wallet=${wallet}`, {
      signal: AbortSignal.timeout(40000),
    });
    if (!r.ok) return true;            // worker error → inconclusive → allow
    const d = await r.json();
    return d.up !== false;             // only an explicit up:false blocks
  } catch(e) {
    // Timeout / network error reaching OUR worker → inconclusive → allow.
    console.warn('mint-health probe inconclusive, allowing mint:', e.message);
    return true;
  }
}

async function nativeMint() {
  // Contract-only mint. The whole payment+mint is one MsgExecuteContract,
  // handled in oracle-mint-v2.js. This wrapper forwards to it so the existing
  // button onclick keeps working without touching the markup.
  if (typeof window.nativeMintV2 !== 'function') {
    alert('Mint module not loaded. Please refresh the page.');
    return;
  }
  return window.nativeMintV2();
}

// Sends a single TX with TWO MsgSend messages (pool payment + Paco fee)
async function sendTwoMsgSend(fromAddr, toAddr1, amount1, toAddr2, amount2, memo, chainId) {
  const _keplr = getWalletKeplr(walletProvider);
  const _isWC  = _isWCProvider(walletProvider);
  if (!_keplr && !_isWC) throw new Error('No wallet connected.');

  // ── helpers (same as sendLuncDirect) ──
  const enc = new TextEncoder();
  function encodeVarint(n) {
    const buf = []; let v = BigInt(n);
    while (v > 127n) { buf.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    buf.push(Number(v & 0x7fn)); return new Uint8Array(buf);
  }
  function encodeField(f, w, d) {
    const tag = encodeVarint((f << 3) | w);
    if (w === 2) {
      const len = encodeVarint(d.length);
      const out = new Uint8Array(tag.length + len.length + d.length);
      out.set(tag); out.set(len, tag.length); out.set(d, tag.length + len.length);
      return out;
    }
    return tag;
  }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }
  function encodeMsgSend(from, to, amount, denom) {
    // /cosmos.bank.v1beta1.MsgSend proto
    const coin = concat(
      encodeField(1, 2, enc.encode(denom)),
      encodeField(2, 2, enc.encode(String(amount)))
    );
    return concat(
      encodeField(1, 2, enc.encode(from)),
      encodeField(2, 2, enc.encode(to)),
      encodeField(3, 2, coin)
    );
  }

  // Build TX body with TWO MsgSend messages
  function makeMsgAny(typeUrl, value) {
    return concat(
      encodeField(1, 2, enc.encode(typeUrl)),
      encodeField(2, 2, value)
    );
  }
  const msg1 = makeMsgAny('/cosmos.bank.v1beta1.MsgSend', encodeMsgSend(fromAddr, toAddr1, amount1, 'uluna'));
  const msg2 = makeMsgAny('/cosmos.bank.v1beta1.MsgSend', encodeMsgSend(fromAddr, toAddr2, amount2, 'uluna'));
  const memoBytes = enc.encode(memo);
  const txBodyBytes = concat(
    encodeField(1, 2, msg1),
    encodeField(1, 2, msg2),
    encodeField(2, 2, memoBytes)
  );

  // ── account info ──
  const LCD_LIST = ['https://terra-classic-lcd.publicnode.com', 'https://lcd-terra-classic.hexxagon.io', 'https://terraclassic.community/cosmos'];
  let accountNumber, sequence, pubkeyBytes;
  for (const lcd of LCD_LIST) {
    try {
      const r = await fetch(`${lcd}/cosmos/auth/v1beta1/accounts/${fromAddr}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const d = await r.json();
      const acc = d.account?.base_account || d.account || d;
      accountNumber = parseInt(acc.account_number || '0');
      sequence      = parseInt(acc.sequence || '0');
      break;
    } catch(e) { continue; }
  }
  if (accountNumber === undefined) throw new Error('Could not fetch account info. Check your connection.');

  // ── pubkey ──
  if (_isWC) {
    pubkeyBytes = new Uint8Array(33); // placeholder, wallet replaces in signed result
  } else {
    const signer = _keplr.getOfflineSigner(chainId);
    const accounts = await signer.getAccounts();
    pubkeyBytes = accounts[0].pubkey;
    // Use address from signer to ensure it matches
    if (accounts[0].address && accounts[0].address !== fromAddr) {
      console.warn('[sendTwoMsgSend] signer address mismatch, using signer address:', accounts[0].address);
      fromAddr = accounts[0].address;
    }
  }

  // ── authInfo ──
  // Gas: 600000 (two MsgSend; real TX used 467863, requested 569338)
  // Fee: 600000 × 28.325 uluna/gas = 16,995,000 uluna ≈ 17 LUNC
  const GAS_LIMIT_2MSG = 600000;
  const totalFee    = Math.ceil(GAS_LIMIT_2MSG * 28.325);
  const pubkeyProto = encodeField(1, 2, pubkeyBytes);
  const pubkeyAny   = concat(
    encodeField(1, 2, enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2, 2, pubkeyProto)
  );
  const modeInfo    = encodeField(1, 2, concat(encodeVarint((1 << 3) | 0), encodeVarint(1)));
  const seqBytes    = encodeVarint(sequence);
  const signerInfo  = concat(
    encodeField(1, 2, pubkeyAny),
    encodeField(2, 2, modeInfo),
    encodeVarint((3 << 3) | 0), seqBytes
  );
  const feeCoin     = concat(
    encodeField(1, 2, enc.encode('uluna')),
    encodeField(2, 2, enc.encode(String(totalFee)))
  );
  const feeProto    = concat(
    encodeField(1, 2, feeCoin),
    encodeVarint((2 << 3) | 0), encodeVarint(GAS_LIMIT_2MSG)
  );
  const authInfoBytes = concat(
    encodeField(1, 2, signerInfo),
    encodeField(2, 2, feeProto)
  );

  // ── sign & broadcast ──
  let txBase64;
  if (_isWC) {
    txBase64 = await _wcSignAndBroadcast(fromAddr, txBodyBytes, authInfoBytes, accountNumber, chainId);
  } else {
    const signer = _keplr.getOfflineSigner(chainId);
    try { await _keplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await _keplr.enable(chainId);
    const { signed, signature } = await signer.signDirect(fromAddr, {
      bodyBytes:     txBodyBytes,
      authInfoBytes: authInfoBytes,
      chainId,
      accountNumber: BigInt(accountNumber),
    });
    function toUint8(v, fallback) {
      if (!v) return fallback;
      if (v instanceof Uint8Array) return v;
      if (v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return new Uint8Array(Object.values(v));
    }
    // Use OUR bodyBytes (Keplr may modify it) but ALWAYS use OUR authInfoBytes
    // because Keplr overrides gas limit to 300k in signed.authInfoBytes
    const finalBody = toUint8(signed.bodyBytes, txBodyBytes);
    const sigBytes  = Uint8Array.from(atob(signature.signature), c => c.charCodeAt(0));
    txBase64 = btoa(String.fromCharCode(...concat(
      encodeField(1, 2, finalBody),
      encodeField(2, 2, authInfoBytes),  // ← our authInfoBytes with 600k gas
      encodeField(3, 2, sigBytes)
    )));
  }

  // ── broadcast ──
  let broadcastRes, broadcastData;
  for (const lcd of LCD_LIST) {
    try {
      const r = await fetch(`${lcd}/cosmos/tx/v1beta1/txs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
        signal: AbortSignal.timeout(15000)
      });
      broadcastData = await r.json();
      broadcastRes  = r;
      break;
    } catch(e) { continue; }
  }
  if (!broadcastData) throw new Error('Broadcast failed — all LCD nodes unreachable.');
  const txHash = broadcastData.tx_response?.txhash || broadcastData.txhash;
  const code   = broadcastData.tx_response?.code   || broadcastData.code || 0;
  if (code !== 0) throw new Error(`TX rejected (code ${code}): ${broadcastData.tx_response?.raw_log || ''}`);
  if (!txHash)    throw new Error('No txhash in broadcast response.');
  return txHash;
}

// Snapshot of NFTs owned BEFORE opening mint iframe — used to detect newly minted NFT
window._preMintTokenIds = null;
window._mintSelectedPool = null;
window._mintSelectedTier = null;
window._postMintPollAbort = false;

async function openMintIframe() {
  const tier    = window.selectedTier || 'common';
  const pool    = window.selectedPool || window.currentLottery || 'daily';   // выбор в модалке имеет приоритет над вкладками
  const wallet  = connectedWalletAddress || lotteryAddress;
  const frame   = document.getElementById('nft-mint-frame');
  const overlay = document.getElementById('mint-modal-overlay');
  const subEl   = document.getElementById('mint-modal-sub');

  // Take snapshot of currently owned NFTs so we can diff after mint
  window._mintSelectedPool = pool;
  window._mintSelectedTier = tier;
  window._postMintPollAbort = false;
  if (wallet) {
    try {
      const r = await fetch(`${NFT_API_BASE}/owned-nfts/${wallet}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        const nfts = Array.isArray(data) ? data : data.nfts || data.data || data.tokens || [];
        window._preMintTokenIds = new Set(nfts.map(n => String(n.id || n.tokenId || n.token_id || '')).filter(Boolean));
        console.log(`[mint] pre-mint snapshot: ${window._preMintTokenIds.size} NFTs owned`);
      }
    } catch(e) {
      console.warn('[mint] pre-mint snapshot failed:', e.message);
      window._preMintTokenIds = new Set();   // empty set — we'll still try to detect any new NFT
    }
  }

  const mintKey = `${tier}_${pool}`;
  if (frame)   frame.src = NFT_MINT_URLS[mintKey] || NFT_MINT_URLS[`${tier}_daily`];
  if (subEl)   subEl.textContent = NFT_TIER_LABELS[tier] || NFT_TIER_LABELS.common;
  if (overlay) overlay.style.display = 'flex';
}

function closeMintIframe() {
  const frame   = document.getElementById('nft-mint-frame');
  const overlay = document.getElementById('mint-modal-overlay');
  if (frame)   frame.src = '';
  if (overlay) overlay.style.display = 'none';

  // After closing iframe, poll for newly minted NFT and auto-activate it
  // (only if user opened iframe with a snapshot)
  if (window._preMintTokenIds && window._mintSelectedPool && !window._postMintPollAbort) {
    pollForNewMintAndActivate();
  }
}

// Poll Paco API after mint iframe closes — detect new NFT, record in Worker, award REP.
// New architecture: mint goes directly to DAILY/WEEKLY wallet — no enterDraw tx needed.
async function pollForNewMintAndActivate() {
  const wallet = connectedWalletAddress || lotteryAddress;
  if (!wallet) return;

  const pool    = window._mintSelectedPool  || 'daily';
  const tier    = window._mintSelectedTier  || 'common';
  const entries = NFT_TIER_ENTRIES[tier]    || 1;
  const repPts  = NFT_TIER_REP[tier]        || 25;
  const preIds  = window._preMintTokenIds   || new Set();

  showAutoActivationToast('<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Detecting your new NFT...', 'info');

  const POLL_INTERVAL_MS = 5000;
  const MAX_ATTEMPTS     = 12; // 12 × 5s = 60s

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (window._postMintPollAbort) { console.log('[mint] poll aborted'); return; }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const r = await fetch(`${NFT_API_BASE}/owned-nfts/${wallet}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const data = await r.json();
      const nfts = Array.isArray(data) ? data : (data.nfts || data.data || data.tokens || []);

      const newNFT = nfts.find(n => {
        const id = String(n.id || n.tokenId || n.token_id || '');
        return id && !preIds.has(id);
      });

      if (newNFT) {
        const newId = String(newNFT.id || newNFT.tokenId || newNFT.token_id);
        console.log(`[mint] detected new NFT: ${newId} tier=${tier} pool=${pool}`);
        showAutoActivationToast(`<svg class="oi oi--gold"><use href="#i-sparkles"/></svg> NFT detected! Registering for ${pool.toUpperCase()} draw...`, 'info');

        // 1. Record in Worker for My Bag tracking (no on-chain tx needed)
        try {
          await fetch(`${DRAW_WORKER}/use-nft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokenId: newId, pool, wallet, entries, tier,
              txHash: 'direct_mint_' + newId,
              directMint: true,
            }),
          });
        } catch(e) { console.warn('[mint] Worker record failed:', e.message); }

        // REP is awarded server-side by the Worker's /use-nft directMint path
        // (guaranteed once per token). Front-end no longer awards to avoid double-counting.
        const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
        showAutoActivationToast(`<svg class="oi oi--green"><use href="#i-check"/></svg> ${tierLabel} NFT entered into ${pool.toUpperCase()} draw! +${repPts} REP`, 'success');

        window._preMintTokenIds  = null;
        window._mintSelectedPool = null;
        window._mintSelectedTier = null;

        if (typeof loadMyBagNFTs === 'function') loadMyBagNFTs(wallet);
        if (typeof loadAllData   === 'function') loadAllData();
        return;
      }
      console.log(`[mint] poll ${attempt}/${MAX_ATTEMPTS} — no new NFT yet`);
    } catch(e) { console.warn(`[mint] poll ${attempt} error:`, e.message); }
  }

  console.warn('[mint] poll timed out');
  showAutoActivationToast('<svg class="oi oi--amber"><use href="#i-warning"/></svg> Could not auto-detect new NFT. Check My Bag in a moment.', 'warning');
  window._preMintTokenIds  = null;
  window._mintSelectedPool = null;
}

// Floating toast in bottom-right corner with auto-activation status.
// Has a close button — clicking it aborts the polling and hides the toast.
function showAutoActivationToast(text, level) {
  let toast = document.getElementById('mint-auto-toast');
  let textEl, closeBtn;

  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mint-auto-toast';
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:rgba(20,25,40,0.96);' +
      'border:1px solid rgba(212,175,55,0.4);backdrop-filter:blur(12px);border-radius:12px;padding:14px 20px;' +
      'color:#fff;font-family:"Exo 2",sans-serif;font-size:13px;font-weight:600;max-width:340px;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.5);animation:slideInToast 0.3s ease-out;' +
      'display:flex;align-items:center;gap:14px;';

    textEl = document.createElement('span');
    textEl.id = 'mint-auto-toast-text';
    textEl.style.flex = '1';
    toast.appendChild(textEl);

    closeBtn = document.createElement('button');
    closeBtn.id = 'mint-auto-toast-close';
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:transparent;border:none;color:#fff;opacity:0.6;cursor:pointer;' +
      'font-size:20px;line-height:1;padding:0 4px;font-weight:300;';
    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.6'; };
    closeBtn.onclick = () => {
      window._postMintPollAbort = true;        // stop the polling loop
      window._preMintTokenIds = null;
      window._mintSelectedPool = null;
      window._mintSelectedTier = null;
      toast.style.display = 'none';
      clearTimeout(window._mintToastTimer);
    };
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);

    if (!document.getElementById('mint-toast-style')) {
      const s = document.createElement('style');
      s.id = 'mint-toast-style';
      s.textContent = '@keyframes slideInToast{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}';
      document.head.appendChild(s);
    }
  } else {
    textEl = toast.querySelector('#mint-auto-toast-text');
  }

  const colors = {
    info:    'rgba(84,147,247,0.5)',
    success: 'rgba(102,255,170,0.6)',
    warning: 'rgba(255,180,80,0.6)',
  };
  toast.style.borderColor = colors[level] || colors.info;
  if (textEl) textEl.innerHTML = text;
  toast.style.display = 'flex';

  // Auto-hide all toasts: info after 60s safety net, success/warning after 8s
  clearTimeout(window._mintToastTimer);
  const hideMs = (level === 'info') ? 70000 : 8000; // info safety net longer than poll timeout
  window._mintToastTimer = setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, hideMs);
}

function changeCount(delta) {
  ticketCount = Math.max(1, Math.min(100, ticketCount + delta));
  const _cd2 = document.getElementById('count-display'); if (_cd2) _cd2.value = ticketCount;
  updateBuyBtn();
}
function setCount(val) {
  const n = parseInt(val);
  ticketCount = isNaN(n) || n < 1 ? 1 : Math.min(n, 100);
  updateBuyBtn();
}
function updateBuyBtn() {
  const tier = window.selectedTier || 'common';
  const NFT_TIER_PRICES = { common: 25000, rare: 125000, legendary: 250000 };
  const NFT_TIER_ENTRIES = { common: 1, rare: 5, legendary: 10 };
  const price   = NFT_TIER_PRICES[tier] || 25000;
  const entries = NFT_TIER_ENTRIES[tier] || 1;
  const pool    = window.selectedPool || window.currentLottery || 'daily';
  const mTotEl  = document.getElementById('modal-total-val');
  const mTierEl = document.getElementById('modal-tier-entries');
  const btn     = document.getElementById('lottery-buy-btn');
  if (mTotEl)  mTotEl.textContent  = fmt(price) + ' LUNC';
  if (mTierEl) mTierEl.textContent = entries + (entries === 1 ? ' entry' : ' entries');
  if (btn && lotteryAddress) btn.style.display = 'block';
  renderBuyBtnLabel(tier, pool, price);
}

// Подпись кнопки минта собирается заново из состояния, а не правится через
// внутренние <span>. Причина: промежуточные статусы ('Waiting for Keplr...',
// 'Mint NFT') затирают innerHTML кнопки вместе со спанами, после чего старый
// код молча переставал обновлять подпись — она застывала на прошлом тире.
// Пул выведен в саму кнопку, чтобы перед нажатием не было сомнений.
function renderBuyBtnLabel(tier, pool, price) {
  const btn = document.getElementById('draw-buy-btn') || document.getElementById('lottery-buy-btn');
  if (!btn || btn.disabled) return;   // идёт транзакция — не трогаем статус
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const isDaily   = pool !== 'weekly';
  const poolCol   = isDaily ? '#f4d03f' : '#7ec8ff';
  btn.innerHTML =
    'Mint <span id=\"buy-btn-tier\">' + tierLabel + '</span>' +
    ' · <span id=\"buy-btn-pool\" style=\"color:' + poolCol + ';font-weight:800;letter-spacing:.06em;\">' +
      (isDaily ? 'DAILY' : 'WEEKLY') + '</span>' +
    ' — <span id=\"buy-btn-total\">' + fmt(price) + '</span> LUNC';
}
window.renderBuyBtnLabel = renderBuyBtnLabel;

// ─── KEPLR ──────────────────────────────────────────────────────────────────
// Connect button inside the buy modal. Previously hardcoded window.keplr and
// did NOT set walletProvider — Galaxy-only users got "No wallet found" and the
// global wallet state stayed out of sync with the modal. Now routes through
// the shared connectWallet(provider) flow with provider auto-detection.
async function connectLotteryKeplr() {
  // Already connected globally? Just sync the modal UI to that wallet.
  if (connectedWalletAddress) {
    lotteryAddress = connectedWalletAddress;
    syncDrawWalletUI(lotteryAddress);
    if (typeof updateBuyBtn === 'function') updateBuyBtn();
    return;
  }
  // Detect the best available provider and use the shared connect flow
  // (it sets walletProvider, persists the session and syncs all UI).
  let provider = null;
  if (window.keplr) provider = 'keplr';
  else if (window.galaxyStation) provider = 'galaxystation';
  else if (window.station) provider = 'station';
  if (!provider) { alert('No wallet found! Please install Keplr, Galaxy Station or Terra Station.'); return; }
  try {
    await connectWallet(provider);
    if (connectedWalletAddress) {
      lotteryAddress = connectedWalletAddress;
      syncDrawWalletUI(lotteryAddress);
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
  } catch(e) { alert('Connection failed: ' + (e.message || e)); }
}

/* Sync both modal wallet UI sections (lottery-* and draw-*) */
function syncDrawWalletUI(address) {
  /* lottery-* elements (inside modal) */
  const d1 = document.getElementById('lottery-addr-display');
  const d2 = document.getElementById('lottery-not-connected');
  const d3 = document.getElementById('lottery-connected');
  const d4 = document.getElementById('lottery-buy-btn');
  /* draw-* elements (in modal wallet section) */
  const d5 = document.getElementById('draw-addr-display');
  const d6 = document.getElementById('draw-not-connected');
  const d7 = document.getElementById('draw-connected');
  const d8 = document.getElementById('draw-buy-btn');

  if (address) {
    if (d1) d1.textContent = fmtAddr(address);
    if (d2) d2.style.display = 'none';
    if (d3) d3.style.display = 'block';
    if (d4) d4.style.display = 'block';
    if (d5) d5.textContent = fmtAddr(address);
    if (d6) d6.style.display = 'none';
    if (d7) d7.style.display = 'block';
    if (d8) d8.style.display = 'block';
  } else {
    if (d2) d2.style.display = 'block';
    if (d3) d3.style.display = 'none';
    if (d4) d4.style.display = 'none';
    if (d6) d6.style.display = 'block';
    if (d7) d7.style.display = 'none';
    if (d8) d8.style.display = 'none';
  }
}

/* Aliases used in index.html */
async function connectDrawKeplr() { return connectLotteryKeplr(); }
function disconnectDrawKeplr() { disconnectLotteryKeplr(); }

function disconnectLotteryKeplr() {
  lotteryAddress = null;
  connectedWalletAddress = null;
  walletProvider = null;
  clearPersistedWallet();
  syncDrawWalletUI(null);
  /* Update global wallet button */
  const btn   = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-btn-label');
  const info  = document.getElementById('wallet-info');
  if (btn)   btn.classList.remove('connected');
  if (label) label.textContent = 'Connect Wallet';
  if (info)  info.classList.remove('open');
}

// ─── BUY TICKETS ────────────────────────────────────────────────────────────

// ─── WALLET PROVIDER HELPER ──────────────────────────────────────────────────
// Returns the Keplr-compatible signer object for the given provider name.
//   keplr        → window.keplr
//   galaxystation→ window.galaxyStation.keplr  (Galaxy wraps Keplr inside .keplr)
//   station      → window.station?.keplr || window.keplr  (Station same pattern)
//   <other>      → window.keplr (fallback)
function getWalletKeplr(provider) {
  if (provider === 'galaxystation') {
    return window.galaxyStation?.keplr || window.galaxyStation;
  }
  if (provider === 'station') {
    return window.station?.keplr || window.station || window.keplr;
  }
  // WalletConnect providers use WC session for signing — return null here,
  // sendLuncDirect will handle them separately via _wcSignDirect()
  if (provider === 'keplr-mobile' || provider === 'galaxy-mobile' || provider === 'luncdash-wc') {
    return null; // signals WC path
  }
  return window.keplr;
}

// Returns true if current wallet provider uses WalletConnect session
function _isWCProvider(provider) {
  return provider === 'keplr-mobile' || provider === 'galaxy-mobile' || provider === 'luncdash-wc';
}

// Sign and broadcast via WalletConnect session (cosmos_signDirect)
async function _wcSignAndBroadcast(fromAddr, txBodyBytes, authInfoBytes, accountNumber, chainId) {
  const client = window._wqrClient;
  if (!client) throw new Error('No WalletConnect session. Please reconnect your wallet.');
  const sessions = client.session.getAll();
  if (!sessions || sessions.length === 0) throw new Error('WalletConnect session expired. Please reconnect.');
  const session = sessions[sessions.length - 1];

  const bodyB64      = btoa(String.fromCharCode(...txBodyBytes));
  const authInfoB64  = btoa(String.fromCharCode(...authInfoBytes));

  const result = await client.request({
    topic: session.topic,
    chainId: 'cosmos:columbus-5',
    request: {
      method: 'cosmos_signDirect',
      params: {
        signerAddress: fromAddr,
        signDoc: {
          bodyBytes:     bodyB64,
          authInfoBytes: authInfoB64,
          chainId:       chainId,
          accountNumber: String(accountNumber),
        }
      }
    }
  });

  // result: { signature: { signature, pub_key }, signed: { bodyBytes, authInfoBytes } }
  function toUint8(v, fallback) {
    if (!v) return fallback;
    if (v instanceof Uint8Array) return v;
    if (typeof v === 'string') return Uint8Array.from(atob(v), c => c.charCodeAt(0));
    if (v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return new Uint8Array(Object.values(v));
  }
  function encodeVarint(n) {
    const buf = []; let v = n;
    while (v > 127) { buf.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    buf.push(v & 0x7f); return new Uint8Array(buf);
  }
  function encodeField(f, w, d) {
    const tag = encodeVarint((f << 3) | w);
    if (w === 2) {
      const len = encodeVarint(d.length);
      const out = new Uint8Array(tag.length + len.length + d.length);
      out.set(tag); out.set(len, tag.length); out.set(d, tag.length + len.length);
      return out;
    }
    return tag;
  }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  const finalBody     = toUint8(result.signed?.bodyBytes,     txBodyBytes);
  const finalAuthInfo = toUint8(result.signed?.authInfoBytes, authInfoBytes);
  const sigBytes      = Uint8Array.from(atob(result.signature.signature), c => c.charCodeAt(0));

  const txRaw = concat(
    encodeField(1, 2, finalBody),
    encodeField(2, 2, finalAuthInfo),
    encodeField(3, 2, sigBytes)
  );
  return btoa(String.fromCharCode(...txRaw));
}

// ─── SEND LUNC DIRECT (signDirect) ──────────────────────────────────────────
async function sendLuncDirect(fromAddr, toAddr, amountUluna, memo, chainId) {
  const _keplr = getWalletKeplr(walletProvider);
  const _isWC  = _isWCProvider(walletProvider);

  if (!_keplr && !_isWC) throw new Error('No wallet connected. Please connect a wallet first.');

  // For WC providers we don't have getOfflineSigner — get pubkey differently
  let pubkeyBytes;
  if (_isWC) {
    // WC doesn't expose pubkey before signing — use a 33-byte placeholder
    // The wallet will replace authInfoBytes.pubkey in the signed result
    pubkeyBytes = new Uint8Array(33);
  } else {
    const directSigner = _keplr.getOfflineSigner(chainId);
    const accounts     = await directSigner.getAccounts();
    pubkeyBytes        = accounts[0].pubkey;
  }

  const LCD_BASE = 'https://terra-classic-lcd.publicnode.com';
  const accRes  = await fetch(`${LCD_BASE}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const accData = await accRes.json();
  const acct    = accData?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  const sequence      = parseInt(acct.sequence || '0');

  function encodeVarint(n) {
    const buf = []; let v = n;
    while (v > 127) { buf.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    buf.push(v & 0x7f); return new Uint8Array(buf);
  }
  function encodeField(f, w, d) {
    const tag = encodeVarint((f << 3) | w);
    if (w === 2) {
      const len = encodeVarint(d.length);
      const out = new Uint8Array(tag.length + len.length + d.length);
      out.set(tag); out.set(len, tag.length); out.set(d, tag.length + len.length);
      return out;
    }
    return tag;
  }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }
  const enc = new TextEncoder();

  // MsgSend proto
  const coinProto = concat(
    encodeField(1, 2, enc.encode('uluna')),
    encodeField(2, 2, enc.encode(String(amountUluna)))
  );
  const msgSendProto = concat(
    encodeField(1, 2, enc.encode(fromAddr)),
    encodeField(2, 2, enc.encode(toAddr)),
    encodeField(3, 2, coinProto)
  );
  const anyMsg = concat(
    encodeField(1, 2, enc.encode('/cosmos.bank.v1beta1.MsgSend')),
    encodeField(2, 2, msgSendProto)
  );

  // TxBody
  const txBodyBytes = concat(
    encodeField(1, 2, anyMsg),
    encodeField(2, 2, enc.encode(memo))
  );

  // Gas fee: 600000 gas × 28.325 = 16,995,000 uluna (two MsgSend need ~470K gas; real TX used 467863)
  const GAS_LIMIT = 600000;
  const gasFee   = Math.ceil(GAS_LIMIT * 28.325);
  const taxFee   = Math.ceil(amountUluna * 0.005);
  const totalFee = gasFee + taxFee;

  // PubKey Any
  const pubkeyProto = encodeField(1, 2, pubkeyBytes);
  const pubkeyAny   = concat(
    encodeField(1, 2, enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2, 2, pubkeyProto)
  );
  // ModeInfo SIGN_MODE_DIRECT = 1
  const modeInfo = encodeField(1, 2, concat(encodeVarint((1 << 3) | 0), encodeVarint(1)));
  const seqBytes = encodeVarint(sequence);
  const signerInfo = concat(
    encodeField(1, 2, pubkeyAny),
    encodeField(2, 2, modeInfo),
    encodeVarint((3 << 3) | 0), seqBytes
  );
  // Fee
  const feeCoin = concat(
    encodeField(1, 2, enc.encode('uluna')),
    encodeField(2, 2, enc.encode(String(totalFee)))
  );
  const feeProto = concat(
    encodeField(1, 2, feeCoin),
    encodeVarint((2 << 3) | 0), encodeVarint(GAS_LIMIT)
  );
  const authInfoBytes = concat(
    encodeField(1, 2, signerInfo),
    encodeField(2, 2, feeProto)
  );

  let txBase64;
  if (_isWC) {
    // WalletConnect path — wallet signs remotely on mobile
    txBase64 = await _wcSignAndBroadcast(fromAddr, txBodyBytes, authInfoBytes, accountNumber, chainId);
  } else {
    const directSigner = _keplr.getOfflineSigner(chainId);
    const { signed, signature } = await directSigner.signDirect(fromAddr, {
      bodyBytes:     txBodyBytes,
      authInfoBytes: authInfoBytes,
      chainId,
      accountNumber: BigInt(accountNumber),
    });

    // Keplr may return bodyBytes/authInfoBytes as plain object {0:...,1:...} not Uint8Array
    function toUint8(v, fallback) {
      if (!v) return fallback;
      if (v instanceof Uint8Array) return v;
      if (v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return new Uint8Array(Object.values(v));
    }
    const finalBody = toUint8(signed.bodyBytes, txBodyBytes);
    // Use OUR authInfoBytes — Keplr overrides gas in signed.authInfoBytes
    const sigBytes  = Uint8Array.from(atob(signature.signature), c => c.charCodeAt(0));

    txBase64 = btoa(String.fromCharCode(...concat(
      encodeField(1, 2, finalBody),
      encodeField(2, 2, authInfoBytes),
      encodeField(3, 2, sigBytes)
    )));
  }
  const broadcastRes = await fetch(`${LCD_BASE}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const broadcastData = await broadcastRes.json();
  const txHash = broadcastData?.tx_response?.txhash || broadcastData?.txhash;
  const code   = broadcastData?.tx_response?.code ?? broadcastData?.code ?? 0;
  if (code !== 0) throw new Error('TX failed on-chain: ' + (broadcastData?.tx_response?.raw_log || JSON.stringify(broadcastData)));
  return txHash;
}

async function buyTicketsKeplr() {
  if (!lotteryAddress) { alert('Please connect your wallet first!'); return; }
  const isDaily = (typeof selectedPool !== 'undefined' ? selectedPool : currentLottery) === 'daily';
  const btn = document.getElementById('draw-buy-btn') || document.getElementById('lottery-buy-btn');
  const statusEl = document.getElementById('draw-tx-status') || document.getElementById('lottery-tx-status');
  const msgEl = document.getElementById('draw-tx-msg') || document.getElementById('lottery-tx-msg');
  const successEl = document.getElementById('draw-tx-success') || document.getElementById('lottery-tx-success');

  // Health check — don't take funds if the mint backend is down
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Checking service...'; }
  if (statusEl) statusEl.style.display = 'block';
  if (!(await isMintServiceUp(lotteryAddress))) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Mint NFT'; }
    if (msgEl) msgEl.innerHTML = '<svg class="oi oi--amber"><use href="#i-warning"/></svg> Mint service is temporarily unavailable. Your funds are safe — please try again in a few minutes.';
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Waiting for Keplr...'; }
  if (statusEl) statusEl.style.display = 'block';
  if (successEl) successEl.style.display = 'none';
  if (msgEl) msgEl.textContent = 'Opening Keplr - please approve the transaction...';

  const wallet = isDaily ? DAILY_WALLET : WEEKLY_WALLET;
  const denom  = 'uluna'; // LUNC only - no USTC

  // Get tier price and entries from NFT_TIERS (defined in index.html)
  // Snapshot selectedTier immediately - capture before any async operations
  const _snapTier = window.selectedTier || (typeof selectedTier !== 'undefined' ? selectedTier : 'common');
  const _snapNFT  = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
  console.log('[BUY] snapTier:', _snapTier, 'snapNFT:', _snapNFT);
  const tier = (_snapNFT && _snapTier)
    ? _snapNFT[_snapTier] || _snapNFT['common']
    : { lunc: LUNC_PER_TICKET, entries: 1, label: 'Common' };
  const pricePerTicket = tier.lunc;
  const totalAmount = pricePerTicket * 1000000;
  const entries = tier.entries;
  const tierLabel = tier.label || selectedTier || 'Common';
  const memo = `draw:${isDaily ? 'daily' : 'weekly'}:${_snapTier}`;  // e.g. draw:daily:common

  try {
    const _keplr = getWalletKeplr(walletProvider);
    const _isWC  = _isWCProvider(walletProvider);
    if (!_keplr && !_isWC) throw new Error('No wallet connected. Please connect a wallet first.');

    let senderAddress;
    if (_isWC) {
      // WC — address is already stored from connection
      senderAddress = connectedWalletAddress;
      if (!senderAddress) throw new Error('WalletConnect session lost. Please reconnect.');
    } else {
      await _keplr.enable(CHAIN_ID);
      const accounts = await _keplr.getOfflineSigner(CHAIN_ID).getAccounts();
      senderAddress = accounts[0].address;
    }

    if (msgEl) msgEl.textContent = _isWC ? 'Check your mobile wallet to approve...' : 'Please approve the transaction in your wallet...';

    const txHash = await sendLuncDirect(senderAddress, wallet, totalAmount, memo, CHAIN_ID);

    if (msgEl) msgEl.textContent = 'Transaction submitted - confirming on-chain...';

    if (statusEl) statusEl.style.display = 'none';
    if (successEl) successEl.style.display = 'block';
    const successMsg = document.getElementById('draw-success-msg') || document.getElementById('lottery-success-msg');
    const txLink = document.getElementById('draw-tx-link') || document.getElementById('lottery-tx-link');
    if (successMsg) successMsg.innerHTML = `<svg class="oi oi--gold"><use href="#i-ticket"/></svg> ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} purchased successfully!`;
    if (txLink) {
      txLink.href = `https://finder.terraport.finance/mainnet/tx/${txHash}`;
      txLink.innerHTML = '<svg class="oi oi--cyan"><use href="#i-link"/></svg> ' + (txHash || '').slice(0,16) + '...';
    }

    if (btn) { btn.innerHTML = `Mint ${ticketCount > 1 ? ticketCount + ' NFTs' : 'NFT'} - ${fmt(ticketCount*pricePerTicket)} LUNC`; btn.disabled = false; }

    await loadAllData();

  } catch(e) {
    if (statusEl) statusEl.style.display = 'none';
    if (btn) { btn.disabled = false; btn.innerHTML = `Mint ${ticketCount > 1 ? ticketCount + ' NFTs' : 'NFT'} - ${fmt(ticketCount*LUNC_PER_TICKET)} LUNC`; }
    const emsg = (e && e.message) || String(e) || '';
    const userRejected = /reject|denied|cancel|user.?denied|code:?\s*4001/i.test(emsg);
    if (userRejected) {
      console.log('[buyTickets] user cancelled the transaction');
    } else {
      alert('Transaction failed: ' + emsg);
    }
  }
}

// ─── SCROLL ─────────────────────────────────────────────────────────────────
function scrollToId(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── WINNERS FILTER BUTTONS ─────────────────────────────────────────────────
function filterWinners(f) {
  winnersFilter = f;
  ['all','daily','weekly','mine'].forEach(function(k){
    var b = document.getElementById('wf-' + k);
    if (b) b.classList.toggle('active', k === f);
  });
  renderWinners();
}

// ─── GET WALLET BALANCE ──────────────────────────────────────────────────────
async function getWalletBalance(address) {
  try {
    const res = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/bank/v1beta1/balances/${address}`);
    if (!res.ok) return 0;
    const data = await res.json();
    const balances = data.balances || [];
    const lunc = balances.find(b => b.denom === 'uluna');
    return lunc ? Math.floor(parseInt(lunc.amount) / 1e6) : 0;
  } catch(e) { return 0; }
}

// ─── LOAD ALL DATA ───────────────────────────────────────────────────────────
async function loadAllData() {
  await fetchPrices();

  // ── Step 1: balances only (very fast) ──
  const [_dailyBal, _weeklyBal] = await Promise.all([
    getWalletBalance(DAILY_WALLET),
    getWalletBalance(WEEKLY_WALLET),
  ]);
  window._dailyPoolBalance  = _dailyBal;
  window._weeklyPoolBalance = _weeklyBal;
  updatePoolDisplay();

  // ── Step 2: tickets + free entries in parallel (slower) ──
  // NOTE: tickets now come from Worker /round-stats (source of truth after NFT activation system)
  // fetchTickets (LCD-based) is kept as fallback but no longer primary
  const [_daily, _weekly] = await Promise.all([
    fetchRoundStatsAsTickets('daily'),
    fetchRoundStatsAsTickets('weekly'),
    loadFreeEntries(),
  ]);
  dailyTickets  = _daily;
  weeklyTickets = _weekly;
  updatePoolDisplay();

  // ── Update wheel with fresh data ──
  if (typeof updateWheelTickets === 'function') {
    updateWheelTickets();
  }

  // ── Refresh home page stats with fresh data ──
  // NFTs Minted = all-time cumulative counter from Worker /total-mints (never resets).
  // Shows total + tier breakdown via tooltip on hover.
  const hNfts = document.getElementById('home-stat-nfts');
  if (hNfts) {
    try {
      const totalRes = await fetch('https://oracle-draw.vladislav-baydan.workers.dev/total-mints');
      if (totalRes.ok) {
        const t = await totalRes.json();
        const total = t.total || 0;
        hNfts.textContent = total;
        // Tooltip with tier breakdown — shown on hover/tap
        const tip = `Common: ${t.common || 0} · Rare: ${t.rare || 0} · Legendary: ${t.legendary || 0}`;
        hNfts.title = tip;
        // Visual cue that it's interactive
        hNfts.style.cursor = 'help';
        // Custom tooltip (mobile-friendly) — replaces parent card content briefly on tap
        const card = hNfts.parentElement;
        if (card && !card.dataset.tooltipBound) {
          card.dataset.tooltipBound = '1';
          card.style.position = 'relative';
          const tooltip = document.createElement('div');
          tooltip.id = 'home-stat-nfts-tooltip';
          tooltip.style.cssText = 'position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);' +
            'background:rgba(12,16,30,0.96);border:1px solid rgba(124,92,255,0.35);border-radius:10px;' +
            'padding:8px 14px;font-size:11px;color:#cdd6f4;white-space:nowrap;pointer-events:none;' +
            'opacity:0;transition:opacity 0.15s ease;z-index:50;letter-spacing:0.04em;backdrop-filter:blur(8px);';
          tooltip.textContent = tip;
          card.appendChild(tooltip);
          const show = () => { tooltip.textContent = hNfts.title; tooltip.style.opacity = '1'; };
          const hide = () => { tooltip.style.opacity = '0'; };
          card.addEventListener('mouseenter', show);
          card.addEventListener('mouseleave', hide);
          card.addEventListener('touchstart', () => { show(); setTimeout(hide, 2500); }, { passive: true });
        } else if (card) {
          // Update existing tooltip text
          const tEl = card.querySelector('#home-stat-nfts-tooltip');
          if (tEl) tEl.textContent = tip;
        }
        window._totalNFTsActivated = total;
      }
    } catch(e) {
      const tickets = (typeof dailyTickets !== 'undefined' ? dailyTickets : []);
      const nftCount = tickets.filter(t => t.nft === 1 || t.nft === undefined).length;
      if (nftCount > 0) hNfts.textContent = nftCount;
    }
  }
  const hDraws = document.getElementById('home-stat-draws');
  if (hDraws) hDraws.textContent = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
}

function updatePodiumPrizes() {
  // Use real wallet balance - not ticket count * price
  const pool = window._weeklyPoolBalance || weeklyTickets.length * 25000;
  const prize80 = Math.floor(pool * 0.80);
  const p1El = document.getElementById('podium-prize-1');
  const p2El = document.getElementById('podium-prize-2');
  const p3El = document.getElementById('podium-prize-3');
  const totalEl = document.getElementById('weekly-pool-total');
  const tickEl  = document.getElementById('weekly-pool-tickets');
  if (p1El) p1El.textContent = fmt(Math.floor(prize80 * 0.60)) + ' LUNC';
  if (p2El) p2El.textContent = fmt(Math.floor(prize80 * 0.25)) + ' LUNC';
  if (p3El) p3El.textContent = fmt(Math.floor(prize80 * 0.15)) + ' LUNC';
  if (totalEl) totalEl.textContent = fmt(pool) + ' LUNC';
  if (tickEl)  tickEl.textContent  = weeklyTickets.length + ' NFTs minted this round';

  // Update minimum pool progress bar
  const WEEKLY_MIN = 500000;
  const pct = Math.min(100, Math.round((pool / WEEKLY_MIN) * 100));
  const bar    = document.getElementById('weekly-progress-bar');
  const label  = document.getElementById('weekly-progress-label');
  const status = document.getElementById('weekly-draw-status');
  if (bar)   bar.style.width = pct + '%';
  if (label) label.textContent = fmt(pool) + ' / 500,000 LUNC';
  if (status) {
    if (pool >= WEEKLY_MIN) {
      bar.style.background = 'linear-gradient(90deg,#66ffaa,#00c8ff)';
      bar.style.boxShadow  = '0 0 8px rgba(102,255,170,0.5)';
      status.innerHTML = '<span style="color:#66ffaa;"><svg class="oi oi--green"><use href="#i-check"/></svg> Pool ready - draw will start at 20:00 UTC</span>';
    } else {
      const remaining = fmt(WEEKLY_MIN - pool);
      bar.style.background = 'linear-gradient(90deg,#7C5CFF,#5B8CFF)';
      bar.style.boxShadow  = '0 0 8px rgba(124,92,255,0.5)';
      status.innerHTML = `<span style="color:#6B7AA6;"><svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Need ${remaining} more LUNC · If not reached, funds roll over to next week</span>`;
    }
  }

  // Ensure podium visibility matches current tab
  const podium = document.getElementById('weekly-podium');
  const poolDisplay = document.getElementById('pool-display');
  const weeklyPoolSum = document.getElementById('weekly-pool-summary-card');
  const dailyExtra = document.getElementById('daily-extra');
  const weeklyExtra = document.getElementById('weekly-extra');
  if (currentLottery === 'weekly') {
    if (podium)       podium.style.display       = 'grid';
    if (weeklyPoolSum) weeklyPoolSum.style.display = 'block';
    if (weeklyExtra)  weeklyExtra.style.display   = 'block';
    if (poolDisplay)  poolDisplay.style.display   = 'none';
    if (dailyExtra)   dailyExtra.style.display    = 'none';
  } else {
    if (podium)       podium.style.display        = 'none';
    if (weeklyPoolSum) weeklyPoolSum.style.display = 'none';
    if (weeklyExtra)  weeklyExtra.style.display   = 'none';
    if (poolDisplay)  poolDisplay.style.display   = 'block';
    if (dailyExtra)   dailyExtra.style.display    = 'block';
  }
}



// ─── FORTUNE WHEEL ─────────────────────────────────────────────────────────────
// Cyber/neon style · Addresses on sectors · Auto-spin at draw time only
const ADMIN_WALLET    = 'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6';
const MAX_SECTORS     = 20;

let ticksCanvas   = null;
let ticksCtx      = null;
let wheelDrawnOnce = false;
let adminUnlocked = false;

// Per-participant color palettes — each participant gets unique color
// Tier icon prefixes for labels
const TIER_ICONS = { legendary: 'LEG', rare: 'RARE', common: 'COM', free: 'FREE' };

// 8 distinct participant colors (daily palette)
const PARTICIPANT_COLORS_DAILY = [
  { fill:'rgba(212,160,23,0.35)',  stroke:'#d4a017', text:'#ffe066'  },  // gold
  { fill:'rgba(220,60,60,0.30)',   stroke:'#e05050', text:'#ff9999'  },  // red
  { fill:'rgba(50,200,120,0.28)', stroke:'#32c878', text:'#80ffbb'  },  // green
  { fill:'rgba(160,80,220,0.30)', stroke:'#a050dc', text:'#d499ff'  },  // purple
  { fill:'rgba(230,130,20,0.30)', stroke:'#e68214', text:'#ffbb55'  },  // orange
  { fill:'rgba(20,180,220,0.28)', stroke:'#14b4dc', text:'#66ddff'  },  // cyan
  { fill:'rgba(220,180,20,0.30)', stroke:'#dcb414', text:'#ffee66'  },  // yellow
  { fill:'rgba(220,80,160,0.28)', stroke:'#dc50a0', text:'#ff99dd'  },  // pink
];
// 8 distinct participant colors (weekly palette — cooler tones)
const PARTICIPANT_COLORS_WEEKLY = [
  { fill:'rgba(74,144,217,0.28)',  stroke:'#4a90d9', text:'#99ccff'  },  // blue
  { fill:'rgba(100,200,180,0.25)',stroke:'#64c8b4', text:'#aaffee'  },  // teal
  { fill:'rgba(180,100,220,0.25)',stroke:'#b464dc', text:'#dd99ff'  },  // violet
  { fill:'rgba(220,160,60,0.28)', stroke:'#dca03c', text:'#ffdd88'  },  // amber
  { fill:'rgba(80,180,255,0.22)', stroke:'#50b4ff', text:'#cceeFF'  },  // sky
  { fill:'rgba(220,80,120,0.25)', stroke:'#dc5078', text:'#ff99bb'  },  // rose
  { fill:'rgba(60,220,140,0.22)', stroke:'#3cdc8c', text:'#88ffcc'  },  // mint
  { fill:'rgba(255,140,60,0.25)', stroke:'#ff8c3c', text:'#ffcc88'  },  // peach
];

// Map address → color index (stable across redraws)
const _addrColorMap = new Map();
let _addrColorCounter = 0;
function getParticipantColor(address) {
  if (!address) return { fill:'rgba(80,80,80,0.2)', stroke:'#555', text:'#888' };
  if (!_addrColorMap.has(address)) {
    _addrColorMap.set(address, _addrColorCounter % 8);
    _addrColorCounter++;
  }
  const idx = _addrColorMap.get(address);
  const palette = currentLottery === 'weekly' ? PARTICIPANT_COLORS_WEEKLY : PARTICIPANT_COLORS_DAILY;
  return palette[idx];
}
function getNeonColors() {
  return currentLottery === 'weekly' ? PARTICIPANT_COLORS_WEEKLY : PARTICIPANT_COLORS_DAILY;
}


// ── Draw the wheel ────────────────────────────────────────────────────────────

// ── Spin animation ────────────────────────────────────────────────────────────

// ── Build ticket list for wheel ───────────────────────────────────────────────

// ── Wheel legend — shows participants with color, tier, entries ──────────────

// ── ДАННЫЕ РАУНДА ДЛЯ КОЛЕСА ────────────────────────────────────────────────
// Раньше эта функция строила wheelTickets и рисовала канвас вручную.
// Рисование целиком уехало в assets/js/wheel/. Здесь остались только
// данные и бейджи — колесо V2 забирает их через OracleDrawUI.participants().
let roundParticipants = [];   // [[адрес, билетов, tokenId|null, тир], ...]

function buildRoundParticipants() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const isDaily = currentLottery === 'daily';
  const pairs = [];

  // txhash имеет вид mint:<tokenId>:<i> — по нему группируем билеты
  // одного NFT и достаём его номер.
  //
  // Тир берём из самого билета (t.tier), а НЕ из размера группы:
  // если человек сминтил пять common одной транзакцией, группа из пяти
  // билетов выглядела бы как rare, хотя это пять обычных масок.
  let lastKey = null;
  for (const t of tickets) {
    const m       = /^mint:([^:]+):/.exec(t.txhash || '');
    const key     = m ? 'mint:' + m[1] : (t.txhash || '');
    const tokenId = m ? m[1] : null;
    const last    = pairs[pairs.length - 1];

    if (last && key && key === lastKey && last[0] === t.address) {
      last[1]++;
    } else {
      pairs.push([t.address, 1, tokenId, (t.tier || 'common').toLowerCase()]);
      lastKey = key;
    }
  }

  // Free entries (только weekly и только при наличии платных участников) —
  // так же, как их добавляет addFreeEntries в lottery-draw.js
  if (!isDaily && pairs.length) {
    for (const [addr, e] of Object.entries(freeEntriesData)) {
      const n = (e && e.total) || 0;
      if (n > 0) pairs.push([addr, n, null, 'common']);
    }
  }
  return pairs;
}

/**
 * NFT конкретного кошелька в текущем раунде.
 * Билеты развёрнуты по одному на entry, поэтому группируем по tokenId
 * из txhash вида mint:<tokenId>:<i> и считаем, сколько entries дал каждый.
 */
function roundNftsFor(address) {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const byToken = new Map();

  for (const t of tickets) {
    if (t.address !== address) continue;
    const m  = /^mint:([^:]+):/.exec(t.txhash || '');
    const id = m ? m[1] : (t.txhash || 'unknown');
    if (!byToken.has(id)) {
      byToken.set(id, {
        tokenId: m ? m[1] : null,
        tier:    (t.tier || 'common').toLowerCase(),
        entries: 0,
        time:    t.time || 0
      });
    }
    byToken.get(id).entries++;
  }

  return Array.from(byToken.values())
    .sort((a, b) => b.entries - a.entries || (a.time - b.time));
}

function updateWheelTickets() {
  const tickets  = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const isDaily  = currentLottery === 'daily';
  const currency = 'LUNC';

  roundParticipants = buildRoundParticipants();

  // Бейджи под колесом
  const partEl = document.getElementById('wheel-participant-count');
  const tickEl = document.getElementById('wheel-ticket-count');
  const poolEl = document.getElementById('wheel-pool-display');

  const tiersRef = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
  let realPool = 0;
  const seenTx = new Set();
  for (const t of tickets) {
    if (seenTx.has(t.txhash)) continue;
    seenTx.add(t.txhash);
    if (tiersRef && t.entries) {
      if (t.entries === tiersRef.legendary.entries) realPool += tiersRef.legendary.lunc;
      else if (t.entries === tiersRef.rare.entries) realPool += tiersRef.rare.lunc;
      else realPool += tiersRef.common.lunc;
    } else realPool += LUNC_PER_TICKET;
  }

  const paidAddrs = new Set(tickets.map(t => t.address));
  const hasPaid   = paidAddrs.size > 0;
  const totalFree = (!isDaily && hasPaid)
    ? Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0) : 0;
  const freeOnly  = (!isDaily && hasPaid)
    ? Object.keys(freeEntriesData).filter(w => !paidAddrs.has(w)).length : 0;

  if (partEl) partEl.textContent = (paidAddrs.size + freeOnly) || 0;
  if (tickEl) tickEl.textContent = (tickets.length + totalFree) || 0;
  if (poolEl) poolEl.textContent = fmt(realPool * 0.80) + ' ' + currency;

  const badgeColor = isDaily ? '#f4d03f' : '#7eb8ff';
  if (partEl) { partEl.style.color = badgeColor; }
  if (tickEl) { tickEl.style.color = isDaily ? '#a060ff' : '#cc66ff'; }
  if (poolEl) { poolEl.style.color = '#66ffaa'; }

  // Колесо перестраивает сектора по живым участникам раунда
  if (window.oracleDrawV2 && window.oracleDrawV2.refreshLive) {
    window.oracleDrawV2.refreshLive();
  }
}

// ── Trigger spin (called at draw time OR by admin) ────────────────────────────
// ── ADMIN DEMO SPIN ONLY ─────────────────────────────────────────────────────
// Настоящий розыгрыш ведёт Draw V2 (DrawBridge): сектор ищется по адресу
// победителя из winners.json. Здесь остался только демо-прогон для админа,
// и он честно помечен как демо.

// ── Winner card — единственный писатель карточки результата ──────────────────
// Человекочитаемая дата раунда: '2026-07-27' → '27 Jul 2026'
function drawDateLabel(iso) {
  if (!iso) return null;
  const ts = Date.parse(iso + 'T20:00:00Z');
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

// Показанный результат — от последнего ожидавшегося розыгрыша, или он старше?
// Если старше, значит свежий розыгрыш ещё не записан в winners.json (упал,
// не отработал крон, не доехал коммит). Именно так 3 августа победитель
// недельной давности читался как свежий.
function isStaleRound(iso, pool) {
  if (!iso || !window.DRAW_SCHEDULE) return false;
  const prev = window.DRAW_SCHEDULE.prev(pool === 'weekly' ? 'weekly' : 'daily');
  if (!prev) return false;
  const ts = Date.parse(iso + 'T20:00:00Z');
  if (Number.isNaN(ts)) return false;
  return ts < prev.getTime() - 60000;   // минута допуска
}

function showWinnerCard(data) {
  const card = document.getElementById('wheel-winner-card');
  if (!card) return;
  const a = document.getElementById('ww-address');
  const p = document.getElementById('ww-prize');
  const t = document.getElementById('ww-tx');

  // ── Строка раунда ────────────────────────────────────────────────────────
  // Создаётся здесь, а не в index.html: карточка уже выложена, и лишняя
  // правка разметки означала бы ещё один деплой фронта.
  let r = document.getElementById('ww-round');
  if (!r) {
    r = document.createElement('div');
    r.id = 'ww-round';
    r.style.cssText = 'font-size:11px;letter-spacing:0.08em;margin-bottom:14px;';
    // сразу под шапкой «✦ Winner Selected ✦»
    const head = card.firstElementChild;
    if (head && head.nextSibling) card.insertBefore(r, head.nextSibling);
    else card.appendChild(r);
  }
  // Пул подписывается ВСЕГДА. 3 августа на вкладке Weekly висела карточка
  // daily-раунда, и понять это можно было только разбором winners.json.
  // С подписью подмена видна сразу.
  const pool = (data.pool === 'weekly' || data.pool === 'daily')
    ? data.pool
    : (window.currentLottery === 'weekly' ? 'weekly' : 'daily');
  const poolName  = pool === 'weekly' ? 'Weekly Draw' : 'Daily Draw';
  const poolColor = pool === 'weekly' ? 'rgba(167,139,250,0.95)' : 'rgba(212,160,23,0.95)';

  const label = drawDateLabel(data.date);
  const stale = isStaleRound(data.date, pool);

  const sep  = '<span style="color:var(--muted);opacity:0.45;"> · </span>';
  let html = '<span style="color:' + poolColor + ';font-weight:600;">' + poolName + '</span>';
  if (label) html += sep + '<span style="color:var(--muted);">Round of ' + label + '</span>';
  if (stale) html += '<div style="margin-top:4px;color:rgba(255,180,80,0.95);">' +
                     'Latest draw not recorded yet</div>';
  r.innerHTML = html;
  r.style.display = 'block';

  if (a) a.textContent = data.address || '-';
  if (p) p.textContent = (data.prize ? fmt(data.prize) + ' LUNC' : '-') +
                         (data.label ? ' · ' + data.label : '');
  if (t) {
    t.innerHTML = data.tx
      ? '<a href="https://finder.terraport.finance/mainnet/tx/' + data.tx +
        '" target="_blank" rel="noopener" style="font-size:11px;color:rgba(0,200,255,0.8);">View transaction</a>'
      : (data.label ? '<span style="font-size:11px;color:rgba(167,139,250,0.6);">' + data.label + '</span>' : '');
  }

  card.style.display = 'block';
  card.classList.remove('show');
  void card.offsetWidth;
  card.classList.add('show');
}

function setWheelMsg(msg, sub, color) {
  const m = document.getElementById('wheel-msg');
  const s = document.getElementById('wheel-submsg');
  if (m) { m.innerHTML = msg; m.style.color = color || '#00c8ff'; m.style.textShadow = '0 0 20px '+color+'88'; }
  if (s)   s.innerHTML = sub || '';
}

// ── Auto check draw time (every second) ──────────────────────────────────────
const ENTRY_DEADLINE_MS = 15 * 60 * 1000; // 15 minutes before draw


function updateBurnButtonState(open) {
  // Update burn buttons in My Bag
  document.querySelectorAll('.burn-btn').forEach(btn => {
    btn.disabled = !open;
    btn.style.opacity = open ? '1' : '0.4';
    btn.style.cursor  = open ? 'pointer' : 'not-allowed';
    btn.title = open ? '' : 'Entries closed - draw starting soon';
  });
  // Update buy button state
  const buyBtn = document.getElementById('btn-buy');
  if (buyBtn && !open) {
    buyBtn.style.opacity = '0.5';
    buyBtn.title = 'Round closing - wait for next draw';
  } else if (buyBtn) {
    buyBtn.style.opacity = '1';
    buyBtn.title = '';
  }
}

// Подпись под колесом («Next draw in {t}»). Раньше здесь был свой формат
// «26h 56m», из-за чего одно и то же время выглядело в Treasury как «1d 02:57»,
// а под колесом как «26h 56m» — читалось как расхождение. Теперь общий формат.
function formatDiffShort(ms) {
  return window.DRAW_SCHEDULE.format(ms);
}


// ── BRIDGE FOR DRAW V2 ───────────────────────────────────────────────────────
// Единственная точка, через которую новое ядро трогает старый UI.
window.OracleDrawUI = {
  // Сообщения и карточка — единственное, что колесо просит у страницы
  msg:            function(m, sub, c) { return setWheelMsg(m, sub, c); },
  card:           function(d) { return showWinnerCard(d); },
  entriesOpen:    function(open) { return updateBurnButtonState(open); },
  fmt:            function(v) { return fmt(v); },
  fmtShort:       function(ms) { return formatDiffShort(ms); },

  // Живые участники текущего раунда: [[адрес, билетов, tokenId, тир], ...]
  // Колесо строит из них сектора ДО розыгрыша. После розыгрыша модель
  // берётся из снимка rounds/<round_id>.json — он авторитетен для
  // winner_index, а этот список только предварительный показ.
  participants:   function() { return roundParticipants; },
  walletNfts:     function(addr) { return roundNftsFor(addr); },
  pool:           function() { return currentLottery; },

  wakeOracleEye:  function(on) {
    document.body.classList.toggle('oracle-predraw', !!on);
    if (window.oracleEye && typeof window.oracleEye.wake === 'function') {
      window.oracleEye.wake(!!on);
    }
  }
};
window.loadWinners = loadWinners;

// ── Admin panel wheel demo ────────────────────────────────────────────────────

// ─── VERIFY TICKETS ──────────────────────────────────────────────────────────
function verifyKeplrAddress() {
  // Use any connected wallet address
  const addr = connectedWalletAddress || lotteryAddress;
  if (addr) {
    document.getElementById('verify-input').value = addr;
    verifyTickets();
  } else {
    // No wallet connected — prompt to connect
    alert('Please connect your wallet first.');
  }
}

function verifyTickets() {
  const addr = document.getElementById('verify-input').value.trim();

  const resultEl   = document.getElementById('verify-result');
  const emptyEl    = document.getElementById('verify-empty');
  const notFoundEl = document.getElementById('verify-notfound');

  // Reset
  resultEl.style.display   = 'none';
  emptyEl.style.display    = 'none';
  notFoundEl.style.display = 'none';

  if (!addr || addr.length < 10) {
    emptyEl.style.display = 'block';
    return;
  }

  if (!addr.startsWith('terra1')) {
    emptyEl.innerHTML = '<span style="color:#ff6060;"><svg class="oi oi--amber"><use href="#i-warning"/></svg> Address must start with terra1...</span>';
    emptyEl.style.display = 'block';
    return;
  }

  // Find tickets for this address in both lotteries
  const myDaily  = dailyTickets.filter(t => t.address === addr);
  const myWeekly = weeklyTickets.filter(t => t.address === addr);
  const myTickets = currentLottery === 'daily' ? myDaily : myWeekly;
  const allTickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;

  if (myTickets.length === 0) {
    notFoundEl.style.display = 'block';
    return;
  }

  // Free entries from GitHub JSON
  const myFreeData = getFreeEntries(addr);
  const myFreeTotal = myFreeData.total;

  // Calculate win chance (paid + free entries)
  const totalFreeAll = Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0);
  const totalTix = allTickets.length + totalFreeAll;
  const myTix    = myTickets.length + myFreeTotal;
  const chance   = totalTix > 0 ? ((myTix / totalTix) * 100).toFixed(2) : '0.00';

  // Pool prize
  const isDaily = currentLottery === 'daily';
  const pricePerTix = isDaily ? LUNC_PER_TICKET : weeklyTicketPrice();
  const poolPrize = totalTix * pricePerTix * 0.80;
  const currency  = 'LUNC';

  // Render summary cards
  document.getElementById('verify-cards').innerHTML = `
    <div style="background:rgba(212,160,23,0.06);border:1px solid rgba(212,160,23,0.15);
      border-radius:10px;padding:16px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:28px;font-weight:700;color:var(--gold-light);">${myTix}</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Your Tickets
      </div>
    </div>
    <div style="background:rgba(102,255,170,0.06);border:1px solid rgba(102,255,170,0.15);
      border-radius:10px;padding:16px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:28px;font-weight:700;color:#66ffaa;">${chance}%</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Win Chance
      </div>
    </div>
    <div style="background:rgba(74,144,217,0.06);border:1px solid rgba(74,144,217,0.15);
      border-radius:10px;padding:16px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:20px;font-weight:700;color:#7eb8ff;">${fmt(poolPrize)}</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Prize If Win (${currency})
      </div>
    </div>
    ${myFreeTotal > 0 ? `
    <div style="background:rgba(102,255,170,0.04);border:1px solid rgba(102,255,170,0.15);
      border-radius:10px;padding:16px;text-align:center;grid-column:1/-1;">
      <div style="font-family:'Cinzel',serif;font-size:22px;font-weight:700;color:#66ffaa;">${myFreeTotal}</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Free Entries (Oracle protocol)
      </div>
      <div style="font-size:10px;color:rgba(102,255,170,0.5);margin-top:4px;">
        ${myFreeData.chat} from chat · ${myFreeData.questions} from questions
      </div>
    </div>` : ''}
  `;

  // Render TX list - deduplicated by txhash
  const uniqueTxs = [];
  const seen = new Set();
  for (const t of myTickets) {
    if (!seen.has(t.txhash)) {
      seen.add(t.txhash);
      const count = myTickets.filter(x => x.txhash === t.txhash).length;
      uniqueTxs.push({ ...t, count });
    }
  }

  const txRows = uniqueTxs.map(tx => {
    const d = new Date(tx.time * 1000);
    const dateStr = d.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    const explorerUrl = `https://finder.terraport.finance/mainnet/tx/${tx.txhash}`;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:12px 14px;border-bottom:1px solid rgba(42,24,0,0.5);font-size:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="background:rgba(212,160,23,0.1);color:var(--gold-light);
            border-radius:4px;padding:3px 8px;font-family:'Cinzel',serif;font-size:11px;">
            ×${tx.count}
          </span>
          <span style="color:var(--muted);">${dateStr}</span>
        </div>
        <a href="${explorerUrl}" target="_blank"
          style="font-family:monospace;font-size:11px;color:var(--gold-dim);text-decoration:none;
            transition:color 0.2s;"
          onmouseover="this.style.color='var(--gold-light)'"
          onmouseout="this.style.color='var(--gold-dim)'">
          ${tx.txhash.slice(0,12)}...${tx.txhash.slice(-6)} <svg class="oi oi--cyan"><use href="#i-link"/></svg>
        </a>
      </div>
    `;
  }).join('');

  document.getElementById('verify-txlist').innerHTML = `
    <div style="border:1px solid rgba(42,24,0,0.8);border-radius:8px;overflow:hidden;">
      <div style="padding:10px 14px;background:rgba(212,160,23,0.04);
        font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);
        border-bottom:1px solid rgba(42,24,0,0.5);">
        Registered Transactions - ${totalTix} total tickets in this round
      </div>
      ${txRows}
    </div>
    <div style="text-align:center;margin-top:12px;font-size:11px;color:var(--muted);">
      All transactions verified on-chain · Draw at 20:00 UTC
    </div>
  `;

  resultEl.style.display = 'block';
}


// ─── DRAW VERIFICATION ───────────────────────────────────────────────────────
function populateDrawVerifySelect() {
  const sel = document.getElementById('dv-round-select');
  if (!sel) return;

  // Keep first placeholder option
  sel.innerHTML = '<option value="" style="background:#110a00;">- Select a completed round -</option>';

  const completed = winnersData.filter(function(w){return w.winner || (w.winners && w.winners.length > 0);});
  if (!completed.length) {
    document.getElementById('dv-empty').style.display = 'block';
    document.getElementById('dv-result').style.display = 'none';
    return;
  }

  completed.forEach((w, i) => {
    const d = new Date(w.time * 1000);
    const dateStr = d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const badge = w.type === 'daily' ? '<svg class="oi oi--gold"><use href="#i-reels"/></svg> Daily' : '<svg class="oi oi--gold"><use href="#i-trophy"/></svg> Weekly';
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${badge} · Round #${w.round} · ${dateStr}`;
    opt.style.background = '#110a00';
    sel.appendChild(opt);
  });
}

async function loadDrawVerify() {
  const sel = document.getElementById('dv-round-select');
  const idx = sel.value;
  const resultEl = document.getElementById('dv-result');
  const emptyEl  = document.getElementById('dv-empty');

  if (idx === '') {
    resultEl.style.display = 'none';
    emptyEl.style.display  = 'block';
    return;
  }

  const completed = winnersData.filter(function(w){return w.winner || (w.winners && w.winners.length > 0);});
  const w = completed[parseInt(idx)];
  if (!w) return;

  emptyEl.style.display  = 'none';
  resultEl.style.display = 'block';

  const isDaily    = w.type === 'daily';
  const currency   = 'LUNC';
  const blockHash  = w.drawBlockHash || 'N/A (pre-upgrade draw)';
  const ticketCount = w.tickets;
  const blockHeight = w.drawBlock;

  // Recalculate winner index client-side using SubtleCrypto (SHA256)
  let recalcIdx = null;
  let seedHex   = null;
  if (w.drawBlockHash) {
    try {
      const seedStr = `${blockHeight}:${blockHash}:${ticketCount}`;
      const enc     = new TextEncoder().encode(seedStr);
      const hashBuf = await crypto.subtle.digest('SHA-256', enc);
      seedHex       = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
      // BigInt modulo
      recalcIdx     = Number(BigInt('0x' + seedHex) % BigInt(ticketCount));
    } catch(e) { console.warn('SHA256 recalc failed:', e); }
  }

  // Input data cards
  document.getElementById('dv-inputs').innerHTML = `
    <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(42,24,0,0.8);border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Block Height</div>
      <div style="font-family:monospace;color:var(--gold-light);font-size:13px;">${blockHeight}</div>
    </div>
    <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(42,24,0,0.8);border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Ticket Count</div>
      <div style="font-family:monospace;color:var(--gold-light);font-size:13px;">${ticketCount}</div>
    </div>
    <div style="grid-column:1/-1;background:rgba(0,0,0,0.3);border:1px solid rgba(42,24,0,0.8);border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Block Hash</div>
      <div style="font-family:monospace;color:var(--gold-light);font-size:12px;word-break:break-all;">${blockHash}</div>
    </div>
  `;

  // Formula display
  const shortHash = blockHash.length > 16 ? blockHash.slice(0,16) + '...' : blockHash;
  document.getElementById('dv-formula').innerHTML = seedHex
    ? `seed&nbsp;&nbsp;&nbsp;= SHA256("<span style="color:#ffaa44;">${blockHeight}:${shortHash}:${ticketCount}</span>")<br>
       seed&nbsp;&nbsp;&nbsp;= <span style="color:#aaffcc;">${seedHex.slice(0,32)}...</span><br>
       winner = BigInt(seed) % ${ticketCount}<br>
       winner = <span style="color:var(--gold-light);font-size:14px;font-weight:700;">${recalcIdx}</span>`
    : `seed&nbsp;&nbsp;&nbsp;= SHA256("${blockHeight}:${blockHash}:${ticketCount}")<br>
       winner = BigInt(seed) % ${ticketCount}<br>
       <span style="color:var(--muted);">(blockHash not available for this round)</span>`;

  // Winner card
  const d = new Date(w.time * 1000);
  const dateStr = d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const matchIcon = recalcIdx !== null
    ? (recalcIdx === (w.winnerIndex || recalcIdx) ? '<svg class="oi oi--green"><use href="#i-check"/></svg>' : '<svg class="oi oi--amber"><use href="#i-warning"/></svg>')
    : '-';

  document.getElementById('dv-winner-card').innerHTML = `
    <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:10px;"><svg class="oi oi--gold"><use href="#i-trophy"/></svg> Winner</div>
    <div style="font-family:monospace;font-size:14px;color:var(--gold-light);margin-bottom:8px;word-break:break-all;">${w.winner}</div>
    <div style="display:flex;justify-content:center;gap:24px;margin-top:12px;flex-wrap:wrap;">
      <span style="font-size:12px;color:#66ffaa;">Prize: ${fmt(w.prize)} ${currency}</span>
      <span style="font-size:12px;color:var(--muted);">Ticket index: #${recalcIdx !== null ? recalcIdx : '-'}</span>
      <span style="font-size:12px;color:var(--muted);">${dateStr}</span>
    </div>
    <div style="margin-top:10px;font-size:11px;color:${recalcIdx !== null ? '#66ffaa' : 'var(--muted)'};">
      ${recalcIdx !== null ? matchIcon + ' Client-side recalculation matches draw result' : '- Legacy draw (no blockHash recorded)'}
    </div>
    ${w.txHashes?.winner ? `<a href="https://finder.terraport.finance/mainnet/tx/${w.txHashes.winner}" target="_blank"
      style="display:inline-block;margin-top:10px;font-size:11px;color:var(--gold-dim);text-decoration:none;">
      <svg class="oi oi--cyan"><use href="#i-link"/></svg> Payout TX: ${w.txHashes.winner.slice(0,16)}...</a>` : ''}
  `;

  // Code snippet for manual verification
  document.getElementById('dv-code-snippet').textContent =
    `crypto.subtle.digest('SHA-256', new TextEncoder().encode('${blockHeight}:${blockHash}:${ticketCount}'))`;
}


// ─── ADMIN PANEL - Keplr wallet auth ────────────────────────────────────────
function initAdminTrigger() {
  // Opens admin login if URL contains ?admin
  if (new URLSearchParams(window.location.search).has('admin')) {
    openAdminLogin();
  }
}

function openAdminLogin() {
  const el = document.getElementById('admin-login');
  el.style.display = 'flex';
  document.getElementById('admin-login-status').textContent = '';
  document.getElementById('admin-connect-btn').innerHTML  = '<svg class="oi oi--gold"><use href="#i-key"/></svg> Connect Keplr';
}

function closeAdminLogin() {
  document.getElementById('admin-login').style.display = 'none';
}

async function connectAdminKeplr() {
  const statusEl = document.getElementById('admin-login-status');
  const btnEl    = document.getElementById('admin-connect-btn');

  if (!window.keplr) {
    statusEl.style.color = '#ff3c78';
    statusEl.innerHTML = '<svg class="oi oi--amber"><use href="#i-warning"/></svg> Keplr not found - install Keplr extension';
    return;
  }

  try {
    btnEl.innerHTML    = '<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Connecting...';
    statusEl.textContent = '';
    statusEl.style.color = 'var(--muted)';

    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const accounts      = await offlineSigner.getAccounts();
    const addr          = accounts[0].address;

    if (addr === ADMIN_WALLET) {
      adminUnlocked = true;
      closeAdminLogin();
      toggleAdminPanel();
    } else {
      // Wrong wallet - show error
      statusEl.style.color = '#ff3c78';
      statusEl.textContent = '✕ Access denied - wrong wallet';
      btnEl.innerHTML    = '<svg class="oi oi--gold"><use href="#i-key"/></svg> Connect Keplr';
      // Briefly flash red border on modal
      const modal = document.querySelector('#admin-login > div');
      if (modal) {
        modal.style.borderColor = 'rgba(255,60,120,0.6)';
        setTimeout(() => { modal.style.borderColor = 'rgba(0,200,255,0.25)'; }, 1500);
      }
    }
  } catch(e) {
    statusEl.style.color = '#ff9944';
    statusEl.innerHTML = '<svg class="oi oi--amber"><use href="#i-warning"/></svg> ' + escHTML(e.message || 'Connection failed');
    btnEl.innerHTML    = '<svg class="oi oi--gold"><use href="#i-key"/></svg> Connect Keplr';
  }
}

function toggleAdminPanel() {
  const panel = document.getElementById('admin-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  updateAdminStats();
}

function updateAdminStats() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const countEl = document.getElementById('admin-ticket-count');
  const refEl   = document.getElementById('admin-last-refresh');
  if (countEl) countEl.textContent = tickets.length;
  if (refEl)   refEl.textContent   = new Date().toLocaleTimeString('en-GB');
}


// ─── WALLET CONNECT ──────────────────────────────────────────────────────────
let connectedWalletAddress = null;

// ── Global API constants (must be declared before any function uses them) ──
// NFT_API_BASE / DRAW_WORKER moved to top of file (TDZ fix)
const DAILY_WALLET_ADDR  = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_WALLET_ADDR = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';

// ── Multi-layered wallet persistence (works around mobile browser quirks) ──
// Mobile Safari/Chrome can clear localStorage between sessions in some modes.
// Try localStorage → sessionStorage → cookie. Read from any source available.
function persistWallet(address, provider) {
  try { localStorage.setItem('walletAddress', address); localStorage.setItem('walletProvider', provider); } catch(e) {}
  try { sessionStorage.setItem('walletAddress', address); sessionStorage.setItem('walletProvider', provider); } catch(e) {}
  try {
    // Cookie fallback — 30 days
    const exp = new Date(Date.now() + 30 * 86400000).toUTCString();
    document.cookie = `oraclewallet=${encodeURIComponent(address)}; expires=${exp}; path=/; SameSite=Lax`;
    document.cookie = `oracleprovider=${encodeURIComponent(provider)}; expires=${exp}; path=/; SameSite=Lax`;
  } catch(e) {}
}
function loadPersistedWallet() {
  let address = null, provider = null;
  try { address = localStorage.getItem('walletAddress'); provider = localStorage.getItem('walletProvider'); } catch(e) {}
  if (!address) {
    try { address = sessionStorage.getItem('walletAddress'); provider = sessionStorage.getItem('walletProvider'); } catch(e) {}
  }
  if (!address) {
    try {
      const m = document.cookie.match(/(?:^|; )oraclewallet=([^;]+)/);
      if (m) address = decodeURIComponent(m[1]);
      const p = document.cookie.match(/(?:^|; )oracleprovider=([^;]+)/);
      if (p) provider = decodeURIComponent(p[1]);
    } catch(e) {}
  }
  return { address, provider };
}
function clearPersistedWallet() {
  try { localStorage.removeItem('walletAddress'); localStorage.removeItem('walletProvider'); } catch(e) {}
  try { sessionStorage.removeItem('walletAddress'); sessionStorage.removeItem('walletProvider'); } catch(e) {}
  try {
    document.cookie = 'oraclewallet=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'oracleprovider=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  } catch(e) {}
}
let walletProvider = null; // 'keplr' | 'station' | 'luncdash'

const TERRA_CHAIN_CONFIG = {
  chainId: 'columbus-5',
  chainName: 'Terra Classic',
  rpc: 'https://terra-classic-rpc.publicnode.com',
  rest: 'https://terra-classic-lcd.publicnode.com',
  bip44: { coinType: 330 },
  bech32Config: {
    bech32PrefixAccAddr: 'terra',
    bech32PrefixAccPub: 'terrapub',
    bech32PrefixValAddr: 'terravaloper',
    bech32PrefixValPub: 'terravaloperpub',
    bech32PrefixConsAddr: 'terravalcons',
    bech32PrefixConsPub: 'terravalconspub',
  },
  currencies: [
    { coinDenom: 'LUNC', coinMinimalDenom: 'uluna', coinDecimals: 6 },
    { coinDenom: 'USTC', coinMinimalDenom: 'uusd', coinDecimals: 6 },
  ],
  feeCurrencies: [{ coinDenom: 'LUNC', coinMinimalDenom: 'uluna', coinDecimals: 6, gasPriceStep: { low: 28.325, average: 28.325, high: 28.325 } }],
  stakeCurrency: { coinDenom: 'LUNC', coinMinimalDenom: 'uluna', coinDecimals: 6 },
};

function walletBtnClick() {
  if (connectedWalletAddress) {
    toggleWalletInfo();
  } else {
    toggleWalletPicker();
  }
}

function toggleWalletPicker() {
  const picker = document.getElementById('wallet-picker');
  const info = document.getElementById('wallet-info');
  info.classList.remove('open');
  picker.classList.toggle('open');
}

function toggleWalletInfo() {
  const info = document.getElementById('wallet-info');
  const picker = document.getElementById('wallet-picker');
  picker.classList.remove('open');
  info.classList.toggle('open');
  if (info.classList.contains('open')) fetchWalletBalances();
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('wallet-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('wallet-picker').classList.remove('open');
    document.getElementById('wallet-info').classList.remove('open');
  }
});

async function connectWallet(provider) {
  document.getElementById('wallet-picker').classList.remove('open');

  if (provider === 'keplr') {
    await connectKeplr();
  } else if (provider === 'station') {
    await connectStation();
  } else if (provider === 'galaxystation') {
    await connectGalaxystation();
  } else if (provider === 'luncdash') {
    promptManualAddress();
  }
}

async function connectKeplr() {
  if (!window.keplr) {
    alert('Keplr extension not found.\nPlease install Keplr: https://www.keplr.app');
    return;
  }
  try {
    try { await window.keplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    if (accounts && accounts[0]) {
      setConnectedWallet(accounts[0].address, 'keplr');
      // Also sync with modal
      lotteryAddress = accounts[0].address;
      const addrDisp = document.getElementById('lottery-addr-display');
      const notConn  = document.getElementById('lottery-not-connected');
      const conn     = document.getElementById('lottery-connected');
      const buyBtn   = document.getElementById('lottery-buy-btn');
      if (addrDisp) addrDisp.textContent = fmtAddr(lotteryAddress);
      if (notConn)  notConn.style.display = 'none';
      if (conn)     conn.style.display    = 'block';
      if (buyBtn)   buyBtn.style.display  = 'block';
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
  } catch(e) {
    console.error('Keplr connect error:', e);
    alert('Could not connect to Keplr: ' + (e.message || e));
  }
}

async function connectStation() {
  // Terra Station injects window.station.keplr (same pattern as Galaxy Station)
  // Fallback: window.station directly if it has enable(), or window.keplr as last resort
  const stationKeplr = window.station?.keplr || (window.station?.enable ? window.station : null);
  if (!stationKeplr) {
    alert('Terra Station wallet not found.\nPlease install Terra Station extension:\nhttps://chrome.google.com/webstore/detail/terra-station/aiifbnbfobpmeekipheeijimdpnlpgpp');
    return;
  }
  try {
    try { await stationKeplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await stationKeplr.enable(CHAIN_ID);
    const offlineSigner = stationKeplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    if (accounts && accounts[0]) {
      setConnectedWallet(accounts[0].address, 'station');
      lotteryAddress = accounts[0].address;
      const addrDisp = document.getElementById('lottery-addr-display');
      const notConn  = document.getElementById('lottery-not-connected');
      const conn     = document.getElementById('lottery-connected');
      const buyBtn   = document.getElementById('lottery-buy-btn');
      if (addrDisp) addrDisp.textContent = fmtAddr(lotteryAddress);
      if (notConn)  notConn.style.display = 'none';
      if (conn)     conn.style.display    = 'block';
      if (buyBtn)   buyBtn.style.display  = 'block';
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
  } catch(e) {
    console.error('Station connect error:', e);
    alert('Could not connect to Terra Station: ' + (e.message || e));
  }
}

async function connectGalaxystation() {
  // Galaxy Station injects window.galaxyStation.keplr (Keplr-compatible API)
  const galaxyKeplr = window.galaxyStation?.keplr || window.galaxyStation;
  if (!galaxyKeplr || !galaxyKeplr.enable) {
    alert('Galaxy Station wallet not found.\nPlease install Galaxy Station extension:\nhttps://chrome.google.com/webstore/detail/galaxy-station/conpajdnokdflbcenodalfifbikfncpa');
    return;
  }
  try {
    try { await galaxyKeplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await galaxyKeplr.enable(CHAIN_ID);
    const offlineSigner = galaxyKeplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    if (accounts && accounts[0]) {
      setConnectedWallet(accounts[0].address, 'galaxystation');
      lotteryAddress = accounts[0].address;
      const addrDisp = document.getElementById('lottery-addr-display');
      const notConn  = document.getElementById('lottery-not-connected');
      const conn     = document.getElementById('lottery-connected');
      const buyBtn   = document.getElementById('lottery-buy-btn');
      if (addrDisp) addrDisp.textContent = fmtAddr(lotteryAddress);
      if (notConn)  notConn.style.display = 'none';
      if (conn)     conn.style.display    = 'block';
      if (buyBtn)   buyBtn.style.display  = 'block';
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
  } catch(e) {
    console.error('Galaxy Station connect error:', e);
    alert('Could not connect to Galaxy Station: ' + (e.message || e));
  }
}

function promptManualAddress() {
  const addr = prompt('Enter your Terra Classic wallet address (terra1...):');
  if (addr && addr.trim().startsWith('terra1') && addr.trim().length >= 40) {
    setConnectedWallet(addr.trim(), 'luncdash');
  } else if (addr !== null) {
    alert('Invalid Terra Classic address. It should start with terra1 and be 44+ characters.');
  }
}

function setConnectedWallet(address, provider) {
  connectedWalletAddress = address;
  // Refresh My Bag if open — DEFERRED via setTimeout(…,0). setConnectedWallet
  // can run during early boot (wallet restore) BEFORE the rest of this file
  // has finished parsing, so calling renderMyBag() synchronously here reached
  // const declarations further down the file while they were still in their
  // temporal-dead-zone ("Cannot access X before initialization" for
  // BAG_CACHE_MAX_AGE_MS, NFT_ID_TO_TIER, etc). Deferring to the next tick
  // guarantees every top-level const is initialized first. try/catch keeps
  // any remaining issue from blocking the wallet UI.
  setTimeout(() => {
    try {
      const bagPage = document.getElementById('page-bag');
      if (bagPage && bagPage.style.display !== 'none') renderMyBag();
    } catch(e) { console.warn('renderMyBag() during setConnectedWallet failed (non-fatal):', e); }
  }, 0);
  walletProvider = provider;

  // Persist across page reloads (multi-layer for mobile browser quirks)
  persistWallet(address, provider);

  // Update button
  const btn = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-btn-label');
  if (btn) btn.classList.add('connected');
  const short = address.slice(0, 8) + '…' + address.slice(-4);
  if (label) label.textContent = short;

  // Update info popover
  const addrEl = document.getElementById('wallet-info-addr');
  const balLunc = document.getElementById('wallet-bal-lunc');
  const balUstc = document.getElementById('wallet-bal-ustc');
  if (addrEl) addrEl.textContent = address;
  if (balLunc) balLunc.textContent = '…';
  if (balUstc) balUstc.textContent = '…';

  fetchWalletBalances();
}

async function fetchWalletBalances() {
  if (!connectedWalletAddress) return;
  try {
    const LCD_BASE = LCD_NODES[0];
    const r = await fetch(`${LCD_BASE}/cosmos/bank/v1beta1/balances/${connectedWalletAddress}?pagination.limit=50`);
    const data = await r.json();
    const balances = data.balances || [];
    const lunc = balances.find(b => b.denom === 'uluna');
    const ustc = balances.find(b => b.denom === 'uusd');
    const luncAmt = lunc ? (parseInt(lunc.amount) / 1e6).toLocaleString('en', {maximumFractionDigits: 2}) : '0';
    const ustcAmt = ustc ? (parseInt(ustc.amount) / 1e6).toLocaleString('en', {maximumFractionDigits: 2}) : '0';
    const balLunc2 = document.getElementById('wallet-bal-lunc');
    const balUstc2 = document.getElementById('wallet-bal-ustc');
    if (balLunc2) balLunc2.textContent = luncAmt;
    if (balUstc2) balUstc2.textContent = ustcAmt;
  } catch(e) {
    const balLunc3 = document.getElementById('wallet-bal-lunc');
    const balUstc3 = document.getElementById('wallet-bal-ustc');
    if (balLunc3) balLunc3.textContent = '-';
    if (balUstc3) balUstc3.textContent = '-';
  }
}

function copyWalletAddress() {
  if (!connectedWalletAddress) return;
  navigator.clipboard.writeText(connectedWalletAddress).then(() => {
    const el = document.getElementById('wallet-info-addr');
    const orig = el.textContent;
    el.textContent = '✓ Copied!';
    setTimeout(() => { el.textContent = orig; }, 1500);
  });
}

function fillWalletAddress() {
  if (!connectedWalletAddress) return;
  // Pre-fill the modal's lottery address state
  lotteryAddress = connectedWalletAddress;
  syncDrawWalletUI(lotteryAddress);
  if (typeof updateBuyBtn === 'function') updateBuyBtn();
  document.getElementById('wallet-info').classList.remove('open');
  openModal();
}

function disconnectWallet() {
  connectedWalletAddress = null;
  lotteryAddress = null;
  walletProvider = null;
  clearPersistedWallet();
  const btn = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-btn-label');
  const info = document.getElementById('wallet-info');
  if (btn) btn.classList.remove('connected');
  if (label) label.textContent = 'Connect Wallet';
  if (info) info.classList.remove('open');
  /* Sync modal wallet UI */
  syncDrawWalletUI(null);
}

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
    if (history.replaceState) history.replaceState({ tab: startTab }, '', '/' + startTab);
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
  // from and back to My Bag (which is confirmed to always work correctly) —
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
  // Отсчёт, фазы и запуск колеса целиком у Draw V2 — старого таймера
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
  // Contract tokens carry their tier explicitly in metadata — no guessing.
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
// Much faster than IPFS gateways — served directly from GitHub Pages / Cloudflare CDN.
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
  // it immediately — no blank/"…" wait. loadMyBagNFTs() then refreshes in
  // the background and silently updates once fresh data arrives.
  const cachedNfts = loadBagCache(wallet, BAG_CACHE_MAX_AGE_MS);
  if (cachedNfts) {
    renderBagFromNFTs(wallet, cachedNfts, { fromCache: true });
  } else {
    // No cache at all — first-ever load for this wallet. Be explicit that
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
  } catch(e) { /* storage full or disabled — ignore */ }
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
      // и новую контрактную коллекцию. Вместо выхода — пустой список, чтобы
      // рендер дошёл и показал контрактные NFT (их подмешиваем ниже).
      allNFTs = [];
    }
  }

  // ── Новая коллекция из собственного контракта ──────────────────────────────
  // Независимо от Paco: если контракт недоступен — вернётся [] и страница
  // отрисуется старой коллекцией; если Paco упал — отрисуется контрактной.
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

  // Filter Oracle Mask only — match all 3 collection slugs (old + new)
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
    // New-architecture NFTs are AUTO-ACTIVE — funds went directly to pool wallet at mint time.
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

  // Fetch wins — count unique rounds won
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

  // Show a "cached" indicator — instant-paint from cache still refreshing,
  // or fallback-to-cache because the live API failed.
  if (usedCache || fromCache) {
    const cnt = el('bag-nft-count');
    if (cnt) cnt.textContent = nfts.length + (fromCache ? ' (refreshing…)' : ' (cached)');
  }

  // History — fetch from Worker /my-history
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
              : `<span style="color:var(--muted);">—</span>`;
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
        // Still proceed — tx is on-chain, Worker can be replayed later via admin tool
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

// ═══ WINNERS v2 ═══════════════════════════════════════════════════════════
// Заменяет mapEntry внутри loadWinners и функцию renderWinners.
//
// Что чинится помимо вида:
//   1. У weekly в «Prize» попадало только ПЕРВОЕ место. У раунда #16 стояло
//      278.0K, хотя выплачено 278.0K + 115.8K = 393.8K. Теперь сумма.
//   2. У weekly терялся winner_index каждого места — из-за этого раздел
//      Verify не с чем было сверять. Теперь переносится.
//   3. Когда у старой записи нет block_height, в «Draw Block» подставлялся
//      кусок хеша — отсюда строки вида i8OQSVnEah8E… Теперь честное «—».
//   4. prize_lunc отсутствует у самых старых раундов → показывалось
//      «0 LUNC», будто никто ничего не выиграл. Теперь «—» и пометка legacy.

// ── маппер записи winners.json → строка списка ────────────────────────────
function mapWinnerEntry(w, type, idx) {
  if (!w || w.skipped) return null;

  var base = {
    type: type,
    round: idx + 1,
    roundId: w.round_id || null,
    tickets: w.entries || 0,
    participants: w.participants || null,
    blockHeight: w.block_height || null,
    blockHash: w.block_hash || null,
    blockTime: w.block_time || null,
    time: w.date ? Math.floor(new Date(w.date + 'T20:00:00Z').getTime() / 1000) : 0,
    legacy: !w.block_height          // до перехода на блок по дедлайну раунда
  };

  // Daily — один победитель
  if (w.winner) {
    base.places = [{
      place: 1,
      address: w.winner,
      amount: w.prize_lunc || w.prize || null,
      index: (w.winner_index !== undefined ? w.winner_index : null),
      tx: w.tx_winner || null
    }];
  }
  // Weekly — сколько мест реально разыграно. Их до трёх: пул делится
  // 48/20/12, но placesCount = min(3, уникальных участников), поэтому
  // при двух участниках мест два. Список строится по факту, без допущений.
  else if (Array.isArray(w.winners) && w.winners.length) {
    base.places = w.winners.map(function (p) {
      return {
        place: p.place,
        address: p.address,
        amount: p.amount_lunc || null,
        index: (p.winner_index !== undefined ? p.winner_index : null),
        tx: p.tx || null
      };
    });
  } else {
    return null;
  }

  // Сумма ВСЕХ выплат раунда, а не первого места
  base.paid = base.places.reduce(function (s, p) { return s + (p.amount || 0); }, 0);

  // ── Совместимость со старой формой записи ────────────────────────────────
  // winnersData читают ещё шесть мест: счётчики розыгрышей (строки 52, 619,
  // 623, 1966), последний победитель daily (811) и раздел Verify (2523, 2554).
  // Все они проверяют `w.winner || w.winners.length` и берут w.tickets,
  // w.drawBlock*, w.winnerIndex. Пока Verify не переписан, старые поля
  // обязаны остаться — иначе разделы молча опустеют.
  base.winner          = base.places[0].address;
  base.prize           = base.places[0].amount || 0;
  base.winnerIndex     = base.places[0].index;
  base.drawBlockHash   = base.blockHash;
  base.drawBlockHeight = base.blockHeight;
  base.drawBlock       = base.blockHeight || '-';
  base.txHashes        = base.places[0].tx ? { winner: base.places[0].tx } : (w.tx_treasury ? { treasury: w.tx_treasury } : null);
  if (type === 'weekly') {
    base.winners      = w.winners;      // ждут именно исходный массив
    base.multiWinners = w.winners;
  }
  return base;
}

// ── сводка над списком ────────────────────────────────────────────────────
function renderWinnersStats(list) {
  var el = document.getElementById('wn-stats');
  if (!el) return;

  var paid = 0, best = 0, wallets = {};
  list.forEach(function (w) {
    paid += w.paid || 0;
    w.places.forEach(function (p) {
      if ((p.amount || 0) > best) best = p.amount || 0;
      if (p.address) wallets[p.address] = 1;
    });
  });

  var cells = [
    [fmt(paid) + ' LUNC', 'total paid out'],
    [String(list.length), 'draws'],
    [fmt(best) + ' LUNC', 'biggest prize'],
    [String(Object.keys(wallets).length), 'winners']
  ];
  el.innerHTML = cells.map(function (c) {
    return '<div class="wn-stat"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
  }).join('');
}

// ── список карточек ───────────────────────────────────────────────────────
function renderWinners() {
  var host = document.getElementById('wn-list');
  if (!host) return;

  var list = winnersData || [];
  if (winnersFilter === 'daily')  list = list.filter(function (w) { return w.type === 'daily'; });
  if (winnersFilter === 'weekly') list = list.filter(function (w) { return w.type === 'weekly'; });

  // На этом сайте адрес лежит в connectedWalletAddress, фолбэк — lotteryAddress
  var me = String(
    (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress) ||
    (typeof lotteryAddress !== 'undefined' && lotteryAddress) || ''
  ).toLowerCase();
  if (winnersFilter === 'mine') {
    list = (winnersData || []).filter(function (w) {
      return w.places.some(function (p) { return (p.address || '').toLowerCase() === me; });
    });
  }

  renderWinnersStats(winnersFilter === 'mine' ? list : (winnersData || []));

  if (!list.length) {
    host.innerHTML = '<div class="wn-empty">' +
      (winnersFilter === 'mine'
        ? 'No wins for this wallet yet.'
        : 'No draws yet - mint your first Oracle Mask.') + '</div>';
    return;
  }

  host.innerHTML = list.slice(0, 60).map(function (w) {
    var isMine = me && w.places.some(function (p) { return (p.address || '').toLowerCase() === me; });

    var places = w.places.map(function (p) {
      var mine = me && (p.address || '').toLowerCase() === me;
      return '<div class="wn-place">' +
        '<span class="wn-medal p' + p.place + '">' + p.place + '</span>' +
        '<span class="wn-addr" title="' + (p.address || '') + '">' + fmtAddr(p.address) + '</span>' +
        (mine ? '<span class="wn-you">you</span>' : '') +
        '<span class="wn-amt">' + (p.amount ? fmt(p.amount) + ' LUNC' : '—') + '</span>' +
        '</div>';
    }).join('');

    var facts = [];
    facts.push('<span class="wn-fact">' + w.tickets + (w.tickets === 1 ? ' entry' : ' entries') + '</span>');
    if (w.participants) facts.push('<span class="wn-fact">' + w.participants +
      (w.participants === 1 ? ' participant' : ' participants') + '</span>');
    if (w.blockHeight) {
      facts.push('<span class="wn-fact"><a href="https://finder.terraport.finance/mainnet/blocks/' +
        w.blockHeight + '" target="_blank" rel="noopener">block #' + w.blockHeight + '</a></span>');
    } else {
      facts.push('<span class="wn-fact" title="Draw made before the deadline-block upgrade">legacy</span>');
    }

    return '<div class="wn-card is-' + w.type + (isMine ? ' is-mine' : '') + '">' +
      '<div class="wn-round"><b>#' + w.round + '</b>' +
        '<span class="wn-chip ' + (w.type === 'daily' ? 'd' : 'w') + '">' +
        (w.type === 'daily' ? 'Daily' : 'Weekly') + '</span></div>' +
      '<div class="wn-places">' + places + '</div>' +
      '<div class="wn-meta">' +
        '<div class="wn-date">' + fmtDate(w.time || 0) + '</div>' +
        '<div class="wn-facts">' + facts.join('') + '</div>' +
        (w.blockHash
          ? '<button class="wn-verify" onclick="openVerifyForRound(\'' + (w.roundId || '') + '\')">verify</button>'
          : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// Переход в раздел проверки с уже выбранным раундом
function openVerifyForRound(roundId) {
  showTab('verify');
  setTimeout(function () {
    var sel = document.getElementById('dv-select');
    if (!sel || !roundId) return;
    for (var i = 0; i < sel.options.length; i++) {
      if ((sel.options[i].dataset && sel.options[i].dataset.roundId) === roundId) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('change'));
        break;
      }
    }
  }, 60);
}

window.openVerifyForRound = openVerifyForRound;

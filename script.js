// ============================================
// BitCraft Market Search v2 - script.js
// ============================================

const API_BASE = 'https://bitcraft-marketvv2.29kiyo.workers.dev/api';

// アイコン画像をキャッシュして再ロードを防ぐ
const iconCache = new Map();
function getCachedIcon(iconAssetName) {
  if (!iconAssetName) return '';
  if (iconCache.has(iconAssetName)) {
    const cached = iconCache.get(iconAssetName);
    iconCache.set(iconAssetName, { url: cached.url, timestamp: Date.now() });
    return cached.url;
  }
  const url = `https://bitjita.com/${iconAssetName}.webp`;
  iconCache.set(iconAssetName, { url, timestamp: Date.now() });
  return url;
}


const HEADERS = { 'x-app-identifier': 'bitcraft-market-vv2' };

// BitCraft Map用のベースURL（座標→マップリンク）
const MAP_BASE = 'https://map.bitcraft.com';

// DOM要素
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const suggestions = document.getElementById('suggestions');
const orderTypeFilter = document.getElementById('orderTypeFilter');
const resultSection = document.getElementById('resultSection');
const emptyState = document.getElementById('emptyState');
const loading = document.getElementById('loading');
const errorMsg = document.getElementById('errorMsg');
const searchResults = document.getElementById('searchResults');
const searchResultsList = document.getElementById('searchResultsList');
const backBtn = document.getElementById('backBtn');



backBtn.addEventListener('click', () => {
  resultSection.classList.add('hidden');
  searchResults.classList.remove('hidden');
  setTimeout(() => window.scrollTo(0, savedScrollPosition), 0);
});

document.getElementById('refreshBtn').addEventListener('click', async () => {
  const item = window._currentItem;
  if (!item) return;
  cachedMarketItems = null;
  fetchPromise = null;
  await loadItemDetail(item);
});

// 状態
let currentItems = [];
let currentPage = 1;
let savedScrollPosition = 0;
let currentOrderPage = 1;
const ORDERS_PER_PAGE = 20;
let currentOrderSort = 'asc';
let currentOrderRegion = '';
let currentOrderClaim = '';

// クラフト機能
let craftMode = false;
let selectedItems = [];
let craftHistory = JSON.parse(localStorage.getItem('craftHistory') || '[]');

let claimDebounceTimer = null;
window.changeOrderClaim = function(claim) {
  clearTimeout(claimDebounceTimer);
  claimDebounceTimer = setTimeout(() => {
    currentOrderClaim = claim;
    renderOrders(currentOrders, orderTypeFilter.value, 1, currentOrderSort, currentOrderRegion, claim);
    const input = document.getElementById('claimSearchInput');
    if (input) {
      input.value = claim;
      input.focus();
      // カーソルを末尾に移動
      input.setSelectionRange(claim.length, claim.length);
    }
  }, 500);
};

window.changeOrderPage = function(page) {
  renderOrders(currentOrders, orderTypeFilter.value, page, currentOrderSort, currentOrderRegion, currentOrderClaim);
};

window.changeOrderSort = function(sort) {
  renderOrders(currentOrders, orderTypeFilter.value, 1, sort, currentOrderRegion, currentOrderClaim);
};

window.changeOrderType = function(type) {
  orderTypeFilter.value = type;
  renderOrders(currentOrders, type, 1, currentOrderSort, currentOrderRegion, currentOrderClaim);
};

window.changeOrderRegion = function(region) {
  currentOrderRegion = region;
  renderOrders(currentOrders, orderTypeFilter.value, 1, currentOrderSort, region, currentOrderClaim);
};

const ITEMS_PER_PAGE = 20;
let currentOrders = [];

// マルチセレクト管理
function getCheckedValues(type) {
  const dropdown = document.getElementById(`${type}Dropdown`);
  if (!dropdown) return [];
  return [...dropdown.querySelectorAll('input[type=checkbox]:not([value=all]):checked')]
    .map(cb => cb.value);
}

function toggleDropdown(id) {
  const dropdown = document.getElementById(id);
  dropdown.classList.toggle('hidden');
}

function toggleParentCategory(el) {
  el.classList.toggle('open');
  el.nextElementSibling.classList.toggle('open');
}

function updateMultiLabel(type) {
  const values = getCheckedValues(type);
  const label = document.getElementById(`${type}Label`);
  if (!label) return;
  if (values.length === 0) {
    label.textContent = 'すべて';
  } else {
    label.textContent = `${values.length}件選択中`;
  }
  applyFilters();
}

function handleMultiAll(type, cb) {
  const dropdown = document.getElementById(`${type}Dropdown`);
  if (!dropdown) return;
  const checkboxes = [...dropdown.querySelectorAll('input[type=checkbox]:not([value=all])')];
  checkboxes.forEach(c => c.checked = false);
  cb.checked = false;
  updateMultiLabel(type);
}

// ドロップダウン外クリックで閉じる
document.addEventListener('click', e => {
  if (!e.target.closest('.search-box')) hideSuggestions();
  if (!e.target.closest('.multi-select-wrap')) {
    document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.add('hidden'));
  }
});

let accumulatedTrades = [];
const MAX_TRADES = 50;
let debounceTimer = null;

let cachedMarketItems = { data: null, timestamp: 0 };
let fetchPromise = null;

async function fetchAllMarketItems() {
  if (cachedMarketItems.data) {
    // キャッシュが1時間未満なら使用
    if (Date.now() - cachedMarketItems.timestamp < 3600000) {
      return cachedMarketItems.data;
    }
    // キャッシュ期限切れならリセット
    cachedMarketItems = { data: null, timestamp: 0 };
  }
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    // offsetが効かない場合があるので固定で大きめに1回取得
    const res = await fetch(
      `${API_BASE}/market?hasOrders=true&limit=2000`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error('fetch failed');
    const json = await res.json();
    const items = json?.data?.items || [];
    cachedMarketItems = { data: items, timestamp: Date.now() };
    fetchPromise = null;
    return items;
  })();

  return fetchPromise;
}



// ============================================
// 検索オートサジェスト
// ============================================
async function onSearchInput() {
  const q = searchInput.value.trim();
  if (q.length < 2) { hideSuggestions(); return; }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // タイムアウト時に最新の値を取得
    const latestQ = searchInput.value.trim();
    fetchSuggestions(latestQ);
  }, 500);
}

async function fetchSuggestions(q) {
  try {
    const allItems = await fetchAllMarketItems();
    const hasJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(q);
    
    let filtered = [];
    
    if (hasJapanese) {
      // 日本語の場合：マッチする全ての翻訳候補で検索
      const matchedEn = new Set();
      // 読み仮名（ひらがな・カタカナ）検索も追加
const yomiMatched = searchByYomi(q);
yomiMatched.forEach(en => matchedEn.add(en));
      const sorted = Object.entries(ITEM_TRANSLATIONS).sort((a, b) => b[0].length - a[0].length);
      for (const [ja, en] of sorted) {
        if (ja.includes(q) || q.includes(ja) ||
    toHiragana(ja).includes(toHiragana(q)) || toHiragana(q).includes(toHiragana(ja))) {
          matchedEn.add(en.toLowerCase());
        }
      }
      
      if (matchedEn.size > 0) {
        filtered = allItems.filter(item => {
          const name = item.name.toLowerCase();
          for (const en of matchedEn) {
            if (name.includes(en)) return true;
          }
          return false;
        });
      }
    } else {
      // 英語の場合：そのまま検索
      filtered = allItems.filter(item =>
        item.name.toLowerCase().includes(q.toLowerCase())
      );
    }

    filtered = filtered.slice(0, 8);
    if (filtered.length === 0) { hideSuggestions(); return; }
    showSuggestions(filtered);
  } catch(err) { 
    console.error('fetchSuggestions error:', err);
    hideSuggestions(); 
  }
}

function showSuggestions(items) {
  suggestions.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    const jaName = getJaName(item.name);
const iconUrl = getCachedIcon(item.iconAssetName);
// 日本語名が英語名より短すぎる場合（プレフィックスのみ）は使わない
const useJaName = jaName && jaName.length > 2 && item.name.toLowerCase() !== jaName.toLowerCase();

div.innerHTML = `
  <img class="s-icon" src="${iconUrl}" alt="${item.name}" onerror="this.style.display='none'">
  <div class="s-text">
    <span class="s-name">${useJaName ? jaName : item.name}</span>
    <span class="s-sub">${useJaName ? item.name : ''}</span>
  </div>
  ${item.tier && item.tier > 0 ? `<span class="s-tier">T${item.tier}</span>` : ''}
  <span class="s-rarity rarity-${item.rarityStr?.toLowerCase()}">${item.rarityStr || ''}
  ${item.tag ? `<span class="s-tag">${getJaName(item.tag) || item.tag}</span>` : ''}</span>
`;
    div.addEventListener('click', () => {
      searchInput.value = item.name;
      hideSuggestions();
      doSearch();
    });
    suggestions.appendChild(div);
  });
  suggestions.classList.remove('hidden');
}

function hideSuggestions() {
  suggestions.classList.add('hidden');
}

// ============================================
// メイン検索
// ============================================
async function doSearch() {
  const q = searchInput.value.trim();

  // 検索ワードが変わったときだけフィルターをクリア
  if (q !== window._lastSearchQuery) {
    document.querySelectorAll('#tierDropdown input[type=checkbox]').forEach(cb => cb.checked = false);
    document.getElementById('tierLabel').textContent = 'すべて';
    document.querySelectorAll('#rarityDropdown input[type=checkbox]').forEach(cb => cb.checked = false);
    document.getElementById('rarityLabel').textContent = 'すべて';
    document.querySelectorAll('#categoryDropdown input[type=checkbox]').forEach(cb => cb.checked = false);
    document.getElementById('categoryLabel').textContent = 'すべて';
    document.getElementById('orderTypeFilter').value = '';
    window._lastSearchQuery = q;
  }
  const tiers = getCheckedValues('tier');
  const rarities = getCheckedValues('rarity');
  const categories = getCheckedValues('category');

  // フィルター条件がない場合、検索されていない状態に戻る
  const orderType = orderTypeFilter.value;
  const isOrderTypeFilterEmpty = orderType === '';
  const isCategoryFilterEmpty = categories.length === 0 || categories.every(cat => cat.startsWith('__group__'));
  if (!q && tiers.length === 0 && rarities.length === 0 && isOrderTypeFilterEmpty && isCategoryFilterEmpty) {
    currentItems = [];
    searchResults.classList.add('hidden');
    resultSection.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  hideSuggestions();
  showLoading();
  clearError();

  try {
    const allItems = await fetchAllMarketItems();
    const hasJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(q);

    // タグの修正
    const items = allItems.map(item => {
      const newItem = { ...item };
      if (item.name === "Hunter's Goat Lead") {
        newItem.tag = "Hunter Tool";
      } else if (item.tag === "Journal") {
        newItem.tag = "Study Journal";
      }
      return newItem;
    });

    let filtered = items;

    // 検索ワードがある場合のみ名前フィルタリング
    if (q) {
      if (hasJapanese) {
        const matchedEn = new Set();
        // 読み仮名（ひらがな・カタカナ）検索も追加
const yomiMatched = searchByYomi(q);
yomiMatched.forEach(en => matchedEn.add(en));
        const sorted = Object.entries(ITEM_TRANSLATIONS).sort((a, b) => b[0].length - a[0].length);
        for (const [ja, en] of sorted) {
          if (ja.includes(q) || q.includes(ja) ||
    toHiragana(ja).includes(toHiragana(q)) || toHiragana(q).includes(toHiragana(ja))) matchedEn.add(en.toLowerCase());
        }
        if (matchedEn.size > 0) {
          filtered = filtered.filter(item => {
            const name = item.name.toLowerCase();
            for (const en of matchedEn) {
              if (name.includes(en)) return true;
            }
            return false;
          });
        }
      } else {
        filtered = filtered.filter(item =>
          item.name.toLowerCase().includes(q.toLowerCase())
        );
      }
    }

    if (tiers.length > 0) {
  filtered = filtered.filter(item => tiers.includes(String(item.tier)));
}
if (rarities.length > 0) {
  filtered = filtered.filter(item => rarities.includes(String(item.rarity)));
}
if (categories.length > 0) {
  const allTags = new Set();
  const select = document.getElementById('categoryDropdown');
  categories.forEach(cat => {
    if (cat.startsWith('__group__')) {
      const options = [...document.querySelectorAll(`#categoryDropdown input[type=checkbox]`)];
      const groupIdx = options.findIndex(o => o.value === cat);
      for (let i = groupIdx + 1; i < options.length; i++) {
        if (options[i].value.startsWith('__group__')) break;
        allTags.add(options[i].value);
      }
    } else {
      allTags.add(cat);
    }
  });
  filtered = filtered.filter(item => allTags.has(item.tag));
}

    currentItems = filtered;

    if (currentItems.length === 0) {
      showError('アイテムが見つかりませんでした。別のキーワードで試してください。');
      return;
    }

  
    currentPage = 1;
    renderSearchResults(currentItems, currentPage);

  } catch (err) {
    showError(`エラーが発生しました: ${err.message}`);
    console.error(err);
  } finally {
    hideLoading();
  }
}
function renderSearchResults(items, page = 1) {
  hideSuggestions();
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const pageItems = items.slice(start, end);

  searchResultsList.innerHTML = `
    <h3 class="section-title">🔍 検索結果 <span class="order-count">${items.length}件</span></h3>
    ${totalPages > 1 ? `
  <div class="pagination">
    <button class="page-btn" onclick="changePage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>← 前へ</button>
    <span class="page-info">${page} / ${totalPages}</span>
    <button class="page-btn" onclick="changePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>次へ →</button>
  </div>
` : ''}

    <div class="result-grid">
      ${pageItems.map(item => {
        const iconUrl = getCachedIcon(item.iconAssetName);
        const jaName = getJaName(item.name);
        const useJaName = jaName && jaName.length > 2;
        const isSelected = selectedItems.some(si => si.id === item.id);
        return `
          <div class="result-card" onclick="selectItem('${item.id}')">
            ${craftMode ? `
              <div class="craft-checkbox" onclick="event.stopPropagation()">
                <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleCraftItem('${item.id}', this.checked)">
              </div>
            ` : ''}
            <img class="rc-icon" src="${iconUrl}" alt="${item.name}" onerror="this.style.display='none'">
            <div class="rc-info">
              <div class="rc-name">${useJaName ? jaName : item.name}</div>
              ${useJaName ? `<div class="rc-sub">${item.name}</div>` : ''}
            </div>
            <div class="rc-badges">
              ${item.tier && item.tier > 0 ? `<span class="badge tier">T${item.tier}</span>` : ''}
              <span class="s-rarity rarity-${item.rarityStr?.toLowerCase()}">${item.rarityStr || ''}
              ${item.tag ? `<span class="s-tag">${getJaName(item.tag) || item.tag}</span>` : ''}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    ${totalPages > 1 ? `
      <div class="pagination">
        <button class="page-btn" onclick="changePage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>← 前へ</button>
        <span class="page-info">${page} / ${totalPages}</span>
        <button class="page-btn" onclick="changePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>次へ →</button>
      </div>
    ` : ''}
  `;

  searchResults.classList.remove('hidden');
  resultSection.classList.add('hidden');
  emptyState.classList.add('hidden');
}

window.selectItem = async function(itemId) {
  const item = currentItems.find(i => i.id === itemId);
  if (!item) return;
  savedScrollPosition = window.scrollY;
  searchResults.classList.add('hidden');
  await loadItemDetail(item);
};

window.changePage = function(page) {
  currentPage = page;
  renderSearchResults(currentItems, currentPage);
  window.scrollTo(0, 0);
};
// ============================================
// アイテム詳細取得
// ============================================
async function loadItemDetail(item) {
  showLoading();
  try {
    const orderType = orderTypeFilter.value;
    const itemOrCargo = item.itemType === 1 ? 'cargo' : 'item';

    const [marketRes, priceRes] = await Promise.all([
      fetch(`${API_BASE}/market/${itemOrCargo}/${item.id}`, { headers: HEADERS }),
      fetch(`${API_BASE}/market/${itemOrCargo}/${item.id}/price-history?bucket=1+day&limit=7`, { headers: HEADERS })
    ]);

    const marketData = marketRes.ok ? await marketRes.json() : null;
    const priceData = priceRes.ok ? await priceRes.json() : null;

    currentOrders = [];

    if (marketData) {
      const sells = (marketData.sellOrders || []).map(o => ({ ...o, orderType: 'sell' }));
      const buys = (marketData.buyOrders || []).map(o => ({ ...o, orderType: 'buy' }));
      currentOrders = [...sells, ...buys];
    }

    const enrichedItem = {
      ...item,
      lowestSellPrice: marketData?.stats?.lowestSell,
      highestBuyPrice: marketData?.stats?.highestBuy,
      itemOrCargo,
    };

    // 現在のアイテムを保存（期間切り替え用）
    window._currentItem = enrichedItem;


    renderResult(enrichedItem, priceData, currentOrders, orderType);
  } catch (err) {
    showError(`詳細取得エラー: ${err.message}`);
    console.error(err);
  } finally {
    hideLoading();
  }
}

// ============================================
// フィルター適用
// ============================================
function applyFilters() {
  doSearch();
}

// ============================================
// 描画
// ============================================
function renderResult(item, priceData, orders, orderType) {
  renderItemHeader(item);
  renderPriceSummary(item, priceData);
  renderPriceChart(priceData);
  renderSupplyDemand(orders);
  renderOrders(orders, orderType);
  renderTradeLog(priceData); // 追加

  resultSection.classList.remove('hidden');
  emptyState.classList.add('hidden');
  updatePriceByRegion();
}

function renderItemHeader(item) {
  const jaName = getJaName(item.name);
  const useJaName = jaName && jaName.length > 2;
  const iconUrl = getCachedIcon(item.iconAssetName);

  let itemHeaderEl = document.getElementById('itemHeader');
  if (!itemHeaderEl) {
    // 要素が存在しない場合は作成
    itemHeaderEl = document.createElement('div');
    itemHeaderEl.id = 'itemHeader';
    itemHeaderEl.className = 'item-header';
    resultSection.appendChild(itemHeaderEl);
  }
  itemHeaderEl.innerHTML = `
    <div class="item-title">
      <img class="item-icon" src="${iconUrl}" alt="${item.name}" onerror="this.style.display='none'">
      <div class="item-title-text">
        <h2>${useJaName ? jaName : item.name}${useJaName ? ` <span class="item-ja">/ ${item.name}</span>` : ''}</h2>
        <div class="item-badges">
          ${item.tier && item.tier > 0 ? `<span class="badge tier">Tier ${item.tier}</span>` : ''}
          <span class="s-rarity rarity-${item.rarityStr?.toLowerCase()}">${item.rarityStr || ''}</span>
        </div>
      </div>
    </div>
  `;
}

function renderPriceSummary(item, priceData) {
  const stats = priceData?.priceStats || {};
  const lowestSell = item.lowestSellPrice ?? stats.allTimeLow ?? '—';
  const highestBuy = item.highestBuyPrice ?? '—';
  const avg24h = stats.avg24h ?? '—';
  const avg7d = stats.avg7d ?? '—';
  const volume24h = priceData?.priceData?.[0]?.volume ?? 0;
  const change24h = stats.priceChange24h;
  const change7d = stats.priceChange7d;

  const changeHtml = change24h != null
    ? `<span class="${change24h >= 0 ? 'pos' : 'neg'}">${change24h >= 0 ? '▲' : '▼'} ${Math.abs(change24h).toFixed(1)}%</span>`
    : '';
  const change7dHtml = change7d != null
    ? `<span class="${change7d >= 0 ? 'pos' : 'neg'}">${change7d >= 0 ? '▲' : '▼'} ${Math.abs(change7d).toFixed(1)}%</span>`
    : '';

  const regions = [...new Set(currentOrders.map(o => o.regionName).filter(Boolean))].sort();
  const regionOptions = regions.map(r => {
    const rid = currentOrders.find(o => o.regionName === r)?.regionId || '';
    return `<option value="${r}">${r} (R${rid})</option>`;
  }).join('');

  let priceSummaryEl = document.getElementById('priceSummary');
  if (!priceSummaryEl) {
    priceSummaryEl = document.createElement('div');
    priceSummaryEl.id = 'priceSummary';
    priceSummaryEl.className = 'price-summary';
    resultSection.appendChild(priceSummaryEl);
  }
  priceSummaryEl.innerHTML = `
    <h3 class="section-title">💰 価格情報</h3>
    <div class="price-region-filter">
      <select id="priceRegionFilter" onchange="updatePriceByRegion()">
        <option value="">全リージョン</option>
        ${regionOptions}
      </select>
    </div>
    <div class="price-cards">
      <div class="price-card sell">
        <div class="pc-label">最低売値</div>
        <div class="pc-value" id="pcLowestSell">${formatPrice(lowestSell)}</div>
        <div class="pc-sub">Lowest Sell</div>
      </div>
      <div class="price-card buy">
        <div class="pc-label">最高買値</div>
        <div class="pc-value" id="pcHighestBuy">${formatPrice(highestBuy)}</div>
        <div class="pc-sub">Highest Buy</div>
      </div>
      <div class="price-card avg-sell">
        <div class="pc-label">平均売値</div>
        <div class="pc-value" id="pcAvgSell">—</div>
        <div class="pc-sub">Avg Sell</div>
      </div>
      <div class="price-card avg-buy">
        <div class="pc-label">平均買値</div>
        <div class="pc-value" id="pcAvgBuy">—</div>
        <div class="pc-sub">Avg Buy</div>
      </div>
      <div class="price-card avg">
        <div class="pc-label">24h平均</div>
        <div class="pc-value" id="pcAvg24h">${formatPrice(avg24h)} ${changeHtml}</div>
        <div class="pc-sub">24h Average</div>
      </div>
      <div class="price-card avg7">
        <div class="pc-label">7日平均</div>
        <div class="pc-value" id="pcAvg7d">${formatPrice(avg7d)} ${change7dHtml}</div>
        <div class="pc-sub">7-day Average</div>
      </div>
      <div class="price-card vol">
        <div class="pc-label">24h取引量</div>
        <div class="pc-value" id="pcVol">${formatNum(volume24h)}</div>
        <div class="pc-sub">24h Volume</div>
      </div>
    </div>
  `;
}

window.updatePriceByRegion = function() {
  const region = document.getElementById('priceRegionFilter')?.value || '';
  const filtered = region ? currentOrders.filter(o => o.regionName === region) : currentOrders;
  
  const sells = filtered.filter(o => o.orderType === 'sell');
  const buys = filtered.filter(o => o.orderType === 'buy');
  
  const lowestSell = sells.length > 0
    ? Math.min(...sells.map(o => Number(o.priceThreshold)))
    : null;
  const highestBuy = buys.length > 0
    ? Math.max(...buys.map(o => Number(o.priceThreshold)))
    : null;

  const pcLowestSell = document.getElementById('pcLowestSell');
  const pcHighestBuy = document.getElementById('pcHighestBuy');
  const pcAvg24h = document.getElementById('pcAvg24h');
  const pcAvg7d = document.getElementById('pcAvg7d');
  const pcVol = document.getElementById('pcVol');

  const avgSell = sells.length > 0
    ? Math.floor(sells.reduce((s, o) => s + Number(o.priceThreshold), 0) / sells.length)
    : null;
  const avgBuy = buys.length > 0
    ? Math.floor(buys.reduce((s, o) => s + Number(o.priceThreshold), 0) / buys.length)
    : null;

  const pcAvgSell = document.getElementById('pcAvgSell');
  const pcAvgBuy = document.getElementById('pcAvgBuy');

  if (pcLowestSell) pcLowestSell.innerHTML = formatPrice(lowestSell ?? '—');
  if (pcHighestBuy) pcHighestBuy.innerHTML = formatPrice(highestBuy ?? '—');
  if (pcAvgSell) pcAvgSell.innerHTML = formatPrice(avgSell ?? '—');
  if (pcAvgBuy) pcAvgBuy.innerHTML = formatPrice(avgBuy ?? '—');

  if (region) {
    if (pcAvg24h) pcAvg24h.innerHTML = '—';
    if (pcAvg7d) pcAvg7d.innerHTML = '—';
    if (pcVol) pcVol.innerHTML = '—';
  }
};

function renderPriceChart(priceData, period = '7d') {
  const data = priceData?.priceData || [];

  document.getElementById('priceChart').innerHTML = `
    <h3 class="section-title">📈 価格推移・取引量</h3>
    <div class="period-btns">
      <button class="period-btn ${period === '24h' ? 'active' : ''}" onclick="changePeriod('24h')">24H</button>
      <button class="period-btn ${period === '7d' ? 'active' : ''}" onclick="changePeriod('7d')">7D</button>
      <button class="period-btn ${period === '30d' ? 'active' : ''}" onclick="changePeriod('30d')">30D</button>
    </div>
    ${data.length === 0 ? '<p class="no-orders">データがありません</p>' : `
      <div class="chart-wrap"><canvas id="priceCanvas"></canvas></div>
      <div class="chart-wrap" style="margin-top:16px"><canvas id="volumeCanvas"></canvas></div>
    `}
  `;

  if (data.length === 0) return;

  const sorted = [...data].reverse();
  const labels = sorted.map(d => {
    const date = new Date(d.bucket);
    if (period === '24h') return `${date.getHours()}:00`;
    return `${date.getMonth()+1}/${date.getDate()}`;
  });
  const prices = sorted.map(d => Math.round(d.avgPrice));
  const volumes = sorted.map(d => d.volume);

  new Chart(document.getElementById('priceCanvas'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '平均価格',
        data: prices,
        borderColor: '#00c896',
        backgroundColor: 'rgba(0,200,150,0.1)',
        tension: 0.3,
        fill: true,
        pointBackgroundColor: '#00c896',
      }]
    },
    options: {
  responsive: true,
  plugins: { legend: { labels: { color: '#aaa' } } },
  scales: {
    x: {
      ticks: {
        color: '#aaa',
        maxRotation: 45,
        autoSkip: false  // ← 全ラベル表示
      },
      grid: { color: 'rgba(255,255,255,0.15)' }
    },
    y: {
      ticks: { color: '#aaa' },
      grid: { color: 'rgba(255,255,255,0.15)' }
    }
  }
}
  });

  new Chart(document.getElementById('volumeCanvas'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '取引量',
        data: volumes,
        backgroundColor: 'rgba(91,156,246,0.5)',
        borderColor: '#5b9cf6',
        borderWidth: 1,
      }]
    },
    options: {
  responsive: true,
  plugins: { legend: { labels: { color: '#aaa' } } },
  scales: {
    x: {
      ticks: {
        color: '#aaa',
        maxRotation: 45,
        autoSkip: false  // ← 全ラベル表示
      },
      grid: { color: 'rgba(255,255,255,0.15)' }
    },
    y: {
      ticks: { color: '#aaa' },
      grid: { color: 'rgba(255,255,255,0.15)' }
    }
  }
}
  });
}

window.changePeriod = async function(period) {
  const item = window._currentItem;
  if (!item) return;

  const bucketMap = { '24h': '1+hour', '7d': '1+day', '30d': '1+day' };
  const limitMap = { '24h': 24, '7d': 7, '30d': 30 };

  const res = await fetch(
    `${API_BASE}/market/${item.itemOrCargo}/${item.id}/price-history?bucket=${bucketMap[period]}&limit=${limitMap[period]}`,
    { headers: HEADERS }
  );
  const priceData = res.ok ? await res.json() : null;
  renderPriceChart(priceData, period);
};

function renderSupplyDemand(orders) {
  const regions = [...new Set(orders.map(o => o.regionName).filter(Boolean))].sort();
  
  document.getElementById('supplyDemand').innerHTML = `
    <h3 class="section-title">📊 需要と供給</h3>
    <div class="sd-region-filter">
      <select id="sdRegionFilter" onchange="updateSupplyDemand()">
        <option value="">全リージョン</option>
        ${regions.map(r => {
          const rid = orders.find(o => o.regionName === r)?.regionId || '';
          return `<option value="${r}">${r} (R${rid})</option>`;
        }).join('')}
      </select>
    </div>
    <div id="sdContent"></div>
  `;

  window._sdOrders = orders;
  updateSupplyDemand();
}

window.updateSupplyDemand = function() {
  const region = document.getElementById('sdRegionFilter')?.value || '';
  const orders = window._sdOrders || [];
  const filtered = region ? orders.filter(o => o.regionName === region) : orders;

  const sellOrders = filtered.filter(o => o.orderType === 'sell');
  const buyOrders = filtered.filter(o => o.orderType === 'buy');
  const totalSupply = sellOrders.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
  const totalDemand = buyOrders.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
  const total = totalSupply + totalDemand;
  const supplyPct = total > 0 ? Math.round((totalSupply / total) * 100) : 50;
  const demandPct = 100 - supplyPct;

  document.getElementById('sdContent').innerHTML = `
    <div class="sd-wrap">
      <div class="sd-info">
        <div class="sd-item sell">
          <span class="sd-label">📦 供給（売り）</span>
          <span class="sd-count">${sellOrders.length}件</span>
          <span class="sd-qty">${formatNum(totalSupply)} 個</span>
        </div>
        <div class="sd-item buy">
          <span class="sd-label">🛒 需要（買い）</span>
          <span class="sd-count">${buyOrders.length}件</span>
          <span class="sd-qty">${formatNum(totalDemand)} 個</span>
        </div>
      </div>
      <div class="sd-bar-wrap">
        <div class="sd-bar">
          <div class="sd-fill sell-fill" style="width: ${supplyPct}%">
            <span>${supplyPct}%</span>
          </div>
          <div class="sd-fill buy-fill" style="width: ${demandPct}%">
            <span>${demandPct}%</span>
          </div>
        </div>
        <div class="sd-bar-labels">
          <span>供給 ${supplyPct}%</span>
          <span>需要 ${demandPct}%</span>
        </div>
      </div>
    </div>
  `;
};


function renderOrders(orders, orderType, page = 1, sort = 'asc', regionFilter = '', claimFilter = '') {
  currentOrderPage = page;
  currentOrderSort = sort;

  let filtered = orders;
  if (orderType === 'sell') filtered = orders.filter(o => o.orderType === 'sell');
  if (orderType === 'buy') filtered = orders.filter(o => o.orderType === 'buy');
  if (regionFilter) filtered = filtered.filter(o => o.regionName === regionFilter);
  if (claimFilter) filtered = filtered.filter(o => o.claimName?.toLowerCase().includes(claimFilter.toLowerCase()));

  if (sort === 'asc') {
    filtered.sort((a, b) => Number(a.priceThreshold) - Number(b.priceThreshold));
  } else {
    filtered.sort((a, b) => Number(b.priceThreshold) - Number(a.priceThreshold));
  }

  const totalPages = Math.ceil(filtered.length / ORDERS_PER_PAGE);
  const start = (page - 1) * ORDERS_PER_PAGE;
  const pageOrders = filtered.slice(start, start + ORDERS_PER_PAGE);

  const sellCount = orders.filter(o => o.orderType === 'sell').length;
const regions = [...new Set(orders.map(o => o.regionName).filter(Boolean))].sort();
const regionOptions = regions.map(r => {
  const rid = orders.find(o => o.regionName === r)?.regionId || '';
  return `<option value="${r}" ${regionFilter === r ? 'selected' : ''}>${r} (R${rid})</option>`;
}).join('');
  
  const buyCount = orders.filter(o => o.orderType === 'buy').length;

  const pagination = totalPages > 1 ? `
    <div class="pagination">
      <button class="page-btn" onclick="changeOrderPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>← 前へ</button>
      <span class="page-info">${page} / ${totalPages}</span>
      <button class="page-btn" onclick="changeOrderPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>次へ →</button>
    </div>
  ` : '';

 const html = filtered.length === 0
  ? '<p class="no-orders">注文が見つかりませんでした</p>'
  : `
    ${pagination}
    <div class="orders-table-wrap">
      <table class="orders-table">
        <thead>
          <tr>
            <th>種別</th>
            <th style="white-space:nowrap;">
  価格
  <span style="display:inline-flex; flex-direction:column; gap:2px; margin-left:4px; vertical-align:middle;">
    <button class="sort-btn ${sort === 'asc' ? 'active' : ''}" onclick="changeOrderSort('asc')">↑</button>
    <button class="sort-btn ${sort === 'desc' ? 'active' : ''}" onclick="changeOrderSort('desc')">↓</button>
  </span>
</th>
            <th>数量</th>
            <th>領地名</th>
            <th>リージョン</th>
            <th>座標</th>
          </tr>
        </thead>
        <tbody>
          ${pageOrders.map((o) => `
            <tr class="order-row ${o.orderType}">
              <td><span class="order-badge ${o.orderType}">${o.orderType === 'sell' ? '売り' : '買い'}</span></td>
              <td class="price-cell">${formatPrice(o.priceThreshold)}</td>
              <td>${formatNum(o.quantity)}</td>
              <td class="claim-name">${o.claimName || '—'}</td>
              <td>${o.regionName ? `${o.regionName} (R${o.regionId})` : '—'}</td>
              <td class="coords">${formatCoords(o)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${pagination}
  `;

document.getElementById('ordersList').innerHTML = `
  <div class="orders-list-header">
    <h3 class="section-title">📋 注文一覧 <span class="order-count">${filtered.length}件</span></h3>
    <div class="order-type-tabs">
      <button class="tab-btn ${orderType === '' ? 'active' : ''}" onclick="changeOrderType('')">売り＆買い (${orders.length})</button>
      <button class="tab-btn ${orderType === 'sell' ? 'active' : ''}" onclick="changeOrderType('sell')">売り (${sellCount})</button>
      <button class="tab-btn ${orderType === 'buy' ? 'active' : ''}" onclick="changeOrderType('buy')">買い (${buyCount})</button>
      <select class="region-order-filter" onchange="changeOrderRegion(this.value)">
        <option value="">全リージョン</option>
        ${regionOptions}
      </select>
    </div>
    <div class="orders-search-bar">
      <input type="text" id="claimSearchInput" class="claim-search" placeholder="領地名検索..." oninput="changeOrderClaim(this.value)" value="${claimFilter}">
    </div>
  </div>
  ${html}
`;
}

let currentLogPage = 1;
const LOG_PER_PAGE = 20;
const LOG_MAX_PAGES = 5;

function renderTradeLog(priceData) {
  const newTrades = priceData?.recentTrades || [];
  if (newTrades.length === 0) {
    document.getElementById('tradeLog').innerHTML = '';
    return;
  }

  // 既存のログと新しいログをマージ（IDで重複排除）
  const existingIds = new Set(accumulatedTrades.map(t => t.id));
  const uniqueNewTrades = newTrades.filter(t => !existingIds.has(t.id));
  
  // 新しいものを先頭に追加
  accumulatedTrades = [...uniqueNewTrades, ...accumulatedTrades];
  
  // 50件超えたら古いものを削除
  if (accumulatedTrades.length > MAX_TRADES) {
    accumulatedTrades = accumulatedTrades.slice(0, MAX_TRADES);
  }

  window._tradeLogs = accumulatedTrades;
  currentLogPage = 1;
  renderLogTable(accumulatedTrades, currentLogPage);
}

function renderLogTable(trades, page) {
  const maxItems = LOG_PER_PAGE * LOG_MAX_PAGES;
  const limited = trades.slice(0, maxItems);
  const totalPages = Math.ceil(limited.length / LOG_PER_PAGE);
  const start = (page - 1) * LOG_PER_PAGE;
  const pageItems = limited.slice(start, start + LOG_PER_PAGE);

  const pagination = totalPages > 1 ? `
    <div class="pagination">
      <button class="page-btn" onclick="changeLogPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>← 前へ</button>
      <span class="page-info">${page} / ${totalPages}</span>
      <button class="page-btn" onclick="changeLogPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>次へ →</button>
    </div>
  ` : '';

  document.getElementById('tradeLog').innerHTML = `
    <h3 class="section-title">📜 取引ログ <span class="order-count">${limited.length}件</span></h3>
    <button class="refresh-btn" onclick="refreshTradeLog()">🔄 ログ更新</button>
    <div class="log-filter">
      <select id="logRegionFilter" onchange="filterTradeLog()">
  <option value="">全リージョン</option>
  ${[...new Set(trades.map(t => t.regionName).filter(Boolean))].sort().map(r => {
    const rid = trades.find(t => t.regionName === r)?.regionId || '';
    const selected = (document.getElementById('logRegionFilter')?.value === r) ? 'selected' : '';
    return `<option value="${r}" ${selected}>${r} (R${rid})</option>`;
  }).join('')}
</select>
    </div>
    ${pagination}
    <div class="log-table-wrap">
      <table class="log-table">
        <thead>
          <tr>
            <th>日時</th>
            <th>買い手</th>
            <th>売り手</th>
            <th>リージョン</th>
            <th>単価</th>
            <th>数量</th>
            <th>合計</th>
          </tr>
        </thead>
        <tbody>
          ${renderLogRows(pageItems)}
        </tbody>
      </table>
    </div>
    ${pagination}
  `;
}

function renderLogRows(trades) {
  return trades.map(t => {
    const date = new Date(t.timestamp);
    const dateStr = `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    return `
      <tr>
        <td>${dateStr}</td>
        <td>${t.buyerUsername || '—'}</td>
        <td>${t.sellerUsername || '—'}</td>
        <td>${t.regionName || '—'} (R${t.regionId || ''})</td>
        <td class="price-cell">${formatPrice(t.unitPrice)}</td>
        <td>${formatNum(t.quantity)}</td>
        <td class="price-cell">${formatPrice(t.price)}</td>
      </tr>
    `;
  }).join('');
}

window.changeLogPage = function(page) {
  currentLogPage = page;
  const region = document.getElementById('logRegionFilter')?.value || '';
  const trades = window._tradeLogs || [];
  const filtered = region ? trades.filter(t => t.regionName === region) : trades;
  renderLogTable(filtered, page);
};

window.refreshTradeLog = async function() {
  const item = window._currentItem;
  if (!item) return;
  const res = await fetch(
    `${API_BASE}/market/${item.itemOrCargo}/${item.id}/price-history?bucket=1+day&limit=7`,
    { headers: HEADERS }
  );
  const priceData = res.ok ? await res.json() : null;
  if (priceData) renderTradeLog(priceData);
};

window.clearAllFilters = function() {
  // Tier
  document.querySelectorAll('#tierDropdown input[type=checkbox]').forEach(cb => cb.checked = false);
  document.getElementById('tierLabel').textContent = 'すべて';
  
  // レア度
  document.querySelectorAll('#rarityDropdown input[type=checkbox]').forEach(cb => cb.checked = false);
  document.getElementById('rarityLabel').textContent = 'すべて';
  
  // カテゴリー
  document.querySelectorAll('#categoryDropdown input[type=checkbox]').forEach(cb => cb.checked = false);
  document.getElementById('categoryLabel').textContent = 'すべて';
  
  // 注文種別
  document.getElementById('orderTypeFilter').value = '';

  // 検索結果クリア
  searchInput.value = '';
  searchResults.classList.add('hidden');
  resultSection.classList.add('hidden');
  emptyState.classList.remove('hidden');
  currentItems = [];
  // カテゴリドロップダウンを全表示に戻す
  document.querySelectorAll('#categoryDropdown .ms-item').forEach(label => {
    label.style.display = '';
  });
};

// クラフト機能
window.toggleCraftMode = function() {
  const toggle = document.getElementById('craftModeToggle');
  craftMode = toggle.checked;
  const aggregateBtn = document.getElementById('aggregateBtn');
  aggregateBtn.disabled = !craftMode || selectedItems.length === 0;
  // 検索結果を再描画してチェックボックスの表示/非表示を切り替え
  if (currentItems.length > 0) {
    renderSearchResults(currentItems, currentPage);
  }
};

window.toggleCraftItem = function(itemId, checked) {
  const item = currentItems.find(i => i.id === itemId);
  if (!item) return;
  
  if (checked) {
    if (!selectedItems.some(si => si.id === itemId)) {
      selectedItems.push(item);
    }
  } else {
    selectedItems = selectedItems.filter(si => si.id !== itemId);
  }
  
  const aggregateBtn = document.getElementById('aggregateBtn');
  aggregateBtn.disabled = !craftMode || selectedItems.length === 0;
};

window.showAggregation = function() {
  if (selectedItems.length === 0) return;
  
  // 履歴に保存
  const historyEntry = {
    id: Date.now(),
    date: new Date().toLocaleString('ja-JP'),
    items: selectedItems.map(item => ({
      id: item.id,
      name: item.name,
      jaName: getJaName(item.name),
      tag: item.tag,
      tier: item.tier,
      rarity: item.rarity
    }))
  };
  
  craftHistory.unshift(historyEntry);
  if (craftHistory.length > 20) craftHistory = craftHistory.slice(0, 20);
  localStorage.setItem('craftHistory', JSON.stringify(craftHistory));
  
  // 集計結果を表示
  renderAggregationResult(selectedItems);
};

window.showCraftHistory = function(historyId) {
  const entry = craftHistory.find(h => h.id === historyId);
  if (!entry) return;
  
  // 履歴のアイテムを再構築（価格情報などは最新データを使用）
  const items = entry.items.map(historyItem => {
    // まずcurrentItemsから探す、なければダミーアイテムを作成
    const current = currentItems.find(ci => ci.id === historyItem.id);
    return current || {
      id: historyItem.id,
      name: historyItem.name,
      tag: historyItem.tag,
      tier: historyItem.tier,
      rarity: historyItem.rarity,
      rarityStr: ['Default','Common','Uncommon','Rare','Epic','Legendary','Mythic'][historyItem.rarity] || ''
    };
  });
  
  renderAggregationResult(items, entry.date);
};

window.filterTradeLog = function() {
  const region = document.getElementById('logRegionFilter')?.value || '';
  const trades = window._tradeLogs || [];
  const filtered = region ? trades.filter(t => t.regionName === region) : trades;
  currentLogPage = 1;
  
  // テーブルボディだけ更新（セレクトは再生成しない）
  const maxItems = LOG_PER_PAGE * LOG_MAX_PAGES;
  const limited = filtered.slice(0, maxItems);
  const totalPages = Math.ceil(limited.length / LOG_PER_PAGE);
  const pageItems = limited.slice(0, LOG_PER_PAGE);
  
  const tbody = document.querySelector('#tradeLog tbody');
  if (tbody) tbody.innerHTML = renderLogRows(pageItems);
};



function renderMap(orders, orderType) {
  let filtered = orders;
  if (orderType === 'sell') filtered = orders.filter(o => o.orderType === 'sell');
  if (orderType === 'buy') filtered = orders.filter(o => o.orderType === 'buy');

  const withCoords = filtered.filter(o => o.claimLocationX != null && o.claimLocationZ != null);

  const mapContainer = document.getElementById('mapContainer');

  if (withCoords.length === 0) {
    mapContainer.innerHTML = '<div class="map-loading">座標データがありません</div>';
    return;
  }

  // SVGベースの簡易マップ（座標をキャンバスにマッピング）
  const xs = withCoords.map(o => Number(o.claimLocationX));
  const zs = withCoords.map(o => Number(o.claimLocationZ));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const padX = (maxX - minX) * 0.15 || 500;
  const padZ = (maxZ - minZ) * 0.15 || 500;

  const W = 520, H = 380;

  function mapX(x) {
    return 30 + ((x - minX + padX) / (maxX - minX + padX * 2)) * (W - 60);
  }
  function mapZ(z) {
    return 30 + ((z - minZ + padZ) / (maxZ - minZ + padZ * 2)) * (H - 60);
  }

  // グループ化（同じclaimをまとめる）
  const claimMap = {};
  withCoords.forEach((o, i) => {
    const key = o.claimName || `${o.locationX},${o.locationZ}`;
    if (!claimMap[key]) claimMap[key] = { orders: [], x: Number(o.claimLocationX), z: Number(o.claimLocationZ) };
    claimMap[key].orders.push({ ...o, globalIdx: i });
  });

  const markers = Object.values(claimMap);

  let svgMarkers = '';
  markers.forEach((m, i) => {
    const cx = mapX(m.x);
    const cy = mapZ(m.z);
    const hasSell = m.orders.some(o => o.orderType === 'sell');
    const hasBuy = m.orders.some(o => o.orderType === 'buy');
    const color = hasSell && hasBuy ? '#f0a500' : hasSell ? '#00c896' : '#5b9cf6';
    const lowestPrice = Math.min(...m.orders.map(o => Number(o.priceThreshold)));

    svgMarkers += `
      <g class="map-marker" onclick="showMarkerInfo(${i})" style="cursor:pointer">
        <circle cx="${cx}" cy="${cy}" r="12" fill="${color}" opacity="0.85" stroke="#fff" stroke-width="1.5"/>
        <circle cx="${cx}" cy="${cy}" r="12" fill="transparent" stroke="${color}" stroke-width="3" opacity="0.4" class="pulse-ring"/>
        <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="9" font-weight="bold" fill="#fff">${m.orders.length}</text>
      </g>
    `;
  });

  // BitCraft Mapへのリンク（代表座標）
  const centerX = Math.round((minX + maxX) / 2);
  const centerZ = Math.round((minZ + maxZ) / 2);
  const mapLink = `https://map.bitjita.com/?x=${centerX}&y=${centerZ}&zoom=4`;

  mapContainer.innerHTML = `
    <div class="map-inner">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="claims-svg">
        <rect width="${W}" height="${H}" rx="8" fill="#0d1520" opacity="0.8"/>
        <!-- グリッド -->
        ${Array.from({length: 6}, (_, i) => `
          <line x1="${30 + i * (W-60)/5}" y1="30" x2="${30 + i * (W-60)/5}" y2="${H-30}" stroke="#1e3048" stroke-width="0.5"/>
          <line x1="30" y1="${30 + i * (H-60)/5}" x2="${W-30}" y2="${30 + i * (H-60)/5}" stroke="#1e3048" stroke-width="0.5"/>
        `).join('')}
        ${svgMarkers}
      </svg>
      <div id="markerInfo" class="marker-info hidden"></div>
    </div>
    <div class="map-actions">
      <a href="${mapLink}" target="_blank" class="map-link-btn">🗺 BitCraft Mapで開く</a>
      <span class="map-hint">マーカーをクリックで詳細</span>
    </div>
  `;

  // マーカーinfoデータを保存
  window._mapMarkers = markers;

  document.getElementById('mapLegend').innerHTML = `
    <div class="legend-items">
      <span class="leg sell">● 売り注文</span>
      <span class="leg buy">● 買い注文</span>
      <span class="leg both">● 売り＆買い</span>
    </div>
  `;
}

// ============================================
// マーカー情報表示
// ============================================
window.showMarkerInfo = function(idx) {
  const marker = window._mapMarkers?.[idx];
  if (!marker) return;

  const info = document.getElementById('markerInfo');
  const mapLink = `https://map.bitjita.com/?x=${Math.round(marker.x)}&y=${Math.round(marker.z)}&zoom=6`;

  info.innerHTML = `
    <div class="mi-header">
      <strong>${marker.orders[0]?.claimName || '不明な領地'}</strong>
      <span class="mi-region">${marker.orders[0]?.regionName || ''}</span>
    </div>
    <div class="mi-coords">📍 X: ${Math.round(marker.x)}, Z: ${Math.round(marker.z)}</div>
    <div class="mi-orders">
      ${marker.orders.map(o => `
        <div class="mi-order ${o.orderType}">
          <span class="order-badge ${o.orderType}">${o.orderType === 'sell' ? '売り' : '買い'}</span>
          <span>${formatPrice(o.priceThreshold)}</span>
          <span>×${formatNum(o.quantity)}</span>
        </div>
      `).join('')}
    </div>
    <a href="${mapLink}" target="_blank" class="mi-maplink">🗺 マップで見る</a>
    <button onclick="document.getElementById('markerInfo').classList.add('hidden')" class="mi-close">✕</button>
  `;
  info.classList.remove('hidden');
};

window.highlightMarker = function(idx) {};

// ============================================
// ユーティリティ
// ============================================
function formatPrice(val) {
  if (val == null || val === '—') return '—';
  const n = Number(val);
  if (isNaN(n)) return '—';
  return Math.floor(n).toLocaleString('ja-JP') + ' <span class="coin">🪙</span>';
}

function formatNum(val) {
  if (val == null) return '0';
  return Number(val).toLocaleString('ja-JP');
}

function formatCoords(order) {
  if (order.claimLocationX == null) return '—';
  const n = Math.round(order.claimLocationZ / 3);
  const e = Math.round(order.claimLocationX / 3);
  return `N:${n}, E:${e}`;
}

function showLoading() {
  loading.classList.remove('hidden');
  resultSection.classList.add('hidden');
  emptyState.classList.add('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  emptyState.classList.add('hidden');
  resultSection.classList.add('hidden');
}

function clearError() {
  errorMsg.classList.add('hidden');
  errorMsg.textContent = '';
}

// アイテムレシピ情報取得
async function fetchItemRecipe(itemId) {
  const itemOrCargo = 'item'; // レシピはアイテムのみ
  try {
    const res = await fetch(`${API_BASE}/items/${itemId}`, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.craftingRecipes || [];
  } catch (err) {
    console.error('Recipe fetch error:', err);
    return null;
  }
}

// 集計結果表示
function renderAggregationResult(items, historyDate = null) {
  // タグごとにグループ化
  const tagGroups = {};
  items.forEach(item => {
    const tag = item.tag || 'Unknown';
    if (!tagGroups[tag]) tagGroups[tag] = [];
    tagGroups[tag].push(item);
  });
  
  // 価格情報を取得
  const pricePromises = items.map(async item => {
    const itemOrCargo = item.itemType === 1 ? 'cargo' : 'item';
    try {
      const res = await fetch(`${API_BASE}/market/${itemOrCargo}/${item.id}`, { headers: HEADERS });
      if (!res.ok) return { id: item.id, price: null };
      const data = await res.json();
      return { id: item.id, price: data?.stats?.lowestSell || null };
    } catch (err) {
      return { id: item.id, price: null };
    }
  });
  
  Promise.all(pricePromises).then(priceResults => {
    // 価格をアイテムに紐付け
    const priceMap = {};
    priceResults.forEach(pr => {
      priceMap[pr.id] = pr.price;
    });
    
    // レシピ情報を取得
    const recipePromises = items.map(async item => {
      const recipes = await fetchItemRecipe(item.id);
      return { id: item.id, recipes: recipes || [] };
    });
    
    Promise.all(recipePromises).then(recipeResults => {
      // レシピをアイテムに紐付け
      const recipeMap = {};
      recipeResults.forEach(rr => {
        recipeMap[rr.id] = rr.recipes;
      });
      
      // 合計金額を計算
      let totalPrice = 0;
      items.forEach(item => {
        const price = priceMap[item.id];
        if (price) totalPrice += price;
      });
      
      // 集計HTMLを生成
      let html = `
        <div class="aggregation-result">
          <h3 class="section-title">🔨 クラフト集計結果 ${historyDate ? `<span class="history-date">(${historyDate})</span>` : ''}</h3>
          <div class="aggregation-summary">
            <div>合計アイテム数: ${items.length}個</div>
            <div>タグ種類数: ${Object.keys(tagGroups).length}種類</div>
            <div>合計価格: ${formatPrice(totalPrice)}</div>
          </div>
          
          <div class="aggregation-region">
            <label>リージョン:</label>
            <select id="aggregationRegionSelect" onchange="updateAggregationPrices()">
              <option value="">全リージョン</option>
            </select>
          </div>
          
          <div class="aggregation-tags">
      `;
      
      Object.keys(tagGroups).sort().forEach(tag => {
        const groupItems = tagGroups[tag];
        const jaTag = getJaName(tag) || tag;
        html += `
          <div class="tag-group">
            <h4 class="tag-title">${jaTag} (${groupItems.length}個)</h4>
            <div class="tag-items">
              ${groupItems.map(item => {
                const jaName = getJaName(item.name);
                const useJaName = jaName && jaName.length > 2;
                const price = priceMap[item.id];
                const recipes = recipeMap[item.id] || [];
                return `
                  <div class="agg-item" onclick="selectItem('${item.id}')">
                    <span class="agg-item-name">${useJaName ? jaName : item.name}</span>
                    ${item.tier ? `<span class="badge tier">T${item.tier}</span>` : ''}
                    <span class="s-rarity rarity-${item.rarityStr?.toLowerCase()}">${item.rarityStr || ''}</span>
                    ${price ? `<span class="agg-price">${formatPrice(price)}</span>` : ''}
                    ${recipes.length > 0 ? `<span class="recipe-badge">📚</span>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });
      
      // レシピ詳細セクション
      html += `
          </div>
          
          <div class="recipe-section">
            <h4 class="section-title">📚 レシピ情報</h4>
            <div class="recipe-list">
      `;
      
      items.forEach(item => {
        const recipes = recipeMap[item.id] || [];
        if (recipes.length > 0) {
          const jaName = getJaName(item.name);
          const useJaName = jaName && jaName.length > 2;
          html += `
            <div class="recipe-item">
              <div class="recipe-header">${useJaName ? jaName : item.name}</div>
              ${recipes.map(recipe => `
                <div class="recipe-detail">
                  <div>クラフト数: ${recipe.craftCount || 1}</div>
                  <div>必要スキル: ${recipe.levelRequirements?.map(r => r.skillName).join(', ') || 'なし'}</div>
                  <div>必要ツール: ${recipe.toolRequirements?.map(t => t.name).join(', ') || 'なし'}</div>
                </div>
              `).join('')}
            </div>
          `;
        }
      });
      
      html += `
            </div>
          </div>
          
          <div class="aggregation-actions">
            <button class="back-btn" onclick="backToSearchResults()">← 検索結果に戻る</button>
            <button class="clear-selection-btn" onclick="clearCraftSelection()">選択をクリア</button>
          </div>
        </div>
      `;
      
      resultSection.innerHTML = html;
      resultSection.classList.remove('hidden');
      searchResults.classList.add('hidden');
      emptyState.classList.add('hidden');
      
      // リージョン選択を設定
      setAggregationRegionOptions();
    });
  });
}

function setAggregationRegionOptions() {
  const select = document.getElementById('aggregationRegionSelect');
  if (!select) return;
  
  // すべてのリージョンを取得
  const regions = new Set();
  selectedItems.forEach(item => {
    // 注文データからリージョンを取得するには、loadItemDetailで取得したcurrentOrdersを使用
    // 今回は簡易的に、現在の注文データからリージョンを取得
  });
  
  // リージョン選択肢を追加
  select.innerHTML = '<option value="">全リージョン</option>';
  // 仮のリージョンリスト
  const regionList = ['東部', '西部', '南部', '北部', '中央'];
  regionList.forEach(region => {
    const option = document.createElement('option');
    option.value = region;
    option.textContent = region;
    select.appendChild(option);
  });
}

function updateAggregationPrices() {
  // リージョン選択時に価格を更新（今回は未実装）
  // 実装する場合は、selectedItemsの各アイテムについて、リージョンごとの最低価格を再計算
}

window.backToSearchResults = function() {
  resultSection.classList.add('hidden');
  if (currentItems.length > 0) {
    searchResults.classList.remove('hidden');
  } else {
    emptyState.classList.remove('hidden');
  }
};

window.clearCraftSelection = function() {
  selectedItems = [];
  const aggregateBtn = document.getElementById('aggregateBtn');
  aggregateBtn.disabled = true;
  if (currentItems.length > 0) {
    renderSearchResults(currentItems, currentPage);
  }
};

// 履歴リスト表示
window.renderCraftHistory = function() {
  const historyContainer = document.getElementById('craftHistoryList');
  if (!historyContainer) return;
  
  if (craftHistory.length === 0) {
    historyContainer.innerHTML = '<p class="no-history">履歴がありません</p>';
    return;
  }
  
  let html = '<div class="history-list">';
  craftHistory.forEach(entry => {
    html += `
      <div class="history-item" onclick="showCraftHistory(${entry.id})">
        <div class="history-date">${entry.date}</div>
        <div class="history-summary">${entry.items.length}アイテム</div>
      </div>
    `;
  });
  html += '</div>';
  historyContainer.innerHTML = html;
};

// ============================================
// 初期化（DOM読み込み後に実行）
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // イベントリスナー設定
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  searchInput.addEventListener('input', onSearchInput);
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) hideSuggestions();
  });

  orderTypeFilter.addEventListener('change', applyFilters);

  // 履歴リストを初期表示
  renderCraftHistory();

  // クラフト機能トグルイベントリスナー
  const craftModeToggle = document.getElementById('craftModeToggle');
  if (craftModeToggle) {
    craftModeToggle.addEventListener('change', toggleCraftMode);
  }

  // キャッシュ自動削除
  const CACHE_TIMEOUT = 3600000; // 1時間

  // 定期的にキャッシュをチェック（1分ごと）
  setInterval(() => {
    const now = Date.now();
    // iconCacheの期限切れチェック
    for (const [key, value] of iconCache.entries()) {
      if (now - value.timestamp > CACHE_TIMEOUT) {
        iconCache.delete(key);
      }
    }
    // market itemsキャッシュの期限切れチェック
    if (cachedMarketItems.timestamp && now - cachedMarketItems.timestamp > CACHE_TIMEOUT) {
      cachedMarketItems = { data: null, timestamp: 0 };
      fetchPromise = null;
    }
  }, 60000); // 1分ごとにチェック

  // ページを閉じる/リロード時にキャッシュをクリア
  window.addEventListener('beforeunload', () => {
    iconCache.clear();
    cachedMarketItems = { data: null, timestamp: 0 };
    fetchPromise = null;
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => hideSuggestions(), 200);
  });
});


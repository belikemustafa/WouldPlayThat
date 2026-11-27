/* ==========================================================================
   WOULD PLAY THAT — Hybrid Video Games API Client
   Instant Curated Vault + Live CheapShark (CORS) + Wikipedia REST + Gemini
   ========================================================================== */

window.WPT_API = (() => {
  const CFG = window.WPT_CONFIG;
  const memCache = new Map();
  const gameIndex = new Map();

  const MAX_CONCURRENT = 3;
  let activeReqs = 0;
  const reqQueue = [];

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      reqQueue.push({ fn, resolve, reject });
      drain();
    });
  }

  function drain() {
    while (activeReqs < MAX_CONCURRENT && reqQueue.length > 0) {
      const next = reqQueue.shift();
      activeReqs += 1;
      next
        .fn()
        .then(next.resolve, next.reject)
        .finally(() => {
          activeReqs -= 1;
          drain();
        });
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getGeminiKey() {
    return localStorage.getItem(CFG.STORAGE_KEYS.GEMINI_KEY)?.trim() || '';
  }

  /* ---------- Cache ---------- */
  function readCache(key) {
    if (memCache.has(key)) return memCache.get(key);
    try {
      const raw = localStorage.getItem(CFG.STORAGE_KEYS.CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() > parsed.exp) {
        localStorage.removeItem(CFG.STORAGE_KEYS.CACHE_PREFIX + key);
        return null;
      }
      memCache.set(key, parsed.data);
      return parsed.data;
    } catch {
      return null;
    }
  }

  function writeCache(key, data, ttl = CFG.CACHE_TTL_MS) {
    memCache.set(key, data);
    try {
      localStorage.setItem(
        CFG.STORAGE_KEYS.CACHE_PREFIX + key,
        JSON.stringify({ exp: Date.now() + ttl, data })
      );
    } catch {
      clearCache();
    }
  }

  function clearCache() {
    memCache.clear();
    const prefix = CFG.STORAGE_KEYS.CACHE_PREFIX;
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(prefix)) localStorage.removeItem(k);
    });
  }

  /* ---------- Fast Lightweight Steam Asset URLs ---------- */
  function steamPortraitUrl(appId) {
    // Standard 600x900 (~70KB vs ~600KB+ for _2x) — still >3x retina on 180px cards
    return appId ? `${CFG.STEAM_ASSET_BASE}${appId}/library_600x900.jpg` : '';
  }

  function steamHeaderUrl(appId) {
    return appId ? `${CFG.STEAM_ASSET_BASE}${appId}/header.jpg` : '';
  }

  function steamHeroUrl(appId) {
    // 616x353 capsule (~55KB vs ~2MB library_hero.jpg) loads almost instantaneously
    return appId ? `${CFG.STEAM_ASSET_BASE}${appId}/capsule_616x353.jpg` : '';
  }

  function inferDifficulty(raw) {
    if (raw.difficulty) return raw.difficulty;
    const genres = raw.genres || [];
    const themes = raw.themes || [];
    if (genres.includes('soulslike')) return 'punishing';
    if (themes.includes('cozy')) return 'relaxed';
    if (genres.includes('roguelike') || genres.includes('strategy') || genres.includes('horror') || genres.includes('metroidvania')) return 'challenging';
    if (
      genres.includes('narrative') &&
      !genres.includes('action') &&
      !genres.includes('action-adventure') &&
      !genres.includes('shooter') &&
      !genres.includes('platformer') &&
      !genres.includes('rpg')
    ) {
      return 'relaxed';
    }
    return 'balanced';
  }

  function inferApproxPrice(raw) {
    if (typeof raw.approxPrice === 'number') return raw.approxPrice;
    const genres = raw.genres || [];
    if (genres.includes('indie')) return 20;
    if (Number(raw.year || 0) <= 2013) return 15;
    if (Number(raw.year || 0) <= 2019) return 40;
    return 60;
  }

  /* ---------- Normalization ---------- */
  function normalizeCuratedGame(raw) {
    const verified = readCache(`verify_game_${raw.id}`);
    const wikiCache = raw.wikiTitle ? readCache(`wiki_${raw.wikiTitle}`) : null;
    const mc = verified?.metacritic ?? raw.metacritic ?? null;
    const ps = verified?.playerScore ?? raw.playerScore ?? null;
    const posterUrl = raw.steamAppId
      ? steamPortraitUrl(raw.steamAppId)
      : wikiCache?.thumbnail || '';
    const fallbackUrl = raw.steamAppId ? steamHeaderUrl(raw.steamAppId) : '';
    const backdropUrl = raw.steamAppId
      ? steamHeroUrl(raw.steamAppId)
      : wikiCache?.thumbnail || '';

    const normalized = {
      ...raw,
      displayTitle: raw.title,
      displayYear: raw.year ? String(raw.year) : '—',
      yearNum: Number(raw.year || 0),
      difficulty: inferDifficulty(raw),
      approxPrice: inferApproxPrice(raw),
      metacritic: typeof mc === 'number' && mc > 0 ? Math.round(mc) : null,
      playerScore: typeof ps === 'number' && ps > 0 ? Number(ps.toFixed(1)) : null,
      hasMetacritic: typeof mc === 'number' && mc > 0,
      hasPlayerScore: typeof ps === 'number' && ps > 0,
      posterUrl,
      fallbackPosterUrl: fallbackUrl,
      backdropUrl,
      awardBadge: verified?.awardsSummary || raw.awardBadge || '',
      popularityScore: (mc || 75) * 10 + (ps || 4) * 40 + (raw.featured ? 200 : 0),
      source: 'curated',
      steamUrl: raw.steamAppId ? `https://store.steampowered.com/app/${raw.steamAppId}/` : ''
    };

    gameIndex.set(normalized.id, normalized);
    return normalized;
  }

  function normalizeCheapSharkDeal(d) {
    const appId = d.steamAppID ? Number(d.steamAppID) : null;
    const title = d.title || d.external || 'Untitled Game';

    // Prefer our rich curated entry if this Steam App ID is already in the Vault
    if (appId) {
      const curatedMatch = CFG.CURATED_GAMES.find((g) => g.steamAppId === appId);
      if (curatedMatch) {
        const base = normalizeCuratedGame(curatedMatch);
        return {
          ...base,
          salePrice: d.salePrice ? Number(d.salePrice) : null,
          normalPrice: d.normalPrice ? Number(d.normalPrice) : null,
          savings: d.savings ? Math.round(Number(d.savings)) : 0,
          dealUrl: d.dealID ? `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.dealID)}` : '',
          cheapsharkId: d.gameID || ''
        };
      }
    }

    const id = `cs-${d.gameID || appId || slugify(title)}`;
    const mcRaw = Number(d.metacriticScore || 0);
    const steamPct = Number(d.steamRatingPercent || 0);
    const playerScore = steamPct > 0 ? Number((1 + (steamPct / 100) * 4).toFixed(1)) : null;
    const relEpoch = Number(d.releaseDate || 0);
    const yearNum = relEpoch > 0 ? new Date(relEpoch * 1000).getUTCFullYear() : 0;

    const item = {
      id,
      title,
      displayTitle: title,
      year: yearNum,
      yearNum,
      displayYear: yearNum > 1970 ? String(yearNum) : '—',
      steamAppId: appId,
      cheapsharkId: d.gameID || '',
      metacritic: mcRaw > 0 ? Math.round(mcRaw) : null,
      playerScore,
      hasMetacritic: mcRaw > 0,
      hasPlayerScore: Boolean(playerScore),
      steamRatingText: d.steamRatingText || '',
      steamRatingCount: Number(d.steamRatingCount || 0),
      hours: null,
      platforms: ['pc'],
      modes: ['singleplayer'],
      genres: [],
      themes: [],
      studio: 'PC / Steam Release',
      publisher: 'Steam Store',
      awards: [],
      awardBadge: mcRaw >= 90 ? `${mcRaw} Metacritic Acclaimed` : '',
      overview: '',
      posterUrl: appId ? steamPortraitUrl(appId) : d.thumb || '',
      fallbackPosterUrl: appId ? steamHeaderUrl(appId) : d.thumb || '',
      backdropUrl: appId ? steamHeroUrl(appId) : d.thumb || '',
      salePrice: d.salePrice !== undefined ? Number(d.salePrice) : null,
      normalPrice: d.normalPrice !== undefined ? Number(d.normalPrice) : null,
      savings: d.savings ? Math.round(Number(d.savings)) : 0,
      dealUrl: d.dealID ? `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.dealID)}` : '',
      steamUrl: appId ? `https://store.steampowered.com/app/${appId}/` : '',
      popularityScore: mcRaw * 8 + steamPct * 2 + Number(d.dealRating || 0) * 10,
      source: 'cheapshark'
    };

    gameIndex.set(item.id, item);
    return item;
  }

  function slugify(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function canonicalGameKey(title) {
    return String(title || '')
      .replace(/\s*\((?:(?:\d{4}\s+)?video game|game|series)\)\s*$/i, '')
      .replace(/[™®©]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }

  function mergeGameRecords(a, b) {
    // Priority: curated > cheapshark (with Steam/Metacritic) > wikipedia, while combining missing fields from both
    const rank = (x) =>
      x.source === 'curated' ? 3 : x.source === 'cheapshark' ? 2 : 1;
    const primary = rank(a) >= rank(b) ? a : b;
    const secondary = primary === a ? b : a;

    const merged = {
      ...secondary,
      ...primary,
      steamAppId: primary.steamAppId || secondary.steamAppId || null,
      posterUrl: primary.posterUrl || secondary.posterUrl || '',
      fallbackPosterUrl: primary.fallbackPosterUrl || secondary.posterUrl || secondary.fallbackPosterUrl || '',
      backdropUrl: primary.backdropUrl || secondary.backdropUrl || primary.posterUrl || secondary.posterUrl || '',
      overview: primary.overview || secondary.overview || '',
      studio:
        primary.studio && primary.studio !== 'PC / Steam Release' && primary.studio !== 'Online Catalog'
          ? primary.studio
          : secondary.studio || primary.studio || 'Video Game',
      yearNum: primary.yearNum || secondary.yearNum || 0,
      displayYear: primary.displayYear && primary.displayYear !== '—' ? primary.displayYear : secondary.displayYear || '—',
      metacritic: primary.metacritic ?? secondary.metacritic ?? null,
      hasMetacritic: Boolean(primary.hasMetacritic || secondary.hasMetacritic),
      playerScore: primary.playerScore ?? secondary.playerScore ?? null,
      hasPlayerScore: Boolean(primary.hasPlayerScore || secondary.hasPlayerScore),
      salePrice: primary.salePrice ?? secondary.salePrice ?? null,
      normalPrice: primary.normalPrice ?? secondary.normalPrice ?? null,
      savings: primary.savings || secondary.savings || 0,
      dealUrl: primary.dealUrl || secondary.dealUrl || '',
      steamUrl: primary.steamUrl || secondary.steamUrl || '',
      wikiTitle: primary.wikiTitle || secondary.wikiTitle || '',
      wikiUrl: primary.wikiUrl || secondary.wikiUrl || '',
      platforms:
        primary.platforms?.length && !(primary.platforms.length === 1 && primary.platforms[0] === 'pc' && secondary.platforms?.length > 1)
          ? primary.platforms
          : secondary.platforms?.length
          ? secondary.platforms
          : primary.platforms || ['pc'],
      genres: primary.genres?.length ? primary.genres : secondary.genres || [],
      popularityScore: Math.max(primary.popularityScore || 0, secondary.popularityScore || 0)
    };

    gameIndex.set(merged.id, merged);
    return merged;
  }

  function dedupeGames(list) {
    const byKey = new Map();
    const bySteam = new Map();

    for (const g of list) {
      if (!g || !g.displayTitle) continue;
      const titleKey = canonicalGameKey(g.displayTitle);
      if (!titleKey) continue;

      let existingKey = null;
      if (g.steamAppId && bySteam.has(g.steamAppId)) {
        existingKey = bySteam.get(g.steamAppId);
      } else if (byKey.has(titleKey)) {
        existingKey = titleKey;
      }

      if (!existingKey) {
        byKey.set(titleKey, g);
        if (g.steamAppId) bySteam.set(g.steamAppId, titleKey);
      } else {
        const merged = mergeGameRecords(byKey.get(existingKey), g);
        byKey.set(existingKey, merged);
        if (merged.steamAppId) bySteam.set(merged.steamAppId, existingKey);
      }
    }
    return [...byKey.values()];
  }

  /* ---------- Fetch Helper ---------- */
  async function fetchJson(url, cacheKey, ttl = CFG.CACHE_TTL_MS) {
    if (cacheKey) {
      const cached = readCache(cacheKey);
      if (cached) return cached;
    }

    return enqueue(async () => {
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`HTTP ${res.status}`);
            await sleep(500 * (attempt + 1));
            continue;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const isEmptyArr = Array.isArray(data) && data.length === 0;
          if (cacheKey && !isEmptyArr) writeCache(cacheKey, data, ttl);
          return data;
        } catch (err) {
          clearTimeout(timer);
          lastErr = err;
          if (attempt < 1) await sleep(350);
        }
      }
      throw lastErr || new Error('Network request failed');
    });
  }

  async function fetchWikiSummary(wikiTitleOrName) {
    if (!wikiTitleOrName) return null;
    const slug = encodeURIComponent(String(wikiTitleOrName).replace(/\s+/g, '_'));
    const cacheKey = `wiki_${wikiTitleOrName}`;
    try {
      const data = await fetchJson(`${CFG.WIKI_SUMMARY_BASE}${slug}`, cacheKey, CFG.CACHE_TTL_MS * 4);
      const parsed = {
        extract: data.extract || '',
        thumbnail: data.thumbnail?.source || '',
        original: data.originalimage?.source || '',
        wikiUrl: data.content_urls?.desktop?.page || ''
      };
      writeCache(cacheKey, parsed, CFG.CACHE_TTL_MS * 4);
      return parsed;
    } catch {
      return null;
    }
  }

  /* ---------- Live Online Wikipedia Video Game Encyclopedia Search ---------- */
  const NON_GAME_DESC_RE = /\b(film|movie|television series|tv series|soundtrack|album|song|band|musician|actor|actress|disambiguation|list of|character|fictional|novel|manga|anime|comic book|board game|card game|tabletop|sport|company|developer|publisher|console|hardware)\b/i;
  const GAME_SIGNAL_RE = /\b(video game|action[- ]adventure|role[- ]playing|rpg|first[- ]person shooter|third[- ]person shooter|tactical shooter|shooter game|platform game|platformer|sandbox game|racing game|fighting game|strategy game|real[- ]time strategy|survival game|horror game|puzzle game|simulation game|rhythm game|battle royale|mmorpg|moba|roguelike|metroidvania|visual novel|arcade game|mobile game|gacha game|sports game|stealth game|open[- ]world|soulslike)\b/i;

  function isLikelyVideoGamePage(page) {
    const title = String(page?.title || '');
    const desc = String(page?.description || '');
    const extract = String(page?.extract || '');
    if (!title) return false;
    if (/^(List of|Category:|Template:|Portal:|Draft:)/i.test(title)) return false;
    if (/\(disambiguation\)|\(film\)|\(TV series\)|\(soundtrack\)|\(novel\)|\(character\)|\(album\)/i.test(title)) return false;

    // Explicit "(video game)" or "(20xx video game)" title is always a video game
    if (/\((?:\d{4}\s+)?video game\)/i.test(title)) return true;

    // Strong signal in short description or opening extract
    if (GAME_SIGNAL_RE.test(desc)) {
      if (/\b(video game company|video game developer|video game publisher|video game console|video game character|video game series)\b/i.test(desc)) {
        // Keep well-known series only if not a company/hardware/character
        return /\bvideo game series\b/i.test(desc);
      }
      return true;
    }

    if (NON_GAME_DESC_RE.test(desc)) return false;

    const firstSentence = extract.split(/(?<=[.!?])\s+/)[0] || extract;
    if (GAME_SIGNAL_RE.test(firstSentence)) {
      if (/\b(is a|was a)\s+(?:\w+\s+){0,3}(video game developer|video game publisher|video game company|video game console)\b/i.test(firstSentence)) {
        return false;
      }
      return true;
    }
    return false;
  }

  function inferPlatformsFromText(text) {
    const t = String(text || '').toLowerCase();
    const plats = [];
    if (/\b(windows|pc|microsoft windows|macos|linux|steam)\b/.test(t)) plats.push('pc');
    if (/\b(playstation|ps1|ps2|ps3|ps4|ps5|psp|ps vita)\b/.test(t)) plats.push('playstation');
    if (/\b(xbox|xbox 360|xbox one|xbox series)\b/.test(t)) plats.push('xbox');
    if (/\b(nintendo|switch|wii|gamecube|n64|snes|nes|game boy|ds|3ds)\b/.test(t)) plats.push('nintendo');
    if (/\b(steam deck)\b/.test(t)) plats.push('deck');
    return plats.length ? plats : ['pc'];
  }

  function inferGenresFromText(text) {
    const t = String(text || '').toLowerCase();
    const out = [];
    if (/\b(role[- ]playing|rpg|jrpg|mmorpg)\b/.test(t)) out.push('rpg');
    if (/\b(action[- ]adventure)\b/.test(t)) out.push('action-adventure');
    if (/\b(shooter|fps|battle royale)\b/.test(t)) out.push('shooter');
    if (/\b(strategy|tactical|4x|rts|moba)\b/.test(t)) out.push('strategy');
    if (/\b(platformer|platform game)\b/.test(t)) out.push('platformer');
    if (/\b(roguelike|roguelite)\b/.test(t)) out.push('roguelike');
    if (/\b(metroidvania)\b/.test(t)) out.push('metroidvania');
    if (/\b(soulslike|souls-like)\b/.test(t)) out.push('soulslike');
    if (/\b(horror)\b/.test(t)) out.push('horror');
    if (/\b(puzzle)\b/.test(t)) out.push('puzzle');
    if (/\b(simulation|sandbox|survival|city[- ]building)\b/.test(t)) out.push('simulation');
    if (/\b(open[- ]world)\b/.test(t)) out.push('open-world');
    if (/\b(indie)\b/.test(t)) out.push('indie');
    if (/\b(action|hack and slash|fighting)\b/.test(t) && !out.includes('action-adventure')) out.push('action');
    return out;
  }

  function normalizeWikiGame(page) {
    const rawTitle = String(page.title || '').trim();
    const displayTitle = rawTitle.replace(/\s*\((?:(?:\d{4}\s+)?video game|game)\)\s*$/i, '').trim() || rawTitle;
    const desc = String(page.description || '').trim();
    const extract = String(page.extract || '').trim();
    const combined = `${desc} ${extract}`;

    const yearMatch = desc.match(/\b(19[7-9]\d|20[0-2]\d)\b/) || extract.match(/\b(19[7-9]\d|20[0-2]\d)\b/);
    const yearNum = yearMatch ? Number(yearMatch[1]) : 0;

    const devMatch = extract.match(/developed by ([A-Z][^.,;()\n]{2,42}?)(?:\s+and published|\s+for\b|[.,;(])/i);
    const pubMatch = extract.match(/published by ([A-Z][^.,;()\n]{2,42}?)(?:\s+for\b|\s+in\b|[.,;(])/i);
    const studio = devMatch ? devMatch[1].trim() : desc || 'Online Game Encyclopedia';
    const publisher = pubMatch ? pubMatch[1].trim() : studio;

    const thumb = page.thumbnail?.source || '';
    const platforms = inferPlatformsFromText(combined);
    const genres = inferGenresFromText(combined);
    const id = `wiki-${page.pageid || slugify(rawTitle)}`;

    const item = {
      id,
      title: displayTitle,
      displayTitle,
      year: yearNum,
      yearNum,
      displayYear: yearNum > 0 ? String(yearNum) : '—',
      steamAppId: null,
      metacritic: null,
      playerScore: null,
      hasMetacritic: false,
      hasPlayerScore: false,
      hours: null,
      platforms,
      modes: /\b(multiplayer|online|co-op|battle royale|mmorpg|moba)\b/i.test(combined) ? ['multiplayer'] : ['singleplayer'],
      genres,
      themes: [],
      studio,
      publisher,
      awards: [],
      awardBadge: '',
      overview: extract,
      posterUrl: thumb,
      fallbackPosterUrl: '',
      backdropUrl: thumb,
      wikiTitle: rawTitle.replace(/\s+/g, '_'),
      wikiUrl: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(rawTitle.replace(/\s+/g, '_'))}`,
      steamUrl: '',
      salePrice: null,
      normalPrice: null,
      savings: 0,
      dealUrl: '',
      difficulty: 'balanced',
      approxPrice: /\b(free-to-play|free to play)\b/i.test(combined) ? 0 : 40,
      popularityScore: (thumb ? 550 : 250) + (yearNum >= 2015 ? 80 : 0),
      source: 'wikipedia'
    };

    gameIndex.set(item.id, item);
    return item;
  }

  async function searchWikipediaGames(query, limit = 18) {
    const clean = String(query || '').trim();
    if (!clean) return [];
    const gsr = /\bvideo game\b/i.test(clean) ? clean : `${clean} "video game"`;
    const url = new URL(CFG.WIKI_API_BASE || 'https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', gsr);
    url.searchParams.set('gsrlimit', String(Math.min(20, Math.max(8, limit))));
    url.searchParams.set('prop', 'pageimages|extracts|description|info');
    url.searchParams.set('piprop', 'thumbnail');
    url.searchParams.set('pithumbsize', '420');
    url.searchParams.set('pilimit', '20');
    url.searchParams.set('exintro', '1');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('exsentences', '2');
    url.searchParams.set('exlimit', '20');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    try {
      const data = await fetchJson(url.toString(), `wiki_search_${gsr.toLowerCase()}`, CFG.CACHE_TTL_MS * 2);
      const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 99) - (b.index || 99));
      return pages.filter(isLikelyVideoGamePage).map(normalizeWikiGame);
    } catch {
      return [];
    }
  }

  /* ---------- Universal Sorter (Never Hides Unrated Games!) ---------- */
  function sortAndSanitize(items, sortMode, preserveOrderOnDefault = false) {
    const list = [...items];

    if (sortMode === 'metacritic.desc' || sortMode === 'metacritic.asc') {
      return list.sort((a, b) => {
        if (a.hasMetacritic !== b.hasMetacritic) return Number(b.hasMetacritic) - Number(a.hasMetacritic);
        if (a.hasMetacritic && b.hasMetacritic) {
          return sortMode === 'metacritic.desc'
            ? b.metacritic - a.metacritic || (b.playerScore || 0) - (a.playerScore || 0)
            : a.metacritic - b.metacritic;
        }
        return (b.popularityScore || 0) - (a.popularityScore || 0);
      });
    }

    if (sortMode === 'playerscore.desc' || sortMode === 'playerscore.asc') {
      return list.sort((a, b) => {
        if (a.hasPlayerScore !== b.hasPlayerScore) return Number(b.hasPlayerScore) - Number(a.hasPlayerScore);
        if (a.hasPlayerScore && b.hasPlayerScore) {
          return sortMode === 'playerscore.desc'
            ? b.playerScore - a.playerScore || (b.metacritic || 0) - (a.metacritic || 0)
            : a.playerScore - b.playerScore;
        }
        return (b.popularityScore || 0) - (a.popularityScore || 0);
      });
    }

    if (sortMode === 'year.desc') {
      return list.sort((a, b) => (b.yearNum || 0) - (a.yearNum || 0));
    }

    if (sortMode === 'year.asc') {
      return list.sort((a, b) => {
        const ya = a.yearNum || Number.MAX_SAFE_INTEGER;
        const yb = b.yearNum || Number.MAX_SAFE_INTEGER;
        return ya - yb;
      });
    }

    if (sortMode === 'hours.asc') {
      return list.sort((a, b) => {
        const ha = a.hours || Number.MAX_SAFE_INTEGER;
        const hb = b.hours || Number.MAX_SAFE_INTEGER;
        return ha - hb;
      });
    }

    if (sortMode === 'title.asc') {
      return list.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
    }

    if (preserveOrderOnDefault) return list;
    return list.sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
  }

  /* ---------- Home Spotlight & Collections ---------- */
  function getCuratedVault() {
    return CFG.CURATED_GAMES.map(normalizeCuratedGame);
  }

  async function fetchHeroSpotlight() {
    return getCuratedVault().filter((g) => g.featured).slice(0, 6);
  }

  async function fetchLiveDeals({ page = 0, pageSize = 24, metacritic = 80, steamRating = 80, sortBy = 'Metacritic', title = '', upperPrice = null, onSale = false, storeID = '1' } = {}) {
    const url = new URL(`${CFG.CHEAPSHARK_BASE}/deals`);
    if (storeID) url.searchParams.set('storeID', String(storeID));
    url.searchParams.set('pageNumber', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    if (sortBy) url.searchParams.set('sortBy', sortBy);
    if (metacritic > 0) url.searchParams.set('metacritic', String(metacritic));
    if (steamRating > 0) url.searchParams.set('steamRating', String(steamRating));
    if (title) url.searchParams.set('title', title);
    if (upperPrice !== null && upperPrice !== undefined) url.searchParams.set('upperPrice', String(upperPrice));
    if (onSale) url.searchParams.set('onSale', '1');

    const rows = await fetchJson(url.toString(), `cs_deals_${url.searchParams.toString()}`);
    if (!Array.isArray(rows)) return [];
    return dedupeGames(rows.map(normalizeCheapSharkDeal));
  }

  async function hydrateWikiCover(game) {
    if (!game || game.posterUrl || !game.wikiTitle) return '';
    const wiki = await fetchWikiSummary(game.wikiTitle);
    if (wiki?.thumbnail) {
      game.posterUrl = wiki.thumbnail;
      game.backdropUrl = wiki.thumbnail;
      gameIndex.set(game.id, game);
      return wiki.thumbnail;
    }
    return '';
  }

  async function fetchCollection(col) {
    if (col.type === 'live_deals') {
      try {
        const deals = await fetchLiveDeals({ page: 0, pageSize: 20, metacritic: 84, steamRating: 85, sortBy: 'Metacritic', onSale: true });
        if (deals.length) return deals.slice(0, 14);
      } catch {
        // graceful fallback to curated Steam games if CheapShark is temporarily unavailable
      }
      return getCuratedVault().filter((g) => g.steamAppId).slice(0, 14);
    }

    // Return immediately in 0ms (console-exclusive Wikipedia covers hydrate in the background)
    return getCuratedVault().filter(col.filter).slice(0, 14);
  }

  /* ---------- 3-Engine Universal Online Game Search ---------- */
  const SEARCH_ALIASES = {
    gta: 'grand theft auto',
    gtav: 'grand theft auto v',
    gta5: 'grand theft auto v',
    gta6: 'grand theft auto vi',
    rdr: 'red dead redemption',
    rdr2: 'red dead redemption 2',
    botw: 'breath of the wild',
    totk: 'tears of the kingdom',
    tlou: 'the last of us',
    gow: 'god of war',
    cod: 'call of duty',
    bg3: "baldur's gate 3",
    cs2: 'counter-strike 2',
    csgo: 'counter-strike',
    ff7: 'final fantasy vii',
    mgs: 'metal gear solid',
    re4: 'resident evil 4',
    wow: 'world of warcraft',
    lol: 'league of legends',
    mc: 'minecraft',
    p5: 'persona 5'
  };

  function expandQueryAlias(raw) {
    const clean = String(raw || '').trim();
    const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return SEARCH_ALIASES[key] || clean;
  }

  function rankSearchResults(items, rawQuery, expandedQuery) {
    const qNorm = canonicalGameKey(expandedQuery);
    const rawNorm = canonicalGameKey(rawQuery);
    const tokens = expandedQuery
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);

    const scoreItem = (g) => {
      const tNorm = canonicalGameKey(g.displayTitle);
      const tLower = g.displayTitle.toLowerCase();
      let score = 0;

      if (tNorm === qNorm || tNorm === rawNorm) score += 10000;
      else if (tNorm.startsWith(qNorm) || (rawNorm && tNorm.startsWith(rawNorm))) score += 6000;
      else if (tokens.length && tokens.every((tk) => tLower.includes(tk))) score += 3500;
      else if (tNorm.includes(qNorm)) score += 2500;
      else {
        const matchedTokens = tokens.filter((tk) => tLower.includes(tk)).length;
        score += matchedTokens * 600;
      }

      // Slightly downrank soundtrack/DLC bundles compared to base games
      if (/\b(soundtrack|ost|dlc|season pass|upgrade pack|artbook|demo)\b/i.test(g.displayTitle)) {
        score -= 1800;
      }

      if (g.source === 'curated') score += 500;
      if (g.posterUrl) score += 300;
      if (g.hasMetacritic) score += g.metacritic * 3;
      if (g.hasPlayerScore) score += g.playerScore * 20;
      return score;
    };

    return [...items].sort((a, b) => scoreItem(b) - scoreItem(a));
  }

  async function searchGames(query) {
    const clean = String(query || '').trim();
    if (!clean) return [];
    const expanded = expandQueryAlias(clean);
    const qLower = expanded.toLowerCase();
    const tokens = qLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

    // Engine 1: Instant Curated Vault matches (fuzzy token matching)
    const vaultMatches = getCuratedVault().filter((g) => {
      const hay = [
        g.displayTitle,
        g.studio,
        g.publisher,
        ...(g.genres || []),
        ...(g.themes || []),
        ...(g.platforms || []),
        g.difficulty || '',
        g.awardBadge,
        g.overview
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(qLower) || (tokens.length > 0 && tokens.every((t) => hay.includes(t)));
    });

    // Engine 2A + 2B + Engine 3: Parallel online search across CheapShark Multi-Store & Wikipedia Encyclopedia
    const csGamesUrl = `${CFG.CHEAPSHARK_BASE}/games?title=${encodeURIComponent(expanded)}&limit=40`;

    const [dealsRes, gamesRes, wikiRes] = await Promise.allSettled([
      fetchLiveDeals({
        page: 0,
        pageSize: 30,
        metacritic: 0,
        steamRating: 0,
        sortBy: 'Title',
        title: expanded,
        storeID: '' // Search ALL PC stores (Steam, Epic, GOG, Humble, Fanatical, GMG, etc.)
      }),
      fetchJson(csGamesUrl, `cs_games_${qLower}`).then((rows) =>
        Array.isArray(rows)
          ? rows.map((r) =>
              normalizeCheapSharkDeal({
                gameID: r.gameID,
                title: r.external,
                steamAppID: r.steamAppID,
                salePrice: r.cheapest,
                dealID: r.cheapestDealID,
                thumb: r.thumb
              })
            )
          : []
      ),
      searchWikipediaGames(expanded, 18)
    ]);

    const liveDeals = dealsRes.status === 'fulfilled' ? dealsRes.value : [];
    const liveCatalog = gamesRes.status === 'fulfilled' ? gamesRes.value : [];
    const wikiGames = wikiRes.status === 'fulfilled' ? wikiRes.value : [];

    const merged = dedupeGames([...vaultMatches, ...liveDeals, ...liveCatalog, ...wikiGames]);
    return rankSearchResults(merged, clean, expanded);
  }

  /* ---------- Filter Studio Discovery (Curated Vault + Online Expansion) ---------- */
  async function discoverWithFilters(filters, page = 1) {
    const isLiveDealsOnly = filters.access.includes('deals') || filters.budget === 'onsale';

    // Curated Vault filtering (page 1)
    let results = [];
    if (page === 1 && !isLiveDealsOnly) {
      results = getCuratedVault().filter((g) => {
        if (filters.platform !== 'all' && !g.platforms.includes(filters.platform)) return false;
        if (filters.mode && !g.modes.includes(filters.mode)) return false;

        if (filters.genres.length) {
          const ok =
            filters.genreLogic === 'OR'
              ? filters.genres.some((x) => g.genres.includes(x))
              : filters.genres.every((x) => g.genres.includes(x));
          if (!ok) return false;
        }

        if (filters.minMetacritic > 0 && (!g.hasMetacritic || g.metacritic < filters.minMetacritic)) return false;
        if (filters.minPlayerScore > 0 && (!g.hasPlayerScore || g.playerScore < filters.minPlayerScore)) return false;

        if (filters.studios.length) {
          const st = g.studio.toLowerCase();
          const ok =
            filters.studioLogic === 'OR'
              ? filters.studios.some((s) => st.includes(s.name.toLowerCase()))
              : filters.studios.every((s) => st.includes(s.name.toLowerCase()));
          if (!ok) return false;
        }

        if (filters.themes.length) {
          const ok =
            filters.themeLogic === 'OR'
              ? filters.themes.some((t) => g.themes.includes(t))
              : filters.themes.every((t) => g.themes.includes(t));
          if (!ok) return false;
        }

        if (filters.publishers.length) {
          const pub = g.publisher.toLowerCase();
          const ok =
            filters.publisherLogic === 'OR'
              ? filters.publishers.some((p) => pub.includes(p.id.toLowerCase()) || pub.includes(p.name.toLowerCase()))
              : filters.publishers.every((p) => pub.includes(p.id.toLowerCase()) || pub.includes(p.name.toLowerCase()));
          if (!ok) return false;
        }

        if (filters.yearFrom && g.yearNum < Number(filters.yearFrom)) return false;
        if (filters.yearTo && g.yearNum > Number(filters.yearTo)) return false;

        if (filters.awards !== 'all') {
          if (filters.awards === 'hof' && (g.metacritic || 0) < 93) return false;
          if (filters.awards !== 'hof' && !g.awards.includes(filters.awards)) return false;
        }

        if (filters.maxHours < 100 && g.hours && g.hours > filters.maxHours) return false;
        if (filters.access.includes('indie') && !g.genres.includes('indie') && !g.awards.includes('indie')) return false;
        if (filters.access.includes('deck') && !g.platforms.includes('deck')) return false;

        // Budget filter
        if (filters.budget === 'free' && g.approxPrice > 0) return false;
        if (filters.budget === 'under10' && g.approxPrice > 10) return false;
        if (filters.budget === 'under20' && g.approxPrice > 20) return false;
        if (filters.budget === 'under40' && g.approxPrice > 40) return false;

        // Difficulty filter
        if (filters.difficulty && filters.difficulty !== 'all' && g.difficulty !== filters.difficulty) return false;

        return true;
      });
    }

    const canFetchLiveDeals =
      isLiveDealsOnly ||
      ((page > 1 || ['under10', 'under20', 'under40', 'free'].includes(filters.budget)) &&
        (filters.platform === 'all' || filters.platform === 'pc') &&
        !filters.genres.length &&
        !filters.studios.length &&
        !filters.themes.length &&
        !filters.publishers.length &&
        filters.awards === 'all' &&
        (!filters.difficulty || filters.difficulty === 'all'));

    let hasMoreLive =
      (filters.platform === 'all' || filters.platform === 'pc') &&
      !filters.genres.length &&
      !filters.studios.length &&
      !filters.themes.length &&
      !filters.publishers.length &&
      filters.awards === 'all' &&
      (!filters.difficulty || filters.difficulty === 'all');

    if (canFetchLiveDeals) {
      try {
        const sortBy =
          filters.sort === 'year.desc'
            ? 'Release'
            : filters.sort === 'title.asc'
            ? 'Title'
            : 'Metacritic';
        const minSteamPct = filters.minPlayerScore > 0 ? Math.max(50, Math.round(((filters.minPlayerScore - 1) / 4) * 100)) : 75;
        const upperPrice =
          filters.budget === 'free'
            ? 0
            : filters.budget === 'under10'
            ? 10
            : filters.budget === 'under20'
            ? 20
            : filters.budget === 'under40'
            ? 40
            : null;
        const livePage = isLiveDealsOnly || upperPrice !== null ? page - 1 : page - 2;
        const live = await fetchLiveDeals({
          page: Math.max(0, livePage),
          pageSize: 28,
          metacritic: Math.max(filters.minMetacritic || 0, 72),
          steamRating: minSteamPct,
          sortBy,
          upperPrice,
          onSale: filters.budget === 'onsale'
        });
        results = dedupeGames([...results, ...live]);
        hasMoreLive = live.length >= 10;
      } catch {
        hasMoreLive = false;
      }
    } else if (
      page === 1 &&
      !isLiveDealsOnly &&
      (results.length < 14 || filters.studios.length > 0 || filters.publishers.length > 0) &&
      filters.minMetacritic === 0 &&
      filters.minPlayerScore === 0 &&
      filters.awards === 'all' &&
      (!filters.difficulty || filters.difficulty === 'all') &&
      (!filters.budget || filters.budget === 'all')
    ) {
      // Online encyclopedia expansion when user filters by Studio, Publisher, Platform (e.g. Nintendo/PS5), or Genre!
      const queryParts = [];
      if (filters.studios.length) queryParts.push(filters.studios.map((s) => s.name).join(' '));
      if (filters.publishers.length) queryParts.push(filters.publishers.map((p) => p.name).join(' '));
      if (filters.genres.length) {
        queryParts.push(
          filters.genres
            .slice(0, 2)
            .map((id) => CFG.GENRES.find((x) => x.id === id)?.name || id)
            .join(' ')
        );
      }
      if (filters.platform !== 'all') queryParts.push(CFG.PLATFORMS[filters.platform] || filters.platform);
      if (filters.yearFrom && filters.yearTo && filters.yearFrom === filters.yearTo) queryParts.push(String(filters.yearFrom));

      if (queryParts.length) {
        try {
          const wikiExtra = await searchWikipediaGames(queryParts.join(' '), 16);
          const filteredExtra = wikiExtra.filter((g) => {
            if (filters.yearFrom && g.yearNum && g.yearNum < Number(filters.yearFrom)) return false;
            if (filters.yearTo && g.yearNum && g.yearNum > Number(filters.yearTo)) return false;
            return true;
          });
          results = dedupeGames([...results, ...filteredExtra]);
        } catch {
          // keep curated vault results
        }
      }
    }

    const sorted = sortAndSanitize(results, filters.sort);
    return {
      results: sorted,
      total_pages: hasMoreLive ? page + 1 : page,
      total_results: sorted.length
    };
  }

  /* ---------- Game Dossier Details (Live Wikipedia + CheapShark Enrichment) ---------- */
  async function fetchGameDetails(id, fallbackItem = null) {
    let base = gameIndex.get(id) || fallbackItem;
    if (!base) {
      const curated = CFG.CURATED_GAMES.find((g) => g.id === id);
      if (curated) base = normalizeCuratedGame(curated);
    }
    if (!base) throw new Error('Game not found in archive');

    const enriched = { ...base };

    // Fetch full Wikipedia editorial summary if overview is empty/short or for console art
    if (!enriched.overview || enriched.overview.length < 120 || (!enriched.posterUrl && enriched.wikiTitle)) {
      const wiki =
        (enriched.wikiTitle && (await fetchWikiSummary(enriched.wikiTitle))) ||
        (await fetchWikiSummary(`${enriched.displayTitle} (video game)`)) ||
        (await fetchWikiSummary(enriched.displayTitle));
      if (wiki) {
        if (wiki.extract && wiki.extract.length > (enriched.overview || '').length) {
          enriched.overview = wiki.extract;
        }
        if (!enriched.posterUrl && wiki.thumbnail) enriched.posterUrl = wiki.thumbnail;
        if (!enriched.backdropUrl && (wiki.original || wiki.thumbnail)) {
          enriched.backdropUrl = wiki.original || wiki.thumbnail;
        }
        enriched.wikiUrl = enriched.wikiUrl || wiki.wikiUrl || '';
      }
    }

    // Fetch live CheapShark price if missing and game is on PC/Steam
    if (enriched.salePrice == null && (enriched.steamAppId || (enriched.platforms || []).includes('pc'))) {
      try {
        const deals = await fetchLiveDeals({ page: 0, pageSize: 4, metacritic: 0, steamRating: 0, title: enriched.displayTitle, storeID: '' });
        const exact = enriched.steamAppId
          ? deals.find((d) => d.steamAppId === enriched.steamAppId)
          : deals.find((d) => canonicalGameKey(d.displayTitle) === canonicalGameKey(enriched.displayTitle));
        if (exact) {
          if (exact.salePrice != null) {
            enriched.salePrice = exact.salePrice;
            enriched.normalPrice = exact.normalPrice;
            enriched.savings = exact.savings;
            enriched.dealUrl = exact.dealUrl;
          }
          if (!enriched.steamAppId && exact.steamAppId) {
            enriched.steamAppId = exact.steamAppId;
            enriched.steamUrl = exact.steamUrl;
          }
          if (!enriched.hasMetacritic && exact.hasMetacritic) {
            enriched.metacritic = exact.metacritic;
            enriched.hasMetacritic = true;
          }
          if (!enriched.hasPlayerScore && exact.hasPlayerScore) {
            enriched.playerScore = exact.playerScore;
            enriched.hasPlayerScore = true;
          }
        }
      } catch {
        // non-fatal
      }
    }

    gameIndex.set(enriched.id, enriched);
    return enriched;
  }

  /* ---------- Optional Google Gemini Search Grounding ---------- */
  async function geminiGroundedJson(promptText, cacheKey) {
    const geminiKey = getGeminiKey();
    if (!geminiKey) return null;

    if (cacheKey) {
      const cached = readCache(cacheKey);
      if (cached) return cached;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 }
      })
    });

    if (!res.ok) return null;
    const payload = await res.json();
    const rawText = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (cacheKey) writeCache(cacheKey, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async function aiNaturalLanguageDiscover(userPrompt) {
    const prompt = `You are a video game curator and archivist. Using Google Search to verify facts, return a JSON array of up to 8 exact video game recommendations matching: "${userPrompt}".
Return ONLY valid JSON with objects containing: {"title": string, "year": number, "reason": string}.`;

    const recs = await geminiGroundedJson(prompt, `ai_games_${userPrompt.toLowerCase()}`);
    if (!Array.isArray(recs) || !recs.length) return null;

    const resolved = [];
    for (const rec of recs.slice(0, 8)) {
      const matches = await searchGames(rec.title);
      if (matches[0]) {
        resolved.push({ ...matches[0], aiReason: rec.reason || '' });
      }
    }
    return dedupeGames(resolved);
  }

  async function verifyGamePrestige(gameId, title, year) {
    const prompt = `Verify the exact Metacritic score (out of 100), OpenCritic/player rating (out of 5), and major awards won (The Game Awards, BAFTA, D.I.C.E., GDC) for the video game "${title}" (${year}).
Return ONLY JSON: {"metacritic": number|null, "playerScore": number|null, "awardsSummary": string}`;
    return geminiGroundedJson(prompt, `verify_game_${gameId}`);
  }

  return {
    getGeminiKey,
    clearCache,
    sortAndSanitize,
    fetchHeroSpotlight,
    fetchCollection,
    hydrateWikiCover,
    fetchGameDetails,
    searchGames,
    discoverWithFilters,
    aiNaturalLanguageDiscover,
    verifyGamePrestige
  };
})();

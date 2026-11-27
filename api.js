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

  /* ---------- Steam Asset URLs ---------- */
  function steamPortraitUrl(appId) {
    return appId ? `${CFG.STEAM_ASSET_BASE}${appId}/library_600x900_2x.jpg` : '';
  }

  function steamHeaderUrl(appId) {
    return appId ? `${CFG.STEAM_ASSET_BASE}${appId}/header.jpg` : '';
  }

  function steamHeroUrl(appId) {
    return appId ? `${CFG.STEAM_ASSET_BASE}${appId}/library_hero.jpg` : '';
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
      : wikiCache?.original || wikiCache?.thumbnail || '';

    const normalized = {
      ...raw,
      displayTitle: raw.title,
      displayYear: raw.year ? String(raw.year) : '—',
      yearNum: Number(raw.year || 0),
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

  function dedupeGames(list) {
    const map = new Map();
    for (const g of list) {
      if (!g || !g.displayTitle) continue;
      const key = g.steamAppId
        ? `steam:${g.steamAppId}`
        : g.displayTitle.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const existing = map.get(key);
      if (!existing) {
        map.set(key, g);
      } else {
        // Keep curated metadata if either is curated, while preserving live deal price!
        if (existing.source === 'curated' && g.salePrice != null && existing.salePrice == null) {
          map.set(key, { ...existing, salePrice: g.salePrice, normalPrice: g.normalPrice, savings: g.savings, dealUrl: g.dealUrl });
        } else if (g.source === 'curated' && existing.source !== 'curated') {
          map.set(key, { ...g, salePrice: existing.salePrice ?? g.salePrice, normalPrice: existing.normalPrice ?? g.normalPrice, savings: existing.savings ?? g.savings, dealUrl: existing.dealUrl || g.dealUrl });
        }
      }
    }
    return [...map.values()];
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
          if (cacheKey) writeCache(cacheKey, data, ttl);
          return data;
        } catch (err) {
          clearTimeout(timer);
          lastErr = err;
          if (attempt < 1) await sleep(400);
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

  /* ---------- Universal Sorter ---------- */
  function sortAndSanitize(items, sortMode, preserveOrderOnDefault = false) {
    let list = [...items];

    if (sortMode === 'metacritic.desc' || sortMode === 'metacritic.asc') {
      list = list.filter((g) => g.hasMetacritic);
      return list.sort((a, b) =>
        sortMode === 'metacritic.desc'
          ? b.metacritic - a.metacritic || (b.playerScore || 0) - (a.playerScore || 0)
          : a.metacritic - b.metacritic
      );
    }

    if (sortMode === 'playerscore.desc' || sortMode === 'playerscore.asc') {
      list = list.filter((g) => g.hasPlayerScore);
      return list.sort((a, b) =>
        sortMode === 'playerscore.desc'
          ? b.playerScore - a.playerScore || (b.metacritic || 0) - (a.metacritic || 0)
          : a.playerScore - b.playerScore
      );
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

  async function fetchLiveDeals({ page = 0, pageSize = 18, metacritic = 80, steamRating = 80, sortBy = 'Metacritic', title = '' } = {}) {
    const url = new URL(`${CFG.CHEAPSHARK_BASE}/deals`);
    url.searchParams.set('storeID', '1'); // Steam
    url.searchParams.set('pageNumber', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('sortBy', sortBy);
    if (metacritic > 0) url.searchParams.set('metacritic', String(metacritic));
    if (steamRating > 0) url.searchParams.set('steamRating', String(steamRating));
    if (title) url.searchParams.set('title', title);

    const rows = await fetchJson(url.toString(), `cs_deals_${url.searchParams.toString()}`);
    if (!Array.isArray(rows)) return [];
    return dedupeGames(rows.map(normalizeCheapSharkDeal));
  }

  async function fetchCollection(col) {
    if (col.type === 'live_deals') {
      try {
        const deals = await fetchLiveDeals({ page: 0, pageSize: 20, metacritic: 84, steamRating: 85, sortBy: 'Metacritic' });
        if (deals.length) return deals.slice(0, 14);
      } catch {
        // graceful fallback to curated Steam games if CheapShark is temporarily unavailable
      }
      return getCuratedVault().filter((g) => g.steamAppId).slice(0, 14);
    }

    const matched = getCuratedVault().filter(col.filter);
    // Lazily enrich console exclusives lacking Steam covers with Wikipedia cover art
    const consoleOnes = matched.filter((g) => !g.posterUrl && g.wikiTitle);
    if (consoleOnes.length) {
      await Promise.allSettled(
        consoleOnes.slice(0, 4).map(async (g) => {
          const wiki = await fetchWikiSummary(g.wikiTitle);
          if (wiki?.thumbnail) {
            g.posterUrl = wiki.thumbnail;
            g.backdropUrl = wiki.original || wiki.thumbnail;
            gameIndex.set(g.id, g);
          }
        })
      );
    }
    return matched.slice(0, 14);
  }

  /* ---------- Hybrid Live Search (Curated Vault + 40,000+ CheapShark Games) ---------- */
  async function searchGames(query) {
    const clean = query.trim();
    const qLower = clean.toLowerCase();

    // 1. Instant local vault matches (title, studio, publisher, genre, theme, platform)
    const vaultMatches = getCuratedVault().filter((g) => {
      const hay = [
        g.displayTitle,
        g.studio,
        g.publisher,
        ...(g.genres || []),
        ...(g.themes || []),
        ...(g.platforms || []),
        g.awardBadge
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(qLower);
    });

    // 2. Live CheapShark search across 40,000+ Steam/PC titles
    let liveMatches = [];
    try {
      const deals = await fetchLiveDeals({
        page: 0,
        pageSize: 24,
        metacritic: 0,
        steamRating: 0,
        sortBy: 'Metacritic',
        title: clean
      });
      liveMatches = deals;

      // Also hit /games?title=... if deals returned few items (catches games not currently listed in deals)
      if (liveMatches.length < 6) {
        const gUrl = `${CFG.CHEAPSHARK_BASE}/games?title=${encodeURIComponent(clean)}&limit=18`;
        const rows = await fetchJson(gUrl, `cs_games_${qLower}`);
        if (Array.isArray(rows)) {
          const extra = rows.map((r) =>
            normalizeCheapSharkDeal({
              gameID: r.gameID,
              title: r.external,
              steamAppID: r.steamAppID,
              salePrice: r.cheapest,
              dealID: r.cheapestDealID,
              thumb: r.thumb
            })
          );
          liveMatches = [...liveMatches, ...extra];
        }
      }
    } catch {
      // keep vault matches if offline
    }

    return dedupeGames([...vaultMatches, ...liveMatches]);
  }

  /* ---------- Filter Studio Discovery ---------- */
  async function discoverWithFilters(filters, page = 1) {
    const isLiveDealsOnly = filters.access.includes('deals');

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

        return true;
      });
    }

    // Live CheapShark augmentation when browsing Deals or loading page 2+ on PC / All Platforms
    const canFetchLiveDeals =
      isLiveDealsOnly ||
      (page > 1 &&
        (filters.platform === 'all' || filters.platform === 'pc') &&
        !filters.genres.length &&
        !filters.studios.length &&
        !filters.themes.length &&
        !filters.publishers.length &&
        filters.awards === 'all');

    let hasMoreLive =
      (filters.platform === 'all' || filters.platform === 'pc') &&
      !filters.genres.length &&
      !filters.studios.length &&
      !filters.themes.length &&
      !filters.publishers.length &&
      filters.awards === 'all';

    if (canFetchLiveDeals) {
      try {
        const sortBy =
          filters.sort === 'year.desc'
            ? 'Release'
            : filters.sort === 'title.asc'
            ? 'Title'
            : 'Metacritic';
        const minSteamPct = filters.minPlayerScore > 0 ? Math.max(50, Math.round(((filters.minPlayerScore - 1) / 4) * 100)) : 75;
        const livePage = isLiveDealsOnly ? page - 1 : page - 2;
        const live = await fetchLiveDeals({
          page: Math.max(0, livePage),
          pageSize: 24,
          metacritic: Math.max(filters.minMetacritic || 0, 72),
          steamRating: minSteamPct,
          sortBy
        });
        results = dedupeGames([...results, ...live]);
        hasMoreLive = live.length >= 10;
      } catch {
        hasMoreLive = false;
      }
    }

    // Enrich console exclusive covers on page 1 if needed
    const consoleMissing = results.filter((g) => !g.posterUrl && g.wikiTitle).slice(0, 5);
    if (consoleMissing.length) {
      await Promise.allSettled(
        consoleMissing.map(async (g) => {
          const wiki = await fetchWikiSummary(g.wikiTitle);
          if (wiki?.thumbnail) {
            g.posterUrl = wiki.thumbnail;
            g.backdropUrl = wiki.original || wiki.thumbnail;
          }
        })
      );
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

    // Fetch Wikipedia editorial summary if overview is empty or for console art
    if (!enriched.overview || (!enriched.posterUrl && enriched.wikiTitle)) {
      const wiki =
        (enriched.wikiTitle && (await fetchWikiSummary(enriched.wikiTitle))) ||
        (await fetchWikiSummary(`${enriched.displayTitle} (video game)`)) ||
        (await fetchWikiSummary(enriched.displayTitle));
      if (wiki) {
        if (!enriched.overview && wiki.extract) enriched.overview = wiki.extract;
        if (!enriched.posterUrl && wiki.thumbnail) enriched.posterUrl = wiki.thumbnail;
        if (!enriched.backdropUrl && (wiki.original || wiki.thumbnail)) {
          enriched.backdropUrl = wiki.original || wiki.thumbnail;
        }
        enriched.wikiUrl = wiki.wikiUrl || '';
      }
    }

    // Fetch live CheapShark price if missing and game is on PC/Steam
    if (enriched.salePrice == null && enriched.steamAppId) {
      try {
        const deals = await fetchLiveDeals({ page: 0, pageSize: 4, metacritic: 0, steamRating: 0, title: enriched.displayTitle });
        const exact = deals.find((d) => d.steamAppId === enriched.steamAppId);
        if (exact && exact.salePrice != null) {
          enriched.salePrice = exact.salePrice;
          enriched.normalPrice = exact.normalPrice;
          enriched.savings = exact.savings;
          enriched.dealUrl = exact.dealUrl;
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
    fetchGameDetails,
    searchGames,
    discoverWithFilters,
    aiNaturalLanguageDiscover,
    verifyGamePrestige
  };
})();

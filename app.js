/* ==========================================================================
   WOULD PLAY THAT — Mobile-First Interactive Games Archive Controller
   Large Filter Sheets, AND/OR Toggles, Tap-Again Deselect, Backlog & Auth
   ========================================================================== */

(() => {
  const CFG = window.WPT_CONFIG;
  const API = window.WPT_API;

  const SVG_LAUREL = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7 4C3.5 7 3.5 14 8 19M17 4c3.5 3 3.5 10-1 15M8 19h8"/></svg>`;

  const state = {
    view: 'home',
    heroItems: [],
    heroIndex: 0,
    heroTimer: null,
    discoverPage: 1,
    discoverTotalPages: 1,
    discoverMode: 'filter',
    discoverSeq: 0,
    currentResults: [],
    lastQuery: '',
    backlogFilter: 'all',
    activeUser: localStorage.getItem(CFG.STORAGE_KEYS.ACTIVE_USER) || null,
    authMode: 'login',
    filters: createDefaultFilters()
  };

  function createDefaultFilters() {
    return {
      platform: 'all',
      mode: '',
      genres: [],
      genreLogic: 'AND',
      minMetacritic: 0,
      minPlayerScore: 0,
      studios: [],
      studioLogic: 'OR',
      themes: [],
      themeLogic: 'AND',
      publishers: [],
      publisherLogic: 'OR',
      era: 'all',
      yearFrom: '',
      yearTo: '',
      awards: 'all',
      maxHours: 100,
      access: [],
      sort: 'popularity.desc'
    };
  }

  const $ = (id) => document.getElementById(id);

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    applySavedAppearance();
    renderSettingsControls();
    renderFilterControls();
    bindGlobalEvents();
    updateAuthUI();
    updateBacklogBadge();
    loadHomeContent();
  });

  /* ---------- Appearance & Settings ---------- */
  function applySavedAppearance() {
    const theme = localStorage.getItem(CFG.STORAGE_KEYS.THEME) || 'abyssal-carbon';
    const accent = localStorage.getItem(CFG.STORAGE_KEYS.ACCENT) || 'royal-gold';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-accent', accent);
  }

  function renderSettingsControls() {
    const curTheme = document.documentElement.getAttribute('data-theme');
    const curAccent = document.documentElement.getAttribute('data-accent');

    $('themeSelectorGrid').innerHTML = CFG.THEMES.map(
      (t) => `
      <button type="button" class="swatch-btn ${curTheme === t.id ? 'active' : ''}" data-set-theme="${t.id}">
        <span class="swatch-dot" style="background:${t.swatch}"></span>
        <span>${t.name}</span>
      </button>`
    ).join('');

    $('accentSelectorGrid').innerHTML = CFG.ACCENTS.map(
      (a) => `
      <button type="button" class="swatch-btn ${curAccent === a.id ? 'active' : ''}" data-set-accent="${a.id}">
        <span class="swatch-dot" style="background:${a.swatch}"></span>
        <span>${a.name}</span>
      </button>`
    ).join('');

    $('geminiKeyInput').value = localStorage.getItem(CFG.STORAGE_KEYS.GEMINI_KEY) || '';
  }

  function openSettings() {
    renderSettingsControls();
    $('settingsDrawer').classList.remove('hidden');
  }

  function closeSettings() {
    $('settingsDrawer').classList.add('hidden');
  }

  /* ---------- View Switching ---------- */
  function switchView(viewName, { skipAutoDiscover = false } = {}) {
    state.view = viewName;
    closeAllPopovers();
    document.querySelectorAll('.view-section').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === viewName));
    document.querySelectorAll('.dock-btn').forEach((b) => b.classList.toggle('active', b.dataset.mobileNav === viewName));
    $(`${viewName}View`)?.classList.add('active');

    if (viewName === 'discover' && !skipAutoDiscover && !state.currentResults.length) {
      runDiscover(1, false);
    }
    if (viewName === 'backlog') renderBacklogView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Popover / Mobile Bottom Sheet Controls ---------- */
  function closeAllPopovers(exceptBox = null) {
    let anyOpen = false;
    document.querySelectorAll('.filter-popover').forEach((box) => {
      if (box === exceptBox) {
        anyOpen = true;
        return;
      }
      box.classList.remove('open');
      box.querySelector('.filter-panel')?.classList.add('hidden');
      box.querySelector('.filter-trigger')?.setAttribute('aria-expanded', 'false');
    });

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    $('sheetBackdrop').classList.toggle('hidden', !(anyOpen && isMobile));
    document.body.classList.toggle('sheet-open', anyOpen && isMobile);
  }

  /* ---------- Home: Swipeable Hero & Collections ---------- */
  function createSkeletonCards(count = 6) {
    return Array.from({ length: count }, () => `<div class="skeleton-card shimmer"></div>`).join('');
  }

  async function loadHomeContent() {
    const container = $('collectionsContainer');
    container.innerHTML = CFG.COLLECTIONS.map(
      (col) => `
      <div class="collection-block" id="col-${col.id}">
        <div class="collection-head">
          <div>
            <p class="eyebrow">${col.eyebrow}</p>
            <h2 class="collection-title">${col.title}</h2>
          </div>
        </div>
        <div class="collection-row" id="col-row-${col.id}">${createSkeletonCards(6)}</div>
      </div>`
    ).join('');

    try {
      state.heroItems = await API.fetchHeroSpotlight();
      state.heroIndex = 0;
      renderHeroSlide();
      startHeroAutoRotate();
    } catch (err) {
      $('heroTrack').innerHTML = `<div class="hero-skeleton"><span>Unable to load spotlight (${escapeHtml(err.message)}).</span></div>`;
    }

    for (const col of CFG.COLLECTIONS) {
      API.fetchCollection(col)
        .then((items) => {
          const row = $(`col-row-${col.id}`);
          if (!row) return;
          row.innerHTML = items.length
            ? items.map((item) => createCardHTML(item)).join('')
            : `<div class="empty-state" style="min-width:260px;">No titles available for ${escapeHtml(col.title)}.</div>`;
          attachCoverFallbacks(row);
        })
        .catch(() => {
          const row = $(`col-row-${col.id}`);
          if (row) row.innerHTML = `<div class="empty-state" style="min-width:260px;">Unable to load ${escapeHtml(col.title)}.</div>`;
        });
    }
  }

  function renderHeroSlide() {
    if (!state.heroItems.length) return;
    const item = state.heroItems[state.heroIndex];
    const saved = isInBacklog(item.id);
    const metaPayload = serializeBacklogPayload(item);

    $('heroTrack').innerHTML = `
      <div class="hero-slide hero-game-slide">
        ${item.backdropUrl ? `<div class="hero-backdrop-art" style="background-image:url('${item.backdropUrl}')"></div>` : ''}
        <div class="hero-layout">
          <div class="hero-box-wrap">
            ${
              item.posterUrl
                ? `<img class="hero-box-art" src="${item.posterUrl}" data-fallback-src="${escapeHtml(item.fallbackPosterUrl || '')}" alt="${escapeHtml(item.displayTitle)}" data-fallback-title="${escapeHtml(item.displayTitle)}" data-fallback-sub="${escapeHtml(item.studio)}" />`
                : buildCoverPlaceholderHTML(item.displayTitle, item.studio, 'hero-box-art')
            }
          </div>
          <div class="hero-content">
            <div class="hero-badges">
              <span class="award-badge">${escapeHtml(item.studio)} · ${item.displayYear}${item.hours ? ` · ~${item.hours}h` : ''}</span>
              ${item.hasMetacritic ? `<span class="rating-pill rating-mc">MC ${item.metacritic}</span>` : ''}
              ${item.hasPlayerScore ? `<span class="rating-pill rating-user">★ ${item.playerScore.toFixed(1)}</span>` : ''}
              ${item.awardBadge ? `<span class="award-badge">${SVG_LAUREL} ${escapeHtml(item.awardBadge)}</span>` : ''}
            </div>
            <h1 class="hero-title">${escapeHtml(item.displayTitle)}</h1>
            <p class="hero-overview">${escapeHtml(item.overview || 'Explore reviews, platforms, playtime, and trailers.')}</p>
            <div class="hero-cta-row">
              <button class="btn-accent" data-action="hero-briefing" data-id="${escapeHtml(item.id)}">Game Briefing</button>
              <button class="btn-outline" data-action="open-detail" data-id="${escapeHtml(item.id)}">Dossier</button>
              <button class="btn-outline" data-action="toggle-hero-backlog" data-payload="${metaPayload}">
                ${saved ? '✓ In Backlog' : '+ Backlog'}
              </button>
            </div>
          </div>
        </div>
      </div>`;

    attachCoverFallbacks($('heroTrack'));

    $('heroDots').innerHTML = state.heroItems
      .map((_, i) => `<button class="hero-dot ${i === state.heroIndex ? 'active' : ''}" data-hero-dot="${i}" aria-label="Slide ${i + 1}"></button>`)
      .join('');

    const bar = $('heroProgressBar');
    bar.classList.remove('running');
    void bar.offsetWidth;
    bar.classList.add('running');
  }

  function stepHero(delta) {
    if (!state.heroItems.length) return;
    state.heroIndex = (state.heroIndex + delta + state.heroItems.length) % state.heroItems.length;
    renderHeroSlide();
    startHeroAutoRotate();
  }

  function startHeroAutoRotate() {
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => {
      if (state.view !== 'home' || !state.heroItems.length) return;
      state.heroIndex = (state.heroIndex + 1) % state.heroItems.length;
      renderHeroSlide();
    }, 7500);
  }

  /* ---------- Filter Controls ---------- */
  function renderFilterControls() {
    $('modeSelect').innerHTML = CFG.MODES.map(
      (m) => `<option value="${m.code}">${escapeHtml(m.name)}</option>`
    ).join('');

    $('genrePills').innerHTML = CFG.GENRES.map(
      (g) => `<button type="button" class="chip" data-genre="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`
    ).join('');

    $('studioPresets').innerHTML = CFG.STUDIO_PRESETS.map(
      (s) => `<button type="button" class="chip" data-studio-preset="${escapeHtml(s.id)}" data-studio-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`
    ).join('');

    $('themePills').innerHTML = CFG.THEMES_VIEWS.map(
      (t) => `<button type="button" class="chip" data-theme-view="${escapeHtml(t.id)}">${escapeHtml(t.name)}</button>`
    ).join('');

    $('publisherPresets').innerHTML = CFG.PUBLISHER_PRESETS.map(
      (p) => `<button type="button" class="chip" data-publisher-preset="${escapeHtml(p.id)}" data-publisher-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`
    ).join('');

    $('eraPresets').innerHTML = CFG.ERAS.map(
      (e) => `<button type="button" class="chip ${e.id === 'all' ? 'active' : ''}" data-era="${e.id}">${escapeHtml(e.label)}</button>`
    ).join('');

    $('awardsPills').innerHTML = CFG.AWARDS_PRESETS.map(
      (a) => `<button type="button" class="chip ${a.id === 'all' ? 'active' : ''}" data-award="${a.id}">${escapeHtml(a.label)}</button>`
    ).join('');

    $('accessPills').innerHTML = CFG.ACCESS_OPTIONS.map(
      (opt) => `<button type="button" class="chip" data-access="${opt.id}">${escapeHtml(opt.label)}</button>`
    ).join('');

    syncFilterBadges();
  }

  function toggleEntityFilter(type, entity) {
    const list = type === 'studio' ? state.filters.studios : state.filters.publishers;
    const norm = String(entity.id).toLowerCase();
    const idx = list.findIndex((item) => String(item.id).toLowerCase() === norm);
    let added = false;

    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push({ id: entity.id, name: entity.name || entity.id });
      added = true;
    }

    syncEntityUI(type);
    syncFilterBadges();
    return added;
  }

  function syncEntityUI(type) {
    if (type === 'studio') {
      renderSelectedTags('selectedStudioTags', state.filters.studios, 'studio');
      $('studioPresets').querySelectorAll('[data-studio-preset]').forEach((btn) => {
        const active = state.filters.studios.some(
          (s) => String(s.id).toLowerCase() === String(btn.dataset.studioPreset).toLowerCase()
        );
        btn.classList.toggle('active', active);
        btn.textContent = `${active ? '✓ ' : ''}${btn.dataset.studioName}`;
      });
    } else if (type === 'publisher') {
      renderSelectedTags('selectedPublisherTags', state.filters.publishers, 'publisher');
      $('publisherPresets').querySelectorAll('[data-publisher-preset]').forEach((btn) => {
        const active = state.filters.publishers.some(
          (p) => String(p.id).toLowerCase() === String(btn.dataset.publisherPreset).toLowerCase()
        );
        btn.classList.toggle('active', active);
        btn.textContent = `${active ? '✓ ' : ''}${btn.dataset.publisherName}`;
      });
    }
  }

  function renderSelectedTags(containerId, items, type) {
    $(containerId).innerHTML = items
      .map(
        (item) => `
      <button type="button" class="tag-removable" data-remove-tag="${type}" data-tag-id="${escapeHtml(item.id)}" title="Tap to remove ${escapeHtml(item.name)}">
        <span>✓ ${escapeHtml(item.name)}</span>
        <span aria-hidden="true">×</span>
      </button>`
      )
      .join('');
  }

  function syncFilterBadges() {
    const f = state.filters;
    const platLabel = f.platform === 'all' ? 'All' : CFG.PLATFORMS[f.platform] || f.platform;
    const modeObj = CFG.MODES.find((m) => m.code === f.mode);
    const modeLabel = f.mode ? modeObj?.name || f.mode : 'Any';
    $('badge-platform').textContent = `${platLabel} · ${modeLabel}`;

    const gNames = f.genres.map((id) => CFG.GENRES.find((g) => g.id === id)?.name || id);
    $('badge-genre').textContent = gNames.length
      ? `${gNames.slice(0, 2).join(f.genreLogic === 'OR' ? ' / ' : ' + ')}${gNames.length > 2 ? ` +${gNames.length - 2}` : ''}`
      : 'Any';

    $('badge-metacritic').textContent = f.minMetacritic > 0 ? `${f.minMetacritic}+ / 100` : 'Any';
    $('badge-playerscore').textContent = f.minPlayerScore > 0 ? `${f.minPlayerScore.toFixed(1)}★+` : 'Any';

    $('badge-studio').textContent = f.studios.length
      ? f.studios.map((s) => s.name).join(f.studioLogic === 'OR' ? ' / ' : ' & ')
      : 'Any';

    const tNames = f.themes.map((id) => CFG.THEMES_VIEWS.find((t) => t.id === id)?.name || id);
    $('badge-theme').textContent = tNames.length
      ? `${tNames.slice(0, 2).join(f.themeLogic === 'OR' ? ' / ' : ' + ')}${tNames.length > 2 ? ` +${tNames.length - 2}` : ''}`
      : 'Any';

    $('badge-publisher').textContent = f.publishers.length
      ? f.publishers.map((p) => p.name).join(f.publisherLogic === 'OR' ? ' / ' : ' & ')
      : 'Any';

    $('badge-era').textContent = f.yearFrom || f.yearTo ? `${f.yearFrom || '…'}–${f.yearTo || '…'}` : 'All Eras';
    $('badge-awards').textContent = CFG.AWARDS_PRESETS.find((a) => a.id === f.awards)?.label || 'All Games';

    const lenParts = [];
    if (f.maxHours < 100) lenParts.push(`≤${f.maxHours}h`);
    if (f.access.length) lenParts.push(`${f.access.length} filter${f.access.length > 1 ? 's' : ''}`);
    $('badge-length').textContent = lenParts.length ? lenParts.join(' · ') : 'Any';

    setPopoverActive('platform', f.platform !== 'all' || Boolean(f.mode));
    setPopoverActive('genre', f.genres.length > 0);
    setPopoverActive('metacritic', f.minMetacritic > 0);
    setPopoverActive('playerscore', f.minPlayerScore > 0);
    setPopoverActive('studio', f.studios.length > 0);
    setPopoverActive('theme', f.themes.length > 0);
    setPopoverActive('publisher', f.publishers.length > 0);
    setPopoverActive('era', Boolean(f.yearFrom || f.yearTo));
    setPopoverActive('awards', f.awards !== 'all');
    setPopoverActive('length', f.maxHours < 100 || f.access.length > 0);

    renderActiveFilterStrip();
  }

  function setPopoverActive(boxKey, isActive) {
    document.querySelector(`[data-filter-box="${boxKey}"]`)?.classList.toggle('has-value', isActive);
  }

  function renderActiveFilterStrip() {
    const f = state.filters;
    const chips = [];
    if (f.platform !== 'all') chips.push({ type: 'platform', id: '', label: CFG.PLATFORMS[f.platform] || f.platform });
    if (f.mode) chips.push({ type: 'mode', id: '', label: CFG.MODES.find((m) => m.code === f.mode)?.name || f.mode });
    if (f.minMetacritic > 0) chips.push({ type: 'metacritic', id: '', label: `Metacritic ≥ ${f.minMetacritic}` });
    if (f.minPlayerScore > 0) chips.push({ type: 'playerscore', id: '', label: `Player ≥ ${f.minPlayerScore.toFixed(1)}★` });
    f.genres.forEach((id) => {
      const g = CFG.GENRES.find((x) => x.id === id);
      if (g) chips.push({ type: 'genre', id, label: g.name });
    });
    f.studios.forEach((s) => chips.push({ type: 'studio', id: s.id, label: s.name }));
    f.themes.forEach((id) => {
      const t = CFG.THEMES_VIEWS.find((x) => x.id === id);
      if (t) chips.push({ type: 'theme', id, label: t.name });
    });
    f.publishers.forEach((p) => chips.push({ type: 'publisher', id: p.id, label: p.name }));
    if (f.yearFrom || f.yearTo) chips.push({ type: 'era', id: '', label: `${f.yearFrom || '…'}–${f.yearTo || '…'}` });
    if (f.awards !== 'all') chips.push({ type: 'awards', id: '', label: CFG.AWARDS_PRESETS.find((a) => a.id === f.awards)?.label || f.awards });
    if (f.maxHours < 100) chips.push({ type: 'hours', id: '', label: `Under ${f.maxHours}h` });
    f.access.forEach((id) => {
      const opt = CFG.ACCESS_OPTIONS.find((x) => x.id === id);
      if (opt) chips.push({ type: 'access', id, label: opt.label });
    });

    const strip = $('activeFiltersStrip');
    if (!chips.length) {
      strip.classList.add('hidden');
      strip.innerHTML = '';
      return;
    }
    strip.classList.remove('hidden');
    strip.innerHTML = chips
      .map(
        (c) => `
      <button type="button" class="tag-removable" data-strip-remove="${c.type}" data-strip-id="${escapeHtml(c.id)}">
        <span>${escapeHtml(c.label)}</span>
        <span aria-hidden="true">×</span>
      </button>`
      )
      .join('');
  }

  /* ---------- Discovery, Live Search & Sorter ---------- */
  function syncSorterUI(sortVal) {
    state.filters.sort = sortVal;
    $('sortSelect').value = sortVal;
    document.querySelectorAll('.sort-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sortVal === sortVal);
    });
  }

  function renderDiscoverGrid(items, append = false, metaPrefix = '') {
    const grid = $('discoverGrid');
    const isRatingSort = ['metacritic.desc', 'metacritic.asc', 'playerscore.desc', 'playerscore.asc'].includes(state.filters.sort);

    if (!append) state.currentResults = items;
    else {
      const seen = new Set(state.currentResults.map((x) => x.id));
      items.forEach((it) => {
        if (!seen.has(it.id)) {
          seen.add(it.id);
          state.currentResults.push(it);
        }
      });
    }

    const preserveOrder =
      (state.discoverMode === 'search' || state.discoverMode === 'ai') &&
      state.filters.sort === 'popularity.desc';
    const displayList = API.sortAndSanitize(state.currentResults, state.filters.sort, preserveOrder);
    const ratedNote = isRatingSort ? ' · unrated games hidden' : '';
    $('resultsMeta').textContent = `${metaPrefix}${displayList.length} game${displayList.length === 1 ? '' : 's'}${ratedNote}`;

    if (!displayList.length) {
      grid.innerHTML = `<div class="empty-state">No games match that exact combination. Try switching an <strong>AND</strong> filter to <strong>OR</strong>, or tap an active chip above to remove it.</div>`;
      return;
    }

    grid.innerHTML = displayList.map((item) => createCardHTML(item)).join('');
    attachCoverFallbacks(grid);
  }

  async function runDiscover(page = 1, append = false) {
    closeAllPopovers();
    const seq = ++state.discoverSeq;
    state.discoverMode = 'filter';
    state.discoverPage = page;
    if (!append) {
      $('discoverGrid').innerHTML = createSkeletonCards(8);
      $('resultsMeta').textContent = 'Filtering archive…';
    }

    try {
      const data = await API.discoverWithFilters(state.filters, page);
      if (seq !== state.discoverSeq) return;
      state.discoverTotalPages = data.total_pages;
      renderDiscoverGrid(data.results, append, 'Showing ');
      $('paginationBar').classList.toggle('hidden', page >= state.discoverTotalPages);
    } catch (err) {
      if (seq !== state.discoverSeq) return;
      $('discoverGrid').innerHTML = `<div class="empty-state">Unable to load games (${escapeHtml(err.message)}).</div>`;
    }
  }

  async function runConciergeSearch(query, useAI = false) {
    const clean = query.trim();
    if (!clean) return;

    const seq = ++state.discoverSeq;
    switchView('discover', { skipAutoDiscover: true });
    syncSorterUI('popularity.desc');
    state.lastQuery = clean;
    $('paginationBar').classList.add('hidden');

    if (useAI && !API.getGeminiKey()) {
      showToast('Add a Gemini API Key in Settings for AI Discover. Searching live archive.');
      useAI = false;
    }

    $('discoverGrid').innerHTML = createSkeletonCards(8);
    $('resultsMeta').textContent = useAI ? '✦ Consulting Gemini Game Grounding…' : `Searching “${clean}”…`;

    try {
      let results = [];
      let prefix = `Search “${clean}” — `;
      if (useAI) {
        state.discoverMode = 'ai';
        results = (await API.aiNaturalLanguageDiscover(clean)) || [];
        prefix = `✦ AI Grounded “${clean}” — `;
      }
      if (!useAI || !results.length) {
        state.discoverMode = 'search';
        results = await API.searchGames(clean);
      }
      if (seq !== state.discoverSeq) return;
      renderDiscoverGrid(results, false, prefix);
    } catch (err) {
      if (seq !== state.discoverSeq) return;
      $('discoverGrid').innerHTML = `<div class="empty-state">Search failed: ${escapeHtml(err.message)}</div>`;
    }
  }

  function handleSortChange(newSort) {
    syncSorterUI(newSort);
    if (state.discoverMode === 'filter') {
      runDiscover(1, false);
    } else if (state.currentResults.length) {
      const prefix = state.discoverMode === 'ai' ? `✦ AI Grounded “${state.lastQuery}” — ` : `Search “${state.lastQuery}” — `;
      renderDiscoverGrid(state.currentResults, false, prefix);
    }
  }

  /* ---------- Game Cards & Multi-Tier Cover Fallbacks ---------- */
  function buildCoverPlaceholderHTML(title, sub, extraClass = '') {
    return `
      <div class="poster-placeholder ${extraClass}">
        <span class="case-ornament" aria-hidden="true">◈</span>
        <span class="case-placeholder-title">${escapeHtml(title)}</span>
        <span class="case-placeholder-sub">${escapeHtml(sub || '')}</span>
      </div>`;
  }

  function attachCoverFallbacks(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('img[data-fallback-title]').forEach((img) => {
      let triedSecondary = false;
      let swapped = false;

      const swapToPlaceholder = () => {
        if (swapped || !img.parentNode) return;
        swapped = true;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildCoverPlaceholderHTML(
          img.dataset.fallbackTitle,
          img.dataset.fallbackSub,
          img.classList.contains('hero-box-art') ? 'hero-box-art' : img.classList.contains('detail-poster') ? 'detail-poster' : ''
        ).trim();
        img.replaceWith(wrapper.firstElementChild);
      };

      const handleFailure = () => {
        const secondary = img.dataset.fallbackSrc;
        if (!triedSecondary && secondary && img.src !== secondary) {
          triedSecondary = true;
          img.src = secondary;
          return;
        }
        swapToPlaceholder();
      };

      img.addEventListener('error', handleFailure);
      if (img.complete && img.naturalWidth === 0) handleFailure();
    });
  }

  function serializeBacklogPayload(item) {
    return encodeURIComponent(
      JSON.stringify({
        id: item.id,
        displayTitle: item.displayTitle,
        studio: item.studio || '',
        displayYear: item.displayYear || '—',
        hours: item.hours || null,
        posterUrl: item.posterUrl || '',
        fallbackPosterUrl: item.fallbackPosterUrl || '',
        metacritic: item.metacritic,
        playerScore: item.playerScore,
        hasMetacritic: Boolean(item.hasMetacritic),
        hasPlayerScore: Boolean(item.hasPlayerScore),
        awardBadge: item.awardBadge || '',
        steamAppId: item.steamAppId || null
      })
    );
  }

  function createCardHTML(item) {
    const saved = isInBacklog(item.id);
    const metaData = serializeBacklogPayload(item);
    const hasDeal = item.salePrice != null && item.savings > 0;

    return `
      <article class="media-card" data-action="open-detail" data-id="${escapeHtml(item.id)}" data-payload="${metaData}">
        <div class="poster-wrap">
          ${
            item.posterUrl
              ? `<img src="${item.posterUrl}" data-fallback-src="${escapeHtml(item.fallbackPosterUrl || '')}" alt="${escapeHtml(item.displayTitle)}" loading="lazy" data-fallback-title="${escapeHtml(item.displayTitle)}" data-fallback-sub="${escapeHtml(item.studio)}" />`
              : buildCoverPlaceholderHTML(item.displayTitle, item.studio)
          }
          ${
            hasDeal
              ? `<span class="card-laurel deal-laurel">-${item.savings}% · $${item.salePrice.toFixed(2)}</span>`
              : item.awardBadge
              ? `<span class="card-laurel">${SVG_LAUREL} ACCLAIMED</span>`
              : ''
          }
          <button
            type="button"
            class="card-wl-btn ${saved ? 'saved' : ''}"
            data-action="card-backlog"
            data-payload="${metaData}"
            aria-label="Toggle Backlog"
          >${saved ? '✓' : '+'}</button>
        </div>
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(item.displayTitle)}</h3>
          <div class="card-sub">${escapeHtml(item.studio || 'PC / Console')}</div>
          <div class="card-meta-sub">${item.displayYear}${item.hours ? ` · ~${item.hours}h` : ''}</div>
          ${item.aiReason ? `<div class="card-sub" style="color:var(--accent);">${escapeHtml(item.aiReason)}</div>` : ''}
          <div class="ratings-strip">
            ${item.hasMetacritic ? `<span class="rating-pill rating-mc">MC ${item.metacritic}</span>` : ''}
            ${item.hasPlayerScore ? `<span class="rating-pill rating-user">★ ${item.playerScore.toFixed(1)}</span>` : ''}
            ${!item.hasMetacritic && !item.hasPlayerScore ? `<span class="rating-pill rating-unrated">Unrated</span>` : ''}
          </div>
        </div>
      </article>`;
  }

  /* ---------- Game Dossier Modal & Briefing Room ---------- */
  async function openDetailModal(id, fallbackPayload = null) {
    const modal = $('detailModal');
    const body = $('detailModalBody');
    modal.classList.remove('hidden');
    body.innerHTML = `<div class="empty-state" style="border:none;">Retrieving game dossier…</div>`;

    try {
      const d = await API.fetchGameDetails(id, fallbackPayload);
      const saved = isInBacklog(d.id);
      const platLabels = (d.platforms || []).map((p) => CFG.PLATFORMS[p] || p).join(' · ') || 'PC';
      const genreLabels = (d.genres || []).map((g) => CFG.GENRES.find((x) => x.id === g)?.name || g).join(' · ');
      const ytTrailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${d.displayTitle} ${d.displayYear} official trailer`)}`;
      const hltbUrl = `https://howlongtobeat.com/?q=${encodeURIComponent(d.displayTitle)}`;
      const mcUrl = `https://www.metacritic.com/search/${encodeURIComponent(d.displayTitle)}/`;

      body.innerHTML = `
        <div class="detail-banner detail-game-banner" ${d.backdropUrl ? `style="background-image:url('${d.backdropUrl}')"` : ''}></div>
        <div class="detail-content">
          ${
            d.posterUrl
              ? `<img class="detail-poster" src="${d.posterUrl}" data-fallback-src="${escapeHtml(d.fallbackPosterUrl || '')}" alt="${escapeHtml(d.displayTitle)}" data-fallback-title="${escapeHtml(d.displayTitle)}" data-fallback-sub="${escapeHtml(d.studio)}" />`
              : buildCoverPlaceholderHTML(d.displayTitle, d.studio, 'detail-poster')
          }
          <div>
            <p class="eyebrow">GAME DOSSIER · ${d.displayYear}${d.hours ? ` · ~${d.hours} HOURS MAIN STORY` : ''}</p>
            <h2 class="detail-title" id="detailTitle">${escapeHtml(d.displayTitle)}</h2>
            <div class="detail-meta-line">${escapeHtml(genreLabels || 'Interactive Title')} · ${escapeHtml(platLabels)}</div>

            <div class="detail-badges-row">
              ${d.hasMetacritic ? `<span class="rating-pill rating-mc" id="detailMcPill">Metacritic ${d.metacritic}/100</span>` : ''}
              ${d.hasPlayerScore ? `<span class="rating-pill rating-user" id="detailUserPill">★ ${d.playerScore.toFixed(1)}/5 Players</span>` : ''}
              ${
                d.salePrice != null
                  ? `<span class="rating-pill rating-deal">$${d.salePrice.toFixed(2)}${d.savings > 0 ? ` (-${d.savings}%)` : ''}</span>`
                  : ''
              }
              ${
                d.awardBadge
                  ? `<span class="award-badge" id="detailAwardBadge">${SVG_LAUREL} ${escapeHtml(d.awardBadge)}</span>`
                  : '<span class="award-badge hidden" id="detailAwardBadge"></span>'
              }
            </div>

            <p class="detail-overview">${escapeHtml(d.overview || 'Explore official store pages, critic reviews, and gameplay trailers below.')}</p>

            <div class="detail-credits">
              <div><strong>Developer</strong>${escapeHtml(d.studio || '—')}</div>
              <div><strong>Publisher</strong>${escapeHtml(d.publisher || '—')}</div>
              <div><strong>Platforms</strong>${escapeHtml(platLabels)}</div>
              <div><strong>Playtime</strong>${d.hours ? `~${d.hours} hours` : 'Varies'}</div>
            </div>

            <div class="detail-actions">
              <button class="btn-accent" id="detailBriefingBtn">Game Briefing</button>
              <button class="btn-outline" id="detailBacklogBtn">${saved ? '✓ In Backlog' : '+ Backlog'}</button>
              ${
                d.dealUrl
                  ? `<a class="btn-outline" target="_blank" rel="noopener noreferrer" href="${d.dealUrl}">Best PC Deal ($${d.salePrice.toFixed(2)}) ↗</a>`
                  : d.steamUrl
                  ? `<a class="btn-outline" target="_blank" rel="noopener noreferrer" href="${d.steamUrl}">Steam ↗</a>`
                  : ''
              }
              <a class="btn-ghost" target="_blank" rel="noopener noreferrer" href="${ytTrailerUrl}">Trailer ↗</a>
              <a class="btn-ghost" target="_blank" rel="noopener noreferrer" href="${mcUrl}">Metacritic ↗</a>
              <a class="btn-ghost" target="_blank" rel="noopener noreferrer" href="${hltbUrl}">HowLongToBeat ↗</a>
            </div>
          </div>
        </div>`;

      attachCoverFallbacks(body);

      $('detailBriefingBtn')?.addEventListener('click', () => openBriefingRoom(d));
      $('detailBacklogBtn')?.addEventListener('click', () => {
        const nowSaved = toggleBacklogItem(d);
        $('detailBacklogBtn').textContent = nowSaved ? '✓ In Backlog' : '+ Backlog';
      });

      if (API.getGeminiKey()) {
        API.verifyGamePrestige(d.id, d.displayTitle, d.displayYear).then((verified) => {
          if (!verified) return;
          if (verified.metacritic && $('detailMcPill')) {
            $('detailMcPill').textContent = `Metacritic ${Math.round(verified.metacritic)}/100 ✓`;
          }
          if (verified.playerScore && $('detailUserPill')) {
            $('detailUserPill').textContent = `★ ${Number(verified.playerScore).toFixed(1)}/5 Players ✓`;
          }
          if (verified.awardsSummary && $('detailAwardBadge')) {
            $('detailAwardBadge').innerHTML = `${SVG_LAUREL} ${escapeHtml(verified.awardsSummary)}`;
            $('detailAwardBadge').classList.remove('hidden');
          }
        });
      }
    } catch (err) {
      body.innerHTML = `<div class="empty-state">Unable to load game details (${escapeHtml(err.message)}).</div>`;
    }
  }

  function openBriefingRoom(game) {
    const ytTrailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${game.displayTitle} ${game.displayYear} official trailer`)}`;
    $('briefingTitleText').textContent = `${game.displayTitle} — ${game.studio || 'Spotlight'}`;
    $('briefingTrailerLink').href = ytTrailerUrl;

    const themeChips = (game.themes || [])
      .map((t) => CFG.THEMES_VIEWS.find((x) => x.id === t)?.name || t)
      .map((name) => `<span class="chip">${escapeHtml(name)}</span>`)
      .join('');

    const platChips = (game.platforms || [])
      .map((p) => CFG.PLATFORMS[p] || p)
      .map((name) => `<span class="chip">${escapeHtml(name)}</span>`)
      .join('');

    $('briefingStage').innerHTML = `
      <div class="reader-paper">
        <div class="reader-folio-head">
          <span class="eyebrow">${escapeHtml(game.studio || 'ARCHIVE')} · ${game.displayYear}${game.hours ? ` · ~${game.hours} HOURS` : ''}</span>
          <h2 class="reader-book-title">${escapeHtml(game.displayTitle)}</h2>
        </div>

        ${
          game.backdropUrl
            ? `<img class="briefing-hero-img" src="${game.backdropUrl}" alt="${escapeHtml(game.displayTitle)}" onerror="this.remove()" />`
            : ''
        }

        <div class="reader-section">
          <span class="panel-label">Editorial Overview</span>
          <p class="reader-prose">${escapeHtml(game.overview || 'Explore critic consensus, gameplay trailers, and live PC pricing via the links below.')}</p>
        </div>

        ${
          platChips || themeChips
            ? `<div class="reader-section">
                 <span class="panel-label">Platforms &amp; Atmosphere</span>
                 <div class="reader-meta-tags">${platChips}${themeChips}</div>
               </div>`
            : ''
        }

        <div class="reader-footer-cta" style="gap:0.65rem;flex-wrap:wrap;">
          <a class="btn-accent" href="${ytTrailerUrl}" target="_blank" rel="noopener noreferrer">Watch Official Trailer ↗</a>
          ${
            game.dealUrl
              ? `<a class="btn-outline" href="${game.dealUrl}" target="_blank" rel="noopener noreferrer">View Live PC Deal ($${game.salePrice.toFixed(2)}) ↗</a>`
              : game.steamUrl
              ? `<a class="btn-outline" href="${game.steamUrl}" target="_blank" rel="noopener noreferrer">Open on Steam ↗</a>`
              : ''
          }
        </div>
      </div>`;

    $('briefingModal').classList.remove('hidden');
  }

  function closeBriefingRoom() {
    $('briefingStage').innerHTML = '';
    $('briefingModal').classList.add('hidden');
  }

  /* ---------- Backlog ---------- */
  function getBacklogKey() {
    return CFG.STORAGE_KEYS.BACKLOG_PREFIX + (state.activeUser || 'guest');
  }

  function getBacklog() {
    try {
      return JSON.parse(localStorage.getItem(getBacklogKey()) || '[]');
    } catch {
      return [];
    }
  }

  function saveBacklog(list) {
    localStorage.setItem(getBacklogKey(), JSON.stringify(list));
    updateBacklogBadge();
  }

  function isInBacklog(id) {
    return getBacklog().some((x) => x.id === id);
  }

  function toggleBacklogItem(item) {
    const list = getBacklog();
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      saveBacklog(list);
      showToast(`Removed “${item.displayTitle}” from backlog`);
      if (state.view === 'backlog') renderBacklogView();
      return false;
    }
    list.unshift({
      id: item.id,
      displayTitle: item.displayTitle,
      studio: item.studio || '',
      displayYear: item.displayYear || '—',
      hours: item.hours || null,
      posterUrl: item.posterUrl || '',
      fallbackPosterUrl: item.fallbackPosterUrl || '',
      metacritic: item.metacritic,
      playerScore: item.playerScore,
      hasMetacritic: Boolean(item.metacritic),
      hasPlayerScore: Boolean(item.playerScore),
      awardBadge: item.awardBadge || '',
      steamAppId: item.steamAppId || null,
      completed: false,
      addedAt: Date.now()
    });
    saveBacklog(list);
    showToast(`Added “${item.displayTitle}” to backlog`);
    return true;
  }

  function updateBacklogBadge() {
    const count = getBacklog().length;
    $('backlogCountBadge').textContent = count;
    $('mobileBacklogBadge').textContent = count;
  }

  function renderBacklogView() {
    const users = JSON.parse(localStorage.getItem(CFG.STORAGE_KEYS.USERS) || '{}');
    const displayName = state.activeUser ? users[state.activeUser]?.displayName || state.activeUser : 'Guest';
    $('backlogHeading').textContent = `${displayName}’s Game Backlog`;

    const list = getBacklog();
    const filtered = list.filter((g) => {
      if (state.backlogFilter === 'completed') return g.completed;
      if (state.backlogFilter === 'toplay') return !g.completed;
      return true;
    });

    const grid = $('backlogGrid');
    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state">No games in this backlog view yet. Tap <strong>+</strong> on any game card to start your queue.</div>`;
      return;
    }

    grid.innerHTML = filtered
      .map(
        (item) => `
      <article class="media-card" data-action="open-detail" data-id="${escapeHtml(item.id)}" data-payload="${serializeBacklogPayload(item)}">
        <div class="poster-wrap">
          ${
            item.posterUrl
              ? `<img src="${item.posterUrl}" data-fallback-src="${escapeHtml(item.fallbackPosterUrl || '')}" alt="${escapeHtml(item.displayTitle)}" data-fallback-title="${escapeHtml(item.displayTitle)}" data-fallback-sub="${escapeHtml(item.studio)}" />`
              : buildCoverPlaceholderHTML(item.displayTitle, item.studio)
          }
          <button type="button" class="card-wl-btn ${item.completed ? 'saved' : ''}" data-action="toggle-completed" data-id="${escapeHtml(item.id)}" title="Mark Completed / To Play">
            ${item.completed ? '✓' : '○'}
          </button>
        </div>
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(item.displayTitle)}</h3>
          <div class="card-sub">${escapeHtml(item.studio || 'Archive')}</div>
          <div class="card-meta-sub">${item.displayYear} · ${item.completed ? 'Completed' : 'To Play'}</div>
          <div class="ratings-strip">
            ${item.metacritic ? `<span class="rating-pill rating-mc">MC ${item.metacritic}</span>` : ''}
            ${item.playerScore ? `<span class="rating-pill rating-user">★ ${Number(item.playerScore).toFixed(1)}</span>` : ''}
          </div>
        </div>
      </article>`
      )
      .join('');
    attachCoverFallbacks(grid);
  }

  /* ---------- Member Auth ---------- */
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function openAuthModal(mode = 'login') {
    state.authMode = mode;
    $('authErrorText').classList.add('hidden');
    $('authForm').reset();
    updateAuthUI();
    $('authModal').classList.remove('hidden');
  }

  function updateAuthUI() {
    const users = JSON.parse(localStorage.getItem(CFG.STORAGE_KEYS.USERS) || '{}');
    const isSignedIn = Boolean(state.activeUser && users[state.activeUser]);

    $('guestAuthButtons').classList.toggle('hidden', isSignedIn);
    $('memberProfileBtn').classList.toggle('hidden', !isSignedIn);

    if (isSignedIn) {
      const profile = users[state.activeUser];
      const name = profile.displayName || state.activeUser;
      $('memberAvatarInitial').textContent = name.charAt(0).toUpperCase();
      $('memberHandleLabel').textContent = `@${state.activeUser}`;
      $('signedInUserLabel').textContent = `${name} (@${state.activeUser})`;
      $('signedInStats').textContent = `${getBacklog().length} saved game${getBacklog().length === 1 ? '' : 's'} in backlog`;

      $('authTabs').classList.add('hidden');
      $('authForm').classList.add('hidden');
      $('signedInPanel').classList.remove('hidden');
      $('authModalTitle').textContent = 'Member Vault';
    } else {
      const isSignup = state.authMode === 'signup';
      $('authTabs').classList.remove('hidden');
      $('authForm').classList.remove('hidden');
      $('signedInPanel').classList.add('hidden');
      $('authDisplayNameRow').classList.toggle('hidden', !isSignup);
      $('authConfirmRow').classList.toggle('hidden', !isSignup);
      $('authConfirmPassword').required = isSignup;
      $('authSubmitBtn').textContent = isSignup ? 'Create Account' : 'Log In';
      $('authModalTitle').textContent = isSignup ? 'Join Would Play That' : 'Log In to Would Play That';

      document.querySelectorAll('.auth-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.authMode === state.authMode);
      });
    }
    updateBacklogBadge();
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const username = $('authUsername').value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const password = $('authPassword').value;
    const errEl = $('authErrorText');
    errEl.classList.add('hidden');

    if (username.length < 3) {
      errEl.textContent = 'Username must be at least 3 letters or numbers.';
      errEl.classList.remove('hidden');
      return;
    }

    const users = JSON.parse(localStorage.getItem(CFG.STORAGE_KEYS.USERS) || '{}');
    const hashed = await sha256(`${username}::wpt_vault_salt::${password}`);

    if (state.authMode === 'signup') {
      if (password !== $('authConfirmPassword').value) {
        errEl.textContent = 'Passwords do not match.';
        errEl.classList.remove('hidden');
        return;
      }
      if (users[username]) {
        errEl.textContent = 'Username already registered. Please log in.';
        errEl.classList.remove('hidden');
        return;
      }
      const displayName = $('authDisplayName').value.trim() || username;
      users[username] = { hash: hashed, displayName, createdAt: Date.now() };
      localStorage.setItem(CFG.STORAGE_KEYS.USERS, JSON.stringify(users));
      state.activeUser = username;
      localStorage.setItem(CFG.STORAGE_KEYS.ACTIVE_USER, username);
      showToast(`Welcome, ${displayName}!`);
    } else {
      if (!users[username] || users[username].hash !== hashed) {
        errEl.textContent = 'Incorrect username or password.';
        errEl.classList.remove('hidden');
        return;
      }
      state.activeUser = username;
      localStorage.setItem(CFG.STORAGE_KEYS.ACTIVE_USER, username);
      showToast(`Signed in as @${username}`);
    }

    $('authModal').classList.add('hidden');
    updateAuthUI();
    if (state.view === 'backlog') renderBacklogView();
  }

  /* ---------- Event Wiring ---------- */
  function bindGlobalEvents() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    document.querySelectorAll('.dock-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dest = btn.dataset.mobileNav;
        if (dest === 'search') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setTimeout(() => $('conciergeInput').focus(), 220);
          return;
        }
        switchView(dest);
      });
    });
    $('brandHomeBtn').addEventListener('click', (e) => {
      e.preventDefault();
      switchView('home');
    });

    // Popover / Mobile Sheet Triggers
    document.querySelectorAll('.filter-popover').forEach((box) => {
      const trigger = box.querySelector('.filter-trigger');
      const panel = box.querySelector('.filter-panel');
      const closeBtn = box.querySelector('.sheet-close-btn');
      const doneBtn = box.querySelector('.sheet-done-btn');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !box.classList.contains('open');
        closeAllPopovers(willOpen ? box : null);
        box.classList.toggle('open', willOpen);
        panel.classList.toggle('hidden', !willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
      });

      panel.addEventListener('click', (e) => e.stopPropagation());
      closeBtn?.addEventListener('click', () => closeAllPopovers());
      doneBtn?.addEventListener('click', () => runDiscover(1, false));
    });

    $('sheetBackdrop').addEventListener('click', () => closeAllPopovers());
    document.addEventListener('click', () => closeAllPopovers());

    // AND / OR Segmented Switches
    document.querySelectorAll('[data-logic-toggle]').forEach((group) => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-logic-val]');
        if (!btn) return;
        const target = group.dataset.logicToggle;
        const val = btn.dataset.logicVal;
        group.querySelectorAll('.logic-btn').forEach((b) => b.classList.toggle('active', b === btn));

        if (target === 'genre') {
          state.filters.genreLogic = val;
          $('genreLogicHint').innerHTML =
            val === 'AND'
              ? 'Matching games that span <strong>all</strong> selected genres.'
              : 'Matching games that belong to <strong>any</strong> selected genre.';
        } else if (target === 'studio') {
          state.filters.studioLogic = val;
          $('studioLogicHint').innerHTML =
            val === 'AND'
              ? 'Showing collaborations credited to <strong>all</strong> selected studios.'
              : 'Tap a studio to select, or tap again to deselect. <strong>OR</strong> shows games by any selected studio.';
        } else if (target === 'theme') {
          state.filters.themeLogic = val;
          $('themeLogicHint').innerHTML =
            val === 'AND'
              ? 'Finding games combining <strong>all</strong> selected themes.'
              : 'Finding games matching <strong>any</strong> selected theme or perspective.';
        } else if (target === 'publisher') {
          state.filters.publisherLogic = val;
        }
        syncFilterBadges();
      });
    });

    // Hero Swipe & Controls
    let touchStartX = 0;
    $('heroSpotlight').addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
    $('heroSpotlight').addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 45) stepHero(dx < 0 ? 1 : -1);
    }, { passive: true });
    $('heroPrevBtn').addEventListener('click', () => stepHero(-1));
    $('heroNextBtn').addEventListener('click', () => stepHero(1));
    $('heroDots').addEventListener('click', (e) => {
      const dot = e.target.closest('[data-hero-dot]');
      if (!dot) return;
      state.heroIndex = Number(dot.dataset.heroDot);
      renderHeroSlide();
      startHeroAutoRotate();
    });

    // Search
    $('conciergeSearchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      runConciergeSearch($('conciergeInput').value, false);
    });
    $('aiConciergeBtn').addEventListener('click', () => runConciergeSearch($('conciergeInput').value, true));
    $('conciergeInput').addEventListener('input', (e) => $('clearSearchBtn').classList.toggle('hidden', !e.target.value));
    $('clearSearchBtn').addEventListener('click', () => {
      $('conciergeInput').value = '';
      $('clearSearchBtn').classList.add('hidden');
    });

    // Delegated Card & Hero Actions
    document.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;

      if (action === 'card-backlog') {
        e.stopPropagation();
        const item = JSON.parse(decodeURIComponent(target.dataset.payload));
        const nowSaved = toggleBacklogItem(item);
        target.classList.toggle('saved', nowSaved);
        target.textContent = nowSaved ? '✓' : '+';
        return;
      }
      if (action === 'toggle-completed') {
        e.stopPropagation();
        const list = getBacklog();
        const found = list.find((x) => x.id === target.dataset.id);
        if (found) {
          found.completed = !found.completed;
          saveBacklog(list);
          renderBacklogView();
        }
        return;
      }
      if (action === 'toggle-hero-backlog') {
        const item = JSON.parse(decodeURIComponent(target.dataset.payload));
        toggleBacklogItem(item);
        renderHeroSlide();
        return;
      }
      if (action === 'hero-briefing') {
        try {
          const d = await API.fetchGameDetails(target.dataset.id);
          openBriefingRoom(d);
        } catch {
          showToast('Unable to open briefing.');
        }
        return;
      }
      if (action === 'open-detail') {
        let fallback = null;
        if (target.dataset.payload) {
          try { fallback = JSON.parse(decodeURIComponent(target.dataset.payload)); } catch { /* ignore */ }
        }
        openDetailModal(target.dataset.id, fallback);
      }
    });

    // Filter Controls
    $('platformPills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-platform]');
      if (!btn) return;
      $('platformPills').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      state.filters.platform = btn.dataset.platform;
      syncFilterBadges();
    });
    $('modeSelect').addEventListener('change', (e) => {
      state.filters.mode = e.target.value;
      syncFilterBadges();
    });

    $('genrePills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-genre]');
      if (!btn) return;
      const id = btn.dataset.genre;
      const idx = state.filters.genres.indexOf(id);
      if (idx >= 0) state.filters.genres.splice(idx, 1);
      else state.filters.genres.push(id);
      btn.classList.toggle('active');
      syncFilterBadges();
    });

    $('mcPresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mc-preset]');
      if (!btn) return;
      const val = Number(btn.dataset.mcPreset);
      $('mcPresets').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      state.filters.minMetacritic = val;
      $('minMcRange').value = val;
      $('minMcVal').textContent = val > 0 ? `${val}+` : 'Any';
      syncFilterBadges();
    });
    $('minMcRange').addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.filters.minMetacritic = val;
      $('minMcVal').textContent = val > 0 ? `${val}+` : 'Any';
      $('mcPresets').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.mcPreset) === val));
      syncFilterBadges();
    });

    $('userScorePresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-us-preset]');
      if (!btn) return;
      const val = Number(btn.dataset.usPreset);
      $('userScorePresets').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      state.filters.minPlayerScore = val;
      $('minUsRange').value = val;
      $('minUsVal').textContent = val > 0 ? `${val.toFixed(1)}★+` : 'Any';
      syncFilterBadges();
    });
    $('minUsRange').addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.filters.minPlayerScore = val;
      $('minUsVal').textContent = val > 0 ? `${val.toFixed(1)}★+` : 'Any';
      $('userScorePresets').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.usPreset) === val));
      syncFilterBadges();
    });

    $('studioPresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-preset]');
      if (!btn) return;
      toggleEntityFilter('studio', { id: btn.dataset.studioPreset, name: btn.dataset.studioName });
    });
    $('studioSearchInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = e.target.value.trim();
      if (!val) return;
      toggleEntityFilter('studio', { id: val, name: val });
      e.target.value = '';
    });

    $('themePills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-view]');
      if (!btn) return;
      const id = btn.dataset.themeView;
      const idx = state.filters.themes.indexOf(id);
      if (idx >= 0) state.filters.themes.splice(idx, 1);
      else state.filters.themes.push(id);
      btn.classList.toggle('active');
      syncFilterBadges();
    });

    $('publisherPresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-publisher-preset]');
      if (!btn) return;
      toggleEntityFilter('publisher', { id: btn.dataset.publisherPreset, name: btn.dataset.publisherName });
    });
    $('publisherSearchInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = e.target.value.trim();
      if (!val) return;
      toggleEntityFilter('publisher', { id: val, name: val });
      e.target.value = '';
    });

    $('filterBarShell').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-tag]');
      if (!btn) return;
      toggleEntityFilter(btn.dataset.removeTag, { id: btn.dataset.tagId, name: '' });
    });

    $('activeFiltersStrip').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-strip-remove]');
      if (!btn) return;
      const type = btn.dataset.stripRemove;
      const id = btn.dataset.stripId;

      if (type === 'studio' || type === 'publisher') {
        toggleEntityFilter(type, { id, name: '' });
      } else if (type === 'platform') {
        state.filters.platform = 'all';
        $('platformPills').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.platform === 'all'));
      } else if (type === 'mode') {
        state.filters.mode = '';
        $('modeSelect').value = '';
      } else if (type === 'genre') {
        state.filters.genres = state.filters.genres.filter((g) => g !== id);
        $('genrePills').querySelector(`[data-genre="${CSS.escape(id)}"]`)?.classList.remove('active');
      } else if (type === 'theme') {
        state.filters.themes = state.filters.themes.filter((t) => t !== id);
        $('themePills').querySelector(`[data-theme-view="${CSS.escape(id)}"]`)?.classList.remove('active');
      } else if (type === 'metacritic') {
        state.filters.minMetacritic = 0;
        $('minMcRange').value = 0;
        $('minMcVal').textContent = 'Any';
        $('mcPresets').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.mcPreset === '0'));
      } else if (type === 'playerscore') {
        state.filters.minPlayerScore = 0;
        $('minUsRange').value = 0;
        $('minUsVal').textContent = 'Any';
        $('userScorePresets').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.usPreset === '0'));
      } else if (type === 'era') {
        state.filters.era = 'all';
        state.filters.yearFrom = '';
        state.filters.yearTo = '';
        $('yearFromInput').value = '';
        $('yearToInput').value = '';
        $('eraPresets').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.era === 'all'));
      } else if (type === 'awards') {
        state.filters.awards = 'all';
        $('awardsPills').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.award === 'all'));
      } else if (type === 'hours') {
        state.filters.maxHours = 100;
        $('maxHoursRange').value = 100;
        $('maxHoursVal').textContent = 'Any';
      } else if (type === 'access') {
        state.filters.access = state.filters.access.filter((a) => a !== id);
        $('accessPills').querySelector(`[data-access="${CSS.escape(id)}"]`)?.classList.remove('active');
      }
      syncFilterBadges();
      runDiscover(1, false);
    });

    $('eraPresets').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-era]');
      if (!btn) return;
      $('eraPresets').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const preset = CFG.ERAS.find((x) => x.id === btn.dataset.era);
      state.filters.era = preset.id;
      state.filters.yearFrom = preset.from;
      state.filters.yearTo = preset.to;
      $('yearFromInput').value = preset.from;
      $('yearToInput').value = preset.to;
      syncFilterBadges();
    });
    $('yearFromInput').addEventListener('input', (e) => { state.filters.yearFrom = e.target.value; syncFilterBadges(); });
    $('yearToInput').addEventListener('input', (e) => { state.filters.yearTo = e.target.value; syncFilterBadges(); });

    $('awardsPills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-award]');
      if (!btn) return;
      $('awardsPills').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      state.filters.awards = btn.dataset.award;
      syncFilterBadges();
    });

    $('maxHoursRange').addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.filters.maxHours = val;
      $('maxHoursVal').textContent = val >= 100 ? 'Any' : `Under ${val}h`;
      syncFilterBadges();
    });
    $('accessPills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-access]');
      if (!btn) return;
      const id = btn.dataset.access;
      const idx = state.filters.access.indexOf(id);
      if (idx >= 0) state.filters.access.splice(idx, 1);
      else state.filters.access.push(id);
      btn.classList.toggle('active');
      syncFilterBadges();
    });

    // Sorter & Actions
    $('sorterQuickPills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sort-val]');
      if (!btn) return;
      handleSortChange(btn.dataset.sortVal);
    });
    $('sortSelect').addEventListener('change', (e) => handleSortChange(e.target.value));

    $('applyFiltersBtn').addEventListener('click', () => runDiscover(1, false));
    $('loadMoreBtn').addEventListener('click', () => runDiscover(state.discoverPage + 1, true));

    $('resetAllFiltersBtn').addEventListener('click', () => {
      const currentSort = state.filters.sort;
      state.filters = createDefaultFilters();
      state.filters.sort = currentSort;
      $('minMcRange').value = 0;
      $('minUsRange').value = 0;
      $('minMcVal').textContent = 'Any';
      $('minUsVal').textContent = 'Any';
      $('modeSelect').value = '';
      $('yearFromInput').value = '';
      $('yearToInput').value = '';
      $('maxHoursRange').value = 100;
      $('maxHoursVal').textContent = 'Any';
      document.querySelectorAll('#filterBarShell .chip').forEach((c) => c.classList.remove('active'));
      $('platformPills').querySelector('[data-platform="all"]')?.classList.add('active');
      $('mcPresets').querySelector('[data-mc-preset="0"]')?.classList.add('active');
      $('userScorePresets').querySelector('[data-us-preset="0"]')?.classList.add('active');
      $('eraPresets').querySelector('[data-era="all"]')?.classList.add('active');
      $('awardsPills').querySelector('[data-award="all"]')?.classList.add('active');
      syncEntityUI('studio');
      syncEntityUI('publisher');
      syncFilterBadges();
      runDiscover(1, false);
    });

    // Backlog Controls
    $('backlogFilterPills').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-backlog-filter]');
      if (!btn) return;
      $('backlogFilterPills').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      state.backlogFilter = btn.dataset.backlogFilter;
      renderBacklogView();
    });
    $('exportBacklogBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(getBacklog(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wpt-backlog-${state.activeUser || 'guest'}.json`;
      a.click();
    });
    $('importBacklogInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error();
          saveBacklog(imported);
          renderBacklogView();
          showToast(`Imported ${imported.length} games.`);
        } catch {
          showToast('Invalid backlog JSON file.');
        }
      };
      reader.readAsText(file);
    });

    // Settings
    $('openSettingsBtn').addEventListener('click', openSettings);
    $('closeSettingsBtn').addEventListener('click', closeSettings);
    $('settingsDrawer').addEventListener('click', (e) => { if (e.target === $('settingsDrawer')) closeSettings(); });
    $('themeSelectorGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-set-theme]');
      if (!btn) return;
      document.documentElement.setAttribute('data-theme', btn.dataset.setTheme);
      localStorage.setItem(CFG.STORAGE_KEYS.THEME, btn.dataset.setTheme);
      renderSettingsControls();
    });
    $('accentSelectorGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-set-accent]');
      if (!btn) return;
      document.documentElement.setAttribute('data-accent', btn.dataset.setAccent);
      localStorage.setItem(CFG.STORAGE_KEYS.ACCENT, btn.dataset.setAccent);
      renderSettingsControls();
    });
    $('saveApiKeysBtn').addEventListener('click', () => {
      const gemini = $('geminiKeyInput').value.trim();
      if (gemini) localStorage.setItem(CFG.STORAGE_KEYS.GEMINI_KEY, gemini);
      else localStorage.removeItem(CFG.STORAGE_KEYS.GEMINI_KEY);
      API.clearCache();
      closeSettings();
      showToast('Settings saved.');
    });
    $('clearCacheBtn').addEventListener('click', () => {
      API.clearCache();
      showToast('Game cache cleared.');
    });

    // Modals Close
    $('closeDetailModalBtn').addEventListener('click', () => $('detailModal').classList.add('hidden'));
    $('detailModal').addEventListener('click', (e) => { if (e.target === $('detailModal')) $('detailModal').classList.add('hidden'); });
    $('closeBriefingModalBtn').addEventListener('click', closeBriefingRoom);
    $('briefingModal').addEventListener('click', (e) => { if (e.target === $('briefingModal')) closeBriefingRoom(); });

    // Auth
    $('headerLoginBtn').addEventListener('click', () => openAuthModal('login'));
    $('headerSignupBtn').addEventListener('click', () => openAuthModal('signup'));
    $('memberProfileBtn').addEventListener('click', () => openAuthModal('login'));
    $('closeAuthModalBtn').addEventListener('click', () => $('authModal').classList.add('hidden'));
    $('authModal').addEventListener('click', (e) => { if (e.target === $('authModal')) $('authModal').classList.add('hidden'); });
    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.authMode = tab.dataset.authMode;
        $('authErrorText').classList.add('hidden');
        updateAuthUI();
      });
    });
    $('authForm').addEventListener('submit', handleAuthSubmit);
    $('logoutBtn').addEventListener('click', () => {
      state.activeUser = null;
      localStorage.removeItem(CFG.STORAGE_KEYS.ACTIVE_USER);
      $('authModal').classList.add('hidden');
      updateAuthUI();
      showToast('Signed out.');
      if (state.view === 'backlog') renderBacklogView();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      closeAllPopovers();
      closeBriefingRoom();
      $('detailModal').classList.add('hidden');
      $('authModal').classList.add('hidden');
      closeSettings();
    });
  }

  let toastTimer = null;
  function showToast(message) {
    const el = $('toastEl');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();

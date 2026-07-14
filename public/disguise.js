document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('disguiseRoot');
    if (!root) return;

    const EXTS = ['.tsx', '.ts', '.js', '.py', '.go', '.rs'];
    const ICON_COLORS = { '.tsx': '#3178c6', '.ts': '#3178c6', '.js': '#e3c53f', '.py': '#4b8bbe', '.go': '#00acd7', '.rs': '#dea584' };
    const LANG_LABELS = { '.tsx': 'TypeScript JSX', '.ts': 'TypeScript', '.js': 'JavaScript', '.py': 'Python', '.go': 'Go', '.rs': 'Rust' };
    const ACCENT = '#007acc';
    const PROJECT_NAME = 'hush-player';
    const ORIGINAL_TITLE = document.title;

    // ── State ──
    const D = {
        active: false,
        theme: 'dark',
        sidebarPanel: 'search',
        sidebarMobileOpen: false,
        query: '',
        searchResults: [],
        openTabs: [],       // array of video objects
        activeTabId: null,
        saved: [],          // array of video objects
        history: [],        // array of history entries (shared shape with app.js)
        tickSeconds: 0,
        bottomPanelOpen: true,
        bottomPanelTab: 'output',
        pathCopiedFlag: false,
        relatedCache: {},   // videoId -> related video array
    };

    const videoLookup = {};
    function registerVideos(list) {
        (list || []).forEach(v => { if (v && v.id) videoLookup[v.id] = v; });
    }

    let shellBuilt = false;
    let tickTimer = null;
    let searchDebounce = null;
    const playerPanes = {}; // videoId -> pane element, kept alive in the DOM so playback survives tab switches
    let advancedForId = null; // guards against auto-advancing more than once for the same "ended" video

    // ── Helpers ──
    function escHtml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function hashStr(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
        return Math.abs(h);
    }
    function extOf(id) { return EXTS[hashStr(id) % EXTS.length]; }
    function fileNameOf(video) { return video.id + extOf(video.id); }
    function videoAuthor(v) { return (v && (v.author || v.channel)) || ''; }

    function extractVideoId(input) {
        if (!input) return null;
        input = input.trim();
        const patterns = [
            /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
        ];
        for (const p of patterns) {
            const m = input.match(p);
            if (m) return m[1];
        }
        if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
        return null;
    }

    function loadPersisted() {
        try { D.saved = JSON.parse(localStorage.getItem('hush_saved_v1')) || []; } catch (e) { D.saved = []; }
        try { D.history = JSON.parse(localStorage.getItem('yt_embed_history')) || []; } catch (e) { D.history = []; }
        registerVideos(D.saved);
        registerVideos(D.history);
    }

    function persistSaved() {
        try { localStorage.setItem('hush_saved_v1', JSON.stringify(D.saved)); } catch (e) {}
    }

    function addToHistory(video) {
        D.history = D.history.filter(item => item.id !== video.id);
        D.history.unshift({
            id: video.id,
            title: video.title || '',
            channel: videoAuthor(video),
            author: videoAuthor(video),
            thumbnail: video.thumbnail || `/api/thumbnail?id=${video.id}`,
            views: video.views,
            ago: video.ago,
            duration: video.duration,
            isLive: video.isLive || false,
            platform: 'youtube',
            url: `https://www.youtube-nocookie.com/embed/${video.id}`,
            timestamp: new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
        });
        if (D.history.length > 30) D.history.pop();
        try { localStorage.setItem('yt_embed_history', JSON.stringify(D.history)); } catch (e) {}
    }

    function toggleSaved(id) {
        const idx = D.saved.findIndex(s => s.id === id);
        if (idx === -1) {
            const v = videoLookup[id];
            D.saved.unshift(v ? { ...v } : { id });
        } else {
            D.saved.splice(idx, 1);
        }
        persistSaved();
        render();
    }

    // ── Data fetching ──
    async function runSearch(q) {
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            return (data.success && data.videos) ? data.videos : [];
        } catch (e) {
            return [];
        }
    }

    async function fetchRelated(video) {
        if (D.relatedCache[video.id]) return D.relatedCache[video.id];
        const q = videoAuthor(video) || video.title || 'video';
        const list = (await runSearch(q)).filter(v => v.id !== video.id).slice(0, 5);
        D.relatedCache[video.id] = list;
        registerVideos(list);
        return list;
    }

    // ── Actions ──
    function openFile(video) {
        if (!video || !video.id) return;
        if (!D.openTabs.some(t => t.id === video.id)) D.openTabs.push(video);
        D.activeTabId = video.id;
        D.tickSeconds = 0;
        D.sidebarMobileOpen = false;
        D.pathCopiedFlag = false;
        registerVideos([video]);
        addToHistory(video);
        render();
        fetchRelated(video).then(() => {
            if (D.activeTabId === video.id) renderBottomPanel();
        });
    }

    function closeTab(id) {
        const idx = D.openTabs.findIndex(t => t.id === id);
        D.openTabs = D.openTabs.filter(t => t.id !== id);
        if (D.activeTabId === id) {
            D.activeTabId = D.openTabs.length ? (D.openTabs[Math.max(0, idx - 1)] || D.openTabs[0]).id : null;
        }
        D.tickSeconds = 0;
        render();
    }

    function copyPath() {
        const v = D.openTabs.find(t => t.id === D.activeTabId);
        if (!v) return;
        const url = `https://www.youtube-nocookie.com/embed/${v.id}`;
        const done = () => {
            D.pathCopiedFlag = true;
            renderBreadcrumb();
            setTimeout(() => { D.pathCopiedFlag = false; renderBreadcrumb(); }, 1600);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(() => {});
    }

    function onSearchInputChange(e) {
        D.query = e.target.value;
        clearTimeout(searchDebounce);
        if (!D.query.trim()) {
            D.searchResults = [];
            updateSearchResultsOnly();
            return;
        }
        const directId = extractVideoId(D.query.trim());
        if (directId) {
            D.query = '';
            D.searchResults = [];
            openFile({ id: directId, title: `Video ${directId}`, author: '', thumbnail: `/api/thumbnail?id=${directId}` });
            return;
        }
        searchDebounce = setTimeout(async () => {
            const q = D.query.trim();
            const list = await runSearch(q);
            if (D.query.trim() !== q) return; // stale response
            D.searchResults = list;
            registerVideos(list);
            updateSearchResultsOnly();
        }, 250);
    }

    function isMobile() { return window.innerWidth < 900; }

    // ── Rendering ──
    function highlightParts(text, q, matchClass) {
        if (!q) return escHtml(text);
        const lower = text.toLowerCase();
        const ql = q.toLowerCase();
        let i = 0, out = '';
        while (i < text.length) {
            const idx = lower.indexOf(ql, i);
            if (idx === -1) { out += escHtml(text.slice(i)); break; }
            if (idx > i) out += escHtml(text.slice(i, idx));
            out += `<span class="${matchClass}">${escHtml(text.slice(idx, idx + ql.length))}</span>`;
            i = idx + ql.length;
        }
        return out;
    }

    function searchShellHTML() {
        return `
            <div class="vc-sidebar-header">SEARCH</div>
            <div class="vc-search-input-row">
                <input type="text" class="vc-search-input" placeholder="Search" value="${escHtml(D.query)}">
                <span style="font-size:10px;opacity:0.55;font-weight:700">Aa</span>
                <span style="font-size:10px;opacity:0.55">.*</span>
            </div>
            <div class="vc-search-summary"></div>
            <div class="vc-search-results"></div>`;
    }

    function searchResultsInnerHTML() {
        const q = D.query.trim();
        if (!q) return { summary: '', results: '' };
        const summary = `${D.searchResults.length} kết quả trong ${D.searchResults.length} tệp`;
        const results = D.searchResults.map((v, i) => {
            const path = `${PROJECT_NAME}/src/results/${fileNameOf(v)}`;
            const ln1 = 10 + i * 3, ln2 = 24 + i * 3;
            const channelLine = `const channel = "${videoAuthor(v)}";`;
            return `
                <div class="vc-search-result vc-mono" data-vc-open="${escHtml(v.id)}">
                    <div class="vc-search-result-path">${escHtml(path)}</div>
                    <div class="vc-search-result-line"><span>${ln1}</span><span>${highlightParts('// ' + v.title, q, 'vc-match')}</span></div>
                    <div class="vc-search-result-line"><span>${ln2}</span><span>${highlightParts(channelLine, q, 'vc-match')}</span></div>
                </div>`;
        }).join('');
        return { summary, results };
    }

    function updateSearchResultsOnly() {
        const { summary, results } = searchResultsInnerHTML();
        root.querySelectorAll('.vc-search-summary').forEach(el => { el.textContent = summary; });
        root.querySelectorAll('.vc-search-results').forEach(el => { el.innerHTML = results; });
    }

    function explorerFileRow(v, depth) {
        const pad = depth === 3 ? 56 : 40;
        return `<div class="vc-explorer-file" style="padding-left:${pad}px" data-vc-open="${escHtml(v.id)}">
            <span class="vc-file-dot" style="background:${ICON_COLORS[extOf(v.id)]}"></span>${escHtml(fileNameOf(v))}
        </div>`;
    }

    function explorerHTML() {
        let html = `<div class="vc-sidebar-header">EXPLORER</div><div class="vc-explorer">`;
        html += `<div class="vc-explorer-root">${escHtml(PROJECT_NAME.toUpperCase())}</div>`;
        html += `<div class="vc-explorer-folder">src</div>`;
        html += `<div class="vc-explorer-subfolder">results</div>`;
        html += D.searchResults.map(v => explorerFileRow(v, 3)).join('');
        if (D.saved.length) {
            html += `<div class="vc-explorer-folder" style="margin-top:6px">saved</div>`;
            html += D.saved.map(v => explorerFileRow(v, 2)).join('');
        }
        if (D.history.length) {
            html += `<div class="vc-explorer-folder" style="margin-top:6px">.history</div>`;
            html += D.history.map(v => explorerFileRow(v, 2)).join('');
        }
        html += `</div>`;
        return html;
    }

    function renderSidebarInto(hostEl) {
        if (!hostEl) return;
        if (D.sidebarPanel === 'search') {
            hostEl.innerHTML = searchShellHTML();
            const { summary, results } = searchResultsInnerHTML();
            hostEl.querySelector('.vc-search-summary').textContent = summary;
            hostEl.querySelector('.vc-search-results').innerHTML = results;
        } else {
            hostEl.innerHTML = explorerHTML();
        }
    }

    function renderSidebar() {
        const mobile = isMobile();
        const inlineHost = document.getElementById('vcSidebarInlineHost');
        const overlayHost = document.getElementById('vcSidebarOverlayHost');
        if (!mobile) {
            inlineHost.style.display = 'flex';
            inlineHost.className = 'vc-sidebar';
            renderSidebarInto(inlineHost);
            overlayHost.style.display = 'none';
            overlayHost.innerHTML = '';
        } else {
            inlineHost.style.display = 'none';
            inlineHost.innerHTML = '';
            if (D.sidebarMobileOpen) {
                overlayHost.style.display = 'block';
                overlayHost.innerHTML = `<div class="vc-sidebar-overlay-backdrop" data-vc-close-mobile="1"></div>
                    <div class="vc-sidebar-overlay" id="vcSidebarOverlayPanel"></div>`;
                renderSidebarInto(document.getElementById('vcSidebarOverlayPanel'));
            } else {
                overlayHost.style.display = 'none';
                overlayHost.innerHTML = '';
            }
        }
        // activity bar active state
        document.getElementById('vcActExplorer').classList.toggle('active', D.sidebarPanel === 'explorer');
        document.getElementById('vcActSearch').classList.toggle('active', D.sidebarPanel === 'search');
    }

    function renderTabbar() {
        const host = document.getElementById('vcTabbarHost');
        if (!D.openTabs.length) { host.innerHTML = ''; return; }
        host.innerHTML = `<div class="vc-tabbar">` + D.openTabs.map(v => {
            const active = v.id === D.activeTabId;
            return `<div class="vc-tab${active ? ' active' : ''}" data-vc-open="${escHtml(v.id)}">
                <div class="vc-tab-icon" style="background:${ICON_COLORS[extOf(v.id)]}"></div>
                <span class="vc-tab-name vc-mono" style="color:${active ? 'var(--vcText)' : 'var(--vcTextMuted)'}">${escHtml(fileNameOf(v))}</span>
                <div class="vc-tab-close" data-vc-close-tab="${escHtml(v.id)}">✕</div>
            </div>`;
        }).join('') + `</div>`;
    }

    function renderBreadcrumb() {
        const host = document.getElementById('vcBreadcrumbHost');
        const v = D.openTabs.find(t => t.id === D.activeTabId);
        if (!v) { host.innerHTML = ''; return; }
        const isSaved = D.saved.some(s => s.id === v.id);
        host.innerHTML = `
            <div class="vc-breadcrumb">
                <span class="vc-mono">${escHtml(PROJECT_NAME)} &gt; src &gt; results &gt; ${escHtml(fileNameOf(v))}</span>
                <div class="vc-breadcrumb-actions">
                    <div class="vc-icon-btn" title="Add to saved" data-vc-toggle-saved="${escHtml(v.id)}" style="color:${isSaved ? 'var(--vc-accent)' : 'var(--vcTextMuted)'}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6"><polygon points="12,3 15,9.5 22,10.3 17,15 18.3,22 12,18.5 5.7,22 7,15 2,10.3 9,9.5"/></svg>
                    </div>
                    <div class="vc-icon-btn" title="Copy Path" data-vc-copy-path="1">
                        ${D.pathCopiedFlag
                            ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#89d185" stroke-width="2.2"><polyline points="4,12 9,17 20,6"/></svg>'
                            : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>'}
                    </div>
                </div>
            </div>`;
    }

    function renderPlayerArea() {
        const host = document.getElementById('vcPlayerAreaHost');
        const v = D.openTabs.find(t => t.id === D.activeTabId);
        // Remove panes for tabs that got closed, so their iframe (and playback) actually stops.
        Object.keys(playerPanes).forEach(id => {
            if (!D.openTabs.some(t => t.id === id)) {
                playerPanes[id].remove();
                delete playerPanes[id];
            }
        });

        // Create a pane the first time a tab is opened; never recreated while it stays open,
        // so switching away and back does not reload/restart the video.
        if (v && !playerPanes[v.id]) {
            const pane = document.createElement('div');
            pane.className = 'vc-player-pane';
            pane.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column';
            const embedUrl = `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1&playsinline=1&autoplay=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
            pane.innerHTML = `
                <div class="vc-browser-toolbar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--vcTextMuted)"><path d="M15 5l-7 7 7 7"/></svg>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4" style="color:var(--vcTextMuted)"><path d="M9 5l7 7-7 7"/></svg>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--vcTextMuted)"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>
                    <div class="vc-addressbar vc-mono"><span class="vc-live-dot"></span>localhost:5173/preview/${escHtml(v.id)}</div>
                </div>
                <div class="vc-player-frame">
                    <iframe src="${embedUrl}" title="${escHtml(v.title || '')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                </div>`;
            host.appendChild(pane);
            playerPanes[v.id] = pane;

            const iframe = pane.querySelector('iframe');
            iframe.addEventListener('load', () => {
                try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: v.id }), '*'); } catch (e) {}
            });
        }

        // Show only the active pane; inactive ones stay mounted (and keep playing) in the background.
        Object.keys(playerPanes).forEach(id => {
            playerPanes[id].style.display = (id === D.activeTabId) ? 'flex' : 'none';
        });

        let emptyEl = host.querySelector('.vc-empty-editor');
        if (!v) {
            if (!emptyEl) {
                emptyEl = document.createElement('div');
                emptyEl.className = 'vc-empty-editor';
                emptyEl.innerHTML = `
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35"><path d="M4 4h6l2 2h8v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>
                    <div class="vc-empty-editor-hint">Go to File... <span style="opacity:0.7">Ctrl+P</span><br>Find in Files... <span style="opacity:0.7">Ctrl+Shift+F</span></div>`;
                host.appendChild(emptyEl);
            }
            emptyEl.style.display = 'flex';
        } else if (emptyEl) {
            emptyEl.style.display = 'none';
        }
    }

    function renderBottomPanel() {
        const host = document.getElementById('vcBottomPanelHost');
        const v = D.openTabs.find(t => t.id === D.activeTabId);
        if (!v) { host.innerHTML = ''; return; }
        const toggleGlyph = D.bottomPanelOpen ? '⌄' : '⌃';
        let body = '';
        if (D.bottomPanelOpen) {
            if (D.bottomPanelTab === 'output') {
                const desc = v.desc || 'Không có mô tả cho video này.';
                const chunks = desc.match(/.{1,58}(\s|$)/g) || [desc];
                body = chunks.map((t, i) => `<div><span class="vc-output-line-time">10:0${i % 6}:1${i % 10}</span> <span class="vc-output-line-tag">[info]</span> ${escHtml(t.trim())}</div>`).join('');
            } else {
                const related = D.relatedCache[v.id] || [];
                body = `<div class="vc-terminal-prompt">➜ hush-player git:(main) ✗</div>` +
                    (related.length
                        ? related.map(r => `<div class="vc-terminal-line vc-mono" data-vc-open="${escHtml(r.id)}">$ code --goto ${escHtml(fileNameOf(r))}</div>`).join('')
                        : `<div class="vc-terminal-line vc-mono" style="cursor:default;opacity:0.6">$ (đang tải gợi ý liên quan...)</div>`);
            }
        }
        host.innerHTML = `
            <div class="vc-bottom-tabs">
                <span class="vc-bottom-tab${D.bottomPanelTab === 'output' ? ' active' : ''}" data-vc-select-output="1">OUTPUT</span>
                <span class="vc-bottom-tab${D.bottomPanelTab === 'terminal' ? ' active' : ''}" data-vc-select-terminal="1">TERMINAL</span>
                <span class="vc-bottom-tab-static">PROBLEMS</span>
                <span class="vc-bottom-tab-static">DEBUG CONSOLE</span>
                <div class="vc-bottom-spacer"></div>
                <div class="vc-bottom-toggle" data-vc-toggle-bottom="1" title="Collapse panel">${toggleGlyph}</div>
            </div>
            ${D.bottomPanelOpen ? `<div class="vc-bottom-body vc-mono">${body}</div>` : ''}`;
    }

    function renderStatusBar(resetTick) {
        const v = D.openTabs.find(t => t.id === D.activeTabId);
        const langLabel = v ? LANG_LABELS[extOf(v.id)] : 'Plain Text';
        document.getElementById('vcStatusLang').textContent = langLabel;
        if (resetTick) D.tickSeconds = 0;
        const ln = 12 + Math.floor(D.tickSeconds / 60);
        const col = (D.tickSeconds % 60) + 1;
        document.getElementById('vcStatusLnCol').textContent = `Ln ${ln}, Col ${col}`;
    }

    function renderTitlebar() {
        const v = D.openTabs.find(t => t.id === D.activeTabId);
        const title = v ? `${fileNameOf(v)} — ${PROJECT_NAME} - Visual Studio Code` : `${PROJECT_NAME} - Visual Studio Code`;
        document.getElementById('vcTitleText').textContent = title;
        document.title = title;
    }

    function render() {
        renderTitlebar();
        renderSidebar();
        renderTabbar();
        renderBreadcrumb();
        renderPlayerArea();
        renderBottomPanel();
        renderStatusBar(true);
    }

    function startTicker() {
        stopTicker();
        tickTimer = setInterval(() => {
            if (!D.activeTabId) return;
            D.tickSeconds += 1;
            renderStatusBar(false);
        }, 1000);
    }
    function stopTicker() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = null;
    }

    // ── Shell (built once) ──
    function buildShellOnce() {
        root.innerHTML = `
            <div class="vc-titlebar">
                <div class="vc-dots">
                    <div class="vc-dot" style="background:#ff5f57"></div>
                    <div class="vc-dot" style="background:#febc2e"></div>
                    <div class="vc-dot" style="background:#28c840"></div>
                </div>
                <div class="vc-titlebar-title" id="vcTitleText"></div>
            </div>
            <div class="vc-menubar">
                <span>File</span><span>Edit</span><span>Selection</span><span>View</span><span>Go</span><span>Run</span><span>Terminal</span><span>Help</span>
            </div>
            <div class="vc-body">
                <div class="vc-activitybar">
                    <div class="vc-activity-icon" id="vcActExplorer" title="Explorer" data-vc-select-explorer="1">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4h6l2 2h8v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>
                    </div>
                    <div class="vc-activity-icon" id="vcActSearch" title="Search" data-vc-select-search="1">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="20" y1="20" x2="15.2" y2="15.2"/></svg>
                    </div>
                    <div class="vc-activity-icon" title="Source Control">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 7.2V16.8M6 9c0 3 2 5 6 5h4"/></svg>
                    </div>
                    <div class="vc-activity-icon" title="Run and Debug">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>
                    </div>
                    <div class="vc-activity-icon" title="Extensions">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>
                    </div>
                    <div class="vc-activity-spacer"></div>
                    <div class="vc-activity-icon" title="Thoát chế độ ngụy trang (Ctrl+Shift+H)" data-vc-exit="1">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.6-4 4.5-6 7.5-6s5.9 2 7.5 6"/></svg>
                    </div>
                    <div class="vc-activity-icon" title="Settings">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.4M12 18.6V21M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3 12h2.4M18.6 12H21M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>
                    </div>
                </div>
                <div id="vcSidebarInlineHost" class="vc-sidebar"></div>
                <div id="vcSidebarOverlayHost"></div>
                <div class="vc-editor-group">
                    <div id="vcTabbarHost"></div>
                    <div id="vcBreadcrumbHost"></div>
                    <div style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">
                        <div id="vcPlayerAreaHost" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
                        <div id="vcBottomPanelHost" class="vc-bottom-panel"></div>
                    </div>
                </div>
            </div>
            <div class="vc-statusbar">
                <div class="vc-status-left">
                    <div class="vc-status-branch">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10"/></svg>
                        main*
                    </div>
                    <div style="opacity:0.9">0 ⚠ 0 ✕</div>
                </div>
                <div class="vc-status-right">
                    <span id="vcStatusLang">Plain Text</span>
                    <span>UTF-8</span>
                    <span>LF</span>
                    <span id="vcStatusLnCol">Ln 12, Col 1</span>
                </div>
            </div>`;

        // Delegated events (attached once — survive all innerHTML rebuilds of descendants)
        root.addEventListener('click', (e) => {
            // Close-tab button is nested inside the tab's [data-vc-open] row, so it must be checked first —
            // otherwise closest('[data-vc-open]') matches the ancestor row and "open" fires instead of "close".
            const closeEl = e.target.closest('[data-vc-close-tab]');
            if (closeEl) { closeTab(closeEl.getAttribute('data-vc-close-tab')); return; }

            const openEl = e.target.closest('[data-vc-open]');
            if (openEl) { openFile(videoLookup[openEl.getAttribute('data-vc-open')]); return; }

            const saveEl = e.target.closest('[data-vc-toggle-saved]');
            if (saveEl) { toggleSaved(saveEl.getAttribute('data-vc-toggle-saved')); return; }

            if (e.target.closest('[data-vc-copy-path]')) { copyPath(); return; }

            if (e.target.closest('[data-vc-select-explorer]')) { D.sidebarPanel = 'explorer'; D.sidebarMobileOpen = true; render(); return; }
            if (e.target.closest('[data-vc-select-search]')) { D.sidebarPanel = 'search'; D.sidebarMobileOpen = true; render(); return; }
            if (e.target.closest('[data-vc-close-mobile]')) { D.sidebarMobileOpen = false; render(); return; }

            if (e.target.closest('[data-vc-select-output]')) { D.bottomPanelTab = 'output'; D.bottomPanelOpen = true; renderBottomPanel(); return; }
            if (e.target.closest('[data-vc-select-terminal]')) { D.bottomPanelTab = 'terminal'; D.bottomPanelOpen = true; renderBottomPanel(); return; }
            if (e.target.closest('[data-vc-toggle-bottom]')) { D.bottomPanelOpen = !D.bottomPanelOpen; renderBottomPanel(); return; }

            if (e.target.closest('[data-vc-exit]')) { setDisguiseMode(false); return; }
        });

        root.addEventListener('input', (e) => {
            if (e.target.classList.contains('vc-search-input')) onSearchInputChange(e);
        });

        window.addEventListener('resize', () => { if (D.active) renderSidebar(); });

        // Auto-advance: when the active tab's video ends, open its first related video.
        window.addEventListener('message', (e) => {
            if (!D.active) return;
            let data;
            try { data = JSON.parse(e.data); } catch (err) { return; }
            if (data.event !== 'infoDelivery' || !data.info || data.info.playerState !== 0) return;
            const endedId = Object.keys(playerPanes).find(id => {
                const f = playerPanes[id].querySelector('iframe');
                return f && f.contentWindow === e.source;
            });
            if (!endedId || endedId !== D.activeTabId || endedId === advancedForId) return;
            advancedForId = endedId;
            const related = D.relatedCache[endedId] || [];
            if (related.length) openFile(related[0]);
        });
    }

    // ── Mode switching ──
    function setDisguiseMode(on) {
        D.active = on;
        try { localStorage.setItem('hush_disguise_mode', on ? '1' : '0'); } catch (e) {}

        const appShell = document.querySelector('.app-shell');
        const fileWarning = document.getElementById('fileWarning');

        if (on) {
            D.theme = localStorage.getItem('hush_theme') || 'dark';
            loadPersisted();
            if (appShell) appShell.style.display = 'none';
            if (fileWarning) fileWarning.style.display = 'none';
            root.style.display = 'flex';
            root.setAttribute('data-vc-theme', D.theme);
            root.style.setProperty('--vc-accent', ACCENT);
            if (!shellBuilt) { buildShellOnce(); shellBuilt = true; }
            render();
            startTicker();
        } else {
            root.style.display = 'none';
            if (appShell) appShell.style.display = '';
            document.title = ORIGINAL_TITLE;
            stopTicker();
        }
    }

    // ── Init ──
    const toggleBtn = document.getElementById('disguiseToggleBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', () => setDisguiseMode(true));

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
            e.preventDefault();
            setDisguiseMode(!D.active);
        }
    });

    const params = new URLSearchParams(location.search);
    const modeParam = params.get('mode');
    let initialDisguise;
    if (modeParam === 'disguise') initialDisguise = true;
    else if (modeParam === 'normal') initialDisguise = false;
    else initialDisguise = localStorage.getItem('hush_disguise_mode') === '1';

    if (initialDisguise) setDisguiseMode(true);
});

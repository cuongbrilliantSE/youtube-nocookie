document.addEventListener('DOMContentLoaded', () => {
    // ── State ──
    let theme = localStorage.getItem('hush_theme') || 'dark';
    let view = 'home';
    let query = '';
    let currentVideo = null;
    let saved = JSON.parse(localStorage.getItem('hush_saved_v1')) || [];
    let history = JSON.parse(localStorage.getItem('yt_embed_history')) || [];
    let searchResults = [];
    let isSearching = false;
    let miniVideoData = null;   // video object currently in mini player
    let watchStartTime = null;  // Date.now() when current video started playing

    // ── Avatar palette ──
    const AVATAR_COLORS = ['#3FCFC0', '#B58EF0', '#E8A93F', '#5FA8F5', '#6EE7B7', '#F0A8C8'];

    function getAvatarColor(name) {
        if (!name) return AVATAR_COLORS[0];
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVATAR_COLORS.length;
        return AVATAR_COLORS[h];
    }

    function getInitials(name) {
        if (!name) return '?';
        const w = name.trim().split(/\s+/);
        if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
        return (w[0][0] + w[w.length - 1][0]).toUpperCase();
    }

    function formatViews(views) {
        if (!views) return '';
        if (views >= 1000000) return (views / 1000000).toFixed(1).replace('.0', '') + 'Tr';
        if (views >= 1000) return (views / 1000).toFixed(1).replace('.0', '') + 'N';
        return String(views);
    }

    function escHtml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

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

    // ── DOM refs ──
    const htmlEl = document.documentElement;
    const sidebar = document.getElementById('sidebar');
    const drawerBackdrop = document.getElementById('drawerBackdrop');
    const hamburger = document.getElementById('hamburger');
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    const themeToggle = document.getElementById('themeToggle');
    const themeLabel = document.getElementById('themeLabel');
    const fileWarning = document.getElementById('fileWarning');
    const errorMsg = document.getElementById('errorMsg');
    const errorText = document.getElementById('errorText');
    const navItems = document.querySelectorAll('.nav-item');

    // Home view
    const homeHeading = document.getElementById('homeHeading');
    const videoGrid = document.getElementById('videoGrid');
    const gridLoader = document.getElementById('gridLoader');
    const homeEmpty = document.getElementById('homeEmpty');
    const homeEmptyText = document.getElementById('homeEmptyText');

    // Mini player
    const miniPlayer = document.getElementById('miniPlayer');
    const miniFrame = document.getElementById('miniFrame');
    const miniPlayerTitle = document.getElementById('miniPlayerTitle');
    const miniExpandBtn = document.getElementById('miniExpandBtn');
    const miniCloseBtn = document.getElementById('miniCloseBtn');

    // Watch view
    const videoFrame = document.getElementById('videoFrame');
    const videoTitle = document.getElementById('videoTitle');
    const channelAvatar = document.getElementById('channelAvatar');
    const channelName = document.getElementById('channelName');
    const videoStats = document.getElementById('videoStats');
    const saveBtn = document.getElementById('saveBtn');
    const saveBtnText = document.getElementById('saveBtnText');
    const copyBtn = document.getElementById('copyBtn');
    const copyBtnText = document.getElementById('copyBtnText');
    const suggestedList = document.getElementById('suggestedList');
    const backBtn = document.getElementById('backBtn');

    // Saved view
    const savedGrid = document.getElementById('savedGrid');
    const savedEmpty = document.getElementById('savedEmpty');

    // History view
    const historyRows = document.getElementById('historyRows');
    const historyEmpty = document.getElementById('historyEmpty');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    // ── Init ──
    applyTheme();
    if (location.protocol === 'file:') fileWarning.style.display = 'block';
    showHomeDefault();

    // ── Theme ──
    function applyTheme() {
        htmlEl.setAttribute('data-theme', theme);
        themeLabel.textContent = theme === 'dark' ? 'Tối' : 'Sáng';
        themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
    }

    themeToggle.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('hush_theme', theme);
        applyTheme();
    });

    // ── Mobile nav ──
    hamburger.addEventListener('click', () => {
        sidebar.classList.add('open');
        drawerBackdrop.classList.add('open');
    });

    drawerBackdrop.addEventListener('click', closeMobileNav);

    function closeMobileNav() {
        sidebar.classList.remove('open');
        drawerBackdrop.classList.remove('open');
    }

    // ── Navigation ──
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const target = item.dataset.view;
            if (target !== 'home') {
                // Clear search when navigating away
                searchInput.value = '';
                query = '';
                toggleSearchClear();
            }
            switchView(target);
            closeMobileNav();
        });
    });

    function setActiveNav(v) {
        navItems.forEach(item => item.classList.toggle('active', item.dataset.view === v));
    }

    function switchView(v) {
        const leavingWatch = view === 'watch' && v !== 'watch';

        view = v;
        setActiveNav(v);
        document.querySelectorAll('.view').forEach(el => {
            el.style.display = 'none';
            el.classList.remove('active');
        });
        const el = document.getElementById(`view-${v}`);
        if (el) {
            el.style.display = 'block';
            el.classList.add('active');
        }

        if (leavingWatch && miniVideoData) {
            activateMiniPlayer();
        }
        if (v === 'watch') {
            deactivateMiniPlayer();
        }

        if (v === 'saved') renderSavedView();
        if (v === 'history') renderHistoryView();
        if (v === 'home') {
            if (query) {
                renderVideoGrid(videoGrid, searchResults);
                homeEmpty.style.display = 'none';
                gridLoader.style.display = 'none';
            } else {
                showHomeDefault();
            }
        }
    }

    function activateMiniPlayer() {
        const elapsed = watchStartTime ? Math.floor((Date.now() - watchStartTime) / 1000) : 0;
        const startParam = elapsed > 2 ? `&start=${elapsed}` : '';
        miniFrame.src = `https://www.youtube-nocookie.com/embed/${miniVideoData.id}?autoplay=1${startParam}&rel=0&modestbranding=1&playsinline=1`;
        miniPlayerTitle.textContent = miniVideoData.title || '';
        miniPlayer.style.display = 'block';
        videoFrame.src = ''; // dừng iframe chính
    }

    function deactivateMiniPlayer() {
        miniPlayer.style.display = 'none';
        miniFrame.src = '';
    }

    miniExpandBtn.addEventListener('click', () => {
        if (miniVideoData) openWatch(miniVideoData);
    });

    miniCloseBtn.addEventListener('click', () => {
        deactivateMiniPlayer();
        miniVideoData = null;
        watchStartTime = null;
    });

    // ── Search input ──
    searchInput.addEventListener('input', () => {
        query = searchInput.value.trim();
        toggleSearchClear();
        hideError();
    });

    searchInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !query) return;
        if (view !== 'home') switchView('home');
        const directId = extractVideoId(query);
        if (directId) {
            openWatchById(directId);
        } else {
            doSearch(query);
        }
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        query = '';
        toggleSearchClear();
        homeHeading.textContent = 'Dành cho bạn';
        showHomeDefault();
        hideError();
    });

    function toggleSearchClear() {
        searchClear.classList.toggle('visible', searchInput.value.length > 0);
    }

    // ── Search API ──
    async function doSearch(q) {
        if (isSearching) return;
        isSearching = true;
        videoGrid.innerHTML = '';
        homeEmpty.style.display = 'none';
        gridLoader.style.display = 'flex';
        hideError();

        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            gridLoader.style.display = 'none';
            isSearching = false;

            if (!data.success || !data.videos || data.videos.length === 0) {
                homeHeading.textContent = `Không tìm thấy video nào cho "${q}"`;
                homeEmptyText.textContent = `Không tìm thấy video nào phù hợp với "${q}".`;
                homeEmpty.style.display = 'flex';
                return;
            }

            searchResults = data.videos;
            homeHeading.textContent = `Kết quả cho "${q}"`;
            renderVideoGrid(videoGrid, searchResults);
        } catch (err) {
            console.error(err);
            gridLoader.style.display = 'none';
            isSearching = false;
            showError('Đã có lỗi khi tìm kiếm. Vui lòng thử lại.');
        }
    }

    function showHomeDefault() {
        videoGrid.innerHTML = '';
        gridLoader.style.display = 'none';
        homeEmptyText.textContent = 'Nhập tên video hoặc từ khóa vào ô tìm kiếm phía trên.';
        homeEmpty.style.display = 'flex';
    }

    // ── Video Grid ──
    function renderVideoGrid(container, videos) {
        container.innerHTML = '';
        if (!videos || videos.length === 0) return;
        videos.forEach(video => container.appendChild(createVideoCard(video)));
    }

    function createVideoCard(video) {
        const card = document.createElement('div');
        card.className = 'video-card';

        const isSaved = saved.some(s => s.id === video.id);
        const color = getAvatarColor(video.author);
        const initials = getInitials(video.author);
        const thumb = video.thumbnail || `/api/thumbnail?id=${video.id}`;
        const viewsText = video.views ? `${formatViews(video.views)}${video.isLive ? ' người xem' : ' lượt xem'}` : '';
        const statsText = [viewsText, video.ago].filter(Boolean).join(' · ');

        card.innerHTML = `
            <div class="card-thumb-wrap">
                <img src="${escHtml(thumb)}" alt="${escHtml(video.title)}" loading="lazy">
                ${video.isLive ? `<span class="live-badge">TRỰC TIẾP</span>` : (video.duration ? `<span class="duration-badge">${escHtml(video.duration)}</span>` : '')}
                <button class="card-bookmark-btn${isSaved ? ' saved' : ''}" data-id="${escHtml(video.id)}" title="${isSaved ? 'Bỏ lưu' : 'Lưu video'}" aria-label="${isSaved ? 'Bỏ lưu' : 'Lưu video'}">
                    <div class="bookmark-shape"></div>
                </button>
            </div>
            <div class="card-meta">
                <div class="card-avatar" style="background:${color}">${escHtml(initials)}</div>
                <div class="card-info">
                    <div class="card-title" title="${escHtml(video.title)}">${escHtml(video.title)}</div>
                    <div class="card-channel">${escHtml(video.author || 'Không rõ kênh')}</div>
                    ${statsText ? `<div class="card-stats">${escHtml(statsText)}</div>` : ''}
                </div>
            </div>`;

        card.addEventListener('click', e => {
            if (e.target.closest('.card-bookmark-btn')) return;
            openWatch(video);
        });

        card.querySelector('.card-bookmark-btn').addEventListener('click', e => {
            e.stopPropagation();
            toggleSaved(video);
            // Sync all bookmark buttons for this video id
            document.querySelectorAll(`.card-bookmark-btn[data-id="${video.id}"]`).forEach(btn => {
                const nowSaved = saved.some(s => s.id === video.id);
                btn.classList.toggle('saved', nowSaved);
                btn.title = nowSaved ? 'Bỏ lưu' : 'Lưu video';
            });
            if (currentVideo && currentVideo.id === video.id) updateSaveBtnState();
        });

        return card;
    }

    // ── Watch View ──
    function openWatch(video) {
        currentVideo = video;
        miniVideoData = video;
        watchStartTime = Date.now();
        videoFrame.src = `https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1&playsinline=1`;

        videoTitle.textContent = video.title || '';
        channelName.textContent = video.author || 'Không rõ kênh';

        const viewsText = video.views ? `${formatViews(video.views)} lượt xem` : '';
        videoStats.textContent = [viewsText, video.ago].filter(Boolean).join(' · ');

        const color = getAvatarColor(video.author);
        channelAvatar.style.background = color;
        channelAvatar.textContent = getInitials(video.author);

        updateSaveBtnState();
        addToHistory(video);
        switchView('watch');
        loadSuggested(video);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function openWatchById(id) {
        // Open with minimal info - full meta will load when/if they search
        openWatch({ id, title: `Video ${id}`, author: '', thumbnail: `/api/thumbnail?id=${id}` });
    }

    function updateSaveBtnState() {
        if (!currentVideo) return;
        const isSaved = saved.some(s => s.id === currentVideo.id);
        saveBtn.classList.toggle('saved-active', isSaved);
        saveBtnText.textContent = isSaved ? 'Đã lưu' : 'Lưu';
    }

    backBtn.addEventListener('click', () => {
        switchView('home');
    });

    saveBtn.addEventListener('click', () => {
        if (!currentVideo) return;
        toggleSaved(currentVideo);
        updateSaveBtnState();
        document.querySelectorAll(`.card-bookmark-btn[data-id="${currentVideo.id}"]`).forEach(btn => {
            const nowSaved = saved.some(s => s.id === currentVideo.id);
            btn.classList.toggle('saved', nowSaved);
        });
    });

    copyBtn.addEventListener('click', () => {
        if (!currentVideo) return;
        const url = `https://www.youtube-nocookie.com/embed/${currentVideo.id}`;
        navigator.clipboard.writeText(url).then(() => {
            copyBtnText.textContent = 'Đã sao chép';
            setTimeout(() => { copyBtnText.textContent = 'Sao chép liên kết riêng tư'; }, 1600);
        }).catch(() => {
            // Fallback for browsers that block clipboard
            copyBtnText.textContent = url;
            setTimeout(() => { copyBtnText.textContent = 'Sao chép liên kết riêng tư'; }, 3000);
        });
    });

    async function loadSuggested(video) {
        suggestedList.innerHTML = '<div class="suggested-loader"><div class="spinner small"></div></div>';
        try {
            const q = encodeURIComponent(video.author || video.title || 'music');
            const res = await fetch(`/api/search?q=${q}`);
            const data = await res.json();

            suggestedList.innerHTML = '';
            if (!data.success || !data.videos || data.videos.length === 0) {
                suggestedList.innerHTML = '<p style="font-size:13px;color:var(--textFaint);padding:8px 6px;">Không có video liên quan.</p>';
                return;
            }

            data.videos.filter(v => v.id !== video.id).slice(0, 8).forEach(v => {
                suggestedList.appendChild(createSuggestedItem(v));
            });
        } catch (err) {
            console.error(err);
            suggestedList.innerHTML = '<p style="font-size:13px;color:var(--textFaint);padding:8px 6px;">Không thể tải video liên quan.</p>';
        }
    }

    function createSuggestedItem(video) {
        const item = document.createElement('div');
        item.className = 'suggested-item';
        const thumb = video.thumbnail || `/api/thumbnail?id=${video.id}`;
        const viewsText = video.views ? `${formatViews(video.views)} lượt xem` : '';

        item.innerHTML = `
            <div class="suggested-thumb-wrap">
                <img src="${escHtml(thumb)}" alt="${escHtml(video.title)}" loading="lazy">
                ${video.duration ? `<span class="duration-badge">${escHtml(video.duration)}</span>` : ''}
            </div>
            <div class="suggested-info">
                <div class="suggested-title">${escHtml(video.title)}</div>
                <div class="suggested-channel">${escHtml(video.author || 'Không rõ kênh')}</div>
                ${viewsText ? `<div class="suggested-views">${escHtml(viewsText)}</div>` : ''}
            </div>`;

        item.addEventListener('click', () => openWatch(video));
        return item;
    }

    // ── Saved View ──
    function renderSavedView() {
        savedGrid.innerHTML = '';
        if (saved.length === 0) {
            savedEmpty.style.display = 'flex';
            savedGrid.style.display = 'none';
        } else {
            savedEmpty.style.display = 'none';
            savedGrid.style.display = 'grid';
            saved.forEach(video => savedGrid.appendChild(createVideoCard(video)));
        }
    }

    // ── History View ──
    function renderHistoryView() {
        historyRows.innerHTML = '';
        const ytHistory = history.filter(item => !item.platform || item.platform === 'youtube');

        if (ytHistory.length === 0) {
            historyEmpty.style.display = 'flex';
            clearHistoryBtn.style.display = 'none';
        } else {
            historyEmpty.style.display = 'none';
            clearHistoryBtn.style.display = 'inline-flex';
            ytHistory.forEach(item => historyRows.appendChild(createHistoryRow(item)));
        }
    }

    function createHistoryRow(item) {
        const row = document.createElement('div');
        row.className = 'history-row';
        const thumb = item.thumbnail || `/api/thumbnail?id=${item.id}`;
        const channelText = item.channel || item.author || '';
        const viewsText = item.views ? `${formatViews(item.views)} lượt xem` : '';
        const subText = [channelText, viewsText].filter(Boolean).join(' · ');

        row.innerHTML = `
            <div class="history-row-thumb">
                <img src="${escHtml(thumb)}" alt="${escHtml(item.title || '')}" loading="lazy">
            </div>document.addEventListener('DOMContentLoaded', () => {
    // ── State ──
    let theme = localStorage.getItem('hush_theme') || 'dark';
    let view = 'home';
    let query = '';
    let currentVideo = null;
    let saved = JSON.parse(localStorage.getItem('hush_saved_v1')) || [];
    let history = JSON.parse(localStorage.getItem('yt_embed_history')) || [];
    let searchResults = [];
    let isSearching = false;
    let miniVideoData = null;   // video object currently in mini player
    let watchStartTime = null;  // Date.now() when current video started playing

    // ── Avatar palette ──
    const AVATAR_COLORS = ['#3FCFC0', '#B58EF0', '#E8A93F', '#5FA8F5', '#6EE7B7', '#F0A8C8'];

    function getAvatarColor(name) {
        if (!name) return AVATAR_COLORS[0];
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVATAR_COLORS.length;
        return AVATAR_COLORS[h];
    }

    function getInitials(name) {
        if (!name) return '?';
        const w = name.trim().split(/\s+/);
        if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
        return (w[0][0] + w[w.length - 1][0]).toUpperCase();
    }

    function formatViews(views) {
        if (!views) return '';
        if (views >= 1000000) return (views / 1000000).toFixed(1).replace('.0', '') + 'Tr';
        if (views >= 1000) return (views / 1000).toFixed(1).replace('.0', '') + 'N';
        return String(views);
    }

    function escHtml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function extractVideoId(input) {
        if (!input) return null;
        input = input.trim();
        const patterns = [
            /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
        ];
        for (const p of patterns) {
            const m = input.match(p);
            if (m) return m[1];
        }
        if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
        return null;
    }


            <div class="history-row-info">
                <div class="history-row-title">${escHtml(item.title || `Video ID: ${item.id}`)}</div>
                ${subText ? `<div class="history-row-sub">${escHtml(subText)}</div>` : ''}
                ${item.timestamp ? `<div class="history-row-time">Xem lúc ${escHtml(item.timestamp)}</div>` : ''}
            </div>`;

        row.addEventListener('click', () => {
            openWatch({
                id: item.id,
                title: item.title,
                author: item.channel || item.author || '',
                thumbnail: thumb,
                views: item.views,
                ago: item.ago,
                duration: item.duration,
                isLive: item.isLive || false,
            });
        });

        return row;
    }

    clearHistoryBtn.addEventListener('click', () => {
        history = [];
        saveHistory();
        renderHistoryView();
    });

    // ── Bookmarks ──
    function toggleSaved(video) {
        const idx = saved.findIndex(s => s.id === video.id);
        if (idx === -1) {
            saved.unshift({ ...video });
        } else {
            saved.splice(idx, 1);
        }
        localStorage.setItem('hush_saved_v1', JSON.stringify(saved));
    }

    // ── History storage ──
    function addToHistory(video) {
        history = history.filter(item => item.id !== video.id);
        history.unshift({
            id: video.id,
            title: video.title || '',
            channel: video.author || '',
            author: video.author || '',
            thumbnail: video.thumbnail || `/api/thumbnail?id=${video.id}`,
            views: video.views,
            ago: video.ago,
            duration: video.duration,
            isLive: video.isLive || false,
            platform: 'youtube',
            url: `https://www.youtube-nocookie.com/embed/${video.id}`,
            timestamp: new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
        });
        if (history.length > 30) history.pop();
        saveHistory();
    }

    function saveHistory() {
        localStorage.setItem('yt_embed_history', JSON.stringify(history));
    }

    // ── Errors ──
    function showError(msg) {
        errorMsg.style.display = 'flex';
        errorText.textContent = msg || 'Đã có lỗi xảy ra.';
    }

    function hideError() {
        errorMsg.style.display = 'none';
    }
});

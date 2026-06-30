document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const embedBtn = document.getElementById('embedBtn');
    const clearInputBtn = document.getElementById('clearInputBtn');
    const videoWrapper = document.getElementById('videoWrapper');
    const videoFrame = document.getElementById('videoFrame');
    const errorMsg = document.getElementById('errorMsg');
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const warningAlert = document.getElementById('fileWarning');

    // Search elements
    const searchWrapper = document.getElementById('searchWrapper');
    const closeSearchBtn = document.getElementById('closeSearchBtn');
    const searchLoader = document.getElementById('searchLoader');
    const searchResultsGrid = document.getElementById('searchResultsGrid');

    let history = JSON.parse(localStorage.getItem('yt_embed_history')) || [];

    // Check file protocol warning
    if (location.protocol === 'file:') {
        warningAlert.style.display = 'flex';
    } else {
        warningAlert.style.display = 'none';
    }

    // Initialize UI
    updateHistoryUI();
    toggleClearButton();

    // Default Video Load
    const defaultId = 'TNwKs39uSVk';
    loadVideo(defaultId, false);

    // Event Listeners
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleEmbed();
    });

    urlInput.addEventListener('input', toggleClearButton);

    embedBtn.addEventListener('click', handleEmbed);

    clearInputBtn.addEventListener('click', () => {
        urlInput.value = '';
        toggleClearButton();
        urlInput.focus();
    });

    clearHistoryBtn.addEventListener('click', () => {
        history = [];
        saveHistory();
        updateHistoryUI();
    });

    closeSearchBtn.addEventListener('click', () => {
        searchWrapper.style.display = 'none';
        searchResultsGrid.innerHTML = '';
    });

    // Preset tag handlers
    window.selectPreset = function(url) {
        urlInput.value = url;
        toggleClearButton();
        handleEmbed();
    };

    function toggleClearButton() {
        if (urlInput.value.length > 0) {
            clearInputBtn.classList.add('active');
        } else {
            clearInputBtn.classList.remove('active');
        }
    }

    function extractVideoId(url) {
        url = url.trim();
        const patterns = [
            /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        // Check if raw 11 char ID is input
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
            return url;
        }
        return null;
    }

    function handleEmbed() {
        const query = urlInput.value.trim();
        if (!query) return;

        const videoId = extractVideoId(query);

        if (!videoId) {
            // If it's not a direct YouTube link/ID, perform search
            hideError();
            searchVideos(query);
            return;
        }

        hideError();
        loadVideo(videoId, true);
        addToHistory(videoId, query);
        searchWrapper.style.display = 'none';
    }

    function loadVideo(id, animate = true) {
        videoFrame.src = `https://www.youtube-nocookie.com/embed/${id}`;
        
        if (animate) {
            videoWrapper.classList.remove('active');
            // Force reflow
            void videoWrapper.offsetWidth;
        }
        videoWrapper.classList.add('active');
    }

    function showError() {
        errorMsg.style.display = 'flex';
    }

    function hideError() {
        errorMsg.style.display = 'none';
    }

    // Search Video Logic
    async function searchVideos(query) {
        searchLoader.style.display = 'flex';
        searchResultsGrid.innerHTML = '';
        searchWrapper.style.display = 'flex';

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            searchLoader.style.display = 'none';

            if (!data.success || !data.videos || data.videos.length === 0) {
                searchResultsGrid.innerHTML = '<div class="empty-history" style="grid-column: 1/-1;">Không tìm thấy video nào phù hợp.</div>';
                return;
            }

            data.videos.forEach(video => {
                const card = document.createElement('div');
                card.className = 'search-result-card';
                
                let statsText = '';
                if (video.views) {
                    statsText += `${formatViews(video.views)} lượt xem`;
                }
                if (video.ago) {
                    statsText += statsText ? ` • ${video.ago}` : video.ago;
                }

                card.innerHTML = `
                    <div class="search-result-thumb-wrapper">
                        <img src="${video.thumbnail}" alt="${video.title}" loading="lazy">
                        ${video.duration ? `<span class="search-result-duration">${video.duration}</span>` : ''}
                    </div>
                    <div class="search-result-info">
                        <h4 class="search-result-title" title="${video.title}">${video.title}</h4>
                        <div class="search-result-meta">
                            <span class="search-result-channel" title="${video.author}">${video.author}</span>
                            <span class="search-result-stats">${statsText}</span>
                        </div>
                    </div>
                `;

                card.addEventListener('click', () => {
                    loadVideo(video.id, true);
                    addToHistory(video.id, `https://www.youtube.com/watch?v=${video.id}`, video.title);
                    videoWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });

                searchResultsGrid.appendChild(card);
            });

        } catch (error) {
            console.error('Fetch search error:', error);
            searchLoader.style.display = 'none';
            searchResultsGrid.innerHTML = '<div class="empty-history" style="grid-column: 1/-1; color: #ff453a;">Đã có lỗi xảy ra khi tìm kiếm. Vui lòng thử lại sau.</div>';
        }
    }

    function formatViews(views) {
        if (!views) return '';
        if (views >= 1000000) {
            return (views / 1000000).toFixed(1).replace('.0', '') + 'Tr';
        }
        if (views >= 1000) {
            return (views / 1000).toFixed(1).replace('.0', '') + 'N';
        }
        return views;
    }

    // History Logic
    function addToHistory(id, originalUrl, title = '') {
        // Avoid duplicate IDs in history (push to top if exists)
        history = history.filter(item => item.id !== id);
        
        history.unshift({
            id: id,
            url: originalUrl,
            title: title || `Video ID: ${id}`,
            timestamp: new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
        });

        // Limit to 10 items
        if (history.length > 10) {
            history.pop();
        }

        saveHistory();
        updateHistoryUI();
    }

    function saveHistory() {
        localStorage.setItem('yt_embed_history', JSON.stringify(history));
    }

    function updateHistoryUI() {
        historyList.innerHTML = '';

        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-history">Chưa có video nào đã phát</div>';
            clearHistoryBtn.style.display = 'none';
            return;
        }

        clearHistoryBtn.style.display = 'block';

        history.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'history-item';
            
            const displayTitle = item.title || `Video ID: ${item.id}`;
            
            div.innerHTML = `
                <div class="history-item-info" onclick="playFromHistory('${item.id}')">
                    <span class="history-item-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                    </span>
                    <span class="history-item-title" title="${displayTitle} - ${item.timestamp}">${displayTitle} (${item.timestamp})</span>
                </div>
                <button class="history-item-delete" onclick="deleteHistoryItem(event, ${index})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;
            historyList.appendChild(div);
        });
    }

    window.playFromHistory = function(id) {
        loadVideo(id);
        // Move to top of history
        const item = history.find(i => i.id === id);
        if (item) {
            addToHistory(id, item.url, item.title);
        }
    };

    window.deleteHistoryItem = function(event, index) {
        event.stopPropagation();
        history.splice(index, 1);
        saveHistory();
        updateHistoryUI();
    };
});

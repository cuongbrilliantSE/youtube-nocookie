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

    // Platform switcher elements
    const tabYoutube = document.getElementById('tabYoutube');
    const tabFacebook = document.getElementById('tabFacebook');
    const nativeVideoPlayer = document.getElementById('nativeVideoPlayer');

    let history = JSON.parse(localStorage.getItem('yt_embed_history')) || [];
    let currentPlatform = 'youtube';

    // Check file protocol warning
    if (location.protocol === 'file:') {
        warningAlert.style.display = 'flex';
    } else {
        warningAlert.style.display = 'none';
    }

    // Initialize UI
    updateHistoryUI();
    toggleClearButton();

    // Default Video Load (YouTube)
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

    tabYoutube.addEventListener('click', () => switchPlatform('youtube'));
    tabFacebook.addEventListener('click', () => switchPlatform('facebook'));

    // Platform Switching UI logic
    function switchPlatform(platform) {
        currentPlatform = platform;
        updateTabUI();
        
        // Update placeholder & presets
        if (currentPlatform === 'youtube') {
            urlInput.placeholder = "Nhập link YouTube, ID video hoặc từ khóa tìm kiếm...";
            updatePresetsUI('youtube');
        } else {
            urlInput.placeholder = "Nhập link Facebook Reels hoặc từ khóa tìm kiếm...";
            updatePresetsUI('facebook');
        }
        
        // Clear search results
        searchWrapper.style.display = 'none';
        searchResultsGrid.innerHTML = '';
    }

    function updateTabUI() {
        if (currentPlatform === 'youtube') {
            tabYoutube.classList.add('active');
            tabFacebook.classList.remove('active');
        } else {
            tabFacebook.classList.add('active');
            tabYoutube.classList.remove('active');
        }
    }

    function updatePresetsUI(platform) {
        const presetsDiv = document.querySelector('.presets');
        if (!presetsDiv) return;
        
        if (platform === 'youtube') {
            presetsDiv.innerHTML = `
                <span>Gợi ý:</span>
                <span class="preset-tag" onclick="selectPreset('https://www.youtube.com/watch?v=jfKfPfyJRdk')">Lofi Girl Coding</span>
                <span class="preset-tag" onclick="selectPreset('https://www.youtube.com/watch?v=dQw4w9WgXcQ')">Rickroll</span>
                <span class="preset-tag" onclick="selectPreset('https://www.youtube.com/watch?v=EngW7tLk6R8')">Nature 4K Relaxation</span>
            `;
        } else {
            presetsDiv.innerHTML = `
                <span>Gợi ý:</span>
                <span class="preset-tag" onclick="selectPreset('hài hước ngắn')">Hài hước ngắn</span>
                <span class="preset-tag" onclick="selectPreset('nấu ăn ngon mỗi ngày')">Nấu ăn ngon</span>
                <span class="preset-tag" onclick="selectPreset('khoảnh khắc thú cưng')">Thú cưng vui nhộn</span>
            `;
        }
    }

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

    // YouTube extractor
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

    // Facebook Reels extractor
    function extractFacebookReelUrl(input) {
        input = input.trim();
        if (input.includes('facebook.com') || input.includes('fb.watch')) {
            return input;
        }
        if (/^\d+$/.test(input)) {
            return `https://www.facebook.com/reel/${input}/`;
        }
        return null;
    }

    function extractFacebookReelId(url) {
        url = url.trim();
        const match = url.match(/\/reel\/([0-9a-zA-Z_-]+)/);
        if (match) return match[1];
        
        const watchMatch = url.match(/[?&]v=([0-9a-zA-Z_-]+)/);
        if (watchMatch) return watchMatch[1];

        if (/^\d+$/.test(url)) return url;

        return null;
    }

    function handleEmbed() {
        const query = urlInput.value.trim();
        if (!query) return;

        if (currentPlatform === 'youtube') {
            const videoId = extractVideoId(query);
            if (!videoId) {
                hideError();
                searchVideos(query);
                return;
            }
            hideError();
            loadVideo(videoId, true);
            addToHistory(videoId, query);
            searchWrapper.style.display = 'none';
        } else {
            const reelUrl = extractFacebookReelUrl(query);
            const reelId = extractFacebookReelId(query);

            if (!reelUrl || !reelId) {
                hideError();
                searchVideos(query);
                return;
            }
            hideError();
            loadVideo(reelId, true);
            addToHistory(reelId, reelUrl);
            searchWrapper.style.display = 'none';
        }
    }

    function loadVideo(id, animate = true) {
        if (currentPlatform === 'facebook') {
            // Hide YouTube iframe, show native video player
            videoFrame.style.display = 'none';
            videoFrame.src = '';
            
            nativeVideoPlayer.style.display = 'block';
            nativeVideoPlayer.src = `/api/video/facebook?id=${id}`;
            nativeVideoPlayer.load();
            
            videoWrapper.classList.add('facebook-reels');
        } else {
            // Show YouTube iframe, hide native video player
            nativeVideoPlayer.style.display = 'none';
            nativeVideoPlayer.src = '';
            
            videoFrame.style.display = 'block';
            videoFrame.src = `https://www.youtube-nocookie.com/embed/${id}`;
            
            videoWrapper.classList.remove('facebook-reels');
        }
        
        if (animate) {
            videoWrapper.classList.remove('active');
            void videoWrapper.offsetWidth; // Force reflow
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

        const loaderText = searchLoader.querySelector('span');
        if (loaderText) {
            loaderText.textContent = currentPlatform === 'youtube' 
                ? 'Đang tìm kiếm video từ YouTube...' 
                : 'Đang tìm kiếm Reels từ Facebook (bảo mật)...';
        }

        try {
            const apiPath = currentPlatform === 'youtube' ? '/api/search' : '/api/search/facebook';
            const response = await fetch(`${apiPath}?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            searchLoader.style.display = 'none';

            if (!data.success || !data.videos || data.videos.length === 0) {
                searchResultsGrid.innerHTML = '<div class="empty-history" style="grid-column: 1/-1;">Không tìm thấy kết quả phù hợp.</div>';
                return;
            }

            data.videos.forEach(video => {
                const card = document.createElement('div');
                card.className = 'search-result-card';
                
                let statsText = '';
                if (currentPlatform === 'youtube') {
                    if (video.views) {
                        statsText += `${formatViews(video.views)} lượt xem`;
                    }
                    if (video.ago) {
                        statsText += statsText ? ` • ${video.ago}` : video.ago;
                    }
                } else {
                    statsText = 'Facebook Reel';
                }

                let thumbnailHtml = '';
                if (currentPlatform === 'facebook') {
                    thumbnailHtml = `
                        <div class="fb-reels-placeholder">
                            <div class="fb-reels-icon-wrapper">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                                </svg>
                            </div>
                            <span>FB REELS</span>
                        </div>
                    `;
                } else {
                    thumbnailHtml = `<img src="${video.thumbnail}" alt="${video.title}" loading="lazy">`;
                }

                card.innerHTML = `
                    <div class="search-result-thumb-wrapper">
                        ${thumbnailHtml}
                        ${video.duration ? `<span class="search-result-duration">${video.duration}</span>` : ''}
                    </div>
                    <div class="search-result-info">
                        <h4 class="search-result-title" title="${video.title}">${video.title}</h4>
                        <div class="search-result-meta">
                            <span class="search-result-channel" title="${video.author || 'Facebook'}">${video.author || 'Facebook'}</span>
                            <span class="search-result-stats">${statsText}</span>
                        </div>
                    </div>
                `;

                card.addEventListener('click', () => {
                    loadVideo(video.id, true);
                    addToHistory(video.id, video.url || `https://www.facebook.com/reel/${video.id}`, video.title);
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
        history = history.filter(item => item.id !== id);
        
        history.unshift({
            id: id,
            url: originalUrl,
            title: title || `Video ID: ${id}`,
            platform: currentPlatform,
            timestamp: new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
        });

        if (history.length > 10) {
            history.pop();
        }

        saveHistory();
        updateHistoryUI();
    }

    // Overwrite the saveHistory function to store correct variable name
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
            const isFb = item.platform === 'facebook';
            
            const platformIconSvg = isFb 
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="#1877f2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="#ff0000"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.508 9.388.508 9.388.508s7.517 0 9.388-.508a3.002 3.002 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
            
            div.innerHTML = `
                <div class="history-item-info" onclick="playFromHistory('${item.id}')">
                    <span class="history-item-icon">
                        ${platformIconSvg}
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
        const item = history.find(i => i.id === id);
        if (item) {
            currentPlatform = item.platform || 'youtube';
            updateTabUI();
            
            if (currentPlatform === 'youtube') {
                urlInput.placeholder = "Nhập link YouTube, ID video hoặc từ khóa tìm kiếm...";
                updatePresetsUI('youtube');
            } else {
                urlInput.placeholder = "Nhập link Facebook Reels hoặc từ khóa tìm kiếm...";
                updatePresetsUI('facebook');
            }

            loadVideo(id);
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

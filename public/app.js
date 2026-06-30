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
        const url = urlInput.value.trim();
        if (!url) return;

        const videoId = extractVideoId(url);

        if (!videoId) {
            showError();
            return;
        }

        hideError();
        loadVideo(videoId, true);
        addToHistory(videoId, url);
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

    // History Logic
    function addToHistory(id, originalUrl) {
        // Avoid duplicate IDs in history (push to top if exists)
        history = history.filter(item => item.id !== id);
        
        history.unshift({
            id: id,
            url: originalUrl,
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
            div.innerHTML = `
                <div class="history-item-info" onclick="playFromHistory('${item.id}')">
                    <span class="history-item-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                    </span>
                    <span class="history-item-title" title="ID: ${item.id} - ${item.timestamp}">ID: ${item.id} (${item.timestamp})</span>
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
            addToHistory(id, item.url);
        }
    };

    window.deleteHistoryItem = function(event, index) {
        event.stopPropagation();
        history.splice(index, 1);
        saveHistory();
        updateHistoryUI();
    };
});

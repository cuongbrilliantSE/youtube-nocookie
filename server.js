const express = require('express');
const path = require('path');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Search API endpoint
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    const results = await yts(query);
    const videos = (results.videos || []).slice(0, 12).map(v => ({
      id: v.videoId,
      title: v.title,
      thumbnail: v.thumbnail || v.image,
      duration: v.timestamp || (v.duration ? v.duration.timestamp : ''),
      author: v.author ? v.author.name : '',
      views: v.views,
      ago: v.ago
    }));

    res.json({ success: true, videos });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to perform search' });
  }
});

// Catch-all route to serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  YouTube No-Cookie Embed Server is running!`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});

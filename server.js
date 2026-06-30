const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const express = require('express');
const path = require('path');
const yts = require('yt-search');
const { exec } = require('child_process');
const util = require('util');
const { Readable } = require('stream');

const execPromise = util.promisify(exec);

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

// HTML Entity decoder for Yahoo search results (supports Vietnamese characters)
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
            .replace(/&dstrok;/gi, 'đ')
            .replace(/&Dstrok;/gi, 'Đ')
            .replace(/&[a-zA-Z0-9]+;/g, (match) => {
              const entities = {
                '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
                '&nbsp;': ' ', '&agrave;': 'à', '&aacute;': 'á', '&acirc;': 'â',
                '&atilde;': 'ã', '&egrave;': 'è', '&eacute;': 'é', '&ecirc;': 'ê',
                '&igrave;': 'ì', '&iacute;': 'í', '&ograve;': 'ò', '&oacute;': 'ó',
                '&ocirc;': 'ô', '&otilde;': 'õ', '&ugrave;': 'ù', '&uacute;': 'ú',
                '&yacute;': 'ý', '&Agrave;': 'À', '&Aacute;': 'Á', '&Acirc;': 'Â',
                '&Atilde;': 'Ã', '&Egrave;': 'È', '&Eacute;': 'É', '&Ecirc;': 'Ê',
                '&Igrave;': 'Ì', '&Iacute;': 'Í', '&Ograve;': 'Ò', '&Oacute;': 'Ó',
                '&Ocirc;': 'Ô', '&Otilde;': 'Õ', '&Ugrave;': 'Ù', '&Uacute;': 'Ú',
                '&Yacute;': 'Ý', '&deg;': '°'
              };
              return entities[match] || match;
            });
}

// Search Facebook Reels API endpoint using Yahoo Search (bypasses DuckDuckGo captcha blocks)
app.get('/api/search/facebook', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    const url = `https://search.yahoo.com/search?q=site:facebook.com/reel+${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo search failed with status: ${response.status}`);
    }

    const html = await response.text();
    const aRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    const videos = [];
    
    while ((match = aRegex.exec(html)) !== null && videos.length < 12) {
      let href = match[1];
      const aContent = match[2];

      // Decode RU parameter from Yahoo redirect URL
      const ruMatch = href.match(/RU=(https%3a%2f%2f[^/]+)/i);
      if (ruMatch) {
        href = decodeURIComponent(ruMatch[1]);
      }

      if (href.includes('facebook.com/reel/')) {
        const reelIdMatch = href.match(/\/reel\/([0-9a-zA-Z_-]+)/);
        const reelId = reelIdMatch ? reelIdMatch[1] : '';
        
        if (reelId) {
          // Extract title inside nested <h3><span ...>TITLE</span></h3>
          const titleMatch = aContent.match(/<h3[^>]*class="[^"]*title[^"]*"[^>]*><span[^>]*>([\s\S]*?)<\/span><\/h3>/);
          let title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';
          title = decodeHtmlEntities(title);
          title = title.replace(/\s*-\s*Facebook\s*$/i, '');

          videos.push({
            id: reelId,
            title: title || `Facebook Reel ${reelId}`,
            url: href,
            thumbnail: '', // Styled with Reels gradient & SVG logo on client
            duration: 'Reel',
            author: 'Facebook Creator',
            views: null,
            ago: null
          });
        }
      }
    }

    res.json({ success: true, videos });
  } catch (error) {
    console.error('Facebook search error:', error);
    res.status(500).json({ error: 'Failed to perform Facebook search' });
  }
});

// Proxy Video Stream endpoint using yt-dlp stdout pipe (fixes 403 Forbidden CDN issues)
app.get('/api/video/facebook', (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).send('Missing video ID');
  }

  // Security check to prevent command injection
  if (!/^[0-9a-zA-Z_-]+$/.test(id)) {
    return res.status(400).send('Invalid video ID format');
  }

  // Set response headers for direct MP4 stream
  res.setHeader('Content-Type', 'video/mp4');
  
  // Spawn yt-dlp process to stream video directly to stdout
  const { spawn } = require('child_process');
  const child = spawn('yt-dlp', [
    '-o', '-',
    '-f', 'mp4/best',
    `https://www.facebook.com/reel/${id}`
  ]);

  // Pipe yt-dlp stdout stream directly to express response
  child.stdout.pipe(res);

  // Log errors if any
  child.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('ERROR')) {
      console.error(`yt-dlp error for ID ${id}:`, msg);
    }
  });

  // Handle stream termination/disconnects safely to prevent crashes & save resources
  res.on('close', () => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  });

  child.on('error', (err) => {
    console.error('Failed to start yt-dlp streaming:', err);
    if (!res.headersSent) {
      res.status(500).send('Streaming error');
    }
  });
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

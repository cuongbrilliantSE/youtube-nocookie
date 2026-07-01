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

// Helper function to fetch with a timeout using AbortController
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 3500 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(id);
  return response;
}

// Search Facebook Reels API endpoint using multi-engine fallback (Bing, Yahoo, DuckDuckGo)
app.get('/api/search/facebook', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const engines = [
    {
      name: 'Yahoo France',
      url: `https://fr.search.yahoo.com/search?q=site:facebook.com/reel+${encodeURIComponent(query)}`
    },
    {
      name: 'Yahoo UK',
      url: `https://uk.search.yahoo.com/search?q=site:facebook.com/reel+${encodeURIComponent(query)}`
    },
    {
      name: 'Yahoo Germany',
      url: `https://de.search.yahoo.com/search?q=site:facebook.com/reel+${encodeURIComponent(query)}`
    },
    {
      name: 'Yahoo Spain',
      url: `https://es.search.yahoo.com/search?q=site:facebook.com/reel+${encodeURIComponent(query)}`
    },
    {
      name: 'Yahoo US',
      url: `https://search.yahoo.com/search?q=site:facebook.com/reel+${encodeURIComponent(query)}`
    },
    {
      name: 'Bing',
      url: `https://www.bing.com/search?q=site:facebook.com/reel+${encodeURIComponent(query)}`
    },
    {
      name: 'DuckDuckGo',
      url: `https://html.duckduckgo.com/html/?q=site:facebook.com/reel+${encodeURIComponent(query)}`
    }
  ];

  let lastError = null;

  for (const engine of engines) {
    try {
      console.log(`Trying Facebook search via ${engine.name}...`);
      const response = await fetchWithTimeout(engine.url, {
        timeout: 4000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        }
      });

      if (!response.ok) {
        throw new Error(`${engine.name} returned status: ${response.status}`);
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

        // Handle DuckDuckGo redirect URL format
        if (href.startsWith('/l/?') || href.includes('uddg=')) {
          const uddgMatch = href.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            href = decodeURIComponent(uddgMatch[1]);
          }
        }

        if (href.includes('facebook.com/reel/')) {
          const reelIdMatch = href.match(/\/reel\/([0-9a-zA-Z_-]+)/);
          const reelId = reelIdMatch ? reelIdMatch[1] : '';

          if (reelId) {
            // Find titles matching headers or spans, generic fallbacks
            const titleMatch = aContent.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) ||
                               aContent.match(/<span[^>]*>([\s\S]*?)<\/span>/) ||
                               [null, ''];
            let title = titleMatch[1] ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';
            title = decodeHtmlEntities(title);
            title = title.replace(/\s*-\s*Facebook\s*$/i, '');

            // De-duplicate reel IDs
            if (!videos.some(v => v.id === reelId)) {
              videos.push({
                id: reelId,
                title: title || `Facebook Reel ${reelId}`,
                url: `https://www.facebook.com/reel/${reelId}/`,
                thumbnail: '',
                duration: 'Reel',
                author: 'Facebook Creator',
                views: null,
                ago: null
              });
            }
          }
        }
      }

      if (videos.length > 0) {
        console.log(`Successfully found ${videos.length} videos from ${engine.name}`);
        return res.json({ success: true, videos });
      } else {
        console.log(`No videos found on ${engine.name}, trying next...`);
      }
    } catch (error) {
      console.warn(`Search via ${engine.name} failed:`, error.message);
      lastError = error;
    }
  }

  console.error('All search engines failed to return results.');
  res.status(500).json({ 
    error: 'Failed to perform Facebook search on all engines',
    details: lastError ? lastError.message : 'Unknown network error'
  });
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

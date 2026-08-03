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

    const hl = req.query.hl || 'en';
    const gl = req.query.gl || 'US';

    const results = await yts({ query, hl, gl });
    const liveVideos = (results.live || [])
      .filter(v => v.status === 'LIVE')
      .map(v => ({
        id: v.videoId,
        title: v.title,
        thumbnail: `/api/thumbnail?id=${v.videoId}`,
        duration: 'LIVE',
        author: v.author ? v.author.name : '',
        authorUrl: v.author ? v.author.url : '',
        views: v.watching,
        ago: '',
        isLive: true,
        desc: v.description || '',
      }));
    const videos = (results.videos || []).slice(0, 12).map(v => ({
      id: v.videoId,
      title: v.title,
      thumbnail: `/api/thumbnail?id=${v.videoId}`,
      duration: v.timestamp || (v.duration ? v.duration.timestamp : ''),
      author: v.author ? v.author.name : '',
      authorUrl: v.author ? v.author.url : '',
      views: v.views,
      ago: v.ago,
      desc: v.description || '',
    }));

    res.json({ success: true, videos: [...liveVideos, ...videos].slice(0, 12) });
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

// Thumbnail proxy endpoint — avoids browser CORS/hotlink blocks on i.ytimg.com
app.get('/api/thumbnail', async (req, res) => {
  const id = req.query.id;
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).send('Invalid video ID');
  }

  const candidates = [
    `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });

      if (response.ok) {
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const { Readable } = require('stream');
        Readable.fromWeb(response.body).pipe(res);
        return;
      }
    } catch (_) {
      // try next candidate
    }
  }

});

// Image proxy endpoint — avoids browser CORS/hotlink blocks on yt3.googleusercontent.com
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url || (!url.startsWith('https://yt3.googleusercontent.com/') && !url.startsWith('https://lh3.googleusercontent.com/'))) {
    return res.status(400).send('Invalid image URL');
  }

  try {
    const response = await fetchWithTimeout(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (response.ok) {
      res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const { Readable } = require('stream');
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.status(response.status).send('Failed to fetch image');
    }
  } catch (err) {
    console.error('Error proxying image:', err);
    res.status(500).send('Internal error proxying image');
  }
});

// Channel API endpoint using InnerTube browse API
app.get('/api/channel', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) {
      return res.status(400).json({ error: 'Missing channel id parameter' });
    }

    let channelId = id;
    if (!channelId.startsWith('UC') || channelId.length !== 24) {
      channelId = await resolveChannelId(id);
    }

    const data = await getChannelData(channelId);

    let channelTitle = '';
    let channelAvatar = '';
    let channelBanner = '';
    let channelSubs = '';

    const header = data.header;
    if (header) {
      if (header.c4TabbedHeaderRenderer) {
        const renderer = header.c4TabbedHeaderRenderer;
        channelTitle = renderer.title || '';
        if (renderer.avatar && renderer.avatar.thumbnails) {
          channelAvatar = renderer.avatar.thumbnails[renderer.avatar.thumbnails.length - 1].url;
        }
        if (renderer.banner && renderer.banner.thumbnails) {
          channelBanner = renderer.banner.thumbnails[renderer.banner.thumbnails.length - 1].url;
        }
        if (renderer.subscriberCountText) {
          channelSubs = renderer.subscriberCountText.simpleText || (renderer.subscriberCountText.runs && renderer.subscriberCountText.runs[0] && renderer.subscriberCountText.runs[0].text) || '';
        }
      } else if (header.pageHeaderRenderer) {
        const renderer = header.pageHeaderRenderer;
        const vm = renderer.content && renderer.content.pageHeaderViewModel;
        if (vm) {
          channelTitle = vm.title && vm.title.dynamicTextViewModel && vm.title.dynamicTextViewModel.text && vm.title.dynamicTextViewModel.text.content || '';
          if (vm.image && vm.image.decoratedAvatarViewModel && vm.image.decoratedAvatarViewModel.avatar && vm.image.decoratedAvatarViewModel.avatar.avatarViewModel && vm.image.decoratedAvatarViewModel.avatar.avatarViewModel.image && vm.image.decoratedAvatarViewModel.avatar.avatarViewModel.image.sources) {
            const srcs = vm.image.decoratedAvatarViewModel.avatar.avatarViewModel.image.sources;
            channelAvatar = srcs[srcs.length - 1].url;
          }
          if (vm.banner && vm.banner.imageBannerViewModel && vm.banner.imageBannerViewModel.image && vm.banner.imageBannerViewModel.image.sources) {
            const srcs = vm.banner.imageBannerViewModel.image.sources;
            channelBanner = srcs[srcs.length - 1].url;
          }
          if (vm.metadata && vm.metadata.contentMetadataViewModel && vm.metadata.contentMetadataViewModel.metadataRows) {
            const partsList = [];
            for (const row of vm.metadata.contentMetadataViewModel.metadataRows) {
              if (row.metadataParts) {
                for (const part of row.metadataParts) {
                  const text = part.text && part.text.content;
                  if (text && text.trim().length > 0) {
                    partsList.push(text.trim());
                  }
                }
              }
            }
            channelSubs = partsList.filter(p => p !== channelTitle).join(' · ');
          }
        }
      }
    }

    const meta = data.metadata && data.metadata.channelMetadataRenderer;
    if (meta) {
      if (!channelTitle) channelTitle = meta.title || '';
      if (!channelAvatar) channelAvatar = (meta.avatar && meta.avatar.thumbnails && meta.avatar.thumbnails[0].url) || '';
    }

    let items = [];
    const tab = data.contents && data.contents.twoColumnBrowseResultsRenderer && data.contents.twoColumnBrowseResultsRenderer.tabs && 
                (data.contents.twoColumnBrowseResultsRenderer.tabs.find(t => t.tabRenderer && t.tabRenderer.selected) || 
                 data.contents.twoColumnBrowseResultsRenderer.tabs[1] || 
                 data.contents.twoColumnBrowseResultsRenderer.tabs[0]);
    
    const tabContent = tab && tab.tabRenderer && tab.tabRenderer.content;
    if (tabContent) {
      if (tabContent.richGridRenderer && tabContent.richGridRenderer.contents) {
        items = tabContent.richGridRenderer.contents;
      } else if (tabContent.sectionListRenderer && tabContent.sectionListRenderer.contents) {
        const itemSec = tabContent.sectionListRenderer.contents[0].itemSectionRenderer;
        const grid = itemSec && itemSec.contents && itemSec.contents[0].gridRenderer;
        if (grid && grid.items) {
          items = grid.items;
        }
      }
    }

    const videos = [];
    for (const item of items) {
      const richContent = item.richItemRenderer && item.richItemRenderer.content;
      const v = (richContent && richContent.videoRenderer) || item.videoRenderer;
      const lockup = (richContent && richContent.lockupViewModel) || item.lockupViewModel;

      if (v) {
        const videoId = v.videoId;
        const title = v.title && (v.title.simpleText || (v.title.runs && v.title.runs[0] && v.title.runs[0].text));
        const thumbnail = `/api/thumbnail?id=${videoId}`;
        const duration = v.lengthText && (v.lengthText.simpleText || (v.lengthText.runs && v.lengthText.runs[0] && v.lengthText.runs[0].text));
        const viewsText = v.viewCountText && (v.viewCountText.simpleText || (v.viewCountText.runs && v.viewCountText.runs[0] && v.viewCountText.runs[0].text));
        const ago = v.publishedTimeText && (v.publishedTimeText.simpleText || (v.publishedTimeText.runs && v.publishedTimeText.runs[0] && v.publishedTimeText.runs[0].text));
        const desc = v.descriptionSnippet && v.descriptionSnippet.runs && v.descriptionSnippet.runs.map(r => r.text).join('');

        videos.push({
          id: videoId,
          title: title || '',
          thumbnail,
          duration: duration || '',
          author: channelTitle || '',
          authorUrl: `/channel/${channelId}`,
          views: parseInnerTubeViews(viewsText),
          ago: ago || '',
          desc: desc || ''
        });
      } else if (lockup) {
        const videoId = lockup.contentId;
        const metaVM = lockup.metadata && lockup.metadata.lockupMetadataViewModel;
        const title = metaVM && metaVM.title && metaVM.title.content;
        const thumbnail = `/api/thumbnail?id=${videoId}`;
        
        let duration = '';
        const overlays = lockup.contentImage && lockup.contentImage.thumbnailViewModel && lockup.contentImage.thumbnailViewModel.overlays;
        if (overlays) {
          const bottomOverlay = overlays.find(o => o.thumbnailBottomOverlayViewModel);
          if (bottomOverlay && bottomOverlay.thumbnailBottomOverlayViewModel.badges) {
            const badge = bottomOverlay.thumbnailBottomOverlayViewModel.badges.find(b => b.thumbnailBadgeViewModel);
            if (badge) {
              duration = badge.thumbnailBadgeViewModel.text || '';
            }
          }
        }

        let viewsText = '';
        let ago = '';
        if (metaVM && metaVM.metadata && metaVM.metadata.contentMetadataViewModel && metaVM.metadata.contentMetadataViewModel.metadataRows) {
          const rows = metaVM.metadata.contentMetadataViewModel.metadataRows;
          if (rows[1] && rows[1].metadataParts) {
            const parts = rows[1].metadataParts;
            if (parts[0] && parts[0].text) viewsText = parts[0].text.content || '';
            if (parts[1] && parts[1].text) ago = parts[1].text.content || '';
          } else if (rows[0] && rows[0].metadataParts) {
            rows[0].metadataParts.forEach(p => {
              const text = p.text && p.text.content;
              if (text) {
                if (text.includes('lượt xem') || text.includes('view') || text.includes('views')) {
                  viewsText = text;
                } else if (!text.includes(channelTitle) && text.trim().length > 0) {
                  ago = text;
                }
              }
            });
          }
        }

        videos.push({
          id: videoId,
          title: title || '',
          thumbnail,
          duration: duration || '',
          author: channelTitle || '',
          authorUrl: `/channel/${channelId}`,
          views: parseInnerTubeViews(viewsText),
          ago: ago || '',
          desc: ''
        });
      }
    }

    const proxyAvatar = channelAvatar ? `/api/proxy-image?url=${encodeURIComponent(channelAvatar)}` : '';
    const proxyBanner = channelBanner ? `/api/proxy-image?url=${encodeURIComponent(channelBanner)}` : '';

    res.json({
      success: true,
      channel: {
        id: channelId,
        title: channelTitle,
        avatar: proxyAvatar,
        banner: proxyBanner,
        subscribers: channelSubs
      },
      videos
    });
  } catch (error) {
    console.error('Channel API error:', error);
    res.status(500).json({ error: 'Failed to fetch channel data' });
  }
});

async function resolveChannelId(identifier) {
  let cleanId = identifier.trim();
  if (cleanId.startsWith('/')) cleanId = cleanId.slice(1);
  if (cleanId.startsWith('channel/')) cleanId = cleanId.replace('channel/', '');
  if (cleanId.startsWith('user/')) cleanId = cleanId.replace('user/', '');

  if (cleanId.startsWith('UC') && cleanId.length === 24) {
    return cleanId;
  }

  let url = `https://www.youtube.com/${cleanId}`;
  if (!cleanId.startsWith('@') && !cleanId.startsWith('user/')) {
    url = `https://www.youtube.com/@${cleanId}`;
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  if (!res.ok) throw new Error(`Failed to fetch channel page: ${url}`);
  const html = await res.text();

  const patterns = [
    /<link rel="canonical" href="https:\/\/www.youtube.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/,
    /meta property="og:url" content="https:\/\/www.youtube.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/,
    /"externalId":"(UC[a-zA-Z0-9_-]{22})"/,
    /"channelId":"(UC[a-zA-Z0-9_-]{22})"/,
    /"browseId":"(UC[a-zA-Z0-9_-]{22})"/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not resolve channel ID for ${identifier}`);
}

async function getChannelData(channelId) {
  const url = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
  const body = {
    context: {
      client: {
        hl: "vi",
        gl: "VN",
        clientName: "WEB",
        clientVersion: "2.20260731.00.00",
        osName: "Windows",
        osVersion: "10.0",
        platform: "DESKTOP"
      }
    },
    browseId: channelId,
    params: "EgZ2aWRlb3PyBgQKAjoA"
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': 'application/json',
      'origin': 'https://www.youtube.com',
      'referer': 'https://www.youtube.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      'x-youtube-client-name': '1',
      'x-youtube-client-version': '2.20260731.00.00'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error('Failed to fetch channel from InnerTube');
  const data = await res.json();
  return data;
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

function parseInnerTubeViews(viewsText) {
  if (!viewsText) return 0;
  const clean = viewsText.toLowerCase().replace(/[^a-z0-9,.\s]/g, '').trim();
  let num = parseFloat(clean.replace(/,/g, '.').replace(/[^0-9.]/g, '')) || 0;
  
  if (clean.includes('b') || clean.includes('tỷ')) {
    num *= 1000000000;
  } else if (clean.includes('tr') || clean.includes('m')) {
    num *= 1000000;
  } else if (clean.includes('n') || clean.includes('k') || clean.includes('nghìn')) {
    num *= 1000;
  }
  return Math.floor(num);
}

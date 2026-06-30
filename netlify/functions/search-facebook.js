const decodeHtmlEntities = (str) => {
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
};

exports.handler = async function (event, context) {
  try {
    const query = event.queryStringParameters.q;
    if (!query) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing query parameter' }),
      };
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true, videos }),
    };
  } catch (error) {
    console.error('Facebook search error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to perform Facebook search' }),
    };
  }
};

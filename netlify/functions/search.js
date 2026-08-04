const parseInnerTubeViews = (viewsText) => {
  if (!viewsText) return 0;
  
  const clean = viewsText.toLowerCase()
    .replace(/l\u01b0\u1ee3t xem|views|view|ng\u01b0\u1ee3i \u0111\u0103ng k\u00fd|subscribers|subscriber/g, '')
    .trim();

  let multiplier = 1;
  if (clean.includes('b') || clean.includes('t\u1ef7')) {
    multiplier = 1000000000;
  } else if (clean.includes('tr') || clean.includes('m')) {
    multiplier = 1000000;
  } else if (clean.includes('n') || clean.includes('k') || clean.includes('ngh\u00ecn')) {
    multiplier = 1000;
  }

  if (multiplier > 1) {
    const numStr = clean.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const num = parseFloat(numStr) || 0;
    return Math.floor(num * multiplier);
  } else {
    const numStr = clean.replace(/[^0-9]/g, '');
    const num = parseInt(numStr, 10) || 0;
    return num;
  }
};

const getSearchData = async (query, hl, gl) => {
  const url = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
  const body = {
    context: {
      client: {
        hl: hl === 'en' ? 'en' : 'vi',
        gl: gl === 'US' ? 'US' : 'VN',
        clientName: "WEB",
        clientVersion: "2.20260731.00.00",
        osName: "Windows",
        osVersion: "10.0",
        platform: "DESKTOP"
      }
    },
    query
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error('Failed to fetch search results from InnerTube');
  return res.json();
};

const getSearchContinuationData = async (token) => {
  const url = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
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
    continuation: token
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error('Failed to fetch search continuation from InnerTube');
  return res.json();
};

exports.handler = async function (event, context) {
  try {
    const token = event.queryStringParameters && event.queryStringParameters.token;
    
    if (token) {
      const data = await getSearchContinuationData(token);
      const videos = [];
      let nextToken = '';

      if (data.onResponseReceivedCommands && data.onResponseReceivedCommands[0] && data.onResponseReceivedCommands[0].appendContinuationItemsAction) {
        const continuationItems = data.onResponseReceivedCommands[0].appendContinuationItemsAction.continuationItems || [];
        
        let items = [];
        if (continuationItems[0] && continuationItems[0].itemSectionRenderer) {
          items = continuationItems[0].itemSectionRenderer.contents || [];
        }

        for (const item of items) {
          if (item.videoRenderer) {
            const v = item.videoRenderer;
            const videoId = v.videoId;
            const title = v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text;
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
              author: v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text || '',
              authorUrl: v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].navigationEndpoint && v.ownerText.runs[0].navigationEndpoint.browseEndpoint && v.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId ? `/channel/${v.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId}` : '',
              views: parseInnerTubeViews(viewsText),
              ago: ago || '',
              desc: desc || ''
            });
          }
        }

        const contItem = continuationItems.find(i => i.continuationItemRenderer);
        if (contItem && contItem.continuationItemRenderer.continuationEndpoint && contItem.continuationItemRenderer.continuationEndpoint.continuationCommand) {
          nextToken = contItem.continuationItemRenderer.continuationEndpoint.continuationCommand.token || '';
        }
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          videos,
          continuationToken: nextToken
        }),
      };
    }

    const query = event.queryStringParameters.q;
    if (!query) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing query or token parameter' }),
      };
    }

    const hl = (event.queryStringParameters && event.queryStringParameters.hl) || 'vi';
    const gl = (event.queryStringParameters && event.queryStringParameters.gl) || 'VN';

    const data = await getSearchData(query, hl, gl);
    const contents = data.contents && data.contents.twoColumnSearchResultsRenderer && data.contents.twoColumnSearchResultsRenderer.primaryContents && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;

    const videos = [];
    let continuationToken = '';

    if (contents) {
      const firstSection = contents.find(s => s.itemSectionRenderer);
      if (firstSection && firstSection.itemSectionRenderer.contents) {
        const items = firstSection.itemSectionRenderer.contents;
        for (const item of items) {
          if (item.videoRenderer) {
            const v = item.videoRenderer;
            const videoId = v.videoId;
            const title = v.title && v.runs ? v.title.simpleText : (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text);
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
              author: v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text || '',
              authorUrl: v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].navigationEndpoint && v.ownerText.runs[0].navigationEndpoint.browseEndpoint && v.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId ? `/channel/${v.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId}` : '',
              views: parseInnerTubeViews(viewsText),
              ago: ago || '',
              desc: desc || ''
            });
          }
        }
      }

      const contItem = contents.find(item => item.continuationItemRenderer);
      if (contItem && contItem.continuationItemRenderer.continuationEndpoint && contItem.continuationItemRenderer.continuationEndpoint.continuationCommand) {
        continuationToken = contItem.continuationItemRenderer.continuationEndpoint.continuationCommand.token || '';
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        videos,
        continuationToken
      }),
    };
  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to perform search' }),
    };
  }
};

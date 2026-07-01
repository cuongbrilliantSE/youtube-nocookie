const yts = require('yt-search');

exports.handler = async function (event, context) {
  try {
    const query = event.queryStringParameters.q;
    if (!query) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Missing query parameter' }),
      };
    }

    const results = await yts(query);
    const videos = (results.videos || []).slice(0, 12).map(v => ({
      id: v.videoId,
      title: v.title,
      thumbnail: `/api/thumbnail?id=${v.videoId}`,
      duration: v.timestamp || (v.duration ? v.duration.timestamp : ''),
      author: v.author ? v.author.name : '',
      views: v.views,
      ago: v.ago
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true, videos }),
    };
  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Failed to perform search' }),
    };
  }
};

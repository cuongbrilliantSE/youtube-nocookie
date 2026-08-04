const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

exports.handler = async function (event, context) {
  try {
    const token = event.queryStringParameters.token;
    if (token) {
      const passedChannelId = event.queryStringParameters.id || '';
      const passedChannelName = event.queryStringParameters.name || '';
      const data = await getChannelContinuationData(token);
      let items = [];
      if (data.onResponseReceivedActions && data.onResponseReceivedActions[0] && data.onResponseReceivedActions[0].appendContinuationItemsAction) {
        items = data.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems || [];
      }
      
      const videos = [];
      let nextToken = '';
      
      for (const item of items) {
        if (item.continuationItemRenderer && item.continuationItemRenderer.continuationEndpoint && item.continuationItemRenderer.continuationEndpoint.continuationCommand) {
          nextToken = item.continuationItemRenderer.continuationEndpoint.continuationCommand.token || '';
          continue;
        }
        
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
            author: passedChannelName || '',
            authorUrl: passedChannelId ? `/channel/${passedChannelId}` : '',
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
                  } else if (text.trim().length > 0) {
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
            author: passedChannelName || '',
            authorUrl: passedChannelId ? `/channel/${passedChannelId}` : '',
            views: parseInnerTubeViews(viewsText),
            ago: ago || '',
            desc: ''
          });
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
        })
      };
    }

    const id = event.queryStringParameters.id;
    if (!id) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing channel id or token parameter' }),
      };
    }

    // 1. Resolve channel ID (handle to UC...)
    let channelId = id;
    if (!channelId.startsWith('UC') || channelId.length !== 24) {
      channelId = await resolveChannelId(id);
    }

    // 2. Fetch from InnerTube
    const data = await getChannelData(channelId);

    // 3. Parse InnerTube response
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

    // Extract videos from Videos Tab content
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

    let continuationToken = '';
    const contItem = items.find(item => item.continuationItemRenderer);
    if (contItem && contItem.continuationItemRenderer.continuationEndpoint && contItem.continuationItemRenderer.continuationEndpoint.continuationCommand) {
      continuationToken = contItem.continuationItemRenderer.continuationEndpoint.continuationCommand.token || '';
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        channel: {
          id: channelId,
          title: channelTitle,
          avatar: proxyAvatar,
          banner: proxyBanner,
          subscribers: channelSubs
        },
        videos,
        continuationToken
      }),
    };
  } catch (error) {
    console.error('Channel error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch channel data' }),
    };
  }
};

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

function parseInnerTubeViews(viewsText) {
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
}

async function getChannelContinuationData(token) {
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
    continuation: token
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

  if (!res.ok) throw new Error('Failed to fetch channel continuation from InnerTube');
  return res.json();
}

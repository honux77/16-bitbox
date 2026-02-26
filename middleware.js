// Vercel Edge Middleware for dynamic OG tags
export const config = {
  matcher: '/',
}

export default async function middleware(request) {
  const url = new URL(request.url)
  const gameId = url.searchParams.get('game')
  const trackName = url.searchParams.get('track')

  // If no query params, serve normally
  if (!gameId) {
    return
  }

  // Fetch the original HTML
  const htmlUrl = new URL('/', request.url)
  htmlUrl.search = '' // Remove query params for fetching original HTML

  const response = await fetch(htmlUrl)
  let html = await response.text()

  // Fetch manifest to get game/track info
  try {
    const manifestUrl = new URL('/music/manifest.json', request.url)
    const manifestRes = await fetch(manifestUrl)
    const manifest = await manifestRes.json()

    const game = manifest.games.find(g => g.id === gameId)
    if (game) {
      let title = `${game.title} - 16-bitbox`
      let description = `${game.system} | ${game.trackCount} tracks`

      // Use OG image if available, fallback to cover, then default
      const baseUrl = 'https://9-player.vercel.app'
      let imageUrl = game.ogImage
        ? `${baseUrl}/music/${game.ogImage}`
        : game.coverImage
          ? `${baseUrl}/music/${game.coverImage}`
          : `${baseUrl}/icons/og-image.png`

      if (trackName) {
        const track = game.tracks?.find(t => t.name === trackName)
        if (track) {
          title = `${track.name} - ${game.title} | 16-bitbox`
          description = `${game.author || game.system} | ${game.title}`
        }
      }

      // Replace OG tags
      html = html.replace(
        /<meta property="og:title" content="[^"]*"/,
        `<meta property="og:title" content="${escapeHtml(title)}"`
      )
      html = html.replace(
        /<meta property="og:description" content="[^"]*"/,
        `<meta property="og:description" content="${escapeHtml(description)}"`
      )
      html = html.replace(
        /<meta property="og:url" content="[^"]*"/,
        `<meta property="og:url" content="${escapeHtml(url.href)}"`
      )
      // Always replace og:image
      html = html.replace(
        /<meta property="og:image" content="[^"]*"/,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}"`
      )

      // Replace Twitter tags
      html = html.replace(
        /<meta name="twitter:title" content="[^"]*"/,
        `<meta name="twitter:title" content="${escapeHtml(title)}"`
      )
      html = html.replace(
        /<meta name="twitter:description" content="[^"]*"/,
        `<meta name="twitter:description" content="${escapeHtml(description)}"`
      )
      // Always replace twitter:image
      html = html.replace(
        /<meta name="twitter:image" content="[^"]*"/,
        `<meta name="twitter:image" content="${escapeHtml(imageUrl)}"`
      )

      // Replace title tag
      html = html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${escapeHtml(title)}</title>`
      )
    }
  } catch (e) {
    // If manifest fetch fails, serve original HTML
    console.error('Middleware error:', e)
  }

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  })
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

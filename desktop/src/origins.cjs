'use strict'

/**
 * The web origins allowed to call the companion: the app window, the website,
 * and local development servers only in development builds.
 */
function companionOrigins(appOrigin, { site, packaged, development = [] }) {
  return [...new Set([appOrigin, site, ...(packaged ? [] : development)])]
}

module.exports = { companionOrigins }

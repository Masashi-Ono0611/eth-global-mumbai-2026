/**
 * Where the wallet's pages live on the app's origin (vitaquack.com, Kris, 6 Nov): `/` is the static landing page,
 * `/api/…` the API, and every page of apps/web is under this prefix. The web router and the server's page links
 * (approval redirects, `approvalUrl`, Telegram buttons) share it, so a link the server builds is a route the web parses.
 */
export const APP_BASE = '/app'

/** The owner's approval page, relative to the app's origin. */
export const approvalPagePath = (approvalId: string) => `${APP_BASE}/wallet/approvals/${approvalId}`

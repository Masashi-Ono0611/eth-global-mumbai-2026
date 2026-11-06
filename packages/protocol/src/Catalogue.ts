/** One thing a merchant sells, as anyone may read it. */
export interface CatalogueEntry {
  readonly itemId: string
  readonly name: string
  /** USDC base units (6 dp) as a decimal string. */
  readonly amount: string
  /** Restricted items need the owner's approval and pay a second address no grant allowlists. */
  readonly restricted: boolean
}

/** A merchant's public menu: what the counter page shows and the API's `GET /api/merchants/:id/items` lists. */
export interface MerchantMenu {
  readonly id: string
  readonly name: string
  readonly items: ReadonlyArray<CatalogueEntry>
}

/**
 * The merchant catalogue is a constant (spec §3): chai 0.10, samosa 0.25 and thali 2.00, the counter item above the
 * demo grant's 1.00 per-payment cap, so it needs the owner's World approval. The demo's approval story is spending
 * limits only (6 Nov, Kris): no restricted item is sold, though `restricted` items and their separate payee still work.
 * The server adds what only it knows (payees, trust; packages/server/src/merchant/Catalogue.ts); the web's counter page
 * renders this menu directly, so its server render already shows it.
 */
export const duckCafe: MerchantMenu = {
  id: 'duck-cafe',
  name: 'Duck Café',
  items: [
    { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
    { itemId: 'samosa', name: 'Samosa', amount: '250000', restricted: false },
    { itemId: 'thali', name: 'Thali', amount: '2000000', restricted: false },
  ],
}

export const menus: ReadonlyArray<MerchantMenu> = [duckCafe]

import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Clock, Effect, Option, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { nowSeconds, randomBytes, sha256Hex } from '../Respond.ts'
import { firstRow } from '../Sql.ts'
import { closesAt, expireIfLate, readApproval } from './Approve.ts'
import { approvalPage, redirectToWorld, type WorldDeps } from './Authorize.ts'

// The Telegram approval button's one-time link (spec §14, Kris 6 Nov). It stands in for the passkey session for exactly
// one approval, so the owner goes from the chat straight to World ID; it never approves anything itself. World still
// signs the owner in afresh (max_age=0, prompt=login) with the approval's nonce, and the callback still requires the
// World account already bound to the wallet. Single use, until the approval's 300 s close, stored only as a sha256.

/** `auth_challenges.kind` of a one-time approval link. */
const LINK_KIND = 'world_link'

const Owner = Schema.Struct({ world_sub: Schema.NullOr(Schema.String) })

/**
 * A fresh link token for this approval, or none: only while the approval is open and only once the wallet has a World
 * account bound (before that, whoever held the link could bind their own World account to the wallet on first use).
 */
export const mintApprovalLink = Effect.fn('EthMumbai.World.mintLink')(function* (
  database: QueryDatabaseClient,
  approvalId: string,
) {
  const row = yield* readApproval(database, approvalId)
  if (Option.isNone(row) || !['requested', 'opened'].includes(row.value.status)) return Option.none<string>()
  const owner = yield* firstRow(
    database.prepare('SELECT world_sub FROM accounts WHERE id = ?').bind(row.value.account_id),
    Owner,
  )
  if (Option.isNone(owner) || owner.value.world_sub === null) return Option.none<string>()
  const token = Base64Url.encode(yield* randomBytes(24))
  yield* database
    .prepare(
      'INSERT INTO auth_challenges (id, kind, account_id, ref, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    )
    .bind(
      yield* sha256Hex(token),
      LINK_KIND,
      row.value.account_id,
      row.value.id,
      closesAt(row.value),
      yield* Clock.currentTimeMillis,
    )
    .run()
  return Option.some(token)
})

/** The link's path: the approval id and the token (the query string is redacted from request logs). */
export const approvalLinkPath = (approvalId: string, token: string) =>
  `/api/world/link?${new URLSearchParams({ approval: approvalId, t: token }).toString()}`

/** Whether this approval's World sign-in was started from a one-time link (the callback then answers without a page
 * that needs a session). */
export const openedByLink = (database: QueryDatabaseClient, approvalId: string) =>
  firstRow(
    database
      .prepare('SELECT id FROM auth_challenges WHERE kind = ? AND ref = ? AND used = 1 LIMIT 1')
      .bind(LINK_KIND, approvalId),
    Schema.Struct({ id: Schema.String }),
  ).pipe(Effect.map(Option.isSome))

const LinkQuery = Schema.Struct({
  approval: Schema.String.check(Schema.isMaxLength(64)),
  t: Schema.String.check(Schema.isMaxLength(64)),
})
const Spent = Schema.Struct({ account_id: Schema.NullOr(Schema.String) })

/**
 * `GET /api/world/link?approval=:id&t=:token` (no session): spends the token (once, before the approval closes, for this
 * approval), then the same World redirect as the signed-in route. A used, late, foreign or unknown link, an answered
 * approval, a wallet without a bound World account, or a World without subject binding falls back to the approval page,
 * which asks for the passkey as before.
 */
export const linkAuthorize = (deps: WorldDeps) =>
  Effect.gen(function* () {
    const query = yield* HttpServerRequest.schemaSearchParams(LinkQuery).pipe(Effect.option)
    if (Option.isNone(query)) return HttpServerResponse.text('expected ?approval=…&t=…', { status: 400 })
    const fallback = HttpServerResponse.redirect(approvalPage(deps.origin, query.value.approval), { status: 302 })
    const spent = yield* firstRow(
      deps.database
        .prepare(
          'UPDATE auth_challenges SET used = 1 WHERE id = ? AND kind = ? AND ref = ? AND used = 0 AND expires_at > ? RETURNING account_id',
        )
        .bind(yield* sha256Hex(query.value.t), LINK_KIND, query.value.approval, yield* nowSeconds),
      Spent,
    )
    if (Option.isNone(spent)) return fallback
    const found = yield* readApproval(deps.database, query.value.approval)
    if (Option.isNone(found) || found.value.account_id !== spent.value.account_id) return fallback
    const owner = yield* firstRow(
      deps.database.prepare('SELECT world_sub FROM accounts WHERE id = ?').bind(found.value.account_id),
      Owner,
    )
    const bindsSubject = Option.match(deps.world, { onNone: () => false, onSome: (world) => world.bindsSubject })
    if (Option.isNone(owner) || owner.value.world_sub === null || !bindsSubject) return fallback
    yield* Effect.logInfo('world approval link used').pipe(Effect.annotateLogs({ approvalId: found.value.id }))
    return yield* redirectToWorld(deps, yield* expireIfLate(deps.database, found.value))
  })

/** What the owner sees after World when they came from Telegram: a page that needs no session (the chat follows up). */
export const linkOutcomePage = (status: string) => {
  const text =
    status === 'approved'
      ? 'Approved. Your robot is paying now; Telegram tells you when it is paid.'
      : status === 'expired'
        ? 'This request had expired, so nothing was paid.'
        : 'Not approved, so nothing was paid.'
  return HttpServerResponse.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vitaquack</title></head><body style="font:18px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#e7f1f6;color:#1f2d36"><main style="max-width:24rem;padding:2rem;text-align:center"><p role="status">${text}</p><p style="color:#5b6b75">You can close this page.</p></main></body></html>`,
  )
}

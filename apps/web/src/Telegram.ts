import { format, type Locale } from '@ethmumbai/i18n'
import { Effect, Schema } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { getJson, postJson } from './api/Http.ts'
import { busyLabel, workingDots } from './Busy.ts'

// The profile sheet's Telegram row (spec §14): connect the owner's chat to @vitaquack_bot so the robot can tell them
// when it needs an OK or has paid. The server hands out a one-time link; the tap that opens Telegram is the owner's own.

const LinkStatus = Schema.Struct({
  configured: Schema.Boolean,
  linked: Schema.Boolean,
  username: Schema.NullOr(Schema.String),
})
const LinkCreated = Schema.Struct({ url: Schema.String })
const Unlinked = Schema.Struct({ linked: Schema.Boolean })

// MODEL

const TelegramState = defineTaggedUnion({
  /** Not asked yet (the sheet has not been opened). */
  Idle: {},
  Loading: {},
  /** The server has no bot configured: the row is hidden. */
  Off: {},
  Unlinked: {},
  Linking: {},
  /** A one-time link is ready; the owner taps it to open Telegram and presses Start. `polls` counts the status reads
   * made since, so the watch ends with the link's 10 minutes. */
  Ready: { url: Schema.String, polls: Schema.Number },
  Linked: { username: Schema.NullOr(Schema.String) },
  Unlinking: { username: Schema.NullOr(Schema.String) },
  Failed: {},
})
type TelegramState = typeof TelegramState.Type
export const Model = Schema.Struct({ state: TelegramState })
export type Model = typeof Model.Type

export const init = (): Model => ({ state: TelegramState.Idle() })

/** Whether the owner's chat is linked: a page hosting the row moves on when it becomes true. */
export const isLinked = (model: Model) => TelegramState.guards.Linked(model.state)

/** Whether the server has no bot configured, so there is nothing to connect. */
export const isOff = (model: Model) => TelegramState.guards.Off(model.state)

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadTelegram: { configured: Schema.Boolean, linked: Schema.Boolean, username: Schema.NullOr(Schema.String) },
  FailedLoadTelegram: {},
  ClickedConnectTelegram: {},
  SucceededLinkTelegram: { url: Schema.String },
  FailedLinkTelegram: {},
  SucceededPollTelegram: { configured: Schema.Boolean, linked: Schema.Boolean, username: Schema.NullOr(Schema.String) },
  FailedPollTelegram: {},
  ClickedCheckTelegram: {},
  ClickedDisconnectTelegram: {},
  SucceededUnlinkTelegram: {},
  FailedUnlinkTelegram: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for scene tests. */
export const LoadTelegram = Command.define('LoadTelegram', {
  messages: [Message.SucceededLoadTelegram, Message.FailedLoadTelegram],
  execute: getJson('/api/telegram', LinkStatus).pipe(
    Effect.map((status) => Message.SucceededLoadTelegram(status)),
    Effect.catch(() => Effect.succeed(Message.FailedLoadTelegram())),
  ),
})

/** While a link is on screen the row re-reads the status on this period, so pressing Start in Telegram is enough.
 * @internal Exported for scene tests. */
export const POLL_MILLIS = 2000
/** The one-time link lives 10 minutes (the server's LINK_CODE_SECONDS); the watch stops with it. */
const MAX_POLLS = 300

/** @internal Exported for scene tests. */
export const PollTelegram = Command.define('PollTelegram', {
  args: { delayMillis: Schema.Number },
  messages: [Message.SucceededPollTelegram, Message.FailedPollTelegram],
  execute: ({ delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(getJson('/api/telegram', LinkStatus)),
      Effect.map((status) => Message.SucceededPollTelegram(status)),
      Effect.catch(() => Effect.succeed(Message.FailedPollTelegram())),
    ),
})

/** @internal Exported for scene tests. */
export const LinkTelegram = Command.define('LinkTelegram', {
  messages: [Message.SucceededLinkTelegram, Message.FailedLinkTelegram],
  execute: postJson('/api/telegram/link', {}, LinkCreated).pipe(
    Effect.map(({ url }) => Message.SucceededLinkTelegram({ url })),
    Effect.catch(() => Effect.succeed(Message.FailedLinkTelegram())),
  ),
})

/** @internal Exported for scene tests. */
export const UnlinkTelegram = Command.define('UnlinkTelegram', {
  messages: [Message.SucceededUnlinkTelegram, Message.FailedUnlinkTelegram],
  execute: postJson('/api/telegram/unlink', {}, Unlinked).pipe(
    Effect.map(() => Message.SucceededUnlinkTelegram()),
    Effect.catch(() => Effect.succeed(Message.FailedUnlinkTelegram())),
  ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>
const to = (state: TelegramState, commands: UpdateReturn['commands'] = []): UpdateReturn => ({
  model: { state },
  commands,
})

const statusOf = (configured: boolean, linked: boolean, username: string | null) => {
  if (!configured) return TelegramState.Off()
  return linked ? TelegramState.Linked({ username }) : TelegramState.Unlinked()
}

/**
 * The sheet opened: ask the server, since the owner may have pressed Start in Telegram meanwhile. A link not yet used
 * stays on screen.
 */
export const opened = (model: Model): UpdateReturn =>
  TelegramState.guards.Ready(model.state) ? { model } : to(TelegramState.Loading(), [LoadTelegram()])

/** One more status read while the link is on screen, or back to Connect once the link has lapsed. */
const keepWatching = (model: Model): UpdateReturn => {
  if (!TelegramState.guards.Ready(model.state)) return { model }
  const polls = model.state.polls + 1
  return polls >= MAX_POLLS
    ? to(TelegramState.Unlinked())
    : to(TelegramState.Ready({ url: model.state.url, polls }), [PollTelegram({ delayMillis: POLL_MILLIS })])
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadTelegram: ({ configured, linked, username }) => {
      // A link the owner has not used yet stays on screen until Telegram reports the chat linked.
      if (TelegramState.guards.Ready(model.state) && !linked) return { model }
      return to(statusOf(configured, linked, username))
    },
    FailedLoadTelegram: () => to(TelegramState.Failed()),
    ClickedConnectTelegram: () => to(TelegramState.Linking(), [LinkTelegram()]),
    SucceededLinkTelegram: ({ url }) =>
      to(TelegramState.Ready({ url, polls: 0 }), [PollTelegram({ delayMillis: POLL_MILLIS })]),
    // Only a link still on screen is watched; a reply after Disconnect, a manual check or a new link is ignored.
    SucceededPollTelegram: ({ configured, linked, username }) => {
      if (!TelegramState.guards.Ready(model.state)) return { model }
      return linked ? to(statusOf(configured, linked, username)) : keepWatching(model)
    },
    FailedPollTelegram: () => keepWatching(model),
    FailedLinkTelegram: () => to(TelegramState.Failed()),
    ClickedCheckTelegram: () => ({ model, commands: [LoadTelegram()] }),
    ClickedDisconnectTelegram: () =>
      TelegramState.guards.Linked(model.state)
        ? to(TelegramState.Unlinking({ username: model.state.username }), [UnlinkTelegram()])
        : { model },
    SucceededUnlinkTelegram: () => to(TelegramState.Unlinked()),
    FailedUnlinkTelegram: () => to(TelegramState.Failed()),
  })

// VIEW

const rowClassName = 'grid gap-2 rounded-card bg-surface p-3'
const rowTitleClassName = 'font-semibold'
const hintClassName = 'text-sm text-muted'
const actionClassName =
  'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control bg-ink px-4 font-semibold text-surface no-underline transition-transform active:scale-[0.96] disabled:cursor-progress disabled:opacity-60'
const quietActionClassName =
  'min-h-11 cursor-pointer rounded-control px-4 font-semibold text-ink underline-offset-2 transition-transform active:scale-[0.96] disabled:opacity-60'

const button = (h: HtmlBuilder<Message>, label: string, onClick: Message, className: string, disabled = false) =>
  h.button(
    [h.Type('button'), h.Class(className), h.Disabled(disabled), h.OnClick(onClick)],
    busyLabel(disabled, label, h),
  )

const connected = (locale: Locale, username: string | null) =>
  username === null ? format(locale, 'telegram.connected', {}) : format(locale, 'telegram.connectedAs', { username })

/** The row; hidden until the sheet has asked, and when the server has no bot. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) => {
  const row = (children: ReadonlyArray<Html>) =>
    h.section(
      [h.Class(rowClassName), h.AriaLabel(format(locale, 'telegram.title', {}))],
      [h.p([h.Class(rowTitleClassName)], [format(locale, 'telegram.title', {})]), ...children],
    )
  const hint = h.p([h.Class(hintClassName)], [format(locale, 'telegram.hint', {})])
  return TelegramState.match(model.state, {
    // Nothing to show, but a submodel view must return an element.
    Idle: () => h.div([h.Hidden(true)]),
    Off: () => h.div([h.Hidden(true)]),
    Loading: () =>
      row([h.p([h.Role('status'), h.Class(hintClassName)], [workingDots(h), format(locale, 'telegram.checking', {})])]),
    Unlinked: () =>
      row([hint, button(h, format(locale, 'telegram.connect', {}), Message.ClickedConnectTelegram(), actionClassName)]),
    Linking: () =>
      row([
        hint,
        button(h, format(locale, 'telegram.connecting', {}), Message.ClickedConnectTelegram(), actionClassName, true),
      ]),
    Ready: ({ url }) =>
      row([
        h.p([h.Class(hintClassName)], [format(locale, 'telegram.pressStart', {})]),
        h.a(
          [h.Href(url), h.Target('_blank'), h.Rel('noopener'), h.Class(actionClassName)],
          [format(locale, 'telegram.open', {})],
        ),
        h.p([h.Role('status'), h.Class(hintClassName)], [workingDots(h), format(locale, 'telegram.waiting', {})]),
      ]),
    Linked: ({ username }) =>
      row([
        h.p([h.Role('status')], [connected(locale, username)]),
        button(h, format(locale, 'telegram.disconnect', {}), Message.ClickedDisconnectTelegram(), quietActionClassName),
      ]),
    Unlinking: ({ username }) =>
      row([
        h.p([h.Role('status')], [connected(locale, username)]),
        button(
          h,
          format(locale, 'telegram.disconnect', {}),
          Message.ClickedDisconnectTelegram(),
          quietActionClassName,
          true,
        ),
      ]),
    Failed: () =>
      row([
        h.p([h.Role('alert'), h.Class(hintClassName)], [format(locale, 'telegram.failed', {})]),
        button(h, format(locale, 'telegram.retry', {}), Message.ClickedCheckTelegram(), quietActionClassName),
      ]),
  })
})

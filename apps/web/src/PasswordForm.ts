import { Context, Effect, Layer, Redacted, Schema } from 'effect'

export const passwordFormId = 'password-sign-in'

export class PasswordFormUnavailable extends Schema.TaggedError<PasswordFormUnavailable>()(
  'PasswordFormUnavailable',
  {},
) {}

/** Credentials stay in the browser form and the command's short-lived Effect.
 * They never enter Foldkit's Model, Message or Command arguments/devtools history. */
export class PasswordForm extends Context.Service<
  PasswordForm,
  {
    readonly take: Effect.Effect<
      { readonly email: string; readonly password: Redacted.Redacted },
      PasswordFormUnavailable
    >
  }
>()('@styld/web/PasswordForm') {}

export const passwordFormLayer = (document: Document) =>
  Layer.succeed(PasswordForm, {
    take: Effect.gen(function* () {
      const form = document.getElementById(passwordFormId)
      if (!(form instanceof HTMLFormElement)) return yield* PasswordFormUnavailable.make({})
      const passwordField = form.elements.namedItem('password')
      if (!(passwordField instanceof HTMLInputElement)) return yield* PasswordFormUnavailable.make({})
      const data = new FormData(form)
      const email = data.get('email')
      const password = Redacted.make(passwordField.value)
      passwordField.value = ''
      if (typeof email !== 'string' || email.length > 320) return yield* PasswordFormUnavailable.make({})
      return { email, password }
    }),
  })

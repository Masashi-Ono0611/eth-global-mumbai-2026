import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { Layer } from 'effect'
import { browserAuthLayer } from '@ethmumbai/auth/client'
import { Runtime } from 'foldkit'
import { Message } from './message.ts'
import { Flags, Model } from './model.ts'
import { init, update } from './update.ts'
import { view } from './View.ts'
import { passwordFormLayer } from './PasswordForm.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Vite loads the application stylesheet for its side effects
import './styles.css'

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  container: document.getElementById('root'),
  devTools: { Message },
  resources: Layer.mergeAll(
    FetchHttpClient.layer,
    browserAuthLayer(window.location.origin).pipe(Layer.orDie),
    passwordFormLayer(document),
  ),
})

Runtime.hydrate(application)

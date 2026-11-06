import { Layer } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { Runtime } from 'foldkit'
import { Message } from './message.ts'
import { Model } from './model.ts'
import { init, subscriptions, update } from './update.ts'
import { view } from './view.ts'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById('root'),
  resources: Layer.mergeAll(FetchHttpClient.layer),
  devTools: { Message },
})

Runtime.run(application)

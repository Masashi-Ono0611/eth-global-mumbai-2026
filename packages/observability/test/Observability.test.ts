import { Effect, Logger, References, Tracer } from 'effect'
import { expect, test } from 'vitest'
import {
  Environment,
  makeObservabilityBase,
  metadataAttributes,
  metadataFromHeaders,
  withObservability,
} from '../src/index.ts'

const base = { environment: 'preview' as const, release: 'release-123', component: 'server' }
const correlationId = '00000000-0000-4000-8000-000000000001'

test('accepts only bounded deployment and correlation metadata', () => {
  expect(Environment.literals).toEqual(['local', 'preview', 'production'])
  const metadata = metadataFromHeaders(
    base,
    new Headers({
      'x-app-kind': 'http',
      'x-app-correlation-id': correlationId,
      'x-app-operation-id': 'op-123',
      'x-app-job-id': 'job-123',
      'x-app-attempt': '2',
      authorization: 'Bearer secret-token',
    }),
  )
  expect(metadata).toEqual({
    ...base,
    kind: 'http',
    correlationId,
  })
  expect(metadataAttributes(metadata)).not.toHaveProperty('authorization')
  expect(
    metadataFromHeaders(base, new Headers({ 'x-app-correlation-id': 'prompt=ignore me', 'x-app-attempt': '0' })),
  ).toEqual({ ...base, kind: 'http' })
})

test('invalid deployment identity fails without logging the supplied value', async () => {
  const failure = await Effect.runPromise(
    makeObservabilityBase({
      environment: 'invalid-private-input',
      release: 'release-123',
      component: 'server',
    }).pipe(Effect.flip),
  )
  expect(failure.constructor.name).toBe('InvalidDeploymentIdentity')
  expect(JSON.stringify(failure)).not.toContain('invalid-private-input')
})

test('withObservability annotates logs and forwards the same approved span fields', async () => {
  const metadata = metadataFromHeaders(base, new Headers({ 'x-app-correlation-id': correlationId }))
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  const annotations: Array<Readonly<Record<string, unknown>>> = []
  const logger = Logger.make(() => undefined)

  await Effect.runPromise(
    Effect.gen(function* () {
      annotations.push(yield* Effect.service(References.CurrentLogAnnotations))
      yield* Effect.logInfo('safe')
      return yield* Effect.succeed('done')
    }).pipe(
      withObservability('app.test', metadata),
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(Tracer.Tracer, tracer),
    ),
  )

  expect(spans).toHaveLength(1)
  expect(Object.fromEntries(spans[0]?.attributes ?? [])).toEqual(metadataAttributes(metadata))
  expect(annotations[0]).toEqual(metadataAttributes(metadata))
  expect(metadataFromHeaders(base, new Headers({ 'x-app-job-id': 'x'.repeat(129) }))).toEqual({
    ...base,
    kind: 'http',
  })
})

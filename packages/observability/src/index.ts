import { Effect, Option, Schema } from 'effect'

/** Values that can safely identify a deployment without exposing a request payload. */
export const Environment = Schema.Literals(['local', 'preview', 'production'])
export type Environment = typeof Environment.Type

const SafeText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9._:/-]+$/),
)
const Attempt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1000))
const CorrelationId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
)

/** The only metadata accepted by the application telemetry seam. */
export const ObservabilityMetadata = Schema.Struct({
  environment: Environment,
  release: SafeText,
  component: SafeText,
  kind: Schema.optional(SafeText),
  correlationId: Schema.optional(CorrelationId),
  operationId: Schema.optional(SafeText),
  jobId: Schema.optional(SafeText),
  attempt: Schema.optional(Attempt),
})
export type ObservabilityMetadata = typeof ObservabilityMetadata.Type

export type ObservabilityBase = Pick<ObservabilityMetadata, 'environment' | 'release' | 'component'>

const DeploymentIdentity = Schema.Struct({
  environment: Environment,
  release: SafeText,
  component: Schema.Literals(['server', 'web', 'edge']),
})

export class InvalidDeploymentIdentity extends Schema.TaggedError<InvalidDeploymentIdentity>()(
  'InvalidDeploymentIdentity',
  {},
) {}

export const makeObservabilityBase = (input: {
  readonly environment: unknown
  readonly release: unknown
  readonly component: unknown
}) =>
  Schema.decodeUnknownEffect(DeploymentIdentity)(input).pipe(Effect.mapError(() => InvalidDeploymentIdentity.make({})))

type FetchHeaders = { readonly get: (name: string) => string | null }
type EffectHeaders = { readonly get?: undefined; readonly [key: string]: string | undefined }
type HeaderSource = EffectHeaders | FetchHeaders

const readHeader = (headers: HeaderSource, name: string): string | undefined => {
  const value = (typeof headers.get === 'function' ? headers.get(name) : headers[name])?.trim()
  return value === undefined || value === '' ? undefined : value
}

/**
 * Only the edge-generated UUID crosses HTTP. Operation/job/attempt labels are
 * assigned by trusted application operations, never derived from request headers.
 */
export const metadataFromHeaders = (base: ObservabilityBase, headers: HeaderSource): ObservabilityMetadata => {
  const correlation = Schema.decodeUnknownOption(CorrelationId)(readHeader(headers, 'x-styld-correlation-id'))
  return Option.match(correlation, {
    onNone: () => ({ ...base, kind: 'http' }),
    onSome: (correlationId) => ({ ...base, kind: 'http', correlationId }),
  })
}

/** Convert the typed metadata to a record with no undefined optional fields. */
export const metadataAttributes = (metadata: ObservabilityMetadata): Record<string, string | number> => {
  const attributes: Record<string, string | number> = {
    'styld.environment': metadata.environment,
    'styld.release': metadata.release,
    'styld.component': metadata.component,
  }
  if (metadata.kind !== undefined) attributes['styld.kind'] = metadata.kind
  if (metadata.correlationId !== undefined) attributes['styld.correlation_id'] = metadata.correlationId
  if (metadata.operationId !== undefined) attributes['styld.operation_id'] = metadata.operationId
  if (metadata.jobId !== undefined) attributes['styld.job_id'] = metadata.jobId
  if (metadata.attempt !== undefined) attributes['styld.attempt'] = metadata.attempt
  return attributes
}

/**
 * Add one named Effect span and the same bounded fields to every log emitted by
 * the effect. Callers cannot pass arbitrary attributes through this API.
 */
export const withObservability =
  (name: string, metadata: ObservabilityMetadata) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.annotateLogs(
      Effect.withSpan(effect, name, { attributes: metadataAttributes(metadata), captureStackTrace: false }),
      metadataAttributes(metadata),
    )

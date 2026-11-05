import { Schema } from 'effect'
export const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160))
export const UserId = Identifier.pipe(Schema.brand('Styld/UserId'))
export type UserId = typeof UserId.Type
export const OperationId = Identifier.pipe(Schema.brand('Styld/OperationId'))
export type OperationId = typeof OperationId.Type
export const Fingerprint = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))

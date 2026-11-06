import { concatBytes, type Hex, hexToBytes, uintToBytes, utf8ToBytes } from './Hex.ts'
import { keccak256, keccak256Bytes } from './Keccak.ts'

// EIP-712 for flat structs of static fields only (bytes32, bytes16, address, uint64, uint256): every field encodes to one
// 32-byte word, so encodeData is a concatenation. Enough for Invoice and Approval; delegations use the kit in chain.
export type FieldType = 'address' | 'bytes16' | 'bytes32' | 'uint64' | 'uint256'
export type Field = { readonly name: string; readonly type: FieldType }
export type StructType = { readonly name: string; readonly fields: readonly Field[] }
export type Domain = {
  readonly name: string
  readonly version: string
  readonly chainId: number
  readonly verifyingContract?: Hex
}

export const encodeType = ({ name, fields }: StructType) =>
  `${name}(${fields.map((field) => `${field.type} ${field.name}`).join(',')})`

const fixedBytes = (value: string, size: number, align: 'left' | 'right') => {
  const bytes = hexToBytes(value)
  if (bytes.length !== size) throw new Error(`EIP-712: expected ${size} bytes, got ${bytes.length}`)
  const word = new Uint8Array(32)
  word.set(bytes, align === 'left' ? 32 - size : 0)
  return word
}

const encodeField = (type: FieldType, value: bigint | string): Uint8Array<ArrayBuffer> => {
  switch (type) {
    case 'address':
      return fixedBytes(String(value), 20, 'left')
    case 'bytes16':
      return fixedBytes(String(value), 16, 'right')
    case 'bytes32':
      return fixedBytes(String(value), 32, 'right')
    case 'uint64':
      return concatBytes(new Uint8Array(24), uintToBytes(BigInt(value), 8))
    case 'uint256':
      return uintToBytes(BigInt(value), 32)
  }
}

export const hashStruct = (
  type: StructType,
  values: Readonly<Record<string, bigint | string>>,
): Uint8Array<ArrayBuffer> =>
  keccak256Bytes(
    concatBytes(
      keccak256Bytes(utf8ToBytes(encodeType(type))),
      ...type.fields.map((field) => {
        const value = values[field.name]
        if (value === undefined) throw new Error(`EIP-712: missing field ${field.name}`)
        return encodeField(field.type, value)
      }),
    ),
  )

export const domainSeparator = (domain: Domain): Uint8Array<ArrayBuffer> => {
  const base = `EIP712Domain(string name,string version,uint256 chainId`
  const typeString = domain.verifyingContract === undefined ? `${base})` : `${base},address verifyingContract)`
  return keccak256Bytes(
    concatBytes(
      keccak256Bytes(utf8ToBytes(typeString)),
      keccak256Bytes(utf8ToBytes(domain.name)),
      keccak256Bytes(utf8ToBytes(domain.version)),
      uintToBytes(BigInt(domain.chainId), 32),
      ...(domain.verifyingContract === undefined ? [] : [fixedBytes(domain.verifyingContract, 20, 'left')]),
    ),
  )
}

/** The EIP-712 digest `keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(message))`. */
export const hashTypedData = (
  domain: Domain,
  type: StructType,
  values: Readonly<Record<string, bigint | string>>,
): Hex => keccak256(concatBytes(new Uint8Array([0x19, 0x01]), domainSeparator(domain), hashStruct(type, values)))

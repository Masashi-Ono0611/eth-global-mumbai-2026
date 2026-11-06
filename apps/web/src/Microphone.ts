import { Effect, Option, Schema } from 'effect'

// The push-to-talk microphone and Vita's speaker: the browser resources the voice Commands own (RobotVoice.ts). The mic
// is open only between `startListening` and `stopListening` (the owner holds the button); the clip leaves as a 16 kHz
// mono WAV data URI, the format the 0G Router's omni models take. Nothing here keeps audio after it is sent.

class MicrophoneFailure extends Schema.TaggedError<MicrophoneFailure>()('MicrophoneFailure', {
  /** `superseded`: a newer hold asked for the mic while this one waited; `hidden`: the page was hidden by then. Either
   *  way the stream that arrived is closed again at once. */
  reason: Schema.Literals(['blocked', 'unsupported', 'superseded', 'hidden']),
}) {}

interface Recording {
  readonly stream: MediaStream
  readonly context: AudioContext
  readonly source: MediaStreamAudioSourceNode
  readonly processor: ScriptProcessorNode
  readonly chunks: Array<Float32Array>
  readonly startedAt: number
  /** Drops the guards below (the time cap and the page-hidden listener). */
  readonly unguard: () => void
}

/** The one recording in progress (a page has one mic button), and the newest press that asked for the mic. */
const current: { recording: Option.Option<Recording>; requested: number; closedByGuard: boolean } = {
  recording: Option.none(),
  requested: Number.NaN,
  closedByGuard: false,
}

/** The mic closes itself after this even if nobody stops it (the page was left, a release was lost). */
const SELF_CLOSE_MILLIS = 15_000

const SAMPLE_RATE = 16_000
/** At most 14 s of speech: the Worker caps the data URI at about 15 s. */
const MAX_SAMPLES = SAMPLE_RATE * 14
/** A press shorter than this is a tap, not speech. */
const MIN_MILLIS = 400

/** Closes the mic: the stream's tracks stop (the browser's mic light goes off) and the audio graph is torn down. */
const releaseNow = (recording: Recording) => {
  recording.unguard()
  recording.source.disconnect()
  recording.processor.disconnect()
  recording.stream.getTracks().forEach((track) => track.stop())
  recording.context.close().catch(() => undefined)
}
const release = (recording: Recording) => Effect.sync(() => releaseNow(recording))

/** Closes the recording if it is still the current one (a guard fired). */
const closeIfCurrent = (recording: Recording) => {
  if (Option.isSome(current.recording) && current.recording.value === recording) {
    current.recording = Option.none()
    current.closedByGuard = true
    releaseNow(recording)
  }
}

/** Opens the mic for hold `holdId`; a newer hold while this one waits supersedes it, and a hidden page gets no mic. */
export const startListening = Effect.fnUntraced(function* (holdId: number) {
  current.requested = holdId
  current.closedByGuard = false
  // A new hold closes any mic still open from an earlier one first, whatever this request's outcome.
  yield* Option.match(current.recording, { onNone: () => Effect.void, onSome: release })
  current.recording = Option.none()
  if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
    return yield* new MicrophoneFailure({ reason: 'unsupported' })
  }
  const stream = yield* Effect.tryPromise({
    try: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }),
    catch: () => new MicrophoneFailure({ reason: 'blocked' }),
  })
  if (current.requested !== holdId || document.visibilityState === 'hidden') {
    stream.getTracks().forEach((track) => track.stop())
    return yield* new MicrophoneFailure({ reason: current.requested === holdId ? 'hidden' : 'superseded' })
  }
  yield* Option.match(current.recording, { onNone: () => Effect.void, onSome: release })
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Array<Float32Array> = []
  processor.addEventListener('audioprocess', (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  })
  source.connect(processor)
  processor.connect(context.destination)
  const startedAt = yield* Effect.sync(() => performance.now())
  const guards: { timer: number; onHidden: () => void } = { timer: 0, onHidden: () => undefined }
  const recording: Recording = {
    stream,
    context,
    source,
    processor,
    chunks,
    startedAt,
    unguard: () => {
      clearTimeout(guards.timer)
      document.removeEventListener('visibilitychange', guards.onHidden)
    },
  }
  guards.onHidden = () => {
    if (document.visibilityState === 'hidden') closeIfCurrent(recording)
  }
  guards.timer = window.setTimeout(() => closeIfCurrent(recording), SELF_CLOSE_MILLIS)
  document.addEventListener('visibilitychange', guards.onHidden)
  current.recording = Option.some(recording)
})

const toWav = (chunks: ReadonlyArray<Float32Array>, rate: number): string => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const flat = new Float32Array(total)
  chunks.reduce((offset, chunk) => {
    flat.set(chunk, offset)
    return offset + chunk.length
  }, 0)
  const ratio = rate / SAMPLE_RATE
  const length = Math.min(Math.floor(total / ratio), MAX_SAMPLES)
  const view = new DataView(new ArrayBuffer(44 + length * 2))
  const ascii = (at: number, text: string) =>
    Array.from({ length: text.length }, (_, index) => view.setUint8(at + index, text.charCodeAt(index)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, length * 2, true)
  Array.from({ length }, (_, index) => {
    const sample = Math.max(-1, Math.min(1, flat[Math.floor(index * ratio)] ?? 0))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    return index
  })
  const bytes = new Uint8Array(view.buffer)
  const binary = Array.from({ length: Math.ceil(bytes.length / 0x8000) }, (_, block) =>
    String.fromCharCode(...bytes.subarray(block * 0x8000, (block + 1) * 0x8000)),
  ).join('')
  return `data:audio/wav;base64,${btoa(binary)}`
}

/** Closes the mic. The clip as a WAV data URI, or none for a tap; `closed` when a guard had already closed the mic
 *  (the page was hidden, or it ran past its time), so nothing was kept to send. */
export const stopListening = Effect.gen(function* () {
  if (Option.isNone(current.recording)) {
    const closed = current.closedByGuard
    current.closedByGuard = false
    return { maybeAudio: Option.none<string>(), closed }
  }
  const recording = current.recording.value
  current.recording = Option.none()
  yield* release(recording)
  const elapsed = (yield* Effect.sync(() => performance.now())) - recording.startedAt
  return {
    maybeAudio:
      elapsed < MIN_MILLIS ? Option.none<string>() : Option.some(toWav(recording.chunks, recording.context.sampleRate)),
    closed: false,
  }
})

/** Plays Vita's speech pitched up like the demo kit (1.16, pitch not preserved): true when it played to the end. */
export const playSpeech = (url: string) =>
  Effect.callback<boolean>((resume) => {
    const player = new Audio(url)
    player.preservesPitch = false
    player.playbackRate = 1.16
    // An error can fire both the element's `error` and the play() rejection: answer once.
    const answered = { done: false }
    const answer = (played: boolean) => {
      if (answered.done) return
      answered.done = true
      resume(Effect.succeed(played))
    }
    player.addEventListener('ended', () => answer(true))
    player.addEventListener('error', () => answer(false))
    player.play().catch(() => answer(false))
    return Effect.sync(() => player.pause())
  })

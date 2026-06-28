// In-browser voice-memo recording.
//
// iOS Safari's MediaRecorder outputs audio/mp4 (AAC), NOT WebM, so we never
// hardcode a type — we feature-detect with MediaRecorder.isTypeSupported() and
// pick the first supported entry from this preference list. The recorded Blob's
// actual .type is stored alongside it so playback uses the right format.
//
// Recording MUST be started from inside a user gesture (a tap handler) or iOS
// leaves the audio pipeline suspended. Always stop the stream tracks on end, or
// the mic indicator stays on.

export const AUDIO_MIME_PREFERENCE = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

export function audioRecordingSupported() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  );
}

/** First supported MIME type, or undefined to let the browser pick its default. */
export function pickSupportedMimeType(preference = AUDIO_MIME_PREFERENCE) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  for (const type of preference) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/**
 * Begin recording. Call inside a tap handler. Returns a handle:
 *   - mimeType: the chosen type (may be the browser default)
 *   - stop():   resolves to the recorded Blob (with correct .type), stops mic
 *   - cancel(): discards and stops mic
 */
export async function startRecording() {
  if (!audioRecordingSupported()) {
    throw new Error('Audio recording is not supported in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chosen = pickSupportedMimeType();
  const recorder = new MediaRecorder(stream, chosen ? { mimeType: chosen } : {});
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });

  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());

  recorder.start();

  return {
    mimeType: recorder.mimeType || chosen,
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      stopTracks();
      // Prefer the recorder's reported type, then the chunk type, then chosen.
      const type =
        recorder.mimeType || (chunks[0] && chunks[0].type) || chosen || AUDIO_MIME_PREFERENCE[0];
      return new Blob(chunks, { type });
    },
    cancel() {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* already stopped */
      }
      stopTracks();
    },
  };
}

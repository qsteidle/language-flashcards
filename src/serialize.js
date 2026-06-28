// Blob <-> base64 helpers used ONLY for the portable JSON export/import.
// Live storage uses binary Blobs in IndexedDB; base64 is accepted here because
// the export file must be self-contained and text-portable.
//
// Works in the browser (atob/btoa/Blob) and in Node (Buffer), so the
// schema round-trip can be unit-tested without a DOM.

/** Blob -> base64 string (no data: prefix). */
export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 string -> Blob with the given MIME type. */
export function base64ToBlob(base64, type) {
  let bytes;
  if (typeof Buffer !== 'undefined') {
    bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  } else {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

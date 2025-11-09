import { unzipSync, strFromU8 } from '../vendor/fflate.js';

export function unzipToTextMap(buffer) {
  if (!buffer) {
    return new Map();
  }

  const uint8 =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  let files;
  try {
    files = unzipSync(uint8);
  } catch (error) {
    throw new Error(`Failed to unzip archive: ${error.message || error}`);
  }

  const result = new Map();
  for (const [name, data] of Object.entries(files)) {
    try {
      result.set(name, strFromU8(data));
    } catch (error) {
      console.warn('[zip] Failed to decode entry', name, error);
    }
  }

  return result;
}


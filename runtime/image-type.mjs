import fs from 'node:fs';

export const IMAGE_PREFIX_BYTES = 4096;

export function imageType(bytes) {
  const prefix = bytes.subarray(0, IMAGE_PREFIX_BYTES);
  if (prefix.length >= 8 && prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (prefix.length >= 3 && prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(prefix.subarray(0,6).toString('ascii'))) return 'image/gif';
  if (prefix.subarray(0,4).toString('ascii') === 'RIFF' && prefix.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  for (let offset = 0; offset + 8 <= prefix.length;) {
    let size = prefix.readUInt32BE(offset);
    const kind = prefix.subarray(offset + 4, offset + 8).toString('ascii');
    let header = 8;
    if (size === 1) {
      if (offset + 16 > prefix.length) break;
      const extended = prefix.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extended); header = 16;
    }
    if (size === 0) size = prefix.length - offset;
    if (size < header) break;
    if (kind === 'ftyp' && size >= header + 8) {
      const end = Math.min(offset + size, prefix.length);
      for (let brand = offset + header; brand + 4 <= end; brand += 4) {
        if (brand === offset + header + 4) continue; // Minor version is not a brand.
        if (['avif','avis'].includes(prefix.subarray(brand,brand + 4).toString('ascii'))) return 'image/avif';
      }
      break;
    }
    offset += size;
  }
  const text = prefix.toString('utf8').replace(/^\uFEFF/, '');
  if (/^\s*(?:<\?xml\s[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg\b[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) return 'image/svg+xml';
  return null;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const prefixes = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify(prefixes.map(prefix => imageType(Buffer.from(prefix, 'base64')))));
}

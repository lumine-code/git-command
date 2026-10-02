const fs = require("fs/promises");
const { StringDecoder } = require("string_decoder");

const MAX_PREVIEW_LENGTH = 12_000;

// Read enough UTF-8 bytes for the preview and one extra character to detect
// truncation. Large untracked files must not be read in full on the UI thread.
async function readFilePreview(filePath) {
  const file = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc((MAX_PREVIEW_LENGTH + 1) * 4);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const decoder = new StringDecoder("utf8");
    const contents = decoder.write(buffer.subarray(0, length));
    const text = length < buffer.length ? contents + decoder.end() : contents;
    return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}\n…` : text;
  } finally {
    await file.close();
  }
}

module.exports = { MAX_PREVIEW_LENGTH, readFilePreview };

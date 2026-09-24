export const attachmentBucket = "os-attachments";
export const attachmentFileNameLimit = 180;

export const attachmentMimeExtensions = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
} as const;

export type AttachmentMimeType = keyof typeof attachmentMimeExtensions;
export const attachmentMimeTypes = Object.keys(
  attachmentMimeExtensions,
) as AttachmentMimeType[];
export function isAttachmentMimeType(value: string): value is AttachmentMimeType {
  return attachmentMimeTypes.includes(value as AttachmentMimeType);
}
export const attachmentAccept = Object.values(attachmentMimeExtensions)
  .flat()
  .join(",");

const unsafeNameCharacters =
  /[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

export function normalizeAttachmentName(original: string) {
  const maxLength = attachmentFileNameLimit;
  const normalized = original
    .normalize("NFKC")
    .replace(unsafeNameCharacters, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (!normalized) return "";
  const extensionStart = normalized.lastIndexOf(".");
  const extension =
    extensionStart > 0 && normalized.length - extensionStart <= 10
      ? normalized.slice(extensionStart)
      : "";
  const base = extension
    ? `${normalized.slice(0, extensionStart).slice(0, maxLength - extension.length)}${extension}`
    : normalized.slice(0, maxLength);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)
    ? `_${base}`.slice(0, maxLength)
    : base;
}

export function attachmentExtensionMatches(name: string, mime: string) {
  const extensions = attachmentMimeExtensions[mime as AttachmentMimeType] as
    | readonly string[]
    | undefined;
  return Boolean(
    extensions?.some((extension) => name.toLowerCase().endsWith(extension)),
  );
}

function starts(bytes: Uint8Array, ...signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function containsAscii(bytes: Uint8Array, value: string) {
  const needle = new TextEncoder().encode(value);
  return bytes.some((_, start) =>
    needle.every((byte, offset) => bytes[start + offset] === byte),
  );
}

export async function attachmentContentMatches(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  switch (file.type) {
    case "application/pdf":
      return starts(bytes, 0x25, 0x50, 0x44, 0x46, 0x2d);
    case "image/jpeg":
      return starts(bytes, 0xff, 0xd8, 0xff);
    case "image/png":
      return starts(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return (
        starts(bytes, 0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return (
        starts(bytes, 0x50, 0x4b, 0x03, 0x04) &&
        containsAscii(bytes, "[Content_Types].xml") &&
        containsAscii(bytes, "xl/")
      );
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return (
        starts(bytes, 0x50, 0x4b, 0x03, 0x04) &&
        containsAscii(bytes, "[Content_Types].xml") &&
        containsAscii(bytes, "word/")
      );
    case "text/plain":
    case "text/csv":
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export async function attachmentSha256(file: File) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

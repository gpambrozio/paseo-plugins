/**
 * What the captain can attach to a message for the first mate, in the two
 * shapes Paseo's own composer sends (read in the 0.9.0 app and daemon):
 *
 * - **An image** goes with the message itself, base64, as the send's
 *   `images` — the same `{ data, mimeType }` Paseo's composer encodes.
 * - **Any other file** is written under `$PASEO_HOME/uploads/` first and goes
 *   as an `uploaded_file` attachment naming its path; the provider tells the
 *   agent the file's name, path, type and size, and the agent reads it from
 *   there. Paseo's app streams the bytes over its own binary upload channel,
 *   which a plugin cannot reach, so the plugin carries them over its own RPC
 *   and the daemon half writes them where Paseo would.
 *
 * Which is which follows Paseo too: a raster image by type or extension is an
 * image, everything else a file.
 */
import { z } from "zod";

/** Paseo's composer refuses a file past this; so does the chat. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export const ImagePartSchema = z.object({
  /** Base64, without a `data:` prefix. */
  data: z.string().min(1),
  mimeType: z.string().min(1),
});
export type ImagePart = z.infer<typeof ImagePartSchema>;

export const FilePartSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  /** Base64, without a `data:` prefix. */
  data: z.string(),
});
export type FilePart = z.infer<typeof FilePartSchema>;

/** The captain's message: words, attachments, or both — never neither. */
export const CaptainMessageSchema = z
  .object({
    text: z.string(),
    images: z.array(ImagePartSchema).optional(),
    files: z.array(FilePartSchema).optional(),
  })
  .refine(
    (message) => message.text.trim() !== "" || (message.images?.length ?? 0) > 0 || (message.files?.length ?? 0) > 0,
    { message: "Nothing to send: the message has no words and no attachments." },
  );
export type CaptainMessage = z.infer<typeof CaptainMessageSchema>;

/** Paseo's list of raster image types (`attachments/file-types.ts`), by extension. */
const RASTER_IMAGE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};
const RASTER_IMAGE_TYPES = new Set(Object.values(RASTER_IMAGE_BY_EXTENSION));

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/**
 * The image type a file is sent as, or `null` when it is sent as a file. A
 * type the browser supplied wins over the extension, as in Paseo, so a
 * `photo.png` the browser calls `text/plain` is a file.
 */
export function rasterImageType(mimeType: string, fileName: string): string | null {
  const supplied = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (supplied !== "") {
    const normalized = supplied === "image/jpg" ? "image/jpeg" : supplied;
    return RASTER_IMAGE_TYPES.has(normalized) ? normalized : null;
  }
  return RASTER_IMAGE_BY_EXTENSION[extensionOf(fileName)] ?? null;
}

/** The type a file is uploaded with: what the browser said, else Paseo's generic one. */
export function fileType(mimeType: string, fileName: string): string {
  const supplied = mimeType.trim();
  if (supplied !== "") return supplied;
  return RASTER_IMAGE_BY_EXTENSION[extensionOf(fileName)] ?? "application/octet-stream";
}

/** How many bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

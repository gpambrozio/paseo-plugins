/**
 * A file the captain attached, written where Paseo writes its own uploads and
 * described the way Paseo describes them, so the first mate is handed exactly
 * what Paseo's composer would hand it.
 *
 * Paseo's daemon (`server/file-upload/index.ts`, 0.9.0) puts each upload in
 * `$PASEO_HOME/uploads/upload_<uuid>/<name>`, with the name reduced to a safe
 * basename, and answers with an `uploaded_file` attachment carrying that path.
 * The app reaches that code over a binary channel a plugin has no access to,
 * so this is the same layout, written by the plugin's own daemon half. Like
 * Paseo's, the files are not cleaned up: the agent may read one turns later.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { MAX_ATTACHMENT_BYTES, base64Bytes, fileType, type FilePart } from "../shared/attachments";
import { paseoHome } from "./data-dir";

/** Paseo's `UploadedFileAttachmentSchema`, the one attachment shape the chat sends. */
export interface UploadedFile {
  type: "uploaded_file";
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
}

/** Paseo's `sanitizeFileName`: a basename of safe characters, never empty or a dot. */
export function sanitizeFileName(value: string): string {
  const name = basename(value)
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim();
  return name.length > 0 && name !== "." && name !== ".." ? name : "upload";
}

/** Writes one attached file under `$PASEO_HOME/uploads/` and describes it. */
export async function writeUpload(file: FilePart, home: string = paseoHome()): Promise<UploadedFile> {
  if (base64Bytes(file.data) > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.fileName} is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`);
  }
  const bytes = Buffer.from(file.data, "base64");
  const id = `upload_${randomUUID()}`;
  const fileName = sanitizeFileName(file.fileName);
  const directory = join(home, "uploads", id);
  await mkdir(directory, { recursive: true });
  const path = join(directory, fileName);
  await writeFile(path, bytes);
  return {
    type: "uploaded_file",
    id,
    fileName,
    mimeType: fileType(file.mimeType, file.fileName),
    size: bytes.byteLength,
    path,
  };
}

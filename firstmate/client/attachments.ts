/**
 * What the captain has attached to the message they are writing, one list per
 * first mate, kept the way `./draft` keeps the words: on `globalThis`, so the
 * attachments survive the surface unmounting and the app evaluating the
 * bundle afresh after a lost connection. Not persisted, and not shared
 * between devices. Pure apart from that one slot.
 */
import {
  MAX_ATTACHMENT_BYTES,
  fileType,
  rasterImageType,
  type CaptainMessage,
} from "../shared/attachments";

/** One attachment waiting to be sent, its bytes already read, as base64. */
export interface PendingAttachment {
  id: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
}

/** A file as the browser handed it over: a picker, a paste or a drop. */
export interface PickedFile {
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
}

export interface AttachmentStore {
  get(key: string): readonly PendingAttachment[];
  /** An empty list is forgotten rather than kept. */
  set(key: string, attachments: readonly PendingAttachment[]): void;
}

/** A registered symbol, so each evaluation of the bundle names the same slot. */
const SLOT = Symbol.for("paseo.firstmate.attachments");

/** The attachments kept on `root`; every store built on the same root shares them. */
export function createAttachmentStore(root: object): AttachmentStore {
  let lists = Reflect.get(root, SLOT) as Map<string, readonly PendingAttachment[]> | undefined;
  if (!(lists instanceof Map)) {
    lists = new Map<string, readonly PendingAttachment[]>();
    Reflect.set(root, SLOT, lists);
  }
  const store = lists;
  return {
    get: (key) => store.get(key) ?? [],
    set: (key, attachments) => {
      if (attachments.length === 0) store.delete(key);
      else store.set(key, attachments);
    },
  };
}

export const pendingAttachments = createAttachmentStore(globalThis);

let nextId = 0;

/** The file as an attachment: an image if Paseo would send it as one, otherwise a file. */
export function toAttachment(file: PickedFile, id: string = `attachment-${Date.now()}-${nextId++}`): PendingAttachment {
  const image = rasterImageType(file.mimeType, file.fileName);
  return image === null
    ? { id, kind: "file", fileName: file.fileName, mimeType: fileType(file.mimeType, file.fileName), size: file.size, data: file.data }
    : { id, kind: "image", fileName: file.fileName, mimeType: image, size: file.size, data: file.data };
}

/** Why a file cannot be attached, or `null` when it can. Checked before its bytes are read. */
export function attachmentProblem(file: { fileName: string; size: number }): string | null {
  return file.size > MAX_ATTACHMENT_BYTES
    ? `${file.fileName} is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`
    : null;
}

/** What the send carries: the words trimmed, images as images, the rest as files to upload. */
export function captainMessage(text: string, attachments: readonly PendingAttachment[]): CaptainMessage {
  const images = attachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => ({ data: attachment.data, mimeType: attachment.mimeType }));
  const files = attachments
    .filter((attachment) => attachment.kind === "file")
    .map((attachment) => ({ fileName: attachment.fileName, mimeType: attachment.mimeType, data: attachment.data }));
  return {
    text: text.trim(),
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

/** Whether there is anything to send. */
export function hasContent(text: string, attachments: readonly PendingAttachment[]): boolean {
  return text.trim() !== "" || attachments.length > 0;
}

/** A size as the chip shows it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

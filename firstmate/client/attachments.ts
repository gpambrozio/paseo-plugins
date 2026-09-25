/**
 * What the captain has attached to the message they are writing, one list per
 * first mate, kept the way `./draft` keeps the words: on `globalThis`, so the
 * attachments survive the surface unmounting and the app evaluating the
 * bundle afresh after a lost connection. Not persisted, and not shared
 * between devices. Pure apart from that one slot.
 */
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_BYTES,
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

const MB = 1024 * 1024;

/**
 * Which of `candidates` fit beside what is already attached, in order, and why
 * each of the rest does not: one attachment's size, the number per message,
 * and all of them together — the limits the daemon holds the message to.
 * Checked on sizes alone, before any bytes are read, and again when the bytes
 * are in, since another pick may have landed meanwhile.
 */
export function admit<Candidate extends { fileName: string; size: number }>(
  current: readonly { size: number }[],
  candidates: readonly Candidate[],
): { accepted: Candidate[]; problems: string[] } {
  let count = current.length;
  let total = current.reduce((sum, attachment) => sum + attachment.size, 0);
  const accepted: Candidate[] = [];
  const problems: string[] = [];
  candidates.forEach((candidate) => {
    if (candidate.size > MAX_ATTACHMENT_BYTES) {
      problems.push(`${candidate.fileName} is larger than ${MAX_ATTACHMENT_BYTES / MB} MB.`);
    } else if (count >= MAX_ATTACHMENTS) {
      problems.push(`${candidate.fileName} was not attached: a message carries at most ${MAX_ATTACHMENTS}.`);
    } else if (total + candidate.size > MAX_MESSAGE_BYTES) {
      problems.push(`${candidate.fileName} was not attached: a message's attachments stay under ${MAX_MESSAGE_BYTES / MB} MB together.`);
    } else {
      count += 1;
      total += candidate.size;
      accepted.push(candidate);
    }
  });
  return { accepted, problems };
}

/** A file whose bytes can be read, as `./web` offers one. */
export interface ReadableFile {
  fileName: string;
  mimeType: string;
  size: number;
  read(): Promise<string>;
}

/**
 * Reads each file on its own, so one that cannot be read costs only itself:
 * the rest still become attachments, and each failure is reported by name.
 */
export function readEach(files: readonly ReadableFile[]): Promise<{ read: PendingAttachment[]; failures: string[] }> {
  return Promise.all(
    files.map(function readOne(file): Promise<PendingAttachment | string> {
      return file.read().then(
        (data) => toAttachment({ fileName: file.fileName, mimeType: file.mimeType, size: file.size, data }),
        (caught: unknown) => `Could not attach ${file.fileName}: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }),
  ).then((results) => ({
    read: results.filter((result): result is PendingAttachment => typeof result !== "string"),
    failures: results.filter((result): result is string => typeof result === "string"),
  }));
}

/**
 * The attachments of a send that failed, put back ahead of whatever was
 * attached while it was in flight, so neither the old nor the new is lost.
 */
export function restoreFailed(
  current: readonly PendingAttachment[],
  failed: readonly PendingAttachment[],
): PendingAttachment[] {
  const restored = new Set(failed.map((attachment) => attachment.id));
  return [...failed, ...current.filter((attachment) => !restored.has(attachment.id))];
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

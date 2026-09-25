/**
 * Every browser global this plugin touches, in the one module the plugin API
 * allows them in. Each export declares the narrow shape of the globals it
 * uses, gates on `Platform.OS`, and gives native the alternative or a no-op —
 * so the rest of `client/` never reaches for `window` or `document` and
 * typechecks without the DOM library.
 *
 * The exports are the chat pane's resize drag, copied from
 * `github-board/client/web.ts` — there is no workspace root to share it from —
 * and the chat's file picker, paste and drop.
 */
import { Platform } from "react-native";

import { rasterImageType } from "../shared/attachments";

/** Only what this module reads off the web globals; the DOM library stays off. */
interface WebGlobals {
  document?: {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
    body?: { style?: Record<string, string> };
  };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Follows a drag at the document level on the web renderer, where the
 * responder system alone is not enough: widening the chat means dragging
 * *right*, across the board's columns, whose scroll views ask for the responder
 * as the pointer crosses them, and a pointer moving faster than the handle
 * leaves it altogether. Document listeners see every move until the button is
 * released, wherever the pointer is — including outside the window, where a
 * `blur` stands in for the release the browser cannot report.
 *
 * Native has no pointer to follow at the document level and gets a no-op; the
 * responder system alone is enough there, because there are no columns
 * competing for a finger that is already down on the handle.
 */
export function trackPointerOnDocument(
  onMove: (clientX: number) => void,
  onEnd: () => void,
): () => void {
  if (Platform.OS !== "web") return () => {};

  const web = globalThis as WebGlobals;
  const document = web.document;
  if (
    document === undefined ||
    typeof document.addEventListener !== "function" ||
    typeof document.removeEventListener !== "function"
  ) {
    return () => {};
  }
  const move = (event: unknown) => {
    const clientX = typeof event === "object" && event !== null ? Reflect.get(event, "clientX") : null;
    if (typeof clientX === "number") onMove(clientX);
  };
  /**
   * A drag is also a mouse-down followed by movement, which is how a browser
   * starts a text selection — and once the pointer leaves the handle, every
   * card title it crosses is selectable. Selection is switched off on the body
   * for the drag's duration, and the resize cursor is pinned there too so it
   * does not flicker back to an I-beam over text.
   */
  const bodyStyle = document.body?.style;
  const previous = {
    userSelect: bodyStyle?.userSelect ?? "",
    webkitUserSelect: bodyStyle?.webkitUserSelect ?? "",
    cursor: bodyStyle?.cursor ?? "",
  };
  if (bodyStyle !== undefined) {
    bodyStyle.userSelect = "none";
    bodyStyle.webkitUserSelect = "none";
    bodyStyle.cursor = "col-resize";
  }
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    if (bodyStyle !== undefined) {
      bodyStyle.userSelect = previous.userSelect;
      bodyStyle.webkitUserSelect = previous.webkitUserSelect;
      bodyStyle.cursor = previous.cursor;
    }
    document.removeEventListener?.("pointermove", move);
    document.removeEventListener?.("pointerup", end);
    document.removeEventListener?.("pointercancel", end);
    web.removeEventListener?.("blur", end);
    onEnd();
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  web.addEventListener?.("blur", end);
  return end;
}

/** A browser `File`, as far as attaching one needs it. */
interface WebFile {
  name: string;
  type: string;
  size: number;
}

interface WebFileReader {
  result: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsDataURL(file: WebFile): void;
}

interface WebFileList {
  length: number;
  [index: number]: WebFile;
}

interface WebInputElement {
  type: string;
  multiple: boolean;
  files: WebFileList | null;
  style: Record<string, string>;
  addEventListener(type: string, listener: () => void): void;
  click(): void;
  remove(): void;
}

interface WebTransfer {
  files?: WebFileList;
  types?: ArrayLike<string>;
  dropEffect?: string;
}

interface WebTransferEvent {
  clipboardData?: WebTransfer | null;
  dataTransfer?: WebTransfer | null;
  preventDefault(): void;
}

interface WebEventTarget {
  addEventListener(type: string, listener: (event: WebTransferEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebTransferEvent) => void): void;
}

interface FileGlobals {
  document?: {
    createElement?: (tag: string) => WebInputElement;
    body?: { appendChild?: (node: WebInputElement) => void };
  };
  FileReader?: new () => WebFileReader;
}

/** A file the browser handed over, before its bytes are read. */
export interface OfferedFile {
  fileName: string;
  mimeType: string;
  size: number;
  /** Its bytes, as base64 without the `data:` prefix. */
  read(): Promise<string>;
}

/** Whether this renderer can pick, paste and drop files: the web renderer, on a desktop or in a browser. */
export const canAttachFiles = Platform.OS === "web";

function offered(file: WebFile): OfferedFile {
  return {
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    read: function read(): Promise<string> {
      return new Promise((resolve, reject) => {
        const Reader = (globalThis as unknown as FileGlobals).FileReader;
        if (Reader === undefined) {
          reject(new Error("This browser cannot read files."));
          return;
        }
        const reader = new Reader();
        reader.onload = () => {
          const url = typeof reader.result === "string" ? reader.result : "";
          const comma = url.indexOf(",");
          resolve(comma < 0 ? "" : url.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
      });
    },
  };
}

function listFiles(list: WebFileList | null | undefined): OfferedFile[] {
  const files: OfferedFile[] = [];
  for (let index = 0; index < (list?.length ?? 0); index += 1) {
    const file = list?.[index];
    if (file !== undefined) files.push(offered(file));
  }
  return files;
}

/**
 * Opens the browser's file picker, the one Paseo's own composer opens on the
 * web: any file, several at once. On a phone's browser it offers the photo
 * library and the camera as well as files. Resolves with nothing when the
 * captain cancels. Native has no picker a plugin can reach — Paseo's app uses
 * Expo's pickers, which are not among the host's modules — and resolves empty.
 */
export function pickFiles(): Promise<OfferedFile[]> {
  const document = (globalThis as unknown as FileGlobals).document;
  if (!canAttachFiles || typeof document?.createElement !== "function") return Promise.resolve([]);
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.style.display = "none";
  return new Promise((resolve) => {
    let settled = false;
    const finish = (files: OfferedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(listFiles(input.files)));
    input.addEventListener("cancel", () => finish([]));
    document.body?.appendChild?.(input);
    input.click();
  });
}

function carriesFiles(transfer: WebTransfer | null | undefined): boolean {
  return Array.from(transfer?.types ?? []).includes("Files");
}

/**
 * Takes images pasted into, and files dropped on, `target` — a view's element
 * on the web renderer — and reports whether a drag carrying files is over it.
 * A paste or a drop with nothing of the kind is left alone, so pasting text
 * still pastes text.
 * Native gets a no-op: nothing is dragged there, and the host's `TextInput`
 * does not hand a plugin pasted images.
 */
export function receiveFiles(
  target: unknown,
  onFiles: (files: OfferedFile[]) => void,
  onDragging: (dragging: boolean) => void,
): () => void {
  if (!canAttachFiles || typeof target !== "object" || target === null) return () => {};
  const element = target as Partial<WebEventTarget>;
  if (typeof element.addEventListener !== "function" || typeof element.removeEventListener !== "function") {
    return () => {};
  }
  /** Enter and leave fire for every child crossed; the drag is over only when they balance. */
  let depth = 0;
  // Images only, as Paseo's composer pastes: a copied file or a rich clipboard is left to the text box.
  const paste = (event: WebTransferEvent) => {
    const files = listFiles(event.clipboardData?.files).filter((file) => rasterImageType(file.mimeType, file.fileName) !== null);
    if (files.length === 0) return;
    event.preventDefault();
    onFiles(files);
  };
  const enter = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth += 1;
    if (depth === 1) onDragging(true);
  };
  const over = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Without this the browser — or Electron — opens the file instead of dropping it here.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const leave = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) onDragging(false);
  };
  const drop = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth = 0;
    onDragging(false);
    const files = listFiles(event.dataTransfer?.files);
    if (files.length > 0) onFiles(files);
  };
  const listeners: Array<[string, (event: WebTransferEvent) => void]> = [
    ["paste", paste],
    ["dragenter", enter],
    ["dragover", over],
    ["dragleave", leave],
    ["drop", drop],
  ];
  listeners.forEach(([type, listener]) => element.addEventListener?.(type, listener));
  return () => listeners.forEach(([type, listener]) => element.removeEventListener?.(type, listener));
}

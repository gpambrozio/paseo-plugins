/**
 * The first mate's home, as files: browse it, read any text file, edit and
 * save it — the charter, the captain's standing orders, the backlog, the
 * briefs and reports.
 *
 * The first mate writes these same files, so an edit is saved against the
 * version it was opened at: a file that changed since is refused, and the
 * editor offers to reload theirs or overwrite it with yours. A file changed
 * on disk while open and unedited is simply reloaded. The daemon confines
 * every path to the home (`server/files.ts`).
 *
 * The open folder, the open file and its unsaved text live in module scope,
 * because the surface unmounts every time the captain opens a workspace.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import { listHomeFiles, readHomeFile, writeHomeFile, type HomeEntry } from "../shared/files";
import { relativeTime } from "./format";
import { useKeyboardOverlap } from "./keyboard";
import { isSaveKey, type WebKeyPressEvent } from "./keys";
import { Markdown } from "./markdown";
import { isDirty, markSaved, type OpenFile } from "./open-file";
import { Banner, IconButton, MONOSPACE, errorText } from "./ui";

interface FilesMemory {
  dir: string;
  open: OpenFile | null;
  preview: boolean;
}

let memory: FilesMemory = { dir: "", open: null, preview: false };

const LIST_QUERY = ["firstmate", "files", "list"] as const;

/** The plugin rewrites these on every start, so an edit here does not last. */
const REWRITTEN = new Set(["AGENTS.md", "data/charter.new.md"]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** What the captain asked to do, held back while the open file has unsaved changes. */
interface PendingAction {
  label: string;
  run: () => void;
}

/** A file another part of the panel asks the view to open — the charter's Compare, a watch's name. `at` tells two asks apart. */
export interface FilesRequest {
  path: string;
  at: number;
}

export function FilesView({
  theme,
  compact,
  request = null,
}: {
  theme: PluginTheme;
  compact: boolean;
  request?: FilesRequest | null;
}) {
  const list = useRpc(listHomeFiles);
  const read = useRpc(readHomeFile);
  const write = useRpc(writeHomeFile);
  const toast = useToast();
  const queryClient = useQueryClient();

  const [dir, setDirState] = useState(memory.dir);
  const [open, setOpenState] = useState<OpenFile | null>(memory.open);
  const [preview, setPreviewState] = useState(memory.preview);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  /** An action held back because the open file has unsaved changes. */
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const editorPane = useRef<View>(null);
  const keyboard = useKeyboardOverlap(editorPane);

  function setDir(next: string): void {
    memory = { ...memory, dir: next };
    setDirState(next);
  }
  function setOpen(next: OpenFile | null): void {
    memory = { ...memory, open: next };
    setOpenState(next);
  }
  function setPreview(next: boolean): void {
    memory = { ...memory, preview: next };
    setPreviewState(next);
  }

  const listing = useQuery({
    queryKey: [...LIST_QUERY, dir],
    queryFn: () => list({ path: dir }),
    // The first mate writes here; a slow poll keeps the list, and the open file, current.
    refetchInterval: 10_000,
  });

  const dirty = isDirty(open);

  /** Runs `action` now, or once the captain has decided what to do with unsaved changes. */
  function guarded(label: string, action: () => void): void {
    if (dirty) setPending({ label, run: action });
    else action();
  }

  function load(path: string, options: { quiet?: boolean } = {}): void {
    if (options.quiet !== true) setLoadingPath(path);
    setError(null);
    read({ path })
      .then((result) => {
        if (result.content === null) {
          setOpen({
            kind: "unreadable",
            path: result.path,
            reason: result.binary ? "binary" : "tooLarge",
            size: result.size,
          });
          return;
        }
        setOpen({
          kind: "text",
          path: result.path,
          modifiedMs: result.modifiedMs,
          saved: result.content,
          draft: result.content,
        });
      })
      .catch((caught: unknown) => setError({ text: errorText(caught), conflict: false }))
      .finally(() => setLoadingPath(null));
  }

  function save(force: boolean, then?: PendingAction): void {
    if (open?.kind !== "text" || saving) return;
    const file = open;
    setSaving(true);
    setError(null);
    write({ path: file.path, content: file.draft, expectedModifiedMs: file.modifiedMs, force })
      .then((result) => {
        // `memory.open`, not `file`: the captain may have typed on, or opened another file, since.
        const next = markSaved(memory.open, { path: file.path, content: file.draft, modifiedMs: result.modifiedMs });
        setOpen(next);
        void queryClient.invalidateQueries({ queryKey: LIST_QUERY });
        toast.show(`Saved ${file.path}`, { variant: "success" });
        // Typed on while it saved: going on now would drop that, so ask again.
        if (then === undefined) return;
        if (isDirty(next)) setPending(then);
        else then.run();
      })
      .catch((caught: unknown) => {
        const text = errorText(caught);
        setError({ text, conflict: /changed since|deleted since/.test(text) });
      })
      .finally(() => setSaving(false));
  }

  function create(): void {
    const name = newName?.trim() ?? "";
    if (name === "") return;
    const path = dir === "" ? name : `${dir}/${name}`;
    write({ path, content: "", expectedModifiedMs: null, force: false })
      .then(() => {
        setNewName(null);
        void queryClient.invalidateQueries({ queryKey: LIST_QUERY });
        load(path);
      })
      .catch((caught: unknown) => toast.error(errorText(caught)));
  }

  // The first mate changed the open file on disk. Unedited, it is simply
  // reloaded; edited, the captain is told and chooses.
  const onDisk = listing.data?.entries.find((entry) => open !== null && entry.path === open.path);
  const changedOnDisk = open?.kind === "text" && onDisk !== undefined && onDisk.modifiedMs !== open.modifiedMs;
  useEffect(() => {
    if (changedOnDisk && !dirty && open !== null && loadingPath === null) load(open.path, { quiet: true });
    // Keyed on the change alone: `load` and `open` are new every render, and
    // listing them would reload on every keystroke.
  }, [changedOnDisk, dirty]);

  // Opens what was asked for, in its folder — after the captain's say on unsaved changes, like any open.
  useEffect(() => {
    if (request === null) return;
    guarded(`open ${request.path}`, () => {
      setDir(parentOf(request.path));
      load(request.path);
    });
    // Keyed on the ask alone, for the same reason as above.
  }, [request?.at]);

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      root: { flex: 1, minHeight: 0, flexDirection: compact ? ("column" as const) : ("row" as const) },
      listPane: {
        width: compact ? undefined : 280,
        flex: compact ? 1 : undefined,
        minHeight: 0,
        borderRightWidth: compact ? 0 : 1,
        borderRightColor: colors.border,
        backgroundColor: colors.surface0,
      },
      listHeader: { padding: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
      crumbs: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 2 },
      crumb: { color: colors.accent, fontSize: 12 },
      crumbCurrent: { color: colors.foreground, fontSize: 12, fontWeight: "600" as const },
      crumbSeparator: { color: colors.foregroundMuted, fontSize: 12 },
      headerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      newInput: {
        flex: 1,
        color: colors.foreground,
        fontSize: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 5,
        backgroundColor: colors.surface1,
      },
      entry: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      entryOpen: { backgroundColor: colors.surface2 },
      entryName: { flex: 1, color: colors.foreground, fontSize: 13 },
      entryMeta: { color: colors.foregroundMuted, fontSize: 11 },
      muted: { color: colors.foregroundMuted, fontSize: 12, padding: 12, lineHeight: 17 },
      editorPane: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.surface0 },
      editorHeader: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      editorTitle: { flexShrink: 1, color: colors.foreground, fontSize: 13, fontFamily: MONOSPACE },
      editorStatus: { flex: 1, color: colors.foregroundMuted, fontSize: 11 },
      notices: { paddingHorizontal: 10, paddingTop: 8, gap: 6 },
      editor: {
        flex: 1,
        color: colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 13,
        lineHeight: 19,
        padding: 12,
        textAlignVertical: "top" as const,
        backgroundColor: colors.surface0,
      },
      preview: { padding: 14, paddingBottom: 32 },
      confirm: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
        margin: 10,
        padding: 10,
        borderWidth: 1,
        borderColor: colors.statusWarning,
        borderRadius: 8,
        backgroundColor: colors.surface1,
      },
      confirmText: { flex: 1, minWidth: 160, color: colors.foreground, fontSize: 12 },
    };
  }, [theme, compact]);

  const crumbs = dir === "" ? [] : dir.split("/");

  const listPane = (
    <View style={styles.listPane}>
      <View style={styles.listHeader}>
        <View style={styles.crumbs}>
          <Pressable accessibilityRole="link" onPress={() => setDir("")}>
            <Text style={dir === "" ? styles.crumbCurrent : styles.crumb}>home</Text>
          </Pressable>
          {crumbs.map((part, index) => {
            const path = crumbs.slice(0, index + 1).join("/");
            const current = index === crumbs.length - 1;
            return (
              <View key={path} style={styles.headerRow}>
                <Text style={styles.crumbSeparator}>/</Text>
                <Pressable accessibilityRole="link" disabled={current} onPress={() => setDir(path)}>
                  <Text style={current ? styles.crumbCurrent : styles.crumb}>{part}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <View style={styles.headerRow}>
          {newName === null ? (
            <>
              <IconButton
                icon="FilePlus"
                label="New file"
                showLabel
                theme={theme}
                onPress={() => guarded("create a new file", () => setNewName(""))}
              />
              <IconButton
                icon="RefreshCw"
                label="Refresh the list"
                theme={theme}
                disabled={listing.isFetching}
                onPress={() => void listing.refetch()}
              />
            </>
          ) : (
            <>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="name.md"
                placeholderTextColor={theme.colors.foregroundMuted}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={create}
                style={styles.newInput}
              />
              <IconButton icon="Check" label="Create" tone="accent" theme={theme} onPress={create} />
              <IconButton icon="X" label="Cancel" theme={theme} onPress={() => setNewName(null)} />
            </>
          )}
        </View>
      </View>
      <ScrollView automaticallyAdjustKeyboardInsets>
        {listing.error !== null ? <Text style={styles.muted}>{errorText(listing.error)}</Text> : null}
        {dir === "" ? null : (
          <Pressable style={styles.entry} accessibilityRole="button" onPress={() => setDir(parentOf(dir))}>
            <Icon name="ArrowLeft" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.entryName}>..</Text>
          </Pressable>
        )}
        {(listing.data?.entries ?? []).map((entry: HomeEntry) => (
          <Pressable
            key={entry.path}
            accessibilityRole="button"
            accessibilityLabel={`${entry.kind === "dir" ? "Folder" : "File"} ${entry.name}`}
            style={[styles.entry, open?.path === entry.path ? styles.entryOpen : null]}
            onPress={() =>
              entry.kind === "dir"
                ? setDir(entry.path)
                : guarded(`open ${entry.name}`, () => load(entry.path))
            }
          >
            <Icon
              name={entry.kind === "dir" ? "Folder" : isMarkdown(entry.name) ? "FileText" : "File"}
              size={14}
              color={entry.kind === "dir" ? theme.colors.accent : theme.colors.foregroundMuted}
            />
            <Text style={styles.entryName} numberOfLines={1}>
              {entry.name}
            </Text>
            <Text style={styles.entryMeta}>
              {entry.kind === "dir" ? "" : `${formatSize(entry.size)} · ${relativeTime(new Date(entry.modifiedMs).toISOString())}`}
            </Text>
          </Pressable>
        ))}
        {listing.data !== undefined && listing.data.entries.length === 0 ? (
          <Text style={styles.muted}>This folder is empty.</Text>
        ) : null}
      </ScrollView>
    </View>
  );

  const confirmBar =
    pending === null || open?.kind !== "text" ? null : (
      <View style={styles.confirm}>
        <Text style={styles.confirmText}>
          {open.path} has unsaved changes. Save them before you {pending.label}?
        </Text>
        <IconButton
          icon="Save"
          label="Save"
          showLabel
          tone="accent"
          theme={theme}
          onPress={() => {
            setPending(null);
            save(false, pending);
          }}
        />
        <IconButton
          icon="X"
          label="Discard"
          showLabel
          tone="danger"
          theme={theme}
          onPress={() => {
            const run = pending.run;
            setPending(null);
            setOpen({ ...open, draft: open.saved });
            run();
          }}
        />
        <IconButton icon="Pencil" label="Keep editing" showLabel theme={theme} onPress={() => setPending(null)} />
      </View>
    );

  let editorBody: ReactNode;
  if (loadingPath !== null) {
    editorBody = <Text style={styles.muted}>Opening {loadingPath}…</Text>;
  } else if (open === null) {
    editorBody = (
      <Text style={styles.muted}>
        Pick a file to read or edit it. The first mate reads its charter from AGENTS.md and your standing orders
        from data/captain.md; its backlog, projects and each worker's brief are under data/.
      </Text>
    );
  } else if (open.kind === "unreadable") {
    editorBody = (
      <Text style={styles.muted}>
        {open.reason === "binary"
          ? `${open.path} is not a text file, so it is not shown here.`
          : `${open.path} is ${formatSize(open.size)}, too large to open here.`}
      </Text>
    );
  } else if (preview && isMarkdown(open.path)) {
    editorBody = (
      <ScrollView contentContainerStyle={styles.preview}>
        <Markdown
          source={open.draft}
          theme={theme}
          fontSize={14}
          onOpenLink={(url) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)))}
        />
      </ScrollView>
    );
  } else {
    const file = open;
    editorBody = (
      <TextInput
        key={file.path}
        value={file.draft}
        onChangeText={(text) => setOpen({ ...file, draft: text })}
        multiline
        scrollEnabled
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={`Edit ${file.path}`}
        onKeyPress={
          Platform.OS === "web"
            ? (event: WebKeyPressEvent) => {
                if (!isSaveKey(event.nativeEvent)) return;
                event.preventDefault();
                save(false);
              }
            : undefined
        }
        style={styles.editor}
      />
    );
  }

  const editorPaneView = (
    <View ref={editorPane} style={[styles.editorPane, { paddingBottom: keyboard }]}>
      {open === null && !compact ? null : (
        <View style={styles.editorHeader}>
          {compact ? (
            <IconButton
              icon="ArrowLeft"
              label="Back to the files"
              theme={theme}
              onPress={() => guarded("go back to the files", () => setOpen(null))}
            />
          ) : null}
          {open === null ? null : (
            <>
              <Text style={styles.editorTitle} numberOfLines={1}>
                {open.path}
              </Text>
              <Text style={styles.editorStatus} numberOfLines={1}>
                {open.kind !== "text"
                  ? ""
                  : dirty
                    ? "Unsaved changes"
                    : `Saved · ${relativeTime(new Date(open.modifiedMs).toISOString())}`}
              </Text>
              {open.kind === "text" && isMarkdown(open.path) ? (
                <IconButton
                  icon={preview ? "Pencil" : "Eye"}
                  label={preview ? "Edit" : "Preview"}
                  showLabel
                  theme={theme}
                  onPress={() => setPreview(!preview)}
                />
              ) : null}
              <IconButton
                icon="RefreshCw"
                label="Reload from disk"
                theme={theme}
                disabled={loadingPath !== null}
                onPress={() => guarded("reload it from disk", () => load(open.path))}
              />
              {open.kind === "text" ? (
                <IconButton
                  icon="Save"
                  label={saving ? "Saving…" : "Save"}
                  showLabel
                  tone="accent"
                  theme={theme}
                  disabled={saving || !dirty}
                  onPress={() => save(false)}
                />
              ) : null}
            </>
          )}
        </View>
      )}
      {confirmBar}
      {open === null ? null : (
        <View style={styles.notices}>
          {REWRITTEN.has(open.path) ? (
            <Banner
              theme={theme}
              tone="info"
              text={
                open.path === "AGENTS.md"
                  ? "The plugin writes this file from data/charter.md every time it starts, so edits here last only until then. Change the charter in data/charter.md, and standing orders in data/captain.md."
                  : "FirstMate's own charter, for comparing with yours. Bring what you want into data/charter.md; this file is rewritten by the plugin and removed when you press Done on the board."
              }
            />
          ) : null}
          {changedOnDisk && dirty ? (
            <Banner
              theme={theme}
              tone="warning"
              text="This file changed on disk while you were editing it — the first mate may have written it."
              action={{ label: "Load theirs", icon: "RefreshCw", onPress: () => load(open.path) }}
            />
          ) : null}
          {error === null ? null : (
            <Banner
              theme={theme}
              tone="danger"
              text={error.text}
              {...(error.conflict ? { action: { label: "Overwrite", icon: "Save", onPress: () => save(true) } } : {})}
            />
          )}
        </View>
      )}
      {editorBody}
    </View>
  );

  if (compact) return <View style={styles.root}>{open === null && loadingPath === null ? listPane : editorPaneView}</View>;
  return (
    <View style={styles.root}>
      {listPane}
      {editorPaneView}
    </View>
  );
}

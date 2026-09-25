/**
 * The conversation with the first mate: its transcript, folded to the words,
 * and a composer. The whole session — every tool call and its output — is
 * one press away in Paseo itself, which is what the Open button is for.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

import { askMate, askMateCommand, type AgentSummary, type MateCommand } from "../shared/fleet";
import {
  admit,
  captainMessage,
  formatBytes,
  hasContent,
  pendingAttachments,
  readEach,
  restoreFailed,
  type PendingAttachment,
} from "./attachments";
import { drafts } from "./draft";
import { useFollowEnd } from "./follow-end";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { MateControls } from "./mate-controls";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { transcriptRows, type TranscriptRow } from "./transcript-rows";
import { IconButton, JumpToEnd, MONOSPACE, Spinner, errorText } from "./ui";
import { useKeyboardOverlap } from "./keyboard";
import { useAgentTimeline } from "./use-timeline";
import { canAttachFiles, pickFiles, receiveFiles, type OfferedFile } from "./web";

/** A run of tool calls shows this many before folding the rest behind a count. */
const TOOL_RUN_VISIBLE = 2;

/**
 * The composer's height; longer text scrolls inside it. Fixed rather than
 * grown with the text: on the web renderer a textarea's reported content
 * height is never less than its own height, so a box sized from it can grow
 * but never shrink back.
 */
const INPUT_HEIGHT = 120;
const INPUT_HEIGHT_COMPACT = 80;


type Group = { key: string; row: TranscriptRow } | { key: string; tools: Extract<TranscriptRow, { kind: "tool" }>[] };

/** Consecutive tool rows become one group, so a supervision pass is a line, not a page. */
function groupRows(rows: readonly TranscriptRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.kind === "tool" && last !== undefined && "tools" in last) {
      last.tools.push(row);
    } else if (row.kind === "tool") {
      groups.push({ key: row.key, tools: [row] });
    } else {
      groups.push({ key: row.key, row });
    }
  }
  return groups;
}

export function MateChat({
  mate,
  theme,
  compact,
  onOpen,
  onChanged,
}: {
  mate: AgentSummary;
  theme: PluginTheme;
  compact: boolean;
  /** Opens the first mate in Paseo; absent where the host gives no navigation. */
  onOpen: (() => void) | null;
  /** After a compact or a restart, so the board catches up without waiting for its poll. */
  onChanged: () => void;
}) {
  const ask = useRpc(askMate);
  const askCommand = useRpc(askMateCommand);
  const toast = useToast();
  const timeline = useAgentTimeline(mate.id, `${mate.updatedAt}:${mate.pendingPermissions}`);
  const rows = useMemo(() => transcriptRows(timeline.entries), [timeline.entries]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const follow = useFollowEnd();
  /** What the first mate is waiting on — a question, a permission, a plan. */
  const { pending, respond } = usePendingRequests(mate.id, timeline.agent?.pendingPermissions, follow.pin);

  /**
   * A half-typed message survives the surface unmounting, which it does every
   * time the captain opens a workspace, and the plugin being evaluated afresh
   * after a lost connection — see `./draft`.
   */
  const [draft, setDraftState] = useState(() => drafts.get(mate.id));
  /** What is attached to the draft, kept beside it for the same reasons — see `./attachments`. */
  const [attachments, setAttachmentsState] = useState(() => pendingAttachments.get(mate.id));
  /** A drag carrying files is over the chat. */
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const pane = useRef<View>(null);
  /** The keyboard's cover over this pane; padding it away lifts the composer above the keyboard. */
  const keyboard = useKeyboardOverlap(pane);
  // The transcript shrinks when the keyboard opens; keep its end in view if that is where the captain was.
  useEffect(() => {
    // Not a dependency: `follow` is new every render, and the keyboard opening is the event.
    if (keyboard > 0) follow.keepAtEnd();
  }, [keyboard]);
  const submitOnEnter = Platform.OS === "web" && !compact;
  /** The timeline's snapshot is re-read with every stream event; the board's poll is the fallback. */
  const status = timeline.agent?.status ?? mate.status;
  const usage = timeline.agent?.lastUsage;

  function setDraft(text: string): void {
    drafts.set(mate.id, text);
    setDraftState(text);
  }

  function setAttachments(list: readonly PendingAttachment[]): void {
    pendingAttachments.set(mate.id, list);
    setAttachmentsState(list);
  }

  /**
   * Reads what was picked, pasted or dropped and adds it to the draft's
   * attachments. Nothing past the limits is read at all; a file that cannot be
   * read is reported and the rest still attach. The list is re-read from the
   * store once the bytes are in, and the limits checked again, so two quick
   * drops, or a removal while one is reading, both hold.
   */
  function attach(files: readonly OfferedFile[]): void {
    const first = admit(pendingAttachments.get(mate.id), files);
    first.problems.forEach((problem) => toast.error(problem));
    if (first.accepted.length === 0) return;
    readEach(first.accepted)
      .then(({ read, failures }) => {
        failures.forEach((failure) => toast.error(failure));
        const current = pendingAttachments.get(mate.id);
        const second = admit(current, read);
        second.problems.forEach((problem) => toast.error(problem));
        if (second.accepted.length > 0) setAttachments([...current, ...second.accepted]);
      })
      .catch((caught: unknown) => toast.error(errorText(caught)));
  }

  /** Paste and drop call whichever `attach` the latest render made, so they never hold a stale first mate. */
  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(
    () =>
      receiveFiles(
        pane.current,
        (files) => attachRef.current(files),
        (over) => setDragging(over),
      ),
    [],
  );

  function openPicker(): void {
    pickFiles()
      .then((files) => attach(files))
      .catch((caught: unknown) => toast.error(errorText(caught)));
  }

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      pane: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      transcript: { flex: 1 },
      scroller: { flex: 1 },
      transcriptBody: { padding: compact ? 10 : 14, gap: 10 },
      captain: {
        alignSelf: "flex-end" as const,
        maxWidth: "88%" as const,
        backgroundColor: colors.surface2,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      captainText: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
      mate: { alignSelf: "stretch" as const },
      line: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      lineText: { flex: 1, color: colors.foregroundMuted, fontSize: 11 },
      toolText: { flex: 1, color: colors.foregroundMuted, fontSize: 11, fontFamily: MONOSPACE },
      more: { color: colors.accent, fontSize: 11 },
      error: { color: colors.statusDanger, fontSize: 12 },
      hint: { color: colors.foregroundMuted, fontSize: 12, textAlign: "center" as const, padding: 16 },
      composerFrame: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface0,
      },
      composer: { padding: compact ? 8 : 10, gap: 8 },
      quick: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      dropZone: {
        position: "absolute" as const,
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
        zIndex: 10,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 6,
        borderWidth: 2,
        borderStyle: "dashed" as const,
        borderColor: colors.accent,
        borderRadius: 10,
        backgroundColor: colors.surface1,
      },
      dropText: { color: colors.foreground, fontSize: 13 },
      inputRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 8 },
      inputActions: { gap: 6 },
      input: {
        flex: 1,
        color: colors.foreground,
        fontSize: 14,
        lineHeight: 20,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        height: compact ? INPUT_HEIGHT_COMPACT : INPUT_HEIGHT,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
    };
  }, [theme, compact]);

  /**
   * The draft and its attachments are cleared as the message goes, not when
   * the daemon answers: the box stays editable while it is in flight, and a
   * follow-up typed in that second must not be wiped by the reply. A failed
   * send puts the text back, unless something new has been typed since, and
   * its attachments ahead of any attached since.
   */
  function sendDraft(): void {
    const text = draft;
    const attached = attachments;
    if (!hasContent(text, attached) || sending) return;
    setSending(true);
    follow.pin();
    setDraft("");
    setAttachments([]);
    ask(captainMessage(text, attached))
      .catch((caught: unknown) => {
        toast.error(errorText(caught));
        if (drafts.get(mate.id).trim() === "") setDraft(text);
        setAttachments(restoreFailed(pendingAttachments.get(mate.id), attached));
      })
      .finally(() => setSending(false));
  }

  /** Bearings or Ahoy: the words are the daemon's, from its templates. */
  function sendCommand(command: MateCommand): void {
    if (sending) return;
    setSending(true);
    follow.pin();
    askCommand({ command, args: "" })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setSending(false));
  }

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  function renderGroup(group: Group) {
    if ("tools" in group) {
      const open = openGroups.has(group.key);
      const shown = open ? group.tools : group.tools.slice(-TOOL_RUN_VISIBLE);
      const hidden = group.tools.length - shown.length;
      return (
        <View key={group.key} style={{ gap: 3 }}>
          {hidden > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${hidden} more tool calls`}
              onPress={() => setOpenGroups((current) => new Set([...current, group.key]))}
            >
              <Text style={styles.more}>+ {hidden} more tool calls</Text>
            </Pressable>
          ) : null}
          {shown.map((tool) => (
            <View key={tool.key} style={styles.line}>
              {tool.status === "running" ? (
                <Spinner size={11} color={theme.colors.foregroundMuted} />
              ) : (
                <Icon
                  name={tool.status === "failed" ? "X" : "Wrench"}
                  size={11}
                  color={tool.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted}
                />
              )}
              <Text style={styles.toolText} numberOfLines={1}>
                {tool.text}
              </Text>
            </View>
          ))}
        </View>
      );
    }
    const row = group.row;
    switch (row.kind) {
      case "captain":
        return (
          <View key={row.key} style={styles.captain}>
            <Text selectable style={styles.captainText}>
              {row.text}
            </Text>
          </View>
        );
      case "mate":
        return (
          <View key={row.key} style={styles.mate}>
            <Markdown source={row.text} theme={theme} onOpenLink={openLink} />
          </View>
        );
      case "error":
        return (
          <Text key={row.key} style={styles.error}>
            {row.text}
          </Text>
        );
      default:
        return (
          <View key={row.key} style={styles.line}>
            <Icon name="Bell" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.lineText}>{row.text}</Text>
          </View>
        );
    }
  }

  return (
    <View ref={pane} style={[styles.pane, { paddingBottom: keyboard }]}>
      <View style={styles.transcript}>
        <ScrollView {...follow.scrollProps} style={styles.scroller} contentContainerStyle={styles.transcriptBody}>
          {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
          {groups.length === 0 && pending.length === 0 ? (
            <Text style={styles.hint}>{timeline.loading ? "Loading the conversation…" : "Nothing said yet. Ask below."}</Text>
          ) : (
            groups.map(renderGroup)
          )}
          {pending.map((request) => (
            // A direct child of the transcript, so its layout is in the transcript's coordinates.
            <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
              <PermissionCard
                request={request}
                theme={theme}
                compact={compact}
                onRespond={(response) => respond(request.id, response)}
                onOpenLink={openLink}
              />
            </View>
          ))}
        </ScrollView>
        {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
      </View>
      {/*
        The host pads a surface's top, under its header, but not its bottom, so
        on a phone the composer would sit on the home indicator. React Native's
        own SafeAreaView is the one inset source a plugin can import — the
        safe-area-context library is not among the host's modules. It pads
        only the edges it overlaps, and it replaces any padding in its own
        style, which is why the composer's padding is on the view inside.
        Deprecated in React Native 0.81 but present; the web renderer pads by
        the browser's safe-area insets, which are zero on a desktop.
      */}
      <SafeAreaView style={styles.composerFrame}>
        <View style={styles.composer}>
          <View style={styles.quick}>
            <IconButton
              icon="Compass"
              label="Bearings"
              showLabel
              theme={theme}
              disabled={sending}
              onPress={() => sendCommand("bearings")}
            />
            <IconButton
              icon="Anchor"
              label="Ahoy"
              showLabel
              theme={theme}
              disabled={sending}
              onPress={() => sendCommand("ahoy")}
            />
            {onOpen === null ? null : (
              <IconButton icon="ExternalLink" label="Open in Paseo" showLabel theme={theme} onPress={onOpen} />
            )}
            <MateControls
              theme={theme}
              compact={compact}
              usedTokens={usage?.contextWindowUsedTokens}
              maxTokens={usage?.contextWindowMaxTokens}
              running={status === "running" || status === "initializing"}
              onChanged={onChanged}
            />
          </View>
          {attachments.length === 0 ? null : (
            <View style={styles.chips}>
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  theme={theme}
                  onRemove={() =>
                    setAttachments(pendingAttachments.get(mate.id).filter((kept) => kept.id !== attachment.id))
                  }
                />
              ))}
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={
                submitOnEnter
                  ? "Tell the first mate what you need, captain… (Enter sends, Shift+Enter for a new line)"
                  : "Tell the first mate what you need, captain…"
              }
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              onKeyPress={
                submitOnEnter
                  ? (event: WebKeyPressEvent) => {
                      // Nothing to send, or a send in flight: Enter is left alone, as Paseo leaves it.
                      if (!isSendKey(event.nativeEvent) || sending || !hasContent(draft, attachments)) return;
                      event.preventDefault();
                      sendDraft();
                    }
                  : undefined
              }
              style={styles.input}
            />
            {/* Stacked on the right, so the box keeps its full width: attach above send. */}
            <View style={styles.inputActions}>
              {canAttachFiles ? (
                <IconButton icon="Paperclip" label="Attach files or images" theme={theme} onPress={openPicker} />
              ) : null}
              <IconButton
                icon="Send"
                label="Send"
                tone="accent"
                theme={theme}
                disabled={sending || !hasContent(draft, attachments)}
                onPress={sendDraft}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
      {dragging ? (
        /*
          Over the whole chat, transcript through composer, since the whole
          pane takes the drop; it never takes the pointer itself. The pane's
          last child and raised, because on the web renderer every view is
          positioned and a later sibling — the composer — paints over an
          earlier one; opaque, so the transcript's scrollbar does not show
          through its right edge.
        */
        <View pointerEvents="none" style={styles.dropZone}>
          <Icon name="Paperclip" size={18} color={theme.colors.accent} />
          <Text style={styles.dropText}>Drop to attach</Text>
        </View>
      ) : null}
    </View>
  );
}

/** One attachment waiting to go: a thumbnail for an image, an icon for a file; its name, size and a remove button. */
function AttachmentChip({
  attachment,
  theme,
  onRemove,
}: {
  attachment: PendingAttachment;
  theme: PluginTheme;
  onRemove: () => void;
}) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        maxWidth: 220,
        paddingLeft: 4,
        paddingRight: 2,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      thumb: { width: 28, height: 28, borderRadius: 4, backgroundColor: colors.surface2 },
      icon: {
        width: 28,
        height: 28,
        borderRadius: 4,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: colors.surface2,
      },
      text: { flexShrink: 1 },
      name: { color: colors.foreground, fontSize: 12 },
      size: { color: colors.foregroundMuted, fontSize: 10 },
      remove: { padding: 4 },
    }),
    [colors],
  );
  return (
    <View style={styles.chip}>
      {attachment.kind === "image" ? (
        <Image
          source={{ uri: `data:${attachment.mimeType};base64,${attachment.data}` }}
          style={styles.thumb}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.icon}>
          <Icon name="File" size={14} color={colors.foregroundMuted} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {attachment.fileName}
        </Text>
        <Text style={styles.size}>{formatBytes(attachment.size)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${attachment.fileName}`}
        hitSlop={6}
        style={styles.remove}
        onPress={onRemove}
      >
        <Icon name="X" size={14} color={colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

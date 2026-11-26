import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";

import { topicMessages } from "../shared/fleet";

/** The query key of one topic's filed messages, for whoever has to refetch them after a send. */
export function topicMessagesKey(topicId: string | null) {
  return ["firstmate", "topic", topicId] as const;
}

/**
 * The messages the daemon filed under a backlog item, re-read as often as the fleet is polled and kept
 * drawn while a re-read is on its way. Nothing is asked for a card with no item.
 */
export function useTopicMessages(topicId: string | null, pollSeconds: number) {
  const load = useRpc(topicMessages);
  return useQuery({
    queryKey: topicMessagesKey(topicId),
    queryFn: () => load({ topicId: topicId ?? "" }),
    enabled: topicId !== null,
    refetchInterval: pollSeconds * 1000,
    placeholderData: (previous) => previous,
  });
}

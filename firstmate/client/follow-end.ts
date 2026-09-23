/**
 * A transcript that follows its end while the reader is there, and stays put
 * once they scroll up to read something.
 *
 * Shared by the first mate's chat and the Watch view, which both stream: a
 * reply growing at the end is followed, and a question or permission request
 * arriving at the end is brought into view whole.
 */
import { useRef } from "react";
import type { LayoutChangeEvent, LayoutRectangle, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

/** How close to the end still counts as being there, in points. */
const END_SLACK = 40;

export function useFollowEnd() {
  const scroller = useRef<ScrollView>(null);
  const pinnedToEnd = useRef(true);
  /** The transcript's visible height, to tell whether a card fits in it. */
  const viewport = useRef(0);
  /** Cards already brought into view, so one is scrolled to once, not on every re-layout. */
  const revealed = useRef(new Set<string>());

  /** Follow the end again — the reader just sent something, or answered something. */
  function pin(): void {
    pinnedToEnd.current = true;
  }

  /** Back to the end, now, if that is where the reader was. */
  function keepAtEnd(): void {
    if (pinnedToEnd.current) scroller.current?.scrollToEnd({ animated: false });
  }

  /**
   * Brings a card into view once it has a size. Following the end is not
   * enough: it only happens while the transcript is pinned there, and the card
   * lays out after the content-size change that would have followed it, so the
   * view stopped where the card began. A card that fits is shown whole, with
   * the end of the transcript; one taller than the transcript is shown from
   * its top, where the question is. The layout must be in the transcript's
   * coordinates — the card's wrapper a direct child of the scroll view.
   */
  function reveal(id: string, layout: LayoutRectangle): void {
    if (revealed.current.has(id)) return;
    revealed.current.add(id);
    const fits = layout.height + 16 <= viewport.current;
    pinnedToEnd.current = fits;
    // After this layout pass, so the scroll view's content already includes the card.
    setTimeout(() => {
      if (fits) scroller.current?.scrollToEnd({ animated: true });
      else scroller.current?.scrollTo({ y: Math.max(0, layout.y - 8), animated: true });
    }, 0);
  }

  /** Spread onto the transcript's `ScrollView`. */
  const scrollProps = {
    ref: scroller,
    scrollEventThrottle: 100,
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      pinnedToEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - END_SLACK;
    },
    onContentSizeChange: keepAtEnd,
    onLayout(event: LayoutChangeEvent): void {
      viewport.current = event.nativeEvent.layout.height;
    },
  };

  return { pin, keepAtEnd, reveal, scrollProps };
}

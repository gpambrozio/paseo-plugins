/**
 * How far the on-screen keyboard covers a view, so the view can pad itself
 * clear of it.
 *
 * Paseo moves its own composer with `react-native-keyboard-controller`, which
 * is not among the modules a plugin may import, and a plugin surface is not
 * resized when the keyboard opens — so the chat's composer disappeared under
 * it. React Native's `KeyboardAvoidingView` is importable but measures itself
 * against its parent, which inside the host's screen needs an offset nobody
 * here can know. This measures the view in window coordinates instead, the
 * same space the keyboard's frame is reported in, so the overlap is exact
 * wherever the host puts the surface.
 *
 * The padding sits inside the view, so it does not change the frame being
 * measured; there is no feedback loop. Where the platform resizes the window
 * for the keyboard itself, the overlap measures as zero and nothing is added.
 * No keyboard events fire on the web renderer, where this is a no-op.
 */
import { useEffect, useState, type RefObject } from "react";
import { Keyboard, LayoutAnimation, Platform, type KeyboardEvent, type View } from "react-native";

export function useKeyboardOverlap(target: RefObject<View | null>): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const ios = Platform.OS === "ios";

    /** Moves with the keyboard on iOS, as its own views do; Android just snaps. */
    function animate(event: KeyboardEvent): void {
      if (!ios || !(event.duration > 0)) return;
      LayoutAnimation.configureNext({
        duration: event.duration,
        update: { duration: event.duration, type: LayoutAnimation.Types.keyboard },
      });
    }

    function onChange(event: KeyboardEvent): void {
      const view = target.current;
      if (view === null) return;
      view.measureInWindow((_x, y, _width, height) => {
        const next = Math.max(0, Math.round(y + height - event.endCoordinates.screenY));
        animate(event);
        setOverlap(next);
      });
    }

    function onHide(event: KeyboardEvent): void {
      animate(event);
      setOverlap(0);
    }

    // iOS announces every frame change before it happens, show and hide
    // included; Android only reports after the fact.
    const subscriptions = ios
      ? [Keyboard.addListener("keyboardWillChangeFrame", onChange), Keyboard.addListener("keyboardWillHide", onHide)]
      : [Keyboard.addListener("keyboardDidShow", onChange), Keyboard.addListener("keyboardDidHide", onHide)];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [target]);

  return overlap;
}

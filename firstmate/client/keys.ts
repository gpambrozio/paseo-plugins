import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";

/**
 * What a key press carries on the web renderer. React Native's type has only
 * `key`; the DOM event underneath also says whether Shift was held and whether
 * an input method is mid-composition.
 */
export type WebKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean; keyCode?: number }
>;

/**
 * Enter sends and Shift+Enter starts a new line, the way Paseo's own composer
 * does — and, like it, only on the web renderer with a wide layout, where
 * there is a keyboard. A phone's return key keeps making new lines, and the
 * Send button is the way to send there. A key press during IME composition
 * (keyCode 229 in older browsers) is the input method confirming a word, not
 * a send.
 */
export function isSendKey(event: WebKeyPressEvent["nativeEvent"]): boolean {
  if (event.key !== "Enter" || event.shiftKey === true) return false;
  return event.isComposing !== true && event.keyCode !== 229;
}

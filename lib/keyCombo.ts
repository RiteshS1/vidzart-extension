// Key privacy rule (CLAUDE.md → events.json): only shortcuts that include
// Ctrl, Meta or Alt are ever recorded, for "⌘K"-style badges in the editor.
// Plain typing, including Shift+letter, must never end up in a file.

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  getModifierState(key: string): boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'OS', 'CapsLock', 'Fn']);

/** Returns e.g. "Meta+Shift+K", or null if this key press must not be logged. */
export function shortcutCombo(event: KeyLike): string | null {
  if (event.repeat || MODIFIER_KEYS.has(event.key)) return null;
  // AltGr (Windows/Linux layouts) reports as Ctrl+Alt, but it's how people
  // TYPE characters like @ or € on many keyboards: treat it as typing.
  if (event.getModifierState('AltGraph')) return null;
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return null;

  const parts: string[] = [];
  if (event.metaKey) parts.push('Meta');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(keyName(event));
  return parts.join('+');
}

/**
 * The key's name from its physical position for letters and digits:
 * on macOS, Alt+K produces event.key "˚", but the badge should say "K".
 */
function keyName(event: KeyLike): string {
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1]!;
  const digit = /^Digit(\d)$/.exec(event.code);
  if (digit) return digit[1]!;
  if (event.key === ' ') return 'Space';
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

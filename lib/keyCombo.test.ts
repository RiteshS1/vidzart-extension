import { describe, expect, it } from 'vitest';
import { shortcutCombo, type KeyLike } from './keyCombo';

const key = (init: Partial<KeyLike> & { key: string; code: string }, altGraph = false): KeyLike => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  getModifierState: (k) => k === 'AltGraph' && altGraph,
  ...init,
});

describe('shortcutCombo', () => {
  it('records shortcuts with Ctrl, Meta or Alt', () => {
    expect(shortcutCombo(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBe('Meta+K');
    expect(shortcutCombo(key({ key: 'K', code: 'KeyK', metaKey: true, shiftKey: true }))).toBe('Meta+Shift+K');
    expect(shortcutCombo(key({ key: 'Enter', code: 'Enter', ctrlKey: true }))).toBe('Ctrl+Enter');
    // macOS Alt+K types "˚"; the badge should still say K.
    expect(shortcutCombo(key({ key: '˚', code: 'KeyK', altKey: true }))).toBe('Alt+K');
  });

  it('never records plain typing', () => {
    expect(shortcutCombo(key({ key: 'a', code: 'KeyA' }))).toBeNull();
    expect(shortcutCombo(key({ key: 'A', code: 'KeyA', shiftKey: true }))).toBeNull();
    expect(shortcutCombo(key({ key: 'Enter', code: 'Enter' }))).toBeNull();
    // AltGr+Q types "@" on a German keyboard: that's typing, not a shortcut.
    expect(shortcutCombo(key({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }, true))).toBeNull();
  });

  it('ignores bare modifiers and auto-repeat', () => {
    expect(shortcutCombo(key({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull();
    expect(shortcutCombo(key({ key: 'k', code: 'KeyK', metaKey: true, repeat: true }))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { recordingFileName } from './fileName';

describe('recordingFileName', () => {
  const at = new Date(2026, 9, 11, 9, 5);
  it('slugifies the tab title and appends the date', () => {
    expect(recordingFileName('My App — Dashboard', at)).toBe('my-app-dashboard-2026-10-11-0905');
    expect(recordingFileName('Café Ünïcode', at)).toBe('cafe-unicode-2026-10-11-0905');
  });
  it('falls back to "recording" for titles with nothing usable', () => {
    expect(recordingFileName('日本語', at)).toBe('recording-2026-10-11-0905');
  });
});

/**
 * "My App — Dashboard" recorded at 2026-10-11 09:30 → "my-app-dashboard-2026-10-11-0930".
 * Safe on every OS: only a-z, 0-9 and dashes.
 */
export function recordingFileName(title: string, createdAt: Date): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())}-${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}`;
  return `${slug || 'recording'}-${stamp}`;
}

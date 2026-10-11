// Build-time settings (Vite env; WXT exposes variables prefixed WXT_).
// Set them in a .env file or the shell, e.g.
//   WXT_EDITOR_URL=https://example.com/editor pnpm build
interface ImportMetaEnv {
  /** The Vidzart editor's URL. Default: http://localhost:3000/editor (the app's `pnpm dev`). */
  readonly WXT_EDITOR_URL?: string;
}

import type { MarkdownRendererModule } from './index.js';

export type MdxComponentMapping =
  | { action: 'unwrap' }
  | { action: 'omit' }
  | { action: 'element'; name: string };

export interface MdxRendererOptions {
  components?: Record<string, MdxComponentMapping>;
}

/** Safe synchronous options forwarded to Defuddle's local DOM parser. */
export interface DefuddleRendererOptions {
  removeExactSelectors?: boolean;
  removePartialSelectors?: boolean;
  removeHiddenElements?: boolean;
  removeLowScoring?: boolean;
  removeSmallImages?: boolean;
  removeImages?: boolean;
  standardize?: boolean;
  contentSelector?: string;
  language?: string;
  includeReplies?: boolean | 'extractors';
}

declare const renderer: MarkdownRendererModule;
export default renderer;

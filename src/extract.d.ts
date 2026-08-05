import type { ExtractionDiagnostics, ExtractionOptions } from './index.js';

export { ExtractionDiagnostics, ExtractionOptions };

export interface ExtractedDocument {
  markdown: string;
  diagnostics: ExtractionDiagnostics;
}

export declare const DEFAULT_EXTRACTION: Required<ExtractionOptions>;

export declare function extractHtml(
  html: string,
  options?: ExtractionOptions,
  context?: { baseUrl?: string },
): Promise<ExtractedDocument>;

// @ts-check

/**
 * The Accept contract. One table decides, for every implementation that
 * negotiates (the Astro middleware, the three static edge handlers, and the
 * `doctor --url` probe of a deployment), whether a header selects Markdown.
 *
 * Markdown has to be asked for explicitly and strictly outrank HTML. A wildcard,
 * a tie, a missing header and a malformed one all resolve to HTML, so browsers,
 * curl and crawlers that send a wildcard are unaffected.
 *
 * @type {ReadonlyArray<{ name: string; accept: string | null; markdown: boolean }>}
 */
export const ACCEPT_CONTRACT = Object.freeze([
  { name: 'markdown alone', accept: 'text/markdown', markdown: true },
  { name: 'markdown outranks html by default weight', accept: 'text/markdown, text/html;q=0.5', markdown: true },
  { name: 'markdown outranks html by explicit weights', accept: 'text/markdown;q=0.9, text/html;q=0.8', markdown: true },
  { name: 'an equal default weight is a tie', accept: 'text/markdown, text/html', markdown: false },
  { name: 'an equal explicit weight is a tie', accept: 'text/markdown;q=0.5, text/html;q=0.5', markdown: false },
  { name: 'html outranks markdown', accept: 'text/html, text/markdown;q=0.8', markdown: false },
  { name: 'html with a charset outranks markdown', accept: 'text/html;charset=UTF-8, text/markdown;q=0.8', markdown: false },
  { name: 'a full wildcard is not a request', accept: '*/*', markdown: false },
  { name: 'a text wildcard is not a request', accept: 'text/*', markdown: false },
  { name: 'a weighted wildcard is not a request', accept: '*/*;q=1.0', markdown: false },
  { name: 'a text wildcard outranks weaker markdown', accept: 'text/markdown;q=0.5, text/*;q=0.9', markdown: false },
  { name: 'markdown outranks a weaker text wildcard', accept: 'text/markdown;q=0.9, text/*;q=0.5', markdown: true },
  { name: 'a browser header', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8', markdown: false },
  { name: 'a missing header', accept: null, markdown: false },
  { name: 'an empty header', accept: '', markdown: false },
  { name: 'a header of separators', accept: ';;;', markdown: false },
  { name: 'a malformed markdown weight', accept: 'text/markdown;q=notanumber', markdown: false },
  { name: 'a malformed html weight', accept: 'text/markdown, text/html;q=garbage', markdown: false },
  { name: 'markdown at weight zero is a refusal', accept: 'text/markdown;q=0', markdown: false },
  { name: 'a matching charset parameter', accept: 'text/markdown;charset=UTF-8, text/html;q=0.5', markdown: true },
  { name: 'a different charset parameter', accept: 'text/markdown;charset=iso-8859-1, text/html;q=0.5', markdown: false },
  { name: 'an unknown media parameter', accept: 'text/markdown;level=1, text/html;q=0.5', markdown: false },
  { name: 'a non-matching range beside a matching one', accept: 'text/markdown;charset=iso-8859-1;q=1, text/markdown;q=0.8, text/html;q=0.5', markdown: true },
  { name: 'legacy text/x-markdown alone', accept: 'text/x-markdown', markdown: false },
  { name: 'legacy text/x-markdown beside refused markdown', accept: 'text/x-markdown;q=1, text/markdown;q=0, text/html;q=0.5', markdown: false },
  { name: 'xhtml counts as html', accept: 'text/markdown;q=0.5, application/xhtml+xml;q=0.9', markdown: false },
]);

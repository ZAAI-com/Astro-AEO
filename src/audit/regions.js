// @ts-check
/** Positions refer only to audited bytes, never inferred Astro/MDX source.
 * One-based UTF-16 columns; end columns are exclusive.
 * @param {string} text */
export function regionLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r') { if (text[i+1] === '\n') i++; starts.push(i+1); }
    else if (text[i] === '\n') starts.push(i+1);
  }
  const position = (/** @type {number} */ offset) => {
    let low = 0, high = starts.length;
    while (low + 1 < high) { const mid = Math.floor((low+high)/2); if (starts[mid] <= offset) low = mid; else high = mid; }
    return {line:low+1,column:offset-starts[low]+1};
  };
  /** @param {number} start @param {number} end */
  return (start,end) => {
    const a = position(start), b = position(end);
    return {line:a.line,column:a.column,endLine:b.line,endColumn:b.column};
  };
}
/** Minimal quote-aware source scanner. Comments and raw/RCDATA element content
 * cannot create fake attribute locations. Ambiguous/malformed tags are omitted.
 * @param {string} html */
export function htmlRegions(html) {
  const locate = regionLocator(html);
  /** @type {Array<{tag:string;attrs:Record<string,string>;location:import('../index.js').SourceLocation}>} */
  const tags = [];
  const token = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (let match; (match = token.exec(html));) {
    const tag = match[1]?.toLowerCase();
    if (!tag || match[0].startsWith('</')) continue;
    const attributes = match[0].slice(1 + match[1].length,-1);
    /** @type {Record<string,string>} */
    const attrs = Object.create(null);
    let ambiguous = false;
    for (const attribute of attributes.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g)) {
      const key = attribute[1].toLowerCase();
      if (Object.hasOwn(attrs,key)) { ambiguous = true; break; }
      attrs[key] = decodeAttribute(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    if (!ambiguous) tags.push({tag,attrs,location:locate(match.index,token.lastIndex)});
    if (['script','style','textarea','title','xmp','iframe','noembed','noframes','plaintext'].includes(tag)) {
      if (tag === 'plaintext') break;
      const close = new RegExp('</' + tag + '\\s*>','gi');
      close.lastIndex = token.lastIndex;
      const ending = close.exec(html);
      if (!ending) break;
      token.lastIndex = close.lastIndex;
    }
  }
  return tags;
}
/** Decode common/numeric attribute entities. Unknown named entities do not
 * match DOM facts, so no false region is attached.
 * @param {string} value */
function decodeAttribute(value) {
  const named = /** @type {Record<string,string>} */ ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'});
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(all,key) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? all;
    const code = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2),16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  });
}
/** Preserve offsets while ignoring fenced/inline example markup.
 * @param {string} markdown @param {RegExp} pattern */
export function markdownRegion(markdown,pattern) {
  const mask = (/** @type {string} */ text) => text.replace(/[^\r\n]/g,' ');
  const visible = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm,mask).replace(/`[^`\n]*`/g,mask);
  const match = pattern.exec(visible);
  return match ? regionLocator(markdown)(match.index,match.index+match[0].length) : undefined;
}

// @ts-check

export const MARKDOWN_MIME = 'text/markdown; charset=utf-8';

/** The command declined to touch a file. Nothing was written. Exit status 2. */
export class FixRefusal extends Error {}

/**
 * @typedef {{ status: 'unchanged' | 'changed'; text: string }} FixResult
 */

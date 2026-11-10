// Private visual-editor patches. Never consumed by the public site renderer.
export const CANVAS_DRAFT_LIMIT = 4_000_000;
export function canvasDraftIssue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Invalid website draft.';
  let count = 0;
  function visit(v: unknown, depth: number): boolean {
    if (++count > 50000 || depth > 18) return false;
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1000000;
    if (typeof v === 'string') return v.length <= 3_000_000 && !v.includes('\u0000');
    if (Array.isArray(v)) return v.length <= 1000 && v.every(x => visit(x, depth + 1));
    if (typeof v !== 'object') return false;
    return Object.entries(v).every(([k, x]) => k.length <= 180 && !['__proto__','constructor','prototype'].includes(k) && visit(x, depth + 1));
  }
  if (!visit(value, 0)) return 'This draft contains unsupported or excessive data.';
  if (Object.keys(value).some(k => !/^(\d{1,3}|\$shared|\$sharedContent)$/.test(k))) return 'Invalid website draft fields.';
  if (new TextEncoder().encode(JSON.stringify(value)).length > CANVAS_DRAFT_LIMIT) return 'This draft is too large. Use smaller images.';
  return null;
}

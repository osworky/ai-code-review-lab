export const categories: string[]
export const severities: string[]
export function parseDiffRanges(diffText: string): Map<string, Array<[number, number]>>
export function validateReview(
  text: string,
  options?: { diffRanges?: Map<string, Array<[number, number]>> },
): { ok: boolean; errors: string[]; review?: { schema_version: number; findings: unknown[] } }

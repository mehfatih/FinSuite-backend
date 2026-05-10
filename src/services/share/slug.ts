// ================================================================
// Sprint D-7 — Public-share slug generator.
//
// Decision §6.C: 8-char base64url slug from crypto.randomBytes(6).
// 48 bits → 281 trillion combinations → birthday collision after
// ~16M slugs. We add a unique constraint on the column and retry
// once on collision (extremely rare for V1 volumes).
//
// Zero new deps; uses Node's built-in crypto module.
// ================================================================
import crypto from "crypto";

const MAX_RETRIES = 3;

/** Generate a single fresh 8-character URL-safe slug. */
export function generateSlug(): string {
  // 6 bytes → exactly 8 base64url chars (no padding).
  return crypto.randomBytes(6).toString("base64url");
}

/**
 * Generate a slug, retrying on collision via the caller-provided
 * existence check. Throws after MAX_RETRIES if no unique slug found
 * (signals catastrophic table contention; should never happen at V1
 * volumes).
 */
export async function generateUniqueSlug(
  existsFn: (slug: string) => Promise<boolean>
): Promise<string> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const slug = generateSlug();
    const exists = await existsFn(slug);
    if (!exists) return slug;
  }
  throw new Error("slug_generation_exhausted");
}

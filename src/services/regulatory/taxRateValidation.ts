// ================================================================
// Sprint D-11 — Tax rate version validation.
//
// Used by the admin CRUD (B.7) to enforce: at most one TaxRateVersion
// row covers any given (country, taxName, instant). The DB has no
// exclusion constraint for half-open ranges, so we check at the
// application layer.
//
// Flow: admin posts a new rate with effectiveFrom + effectiveTo.
// validateOverlap loads existing rows for (country, taxName) and
// rejects if the new range overlaps any of them. Admin UI surfaces
// the conflicting row id + dates so the user can see what's in the
// way before resubmitting.
// ================================================================
import { prisma } from "../../config/database";

export interface OverlapCheckArgs {
  country:        string;
  taxName:        string;
  effectiveFrom:  Date;
  effectiveTo:    Date | null;
  /** Set when editing an existing row — that row excludes itself from the check. */
  excludeId?:     string;
}

export interface OverlapResult {
  ok:          boolean;
  reason?:     "overlap" | "from_after_to" | "missing_dates";
  conflict?: {
    id:             string;
    effectiveFrom:  Date;
    effectiveTo:    Date | null;
    rate:           number;
  };
}

/**
 * Two half-open intervals [aFrom, aTo?) and [bFrom, bTo?) overlap iff
 *   aFrom < bTo (or bTo is null) AND bFrom < aTo (or aTo is null).
 * That predicate translates to the Prisma where clause below.
 */
export async function validateNoOverlap(args: OverlapCheckArgs): Promise<OverlapResult> {
  if (!args.effectiveFrom) {
    return { ok: false, reason: "missing_dates" };
  }
  if (args.effectiveTo && args.effectiveTo <= args.effectiveFrom) {
    return { ok: false, reason: "from_after_to" };
  }

  const rows = await prisma.taxRateVersion.findMany({
    where: {
      country: args.country.toUpperCase(),
      taxName: args.taxName,
      ...(args.excludeId ? { id: { not: args.excludeId } } : {})
    },
    orderBy: { effectiveFrom: "asc" },
    select:  { id: true, effectiveFrom: true, effectiveTo: true, rate: true }
  });

  for (const r of rows) {
    const rFrom = r.effectiveFrom;
    const rTo   = r.effectiveTo;
    // r-overlaps-args iff
    //   args.effectiveFrom < rTo (or rTo null)
    //   AND r.effectiveFrom < args.effectiveTo (or args.effectiveTo null)
    const aBeforeRTo = rTo === null ? true : args.effectiveFrom < rTo;
    const rBeforeATo = args.effectiveTo === null ? true : rFrom < args.effectiveTo;
    if (aBeforeRTo && rBeforeATo) {
      return {
        ok:       false,
        reason:   "overlap",
        conflict: {
          id:            r.id,
          effectiveFrom: r.effectiveFrom,
          effectiveTo:   r.effectiveTo,
          rate:          typeof r.rate === "number" ? r.rate : Number(r.rate)
        }
      };
    }
  }
  return { ok: true };
}

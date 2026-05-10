// ================================================================
// Sprint D-11 — Admin tax-rate version CRUD.
//
//   GET    /api/admin/regulatory/tax-rates?country=&taxName=
//          List version timeline. Default scope: all (paged).
//
//   POST   /api/admin/regulatory/tax-rates
//          Create a new version row. validateNoOverlap from B.3
//          rejects creates that overlap an existing range; the
//          response carries the conflicting row id so the admin UI
//          can highlight it.
//
//   PATCH  /api/admin/regulatory/tax-rates/:id
//          Update fields on an existing row (rate, effectiveTo,
//          notes). country + taxName are immutable; admins must
//          delete + recreate to change those.
//
//   DELETE /api/admin/regulatory/tax-rates/:id
//          Hard delete (the row has no FK to invoices — old invoices
//          carry their stamped rate on the row, not via this table).
//
// Every mutation writes to MerchantAuditLog with action=UPDATE,
// resource="tax_rate_version", resourceId=row.id so the change is
// traceable. metadata carries before+after snapshots.
//
// Mounted under /api/admin/regulatory inside routes/admin/index.ts;
// authenticateAdmin runs upstream.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { AdminRequest } from "../../types";
import { validateNoOverlap } from "../../services/regulatory/taxRateValidation";
import { listProfiles, normalizeCountry } from "../../services/regulatory/profiles";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_COUNTRIES = new Set(["TR", "SA"]);

interface UpsertBody {
  country?:       string;
  taxName?:       string;
  rate?:          number;
  effectiveFrom?: string;        // ISO date
  effectiveTo?:   string | null; // ISO date or null
  notes?:         string;
}

function payloadOf(row: any) {
  return {
    id:             row.id,
    country:        row.country,
    taxName:        row.taxName,
    rate:           typeof row.rate === "number" ? row.rate : Number(row.rate),
    effectiveFrom:  row.effectiveFrom,
    effectiveTo:    row.effectiveTo,
    createdBy:      row.createdBy,
    notes:          row.notes,
    createdAt:      row.createdAt,
    updatedAt:      row.updatedAt
  };
}

async function writeAuditLog(args: {
  adminId:    string;
  action:     "CREATE" | "UPDATE" | "DELETE";
  resourceId: string;
  metadata:   Record<string, unknown>;
}): Promise<void> {
  // The audit table is keyed by merchantId; this admin operation isn't
  // merchant-scoped, so we use a synthetic "system" row keyed off the
  // admin's id. metadata.adminId carries the real actor.
  try {
    await prisma.merchantAuditLog.create({
      data: {
        merchantId: "system",
        userId:     args.adminId,
        action:     args.action,
        resource:   "tax_rate_version",
        resourceId: args.resourceId,
        metadata:   { ...args.metadata, adminId: args.adminId } as any,
        success:    true
      }
    });
  } catch (err: any) {
    console.error("[admin/tax-rates] audit log failed:", err?.message || err);
  }
}

export const adminTaxRatesController = {

  // GET /api/admin/regulatory/tax-rates
  list: h(async (req: Request, res: Response): Promise<void> => {
    const country = req.query.country ? String(req.query.country).toUpperCase() : undefined;
    const taxName = req.query.taxName ? String(req.query.taxName) : undefined;

    const rows = await prisma.taxRateVersion.findMany({
      where: {
        ...(country ? { country } : {}),
        ...(taxName ? { taxName } : {})
      },
      orderBy: [{ country: "asc" }, { taxName: "asc" }, { effectiveFrom: "desc" }]
    });

    res.json({
      success: true,
      data: {
        rows:     rows.map(payloadOf),
        // Helpful for the admin UI's empty-state ("there are no
        // versions yet — create one for SA / VAT").
        profiles: listProfiles().map((p) => ({ country: p.code, taxName: p.tax.name, defaultRate: p.tax.defaultRate }))
      }
    });
  }),

  // POST /api/admin/regulatory/tax-rates
  create: h(async (req: Request, res: Response): Promise<void> => {
    const adminId = (req as AdminRequest).admin?.id;
    if (!adminId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const body = (req.body || {}) as UpsertBody;
    const country  = String(body.country || "").toUpperCase();
    const taxName  = String(body.taxName || "").trim();
    const rate     = Number(body.rate);
    const fromIso  = body.effectiveFrom ? new Date(body.effectiveFrom) : null;
    const toIso    = body.effectiveTo   ? new Date(body.effectiveTo)   : null;

    if (!ALLOWED_COUNTRIES.has(country)) {
      res.status(400).json({ success: false, error: `Country ${country} not supported in V1.` }); return;
    }
    if (!taxName) { res.status(400).json({ success: false, error: "taxName required" }); return; }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      res.status(400).json({ success: false, error: "rate must be 0-100" }); return;
    }
    if (!fromIso || Number.isNaN(fromIso.getTime())) {
      res.status(400).json({ success: false, error: "effectiveFrom must be a valid ISO date" }); return;
    }
    if (toIso && Number.isNaN(toIso.getTime())) {
      res.status(400).json({ success: false, error: "effectiveTo must be a valid ISO date" }); return;
    }

    // Overlap guard before insert.
    const overlap = await validateNoOverlap({
      country,
      taxName,
      effectiveFrom: fromIso,
      effectiveTo:   toIso
    });
    if (!overlap.ok) {
      res.status(409).json({
        success: false,
        error:   `Overlap with existing tax rate version (${overlap.reason})`,
        conflict: overlap.conflict
      });
      return;
    }

    const row = await prisma.taxRateVersion.create({
      data: {
        country,
        taxName,
        rate,
        effectiveFrom: fromIso,
        effectiveTo:   toIso,
        createdBy:     adminId,
        notes:         body.notes ? String(body.notes).slice(0, 500) : null
      }
    });

    await writeAuditLog({
      adminId,
      action:     "CREATE",
      resourceId: row.id,
      metadata:   { country, taxName, rate, effectiveFrom: fromIso, effectiveTo: toIso, notes: body.notes }
    });

    res.status(201).json({ success: true, data: payloadOf(row) });
  }),

  // PATCH /api/admin/regulatory/tax-rates/:id
  update: h(async (req: Request, res: Response): Promise<void> => {
    const adminId = (req as AdminRequest).admin?.id;
    if (!adminId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const id = String(req.params.id || "");
    const existing = await prisma.taxRateVersion.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ success: false, error: "Tax rate version not found" }); return; }

    const body = (req.body || {}) as UpsertBody;
    const update: any = {};
    if (body.rate !== undefined) {
      const r = Number(body.rate);
      if (!Number.isFinite(r) || r < 0 || r > 100) {
        res.status(400).json({ success: false, error: "rate must be 0-100" }); return;
      }
      update.rate = r;
    }
    if (body.effectiveFrom !== undefined) {
      const f = new Date(body.effectiveFrom);
      if (Number.isNaN(f.getTime())) { res.status(400).json({ success: false, error: "bad effectiveFrom" }); return; }
      update.effectiveFrom = f;
    }
    if (body.effectiveTo !== undefined) {
      if (body.effectiveTo === null) {
        update.effectiveTo = null;
      } else {
        const t = new Date(body.effectiveTo);
        if (Number.isNaN(t.getTime())) { res.status(400).json({ success: false, error: "bad effectiveTo" }); return; }
        update.effectiveTo = t;
      }
    }
    if (body.notes !== undefined) {
      update.notes = body.notes ? String(body.notes).slice(0, 500) : null;
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ success: false, error: "No valid fields to update." });
      return;
    }

    // Re-check overlap against the new range. excludeId so the row
    // doesn't conflict with itself.
    const overlap = await validateNoOverlap({
      country:        existing.country,
      taxName:        existing.taxName,
      effectiveFrom:  update.effectiveFrom ?? existing.effectiveFrom,
      effectiveTo:    update.effectiveTo  !== undefined ? update.effectiveTo : existing.effectiveTo,
      excludeId:      id
    });
    if (!overlap.ok) {
      res.status(409).json({
        success: false,
        error:   `Overlap with existing tax rate version (${overlap.reason})`,
        conflict: overlap.conflict
      });
      return;
    }

    const row = await prisma.taxRateVersion.update({ where: { id }, data: update });

    await writeAuditLog({
      adminId,
      action:     "UPDATE",
      resourceId: id,
      metadata:   { before: payloadOf(existing), after: payloadOf(row) }
    });

    res.json({ success: true, data: payloadOf(row) });
  }),

  // DELETE /api/admin/regulatory/tax-rates/:id
  remove: h(async (req: Request, res: Response): Promise<void> => {
    const adminId = (req as AdminRequest).admin?.id;
    if (!adminId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const id = String(req.params.id || "");
    const existing = await prisma.taxRateVersion.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ success: false, error: "Tax rate version not found" }); return; }

    await prisma.taxRateVersion.delete({ where: { id } });

    await writeAuditLog({
      adminId,
      action:     "DELETE",
      resourceId: id,
      metadata:   { snapshot: payloadOf(existing) }
    });

    res.json({ success: true, data: { deletedId: id } });
  })
};

// Suppress unused import warning when normalizeCountry isn't referenced.
void normalizeCountry;

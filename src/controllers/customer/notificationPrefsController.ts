// ================================================================
// notificationPrefsController.ts — Sprint D-4.
//   GET   /api/customer/preferences/notifications
//   PATCH /api/customer/preferences/notifications
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_CHANNELS    = ["inapp", "email", "webpush", "mobilepush"] as const;
const ALLOWED_FREQUENCIES = ["instant", "hourly", "daily", "never"]   as const;

const DEFAULTS = {
  inappEnabled:        true,
  emailEnabled:        true,
  webPushEnabled:      false,
  mobilePushEnabled:   false,
  criticalChannels:    ["inapp", "email", "webpush"],
  attentionChannels:   ["inapp", "email"],
  opportunityChannels: ["inapp"],
  shareEventChannels:  ["inapp"],
  digestFrequency:     "instant",
  quietHoursStart:     null as number | null,
  quietHoursEnd:       null as number | null,
  mutedUntil:          null as Date   | null
};

function sanitizeChannels(arr: any): string[] | null {
  if (!Array.isArray(arr)) return null;
  const out = arr
    .map((v) => String(v || "").toLowerCase())
    .filter((v) => (ALLOWED_CHANNELS as readonly string[]).includes(v));
  // dedupe
  return Array.from(new Set(out));
}

export const notificationPrefsController = {
  // GET — returns prefs row OR defaults if no row exists yet.
  get: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const row = await prisma.notificationPreference.findUnique({
        where: { merchantId: userId }
      });
      const prefs = row ? {
        inappEnabled:        row.inappEnabled,
        emailEnabled:        row.emailEnabled,
        webPushEnabled:      row.webPushEnabled,
        mobilePushEnabled:   row.mobilePushEnabled,
        criticalChannels:    row.criticalChannels,
        attentionChannels:   row.attentionChannels,
        opportunityChannels: row.opportunityChannels,
        shareEventChannels:  row.shareEventChannels,
        digestFrequency:     row.digestFrequency,
        quietHoursStart:     row.quietHoursStart,
        quietHoursEnd:       row.quietHoursEnd,
        mutedUntil:          row.mutedUntil
      } : DEFAULTS;

      res.status(200).json({ success: true, data: { preferences: prefs, persisted: Boolean(row) } });
    } catch (err: any) {
      console.error("[notif-prefs/get] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load preferences." });
    }
  }),

  // PATCH — upsert; partial updates allowed.
  patch: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const body  = req.body || {};
      const data: any = {};

      const boolFields = ["inappEnabled", "emailEnabled", "webPushEnabled", "mobilePushEnabled"];
      for (const f of boolFields) if (typeof body[f] === "boolean") data[f] = body[f];

      const channelFields = ["criticalChannels", "attentionChannels", "opportunityChannels", "shareEventChannels"];
      for (const f of channelFields) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          const sane = sanitizeChannels(body[f]);
          if (sane === null) { res.status(400).json({ success: false, error: `${f} must be an array of channel names.` }); return; }
          data[f] = sane;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, "digestFrequency")) {
        const v = String(body.digestFrequency || "").toLowerCase();
        if (!(ALLOWED_FREQUENCIES as readonly string[]).includes(v)) {
          res.status(400).json({ success: false, error: "Invalid digestFrequency." }); return;
        }
        data.digestFrequency = v;
      }

      const intFields = ["quietHoursStart", "quietHoursEnd"];
      for (const f of intFields) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          if (body[f] === null) { data[f] = null; continue; }
          const n = parseInt(String(body[f]), 10);
          if (!Number.isFinite(n) || n < 0 || n > 23) {
            res.status(400).json({ success: false, error: `${f} must be an integer 0-23 or null.` }); return;
          }
          data[f] = n;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, "mutedUntil")) {
        if (body.mutedUntil === null) {
          data.mutedUntil = null;
        } else {
          const d = new Date(body.mutedUntil);
          if (Number.isNaN(d.getTime())) {
            res.status(400).json({ success: false, error: "mutedUntil must be ISO date or null." }); return;
          }
          data.mutedUntil = d;
        }
      }

      const updated = await prisma.notificationPreference.upsert({
        where:  { merchantId: userId },
        update: data,
        create: { merchantId: userId, ...data }
      });
      res.status(200).json({ success: true, data: { preferences: updated, persisted: true } });
    } catch (err: any) {
      console.error("[notif-prefs/patch] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to update preferences." });
    }
  })
};

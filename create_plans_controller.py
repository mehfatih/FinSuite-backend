# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Step 5: Create src/controllers/plansController.ts
# Four endpoints: provision, catalog, upgrade, cancel
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
CONTROLLERS_DIR = ROOT / "src" / "controllers"
TARGET = CONTROLLERS_DIR / "plansController.ts"

print("=" * 70)
print("CREATE src/controllers/plansController.ts")
print("=" * 70)

if not CONTROLLERS_DIR.exists():
    print("[FAIL] Controllers dir not found")
    raise SystemExit(1)

if TARGET.exists():
    print("[WARN] plansController.ts already exists - will be OVERWRITTEN")
    print()

content = '''// ============================================================
// Zyrix FinSuite — Plans Controller
// Stage 8 Phase B — Auto-Provisioning System
//
// Endpoints:
//   POST /api/plans/provision   public, rate-limited
//   GET  /api/plans/catalog     public
//   POST /api/plans/upgrade     authenticated
//   POST /api/plans/cancel      authenticated
//
// Each handler:
//   - Validates input with Zod
//   - Calls the appropriate service
//   - Returns the standard Zyrix response shape:
//       { success: boolean, data?: any, error?: string }
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import {
  PLAN_IDS,
  PLAN_PRICING,
  PLAN_TO_ENUM,
  PLAN_META,
  COUNTRY_CURRENCY,
  getFeatureCodes,
  getPlanPrice,
  getCurrency,
  isPlanId,
  normalizeCountry,
  PlanId,
} from "../config/planCatalog";
import {
  provisionMerchant,
  ProvisioningError,
} from "../services/provisioningService";
import { renderPlanWelcome } from "../services/emailTemplates";

// ----------------------------------------------------------------
// Authenticated request shape (matches the rest of the codebase)
// ----------------------------------------------------------------
interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan?: string;
    language?: string;
    currency?: string;
  };
}

// ----------------------------------------------------------------
// Zod schemas
// ----------------------------------------------------------------

const provisionSchema = z.object({
  planId: z.enum(["eDonusum", "onMuhasebe", "pro"]),
  billing: z.enum(["monthly", "yearly"]),
  country: z.string().min(2).max(2),
  language: z.enum(["TR", "EN", "AR"]).default("TR"),
  name: z.string().trim().min(2).max(100),
  email: z.string().email().toLowerCase(),
  phone: z.string().trim().min(7).max(20),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password is too long")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a digit"),
  businessName: z.string().trim().min(2).max(150).optional(),
});

const upgradeSchema = z.object({
  newPlanId: z.enum(["eDonusum", "onMuhasebe", "pro"]),
  billing: z.enum(["monthly", "yearly"]).optional(),
});

const cancelSchema = z.object({
  reason: z.string().max(100).optional(),
  feedback: z.string().max(2000).optional(),
});

// ----------------------------------------------------------------
// Helper: standardized response builders
// ----------------------------------------------------------------

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// POST /api/plans/provision
// ----------------------------------------------------------------

export async function provisionHandler(req: Request, res: Response) {
  // 1. Parse and validate input
  const parsed = provisionSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return fail(res, 400, firstError.message || "Invalid input");
  }
  const input = parsed.data;

  // 2. Normalize country
  const country = normalizeCountry(input.country);
  if (!country) {
    return fail(res, 422, "Country not supported: " + input.country);
  }

  // 3. Provision the merchant
  try {
    const result = await provisionMerchant({
      planId: input.planId,
      billing: input.billing,
      country: country,
      language: input.language,
      name: input.name,
      email: input.email,
      phone: input.phone,
      password: input.password,
      businessName: input.businessName,
    });

    // 4. Send welcome email (non-blocking)
    //    We render the template here and dispatch through the existing
    //    Resend-backed email service. Failure must not break provisioning.
    try {
      const tpl = renderPlanWelcome({
        to: result.merchant.email,
        name: result.merchant.name,
        language: input.language,
        planId: input.planId,
        planName: PLAN_META[input.planId].name,
        features: result.featuresEnabled,
        loginUrl:
          "https://finsuite.zyrix.co/dashboard?welcome=1&token=" +
          encodeURIComponent(result.token),
      });

      // Lazy import to avoid hard coupling at module load.
      // emailService.ts already initializes Resend with env.resendApiKey.
      const emailService = await import("../services/emailService");
      const sendFn =
        (emailService as any).sendRawEmail ||
        (emailService as any).sendEmail ||
        null;

      if (sendFn) {
        // Fire-and-forget; do not await
        Promise.resolve(
          sendFn({
            to: result.merchant.email,
            subject: tpl.subject,
            html: tpl.html,
          })
        ).catch((emailErr: unknown) => {
          // eslint-disable-next-line no-console
          console.warn("[provisioning] welcome email failed:", emailErr);
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          "[provisioning] emailService has no sendRawEmail/sendEmail export; skipping welcome email"
        );
      }
    } catch (emailRenderErr) {
      // eslint-disable-next-line no-console
      console.warn(
        "[provisioning] welcome email render failed:",
        emailRenderErr
      );
    }

    // 5. Return success
    return ok(res, result, 201);
  } catch (err) {
    if (err instanceof ProvisioningError) {
      switch (err.code) {
        case "DUPLICATE_EMAIL":
        case "DUPLICATE_PHONE":
          return fail(res, 409, err.message);
        case "INVALID_PLAN":
          return fail(res, 422, err.message);
        case "INVALID_COUNTRY":
          return fail(res, 422, err.message);
        default:
          // eslint-disable-next-line no-console
          console.error("[provisioning] DB error:", err.message);
          return fail(res, 500, "Provisioning failed");
      }
    }
    // eslint-disable-next-line no-console
    console.error("[provisioning] unknown error:", err);
    return fail(res, 500, "Provisioning failed");
  }
}

// ----------------------------------------------------------------
// GET /api/plans/catalog
// ----------------------------------------------------------------

export async function catalogHandler(req: Request, res: Response) {
  const rawCountry =
    typeof req.query.country === "string" ? req.query.country : "TR";
  const country = normalizeCountry(rawCountry) || "TR";
  const currency = getCurrency(country);

  const plans = PLAN_IDS.map((planId: PlanId) => {
    const monthly = getPlanPrice(planId, country, "monthly");
    const yearly = getPlanPrice(planId, country, "yearly");
    return {
      id: planId,
      name: PLAN_META[planId].name,
      tagline: PLAN_META[planId].tagline,
      price: { monthly, yearly },
      popular: planId === "pro",
      featuresCount: getFeatureCodes(planId).length,
    };
  });

  return ok(res, {
    country,
    currency,
    plans,
  });
}

// ----------------------------------------------------------------
// POST /api/plans/upgrade
// Authenticated: req.merchant.id is populated by auth middleware
// ----------------------------------------------------------------

export async function upgradeHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) {
    return fail(res, 401, "Not authenticated");
  }

  const parsed = upgradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0].message || "Invalid input");
  }
  const { newPlanId, billing } = parsed.data;

  // Load merchant + active subscription
  const merchant = await prisma.merchant.findUnique({
    where: { id: req.merchant.id },
  });
  if (!merchant) {
    return fail(res, 404, "Merchant not found");
  }

  const country = (merchant as any).country || "TR";
  const newEnum = PLAN_TO_ENUM[newPlanId];
  if (!newEnum) {
    return fail(res, 422, "Invalid plan: " + newPlanId);
  }

  // Find current subscription
  const currentSub = await prisma.subscription.findFirst({
    where: { merchantId: merchant.id, status: "ACTIVE" as any },
    orderBy: { createdAt: "desc" },
  });

  const finalBilling: "monthly" | "yearly" =
    billing ||
    ((currentSub as any)?.interval === "YEARLY" ? "yearly" : "monthly");

  const newPrice = getPlanPrice(newPlanId, country, finalBilling);
  if (newPrice === null) {
    return fail(res, 422, "No pricing for plan in this country");
  }

  const featureCodes = getFeatureCodes(newPlanId);
  const previousPlan = String(merchant.plan);

  // Update merchant + subscription + feature flags atomically
  try {
    await prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id: merchant.id },
        data: { plan: newEnum } as any,
      });

      if (currentSub) {
        await tx.subscription.update({
          where: { id: currentSub.id },
          data: {
            planName: newEnum,
            interval:
              (finalBilling === "yearly" ? "YEARLY" : "MONTHLY") as any,
          } as any,
        });
      }

      // Disable existing flags, then upsert new ones
      await tx.featureFlag.updateMany({
        where: { merchantId: merchant.id },
        data: { isEnabled: false },
      });

      for (const code of featureCodes) {
        await tx.featureFlag.upsert({
          where: {
            merchantId_featureCode: {
              merchantId: merchant.id,
              featureCode: code,
            },
          } as any,
          update: { isEnabled: true },
          create: {
            merchantId: merchant.id,
            featureCode: code,
            isEnabled: true,
          } as any,
        });
      }

      await tx.auditLog.create({
        data: {
          action: "UPGRADE_PLAN",
          targetType: "Merchant",
          targetId: merchant.id,
          details: {
            previousPlan,
            newPlan: newPlanId,
            billing: finalBilling,
          },
        } as any,
      });
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[upgrade] DB error:", err);
    return fail(res, 500, "Upgrade failed");
  }

  return ok(res, {
    previousPlan,
    newPlan: newPlanId,
    billing: finalBilling,
    newFeatures: featureCodes,
  });
}

// ----------------------------------------------------------------
// POST /api/plans/cancel
// ----------------------------------------------------------------

export async function cancelHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) {
    return fail(res, 401, "Not authenticated");
  }

  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0].message || "Invalid input");
  }
  const { reason, feedback } = parsed.data;

  const sub = await prisma.subscription.findFirst({
    where: { merchantId: req.merchant.id, status: "ACTIVE" as any },
    orderBy: { createdAt: "desc" },
  });

  if (!sub) {
    return fail(res, 404, "No active subscription found");
  }

  const cancelledAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: "CANCELLED" as any,
          cancelledAt: cancelledAt,
        } as any,
      });

      await tx.auditLog.create({
        data: {
          action: "CANCEL_SUBSCRIPTION",
          targetType: "Subscription",
          targetId: sub.id,
          details: {
            reason: reason || null,
            feedback: feedback || null,
            cancelledAt: cancelledAt.toISOString(),
          },
        } as any,
      });
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[cancel] DB error:", err);
    return fail(res, 500, "Cancellation failed");
  }

  const accessUntil = (sub as any).currentPeriodEnd ?? cancelledAt;

  return ok(res, {
    subscription: {
      status: "CANCELLED",
      cancelledAt: cancelledAt.toISOString(),
      currentPeriodEnd: accessUntil,
      accessUntil: accessUntil,
    },
    message: "Subscription cancelled. Access remains until period end.",
  });
}
'''

TARGET.write_text(content, encoding="utf-8")

print("[OK] File written: " + str(TARGET))
print("     Size: " + str(TARGET.stat().st_size) + " bytes")
print()

# Verification
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
written = TARGET.read_text(encoding="utf-8")
checks = [
    ("provisionHandler export",  "export async function provisionHandler" in written),
    ("catalogHandler export",    "export async function catalogHandler" in written),
    ("upgradeHandler export",    "export async function upgradeHandler" in written),
    ("cancelHandler export",     "export async function cancelHandler" in written),
    ("Zod provision schema",     "const provisionSchema = z.object" in written),
    ("Zod upgrade schema",       "const upgradeSchema = z.object" in written),
    ("Zod cancel schema",        "const cancelSchema = z.object" in written),
    ("imports planCatalog",      "from \"../config/planCatalog\"" in written),
    ("imports provisioning svc", "from \"../services/provisioningService\"" in written),
    ("imports email templates",  "from \"../services/emailTemplates\"" in written),
    ("password validation",      'Password must be at least 8 characters' in written),
    ("409 on duplicate",         "return fail(res, 409" in written),
    ("422 on invalid",           "return fail(res, 422" in written),
    ("201 on success",           "return ok(res, result, 201)" in written),
]
for label, ok_check in checks:
    print("     " + label.ljust(28) + " -> " + ("OK" if ok_check else "MISSING"))
print()

print("=" * 70)
print("[DONE] plansController.ts created. Send output to Claude.")
print("=" * 70)
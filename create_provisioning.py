# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Step 3: Create src/services/provisioningService.ts
# Tenant creation logic — transactional merchant + subscription + flags
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SERVICES_DIR = ROOT / "src" / "services"
TARGET = SERVICES_DIR / "provisioningService.ts"

print("=" * 70)
print("CREATE src/services/provisioningService.ts")
print("=" * 70)

if not SERVICES_DIR.exists():
    print("[FAIL] Services dir not found: " + str(SERVICES_DIR))
    raise SystemExit(1)

print("[OK] Services dir exists: " + str(SERVICES_DIR))
print()
print("Existing files in src/services/:")
for f in sorted(SERVICES_DIR.iterdir()):
    print("     - " + f.name + " (" + str(f.stat().st_size) + " bytes)")
print()

if TARGET.exists():
    print("[WARN] provisioningService.ts already exists")
    print("       Will be OVERWRITTEN.")
    print()

content = '''// ============================================================
// Zyrix FinSuite — Provisioning Service
// Stage 8 Phase B — Auto-Provisioning System
//
// Responsibility:
//   Given validated signup input, create the merchant tenant and
//   activate the chosen plan in a single atomic transaction:
//     1. Hash password
//     2. Open DB transaction
//     3. Create Merchant (status=ACTIVE, plan=mapped enum)
//     4. Create Subscription (period dates from billing interval)
//     5. Create FeatureFlag rows (one per feature code)
//     6. Write AuditLog entry
//     7. Commit transaction
//     8. Sign JWT (caller is responsible for sending welcome email)
//     9. Return full payload
//
// On any failure inside the transaction, the entire write is rolled
// back. No half-created accounts are ever persisted.
// ============================================================

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { env } from "../config/env";
import {
  PlanId,
  PLAN_TO_ENUM,
  getFeatureCodes,
  getPlanPrice,
  getCurrency,
} from "../config/planCatalog";

// ----------------------------------------------------------------
// Public input/output types
// ----------------------------------------------------------------

export type ProvisionInput = {
  planId: PlanId;
  billing: "monthly" | "yearly";
  country: string;          // ISO 2-letter, already normalized upstream
  language: "TR" | "EN" | "AR";
  name: string;
  email: string;
  phone: string;
  password: string;         // raw — will be hashed here
  businessName?: string;
};

export type ProvisionResult = {
  merchant: {
    id: string;
    name: string;
    email: string;
    merchantId: string;
    plan: string;
    language: string;
    currency: string;
    status: string;
    trialEndsAt: Date | null;
    businessName: string | null;
  };
  subscription: {
    id: string;
    planName: string;
    amount: string;
    currency: string;
    interval: string;
    status: string;
    currentPeriodEnd: Date;
  };
  featuresEnabled: string[];
  token: string;
  redirectTo: string;
};

// ----------------------------------------------------------------
// Custom error class — controllers can map this to HTTP responses
// ----------------------------------------------------------------

export class ProvisioningError extends Error {
  constructor(
    public code:
      | "DUPLICATE_EMAIL"
      | "DUPLICATE_PHONE"
      | "INVALID_PLAN"
      | "INVALID_COUNTRY"
      | "DB_ERROR"
      | "UNKNOWN",
    message: string
  ) {
    super(message);
    this.name = "ProvisioningError";
  }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function generatePublicMerchantId(): string {
  // Format: ZRX-FIN-<5 random digits>
  // Collision risk is acceptable at our scale; uniqueness is not enforced
  // by DB constraint on this field — it is for display only.
  const n = Math.floor(10000 + Math.random() * 90000);
  return "ZRX-FIN-" + n;
}

function computePeriodEnd(start: Date, billing: "monthly" | "yearly"): Date {
  const end = new Date(start);
  if (billing === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

function signMerchantJwt(payload: {
  id: string;
  email: string;
  plan: string;
  language: string;
  currency: string;
}): string {
  // Cast to any to bypass jsonwebtoken type quirks present in this codebase
  return (jwt.sign as any)(
    payload,
    env.jwtSecret,
    { expiresIn: "7d" }
  );
}

// ----------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------

export async function provisionMerchant(
  input: ProvisionInput
): Promise<ProvisionResult> {
  const country = input.country.toUpperCase();

  // 1. Validate plan + price availability
  const enumValue = PLAN_TO_ENUM[input.planId];
  if (!enumValue) {
    throw new ProvisioningError("INVALID_PLAN", "Unknown plan: " + input.planId);
  }

  const price = getPlanPrice(input.planId, country, input.billing);
  if (price === null) {
    throw new ProvisioningError(
      "INVALID_PLAN",
      "No pricing for plan " + input.planId + " in country " + country
    );
  }

  const currency = getCurrency(country);
  const featureCodes = getFeatureCodes(input.planId);

  // 2. Pre-check duplicates (returns friendlier errors than relying
  //    solely on DB unique-constraint failure)
  const existingByEmail = await prisma.merchant.findUnique({
    where: { email: input.email.toLowerCase() },
    select: { id: true },
  });
  if (existingByEmail) {
    throw new ProvisioningError(
      "DUPLICATE_EMAIL",
      "An account with this email already exists"
    );
  }

  const existingByPhone = await prisma.merchant.findFirst({
    where: { phone: input.phone },
    select: { id: true },
  });
  if (existingByPhone) {
    throw new ProvisioningError(
      "DUPLICATE_PHONE",
      "An account with this phone already exists"
    );
  }

  // 3. Hash password
  const passwordHash = await bcrypt.hash(input.password, 12);

  // 4. Compute period dates
  const now = new Date();
  const periodStart = now;
  const periodEnd = computePeriodEnd(now, input.billing);

  // 5. Public-facing merchant id
  const publicMerchantId = generatePublicMerchantId();

  // 6. Open transaction and write all rows atomically
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Create the merchant
      const merchant = await tx.merchant.create({
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          phone: input.phone,
          password: passwordHash,
          merchantId: publicMerchantId,
          businessName: input.businessName ?? null,
          plan: enumValue,
          language: input.language,
          currency: currency,
          status: "ACTIVE" as any,
          trialEndsAt: null,
          country: country,
        } as any,
      });

      // Create the subscription
      const subscription = await tx.subscription.create({
        data: {
          merchantId: merchant.id,
          planName: enumValue,
          amount: new Prisma.Decimal(price),
          currency: currency,
          interval: (input.billing === "yearly" ? "YEARLY" : "MONTHLY") as any,
          status: "ACTIVE" as any,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        } as any,
      });

      // Create feature flags — one row per feature code
      // We use createMany for performance; skipDuplicates protects against
      // any unexpected re-runs of this function for the same merchant.
      await tx.featureFlag.createMany({
        data: featureCodes.map((code) => ({
          merchantId: merchant.id,
          featureCode: code,
          isEnabled: true,
        })) as any,
        skipDuplicates: true,
      });

      // Audit log entry
      await tx.auditLog.create({
        data: {
          action: "PROVISION_PLAN",
          targetType: "Merchant",
          targetId: merchant.id,
          details: {
            planId: input.planId,
            billing: input.billing,
            country: country,
            source: "self-serve",
            amount: price,
            currency: currency,
          },
        } as any,
      });

      return { merchant, subscription };
    });
  } catch (err) {
    // Map Prisma unique-violation to a friendlier error
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const fields = (err.meta?.target as string[] | undefined) || [];
      if (fields.includes("email")) {
        throw new ProvisioningError(
          "DUPLICATE_EMAIL",
          "An account with this email already exists"
        );
      }
      if (fields.includes("phone")) {
        throw new ProvisioningError(
          "DUPLICATE_PHONE",
          "An account with this phone already exists"
        );
      }
    }
    // Re-throw any other DB error as a generic provisioning failure
    const message =
      err instanceof Error ? err.message : "Unknown DB error";
    throw new ProvisioningError("DB_ERROR", message);
  }

  const { merchant, subscription } = result;

  // 7. Sign JWT
  const token = signMerchantJwt({
    id: merchant.id,
    email: merchant.email,
    plan: String(merchant.plan),
    language: merchant.language,
    currency: merchant.currency,
  });

  // 8. Build response
  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      merchantId: merchant.merchantId,
      plan: String(merchant.plan),
      language: merchant.language,
      currency: merchant.currency,
      status: String((merchant as any).status ?? "ACTIVE"),
      trialEndsAt: (merchant as any).trialEndsAt ?? null,
      businessName: (merchant as any).businessName ?? null,
    },
    subscription: {
      id: subscription.id,
      planName: String(subscription.planName),
      amount: subscription.amount.toString(),
      currency: subscription.currency,
      interval: String((subscription as any).interval),
      status: String((subscription as any).status),
      currentPeriodEnd: (subscription as any).currentPeriodEnd,
    },
    featuresEnabled: featureCodes,
    token,
    redirectTo: "/dashboard?welcome=1",
  };
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
    ("provisionMerchant export",   "export async function provisionMerchant" in written),
    ("ProvisioningError class",    "export class ProvisioningError" in written),
    ("ProvisionInput type",        "export type ProvisionInput" in written),
    ("ProvisionResult type",       "export type ProvisionResult" in written),
    ("imports planCatalog",        "from \"../config/planCatalog\"" in written),
    ("imports prisma",             "from \"../config/database\"" in written),
    ("imports env",                "from \"../config/env\"" in written),
    ("uses bcrypt cost 12",        "bcrypt.hash(input.password, 12)" in written),
    ("uses $transaction",          "prisma.$transaction" in written),
    ("creates merchant",           "tx.merchant.create" in written),
    ("creates subscription",       "tx.subscription.create" in written),
    ("creates feature flags",      "tx.featureFlag.createMany" in written),
    ("writes audit log",           "tx.auditLog.create" in written),
    ("signs JWT 7 days",           '"7d"' in written),
    ("handles P2002 duplicate",    '"P2002"' in written),
]
for label, ok in checks:
    print("     " + label.ljust(28) + " -> " + ("OK" if ok else "MISSING"))
print()

print("=" * 70)
print("[DONE] provisioningService.ts created. Send output to Claude.")
print("=" * 70)
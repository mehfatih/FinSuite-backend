// ================================================================
// Phase 14 — Super admin seed.
// Run: npx tsx prisma/seeds/superAdmin.ts
// Creates 3 SUPER_ADMIN accounts with bcrypt-hashed Levana2025
// password and mustChangePassword=true.
// ================================================================
import { PrismaClient, AdminRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// All 98 permissions — SUPER_ADMIN gets every one. Frontend permission
// checks short-circuit on role===SUPER_ADMIN so the array is also a
// useful source of truth for Phase 14's frontend.
const ALL_PERMISSIONS = [
  // Customer Management (7)
  "customer.view", "customer.edit", "customer.delete", "customer.archive",
  "customer.restore", "customer.impersonate", "customer.bulk",

  // Subscription (5)
  "subscription.view", "subscription.edit", "subscription.cancel",
  "subscription.refund", "subscription.discount",

  // Plans (3)
  "plan.view", "plan.edit", "plan.create",

  // Coupons (4)
  "coupon.view", "coupon.create", "coupon.edit", "coupon.delete",

  // Revenue (5)
  "revenue.view", "revenue.export", "revenue.forecast", "invoice.create",
  "dunning.configure",

  // Support (6)
  "support.view", "support.respond", "support.assign", "support.escalate",
  "macro.manage", "kb.edit",

  // Communications (5)
  "campaign.view", "campaign.create", "campaign.send", "announcement.create",
  "nps.manage",

  // Analytics (8)
  "analytics.view", "analytics.export", "analytics.funnel", "analytics.replay",
  "analytics.heatmap", "report.create", "report.schedule", "dashboard.create",

  // Compliance (8)
  "compliance.view", "compliance.respond", "kvkk.respond", "gdpr.respond",
  "audit.view", "audit.export", "retention.configure", "subprocessor.manage",

  // System (12)
  "system.view", "system.configure", "system.maintenance", "system.backup",
  "system.deploy", "db.console", "cache.manage", "jobs.manage",
  "alerts.manage", "errors.view", "feature_flag.manage", "security.scan",

  // Marketing (8)
  "marketing.view", "marketing.edit", "review.moderate", "lead.manage",
  "blog.publish", "seo.edit", "affiliate.manage", "social.schedule",

  // Mali Müşavir (5)
  "musavir.view", "musavir.edit", "musavir.onboard", "commission.manage",
  "training.publish",

  // Admin Management (5)
  "admin.view", "admin.create", "admin.edit", "admin.delete", "admin.role.assign",

  // Audit (3)
  "audit.review", "audit.purge", "audit.severity.escalate",

  // Webinars (4)
  "webinar.create", "webinar.host", "webinar.delete", "status.publish",

  // Misc (10)
  "settings.view", "settings.edit", "tag.manage", "note.write",
  "tier.override", "trial.extend", "merge.accounts", "risk.review",
  "coupon.bulk", "data.export.bulk",
];

const ADMINS = [
  { email: "meh.fatih77@gmail.com",      fullName: "Mehmet Fatih" },
  { email: "admin@finsuite.zyrix.co",    fullName: "Mehmet Fatih" },
  { email: "adminfinsuite@zyrix.co",     fullName: "Mehmet Fatih" },
];

async function seed() {
  const password = "Levana2025";
  const passwordHash = await bcrypt.hash(password, 12);

  console.log(`Seeding ${ADMINS.length} super admin accounts...\n`);
  console.log(`Total permissions granted per account: ${ALL_PERMISSIONS.length}\n`);

  for (const a of ADMINS) {
    await prisma.adminUser.upsert({
      where: { email: a.email },
      update: {
        passwordHash,
        fullName: a.fullName,
        role: AdminRole.SUPER_ADMIN,
        permissions: ALL_PERMISSIONS,
        isActive: true,
        mustChangePassword: true,
        twoFactorEnabled: false,
        failedLoginAttempts: 0,
      },
      create: {
        email: a.email,
        passwordHash,
        fullName: a.fullName,
        role: AdminRole.SUPER_ADMIN,
        permissions: ALL_PERMISSIONS,
        isActive: true,
        mustChangePassword: true,
      },
    });
    console.log(`  ✓ ${a.email}`);
  }

  console.log("\n✅ Super admins seeded.");
  console.log("Login credentials:");
  console.log(`  Password (all 3 accounts): ${password}`);
  console.log("  ⚠ Must change password on first login");
  console.log("  ⚠ Must enrol 2FA on first login\n");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

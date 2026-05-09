// ================================================================
// Cleanup script — removes every record created by testMerchants.ts.
// Run: npm run cleanup:test-merchants
//
// Marker convention: any Merchant whose email begins with "test+".
// All child relations (invoices, customers, bank_*, expenses, tax_events,
// etc.) cascade on Merchant delete, so a single deleteMany suffices.
// ================================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targets = await prisma.merchant.findMany({
    where:  { email: { startsWith: "test+" } },
    select: { id: true, email: true, name: true },
  });

  if (targets.length === 0) {
    console.log("No test merchants found — nothing to clean up.");
    return;
  }

  console.log(`Removing ${targets.length} test merchant(s) (cascade clears all children):`);
  for (const m of targets) {
    console.log(`  · ${m.email}  (${m.name})`);
  }

  const result = await prisma.merchant.deleteMany({
    where: { email: { startsWith: "test+" } },
  });

  console.log(`\n✅ Removed ${result.count} merchant(s) and all cascaded rows.`);
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

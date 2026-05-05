# ============================================================
# Fix provisioningService.ts to match real schema:
#   - password         -> passwordHash
#   - featureCode      -> feature
#   - Remove AuditLog  (adminId is required, not available in self-serve)
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
TARGET = ROOT / "src" / "services" / "provisioningService.ts"

print("=" * 70)
print("FIX provisioningService.ts to match schema")
print("=" * 70)

text = TARGET.read_text(encoding="utf-8")
original = text

# ---- Fix 1: password -> passwordHash on the merchant create ----
old1 = "          password: passwordHash,"
new1 = "          passwordHash: passwordHash,"
ok1 = old1 in text
if ok1:
    text = text.replace(old1, new1, 1)
    print("[OK] Fix 1: merchant.password -> passwordHash")
else:
    print("[FAIL] Fix 1 anchor not found")

# ---- Fix 2: featureCode -> feature in createMany ----
old2 = """          merchantId: merchant.id,
          featureCode: code,
          isEnabled: true,
        })) as any,"""
new2 = """          merchantId: merchant.id,
          feature: code,
          isEnabled: true,
        })) as any,"""
ok2 = old2 in text
if ok2:
    text = text.replace(old2, new2, 1)
    print("[OK] Fix 2: featureFlag.featureCode -> feature")
else:
    print("[FAIL] Fix 2 anchor not found")

# ---- Fix 3: Remove the AuditLog block from the transaction ----
audit_block = """      // Audit log entry
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

"""
audit_replacement = """      // NOTE: AuditLog is intentionally omitted here.
      // The schema requires AuditLog.adminId, which is not available
      // during self-serve provisioning. Self-serve activations are
      // already traceable via Merchant.createdAt + Subscription rows.

"""
ok3 = audit_block in text
if ok3:
    text = text.replace(audit_block, audit_replacement, 1)
    print("[OK] Fix 3: Removed AuditLog from provisioning transaction")
else:
    print("[FAIL] Fix 3 anchor not found")

if not (ok1 and ok2 and ok3):
    print()
    print("[ABORT] One or more fixes failed. No file written.")
    raise SystemExit(1)

# Write
TARGET.write_text(text, encoding="utf-8")
print()
print("[OK] File written: " + str(TARGET))
print("     Size: " + str(TARGET.stat().st_size) + " bytes")
print()

# ---- Verification ----
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
written = TARGET.read_text(encoding="utf-8")
print("     'passwordHash:' on create:        " + str("passwordHash: passwordHash" in written))
print("     'password: passwordHash' gone:    " + str("password: passwordHash," not in written))
print("     'feature: code' present:          " + str("feature: code," in written))
print("     'featureCode: code' gone:         " + str("featureCode: code," not in written))
print("     'tx.auditLog.create' gone:        " + str("tx.auditLog.create" not in written))
print("     AuditLog comment present:         " + str("AuditLog is intentionally omitted" in written))
print()
print("=" * 70)
print("[DONE] Send output to Claude.")
print("=" * 70)
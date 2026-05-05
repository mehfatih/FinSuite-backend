# ============================================================
# Standalone test of eIrsaliyeXmlService (no DB, no HTTP)
# Validates that buildEIrsaliyeXml produces well-formed UBL-TR
# ============================================================

import subprocess

ROOT = r"D:\Zyrix Hub\zyrix-finsuite-backend"

test_ts = r"""
import { buildEIrsaliyeXml, computeTotals } from "./src/services/eIrsaliyeXmlService";

const xml = buildEIrsaliyeXml({
  irsaliyeNo: "ZRX2026000000001",
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  issueDate: new Date("2026-05-05T10:00:00Z"),
  sender: {
    vkn: "1234567890",
    title: "Zyrix Test Ltd",
    address: "Atasehir Mah. Test Cad. No:1",
    city: "Istanbul",
    country: "Turkiye",
    taxOffice: "Atasehir",
  },
  receiver: {
    vkn: "9876543210",
    title: "Acme Corp",
    address: "Levent Mah.",
    city: "Istanbul",
  },
  delivery: {
    address: "Kadikoy Depo",
    deliveryDate: new Date("2026-05-06"),
    vehiclePlate: "34 ABC 123",
    driverName: "Ahmet Yilmaz",
    driverTcKimlik: "12345678901",
  },
  items: [
    {
      productCode: "SKU-001",
      description: "Test urunu A",
      quantity: 5,
      unitCode: "C62",
      unitPrice: 100,
      vatRate: 0.18,
    },
    {
      description: "Test urunu B (no price)",
      quantity: 2,
    },
  ],
  notes: "Bu bir test irsaliyesidir.",
});

console.log("===== XML OUTPUT =====");
console.log(xml);
console.log("===== END =====");
console.log();

const totals = computeTotals([
  { description: "A", quantity: 5, unitPrice: 100, vatRate: 0.18 },
  { description: "B", quantity: 2 },
]);
console.log("Totals:", JSON.stringify(totals));

// Validations
console.log();
console.log("===== VALIDATIONS =====");
console.log("starts with <?xml:               " + xml.startsWith("<?xml"));
console.log("contains DespatchAdvice:         " + xml.includes("<DespatchAdvice"));
console.log("contains ProfileID TEMELIRSALIYE:" + xml.includes("TEMELIRSALIYE"));
console.log("contains sender VKN:             " + xml.includes("1234567890"));
console.log("contains receiver title:         " + xml.includes("Acme Corp"));
console.log("contains license plate:          " + xml.includes("34 ABC 123"));
console.log("contains driver TC kimlik:       " + xml.includes("12345678901"));
console.log("contains 2 DespatchLine:         " + (xml.match(/<cac:DespatchLine>/g) || []).length);
console.log("ends with </DespatchAdvice>:     " + xml.trim().endsWith("</DespatchAdvice>"));
"""

import os
test_file = os.path.join(ROOT, "_xml_test.ts")
with open(test_file, "w", encoding="utf-8") as f:
    f.write(test_ts)

print("Test file written:", test_file)
print()
print("Running tsx...")
print("=" * 70)

# Run tsx
result = subprocess.run(
    ["npx", "tsx", test_file],
    cwd=ROOT,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
    shell=True,
)

print("STDOUT:")
print(result.stdout)
if result.stderr:
    print("STDERR:")
    print(result.stderr)
print()
print("Exit code:", result.returncode)

# Cleanup
try:
    os.remove(test_file)
    print("[OK] Test file cleaned up")
except Exception as e:
    print("[WARN] Could not delete test file: " + str(e))

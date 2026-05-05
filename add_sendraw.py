# ============================================================
# Add sendRawEmail() helper to emailService.ts
# Update FROM address to hello@zyrix.co
# ============================================================

from pathlib import Path
import shutil

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
TARGET = ROOT / "src" / "services" / "emailService.ts"
BACKUP = ROOT / "src" / "services" / "emailService.ts.backup-stage-8B"

print("=" * 70)
print("ADD sendRawEmail() + update FROM address")
print("=" * 70)

shutil.copy2(TARGET, BACKUP)
print("[OK] Backup: " + BACKUP.name)
print()

text = TARGET.read_text(encoding="utf-8")
original = text

# ---- Find the FROM constant and inspect ----
import re
from_match = re.search(r'const\s+FROM\s*=\s*["\']([^"\']+)["\']', text)
if from_match:
    current_from = from_match.group(1)
    print("Current FROM: " + current_from)
    if "noreply@zyrix.co" in current_from:
        new_from_value = current_from.replace("noreply@zyrix.co", "hello@zyrix.co")
        text = text.replace(
            'const FROM = "' + current_from + '"',
            'const FROM = "' + new_from_value + '"',
            1
        )
        # Also try single quotes variant
        text = text.replace(
            "const FROM = '" + current_from + "'",
            "const FROM = '" + new_from_value + "'",
            1
        )
        print("[OK] FROM updated to: " + new_from_value)
    else:
        print("[INFO] FROM does not contain noreply@zyrix.co; leaving as-is")
else:
    print("[INFO] No 'const FROM = ...' pattern detected")
print()

# ---- Add sendRawEmail at the end of the file ----
if "export async function sendRawEmail" not in text:
    appendix = '''

// ============================================================
// Stage 8 Phase B: generic raw-HTML send
// Used by the auto-provisioning flow to dispatch trilingual
// welcome emails rendered in src/services/emailTemplates.ts
// ============================================================
export async function sendRawEmail(opts: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  const result = await resend.emails.send({
    from: opts.from || FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  return result;
}
'''
    text = text.rstrip() + appendix + "\n"
    print("[OK] Appended sendRawEmail() export")
else:
    print("[OK] sendRawEmail already exists - no changes")

if text != original:
    TARGET.write_text(text, encoding="utf-8")
    print("[OK] File written")
    print("     New size: " + str(TARGET.stat().st_size) + " bytes")
else:
    print("[INFO] No changes")
print()

# ---- Verification ----
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
final = TARGET.read_text(encoding="utf-8")
print("     sendRawEmail export:    " + str("export async function sendRawEmail" in final))
print("     hello@zyrix.co present: " + str("hello@zyrix.co" in final))
print()

# ---- Find current FROM line ----
match2 = re.search(r'const\s+FROM\s*=\s*["\']([^"\']+)["\']', final)
if match2:
    print("     Final FROM: " + match2.group(1))
print()
print("=" * 70)

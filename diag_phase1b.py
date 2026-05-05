from pathlib import Path
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SCHEMA = ROOT / "prisma" / "schema.prisma"
ENV = ROOT / ".env"
ENV_TS = ROOT / "src" / "config" / "env.ts"

print("=" * 70)
print("DIAGNOSTIC: Phase 1B (WhatsApp + Banks)")
print("=" * 70)

# ---- 1. .env keys ----
print()
print("[1] .env file - relevant keys")
print("-" * 70)
if ENV.exists():
    text = ENV.read_text(encoding="utf-8")
    for line in text.splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key = line.split("=")[0].strip()
            up = key.upper()
            if any(t in up for t in ["WHATSAPP", "WA_", "META", "FACEBOOK", "BANK", "GARANTI", "AKBANK", "ZIRAAT", "BKM"]):
                print("  " + key)
else:
    print("  [.env not found]")

# ---- 2. env.ts shape ----
print()
print("[2] src/config/env.ts current keys")
print("-" * 70)
if ENV_TS.exists():
    text = ENV_TS.read_text(encoding="utf-8")
    for line in text.splitlines():
        s = line.strip()
        if ":" in s and "process.env" in s:
            print("  " + s)
else:
    print("  [env.ts not found]")

# ---- 3. Schema models we will touch ----
print()
print("[3] Schema models - existing relevant")
print("-" * 70)
text = SCHEMA.read_text(encoding="utf-8")

for model_name in ["Invoice", "PaymentLink", "BankAccount", "BankTransaction"]:
    pattern = r"model\s+" + model_name + r"\s*\{([^}]*)\}"
    m = re.search(pattern, text, flags=re.DOTALL)
    if m:
        print()
        print(">>> " + model_name + " (" + str(m.group(1).count(chr(10))) + " lines)")
        # Show first 15 lines
        body = m.group(1).strip().splitlines()
        for ln in body[:18]:
            print("  " + ln)
        if len(body) > 18:
            print("  ... (" + str(len(body) - 18) + " more lines)")
    else:
        print()
        print(">>> " + model_name + " : [NOT FOUND]")

# ---- 4. Pre-check the new models ----
print()
print("[4] PRE-CHECK target models")
print("-" * 70)
print("  WhatsAppMessage:    " + str(bool(re.search(r"model\s+WhatsAppMessage\s*\{", text))))
print("  BankConnection:     " + str(bool(re.search(r"model\s+BankConnection\s*\{", text))))
print("  BankTransaction:    " + str(bool(re.search(r"model\s+BankTransaction\s*\{", text))))
print("  WhatsAppStatus enum:" + str(bool(re.search(r"enum\s+WhatsAppStatus\s*\{", text))))
print("  BankProvider enum:  " + str(bool(re.search(r"enum\s+BankProvider\s*\{", text))))

# ---- 5. Merchant relations area ----
print()
print("[5] Merchant model: last 8 relations")
print("-" * 70)
m = re.search(r"model\s+Merchant\s*\{([^}]*)\}", text, flags=re.DOTALL)
if m:
    body_lines = m.group(1).strip().splitlines()
    for ln in body_lines[-12:]:
        print("  " + ln)

print()
print("=" * 70)

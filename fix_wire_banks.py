from pathlib import Path

INDEX = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\src\index.ts")
text = INDEX.read_text(encoding="utf-8")

print("=" * 70)
print("FIX: Add banks import + route to index.ts")
print("=" * 70)

# Add import after whatsappRoutes import
old_imp = 'import whatsappRoutes      from "./routes/whatsapp";'
new_imp = 'import whatsappRoutes      from "./routes/whatsapp";\nimport banksRoutes         from "./routes/banks";'
if "banksRoutes" not in text:
    if old_imp in text:
        text = text.replace(old_imp, new_imp, 1)
        print("[OK] Added banksRoutes import")
    else:
        print("[FAIL] whatsapp import not found")
        raise SystemExit(1)
else:
    print("[INFO] banksRoutes import already exists")

# Add route after whatsapp route registration
old_use = 'app.use("/api/whatsapp",       whatsappRoutes);'
new_use = 'app.use("/api/whatsapp",       whatsappRoutes);\napp.use("/api/banks",          banksRoutes);'
if '"/api/banks"' not in text:
    if old_use in text:
        text = text.replace(old_use, new_use, 1)
        print("[OK] Added /api/banks route")
    else:
        print("[FAIL] whatsapp route not found")
        raise SystemExit(1)
else:
    print("[INFO] /api/banks already exists")

INDEX.write_text(text, encoding="utf-8")
print()

# Verify
final = INDEX.read_text(encoding="utf-8")
print("Verification:")
print("  /api/whatsapp present: " + str("/api/whatsapp" in final))
print("  /api/banks present:    " + str("/api/banks" in final))
print("  banksRoutes import:    " + str("banksRoutes" in final))
print("  v3.4:                  " + str("v3.4" in final))
print()
print("=" * 70)

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
ENV_FILE = ROOT / ".env"

print("=" * 70)
print("DIAGNOSE Gemini API key + AI service patterns")
print("=" * 70)
print()

# Check .env
if ENV_FILE.exists():
    text = ENV_FILE.read_text(encoding="utf-8")
    print("[.env file]")
    keys = []
    for line in text.splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key = line.split("=")[0].strip()
            if "GEMINI" in key.upper() or "GOOGLE" in key.upper() or "AI_" in key.upper() or "OPENAI" in key.upper() or "ANTHROPIC" in key.upper():
                keys.append(key)
    if keys:
        print("  AI-related keys found:")
        for k in keys:
            print("    " + k)
    else:
        print("  [WARN] No AI/Gemini key found in .env")
print()

# Check env.ts for the typed config
ENV_TS = ROOT / "src" / "config" / "env.ts"
if ENV_TS.exists():
    print("[src/config/env.ts content]")
    print("-" * 70)
    print(ENV_TS.read_text(encoding="utf-8"))
print()

# Check existing AI services for the pattern
print("[Existing AI services - check imports/patterns]")
print("-" * 70)
for f in (ROOT / "src" / "services").glob("*.ts"):
    text = f.read_text(encoding="utf-8")
    if "gemini" in text.lower() or "google.generativeai" in text.lower() or "@google/generative-ai" in text:
        print(f"  {f.name}:")
        for n, line in enumerate(text.splitlines()[:30], 1):
            if "import" in line or "gemini" in line.lower() or "GoogleGen" in line or "model" in line.lower():
                print(f"    L{n}: {line.strip()}")
        print()

# Check if @google/generative-ai is in package.json
PKG = ROOT / "package.json"
if PKG.exists():
    text = PKG.read_text(encoding="utf-8")
    print("[package.json - AI SDK presence]")
    print("  @google/generative-ai: " + str("@google/generative-ai" in text))
    print("  @anthropic-ai/sdk:     " + str("@anthropic-ai/sdk" in text))
    print("  openai:                " + str('"openai"' in text))
print()
print("=" * 70)

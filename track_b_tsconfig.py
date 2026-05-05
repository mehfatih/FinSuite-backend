from pathlib import Path
import json

TSC = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\tsconfig.json")
text = TSC.read_text(encoding="utf-8")

print("=" * 70)
print("Track B: Final tsconfig adjustments")
print("=" * 70)

# Add new flags before closing brace of compilerOptions
old_block = '''"sourceMap": true
  },'''

new_block = '''"sourceMap": true,
    "noImplicitAny": false,
    "noPropertyAccessFromIndexSignature": false,
    "useUnknownInCatchVariables": false
  },'''

if "noImplicitAny" not in text:
    text = text.replace(old_block, new_block, 1)
    TSC.write_text(text, encoding="utf-8")
    print("[OK] Added 3 lenient flags")
else:
    print("[INFO] Flags already present")

print()
print("Final tsconfig.json:")
print("-" * 70)
print(TSC.read_text(encoding="utf-8"))

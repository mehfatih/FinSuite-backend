from pathlib import Path

SCHEMA = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\prisma\schema.prisma")
text = SCHEMA.read_text(encoding="utf-8")

print("Search for iban in BankConnection:")
in_block = False
for n, line in enumerate(text.splitlines(), 1):
    if "model BankConnection" in line:
        in_block = True
    elif in_block and line.strip() == "}":
        in_block = False
    elif in_block and "iban" in line.lower():
        print("L" + str(n) + ": " + line)

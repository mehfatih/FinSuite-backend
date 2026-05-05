# Cleanup script — generates SQL for you to run on Railway
# Removes test merchants created during local testing

print("=" * 70)
print("CLEANUP SQL — run on Railway Data console")
print("=" * 70)
print()
print("Copy and run this SQL in Railway > FinSuite Postgres > Data > Query:")
print()
print("-- Delete test merchants and cascade subscriptions + feature_flags")
print("DELETE FROM merchants WHERE email LIKE '%@zyrix.test';")
print()
print("-- Verify cleanup")
print("SELECT email, plan FROM merchants WHERE email LIKE '%@zyrix.test';")
print("-- Expected: 0 rows")
print()
print("=" * 70)
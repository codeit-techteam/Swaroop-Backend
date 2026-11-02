# TDS library source files

Place (or pass via CLI) the production TDS sources:

- `Polystore_TDS_Index.xlsx`
- `Polystore_TDS_Library_Part1.zip`
- `Polystore_TDS_Library_Part2.zip`

## Import

```bash
# 1. Ensure Postgres is up and migrate
npx prisma migrate deploy

# 2. Dry-run mapping (no R2 / DB document writes for uploads — still reads grades for match report)
npm run import:tds -- --dry-run

# 3. Live import → Cloudflare R2 + grade_tds_documents
npm run import:tds

# Optional explicit paths
npm run import:tds -- \
  --excel ~/Downloads/Polystore_TDS_Index.xlsx \
  --zip ~/Downloads/Polystore_TDS_Library_Part1.zip \
  --zip ~/Downloads/Polystore_TDS_Library_Part2.zip
```

Required env (already used by the API): `DATABASE_URL`, `R2_*` or `CLOUDFLARE_R2_*`.

### Import policy

| Source | Customer visibility after import |
|--------|----------------------------------|
| `app` + exact grade map | `VERIFIED` |
| web / dealer / multi-grade / doubtful | `PENDING_REVIEW` (Admin must approve) |
| Missing TDS sheet / no file | `MISSING` (no file invented) |
| Ambiguous / unmatched grade | `NEEDS_MAPPING` |

`PC MOULD 103 / SABIC` is **not** in the supplied Excel — do not auto-attach a PDF.

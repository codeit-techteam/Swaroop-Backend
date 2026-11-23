-- Audit only — do NOT delete without reviewing related carts/orders.
-- Target: ABS Injection Grade / ABS Flame Retardant Compound lookalikes.

-- 1) Products that share name + grade and look like duplicates
SELECT
  p.id,
  p.name,
  p.sku,
  p."gradeId",
  p."gradeCode",
  p.status,
  p."createdAt",
  (
    SELECT COUNT(*)::int
    FROM offers o
    WHERE o."productId" = p.id AND o.status = 'ACTIVE'
  ) AS active_offers
FROM products p
WHERE
  p.name ILIKE '%ABS Injection%'
  OR p.name ILIKE '%ABS Flame Retardant%'
  OR p."gradeCode" ILIKE '%ABS-IM%'
  OR p."gradeCode" ILIKE '%ABS-FR%'
  OR p.sku ILIKE '%ABS%'
ORDER BY p.name, p."createdAt";

-- 2) Commercial fingerprint collisions (same grade + price + MOQ)
SELECT
  p."gradeId",
  p.name,
  o.price,
  o.moq,
  COUNT(DISTINCT p.id) AS product_count,
  ARRAY_AGG(DISTINCT p.id::text) AS product_ids,
  ARRAY_AGG(DISTINCT o.id::text) AS offer_ids
FROM offers o
JOIN products p ON p.id = o."productId"
WHERE o.status = 'ACTIVE'
  AND (
    p.name ILIKE '%ABS Injection%'
    OR p.name ILIKE '%ABS Flame Retardant%'
  )
GROUP BY p."gradeId", p.name, o.price, o.moq
HAVING COUNT(DISTINCT p.id) > 1
ORDER BY product_count DESC;

-- 3) TDS availability for those grades
SELECT
  g.id AS grade_id,
  g.code AS grade_code,
  g.name AS grade_name,
  d.id AS tds_document_id,
  d."originalFilename",
  d."verifiedAt",
  d.status
FROM grades g
LEFT JOIN grade_documents d
  ON d."gradeId" = g.id
 AND d."documentType" = 'TDS'
WHERE
  g.name ILIKE '%ABS%'
  OR g.code ILIKE '%ABS%'
ORDER BY g.code, d."verifiedAt" DESC NULLS LAST;

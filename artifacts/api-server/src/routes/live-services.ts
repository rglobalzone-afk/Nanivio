import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { adminOnly, requireAuth } from "../middleware/auth";

const router: IRouter = Router();
const SERVICE_CATEGORIES = new Set([
  "Sponsored", "Featured Business", "Online Now", "Consultant Online", "Nanivio Service",
]);

const columns = `
  id, title, description, category, business_name, image_url, cta_label,
  cta_url, is_active, sort, created_at, updated_at
`;

function toClient(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    businessName: row.business_name,
    imageUrl: row.image_url,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    isActive: row.is_active,
    sort: row.sort,
  };
}

// The catalog is optional in older installations. A missing table is treated
// as an empty catalog rather than making an in-call experience fail.
router.get("/live-services", requireAuth, async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool.query(
      `SELECT ${columns} FROM live_services WHERE is_active = TRUE ORDER BY sort ASC, created_at DESC`,
    );
    res.json({ services: rows.map(toClient) });
  } catch (error: any) {
    if (error?.code === "42P01") {
      res.json({ services: [] });
      return;
    }
    res.status(500).json({ error: "Unable to load live services" });
  }
});

router.get("/admin/live-services", adminOnly, async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool.query(`SELECT ${columns} FROM live_services ORDER BY sort ASC, created_at DESC`);
    res.json({ services: rows.map(toClient) });
  } catch (error: any) {
    if (error?.code === "42P01") { res.json({ services: [] }); return; }
    res.status(500).json({ error: "Unable to load live services" });
  }
});

router.post("/admin/live-services", adminOnly, async (req, res): Promise<void> => {
  const { title, description, category, businessName, imageUrl, ctaLabel, ctaUrl, isActive = true, sort = 100 } = req.body ?? {};
  if (typeof title !== "string" || !title.trim() || typeof category !== "string" || !SERVICE_CATEGORIES.has(category)) {
    res.status(400).json({ error: "title and a valid service category are required" });
    return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO live_services (title, description, category, business_name, image_url, cta_label, cta_url, is_active, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${columns}`,
      [title.trim(), description || null, category.trim(), businessName || null, imageUrl || null, ctaLabel || null, ctaUrl || null, Boolean(isActive), Number(sort) || 100],
    );
    res.status(201).json({ service: toClient(result.rows[0]) });
  } catch (error: any) {
    if (error?.code === "42P01") { res.status(503).json({ error: "Live services catalog is not available" }); return; }
    res.status(500).json({ error: "Unable to create live service" });
  }
});

router.put("/admin/live-services/:id", adminOnly, async (req, res): Promise<void> => {
  const { title, description, category, businessName, imageUrl, ctaLabel, ctaUrl, isActive, sort } = req.body ?? {};
  if (typeof title !== "string" || !title.trim() || typeof category !== "string" || !SERVICE_CATEGORIES.has(category)) {
    res.status(400).json({ error: "title and a valid service category are required" });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE live_services SET title=$1, description=$2, category=$3, business_name=$4, image_url=$5,
       cta_label=$6, cta_url=$7, is_active=$8, sort=$9, updated_at=NOW() WHERE id=$10 RETURNING ${columns}`,
      [title.trim(), description || null, category.trim(), businessName || null, imageUrl || null, ctaLabel || null, ctaUrl || null, Boolean(isActive), Number(sort) || 100, Number(req.params.id)],
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Live service not found" }); return; }
    res.json({ service: toClient(result.rows[0]) });
  } catch (error: any) {
    if (error?.code === "42P01") { res.status(503).json({ error: "Live services catalog is not available" }); return; }
    res.status(500).json({ error: "Unable to update live service" });
  }
});

router.delete("/admin/live-services/:id", adminOnly, async (req, res): Promise<void> => {
  try {
    const result = await pool.query("DELETE FROM live_services WHERE id=$1", [Number(req.params.id)]);
    if (!result.rowCount) { res.status(404).json({ error: "Live service not found" }); return; }
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === "42P01") { res.status(503).json({ error: "Live services catalog is not available" }); return; }
    res.status(500).json({ error: "Unable to delete live service" });
  }
});

export default router;
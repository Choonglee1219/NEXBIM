import express, { Request, Response } from "express";
import OracleDB from "oracledb";
import { getConnection } from "../config/db.js";

const router = express.Router();

// Get Saved Clash Statuses
router.get("/api/clash-manager", async (_req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT "guid1", "guid2", "badge" FROM "clash_manager"`,
      [],
      { outFormat: OracleDB.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error fetching clash statuses:", err);
    res.status(500).json({ error: "Failed to fetch clash statuses" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

// Filter Saved Clash Statuses by specific GUID pairs
router.post("/api/clash-manager/filter", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    const { pairs } = req.body;
    if (!Array.isArray(pairs) || pairs.length === 0) {
      res.json([]);
      return;
    }

    connection = await getConnection();
    const results: any[] = [];

    // Oracle DB의 쿼리 길이 및 바인드 변수 제한을 우회하기 위해 500개씩 청크 분할 처리
    const chunkSize = 500;
    for (let i = 0; i < pairs.length; i += chunkSize) {
      const chunk = pairs.slice(i, i + chunkSize);
      const binds: Record<string, any> = {};
      const conditions = chunk.map((p: string[], idx: number) => {
        binds[`g1_${idx}`] = p[0];
        binds[`g2_${idx}`] = p[1];
        return `("guid1" = :g1_${idx} AND "guid2" = :g2_${idx})`;
      });

      const sql = `SELECT "guid1", "guid2", "badge" FROM "clash_manager" WHERE ${conditions.join(" OR ")}`;
      const result = await connection.execute(sql, binds, { outFormat: OracleDB.OUT_FORMAT_OBJECT });
      if (result.rows) results.push(...result.rows);
    }

    res.json(results);
  } catch (err) {
    console.error("Error filtering clash statuses:", err);
    res.status(500).json({ error: "Failed to filter clash statuses" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

// Upsert Clash Statuses (MERGE INTO)
router.post("/api/clash-manager/upsert", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    const payload = req.body; // Array of objects
    if (!Array.isArray(payload) || payload.length === 0) {
      res.status(400).json({ error: "Empty payload" });
      return;
    }

    connection = await getConnection();

    const sql = `
      MERGE INTO "clash_manager" dest
      USING (SELECT :guid1 AS "guid1", :guid2 AS "guid2", :badge AS "badge", 
                    :entity1 AS "entity1", :object1 AS "object1", 
                    :entity2 AS "entity2", :object2 AS "object2",
                    :x_coord AS "x_coord", :y_coord AS "y_coord", :z_coord AS "z_coord" FROM DUAL) src
      ON (dest."guid1" = src."guid1" AND dest."guid2" = src."guid2")
      WHEN MATCHED THEN
        UPDATE SET "badge" = src."badge", "x_coord" = src."x_coord", "y_coord" = src."y_coord", "z_coord" = src."z_coord"
      WHEN NOT MATCHED THEN
        INSERT ("guid1", "guid2", "badge", "entity1", "object1", "entity2", "object2", "x_coord", "y_coord", "z_coord")
        VALUES (src."guid1", src."guid2", src."badge", src."entity1", src."object1", src."entity2", src."object2", src."x_coord", src."y_coord", src."z_coord")
    `;

    const options = {
      autoCommit: true,
      bindDefs: {
        guid1: { type: OracleDB.STRING, maxSize: 255 },
        guid2: { type: OracleDB.STRING, maxSize: 255 },
        badge: { type: OracleDB.STRING, maxSize: 50 },
        entity1: { type: OracleDB.STRING, maxSize: 255 },
        object1: { type: OracleDB.STRING, maxSize: 255 },
        entity2: { type: OracleDB.STRING, maxSize: 255 },
        object2: { type: OracleDB.STRING, maxSize: 255 },
        x_coord: { type: OracleDB.NUMBER },
        y_coord: { type: OracleDB.NUMBER },
        z_coord: { type: OracleDB.NUMBER }
      }
    };

    await connection.executeMany(sql, payload, options);

    res.status(200).json({ message: "Clash statuses synchronized successfully." });
  } catch (err) {
    console.error("Error upserting clash statuses:", err);
    res.status(500).json({ error: "Failed to upsert clash statuses" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

// Delete specific clash statuses (when reverted to "New")
router.post("/api/clash-manager/delete-pairs", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    const payload = req.body; // Array of { guid1, guid2 }
    if (!Array.isArray(payload) || payload.length === 0) {
      res.status(400).json({ error: "Empty payload" });
      return;
    }

    connection = await getConnection();

    const sql = `DELETE FROM "clash_manager" WHERE "guid1" = :guid1 AND "guid2" = :guid2`;
    const options = {
      autoCommit: true,
      bindDefs: {
        guid1: { type: OracleDB.STRING, maxSize: 255 },
        guid2: { type: OracleDB.STRING, maxSize: 255 }
      }
    };

    await connection.executeMany(sql, payload, options);
    res.status(200).json({ message: "Reverted clash statuses deleted successfully." });
  } catch (err) {
    console.error("Error deleting clash statuses:", err);
    res.status(500).json({ error: "Failed to delete clash statuses" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

export default router;

import express, { Request, Response } from "express";
import OracleDB from "oracledb";
import { getConnection } from "../config/db.js";
import { upload } from "../app.js";

const router = express.Router();

// Get ifcs name
router.get("/api/ifcs/name", async (_req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const projectIdQuery = _req.query.projectId;
    let sql = `SELECT "id", "name" FROM "ifc"`;
    const binds: any = {};
    if (projectIdQuery) {
      const projId = parseInt(projectIdQuery as string, 10);
      if (!isNaN(projId)) {
        sql += ` WHERE "project_id" = :project_id`;
        binds.project_id = projId;
      }
    }
    const result = await connection.execute(
      sql,
      binds,
      { outFormat: OracleDB.OUT_FORMAT_OBJECT },
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching ifcs: ", err);
    res.status(500).json({ error: "Failed to fetch ifcs" });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Get IFC
router.get("/api/ifc/:id", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const ifcid = parseInt(req.params.id as string, 10);
    if (isNaN(ifcid)) {
      res.status(400).json({ error: "ifc id 가 숫자가 아님!" });
      return;
    }
    const result = await connection.execute(
      `SELECT "content", "name" FROM "ifc" WHERE "id" = :id`,
      { id: ifcid },
      {
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
        fetchInfo: { content: { type: OracleDB.BUFFER } },
      } as any
    );
    const ifc = result.rows?.[0] as {
      content: Buffer | null,
      name: string | null
    };
    if (!ifc || !ifc.content) {
      console.warn(`IFC data not found for id: ${ifcid}`);
      res.status(404).json({ error: "IFC data not found" });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    const encodedName = encodeURIComponent(ifc.name || "model.ifc");
    res.setHeader("x-file-name", encodedName);
    res.setHeader("Content-Disposition", `attachment; filename="${encodedName}"`);
    res.send(ifc.content);
  } catch (err) {
    console.error("Error fetching IFC:", err);
    res.status(500).json({ error: "Failed to fetch IFC" });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Post IFC
router.post("/api/ifc", (req, res, next) => upload.single("file")(req, res, next), async (req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const name = req.file.originalname;
    const bufferContent = req.file.buffer;
    const projectIdRaw = req.body.projectId;
    let projectId: number | null = null;
    if (projectIdRaw !== undefined && projectIdRaw !== null && projectIdRaw !== "") {
      projectId = parseInt(projectIdRaw, 10);
      if (isNaN(projectId)) projectId = null;
    }

    const sql = `INSERT INTO "ifc" ("name", "content", "project_id") VALUES (:name, :content, :project_id) RETURNING "id" INTO :id`;

    const result = await connection.execute<{ id: number[] }>(
      sql,
      {
        name: {
          val: name,
          type: OracleDB.DB_TYPE_VARCHAR,
        },
        content: {
          val: bufferContent,
          type: OracleDB.DB_TYPE_BLOB,
        },
        project_id: {
          val: projectId,
          type: OracleDB.DB_TYPE_NUMBER,
        },
        id: {
          type: OracleDB.DB_TYPE_NUMBER,
          dir: OracleDB.BIND_OUT,
        },
      },
      { autoCommit: true },
    );
    if (result.outBinds && Array.isArray(result.outBinds.id) && result.outBinds.id.length > 0) {
      res.status(201).json({
        message: "IFC inserted successfully",
        id: result.outBinds.id[0],
      });
    } else {
      console.error("Error inserting IFC: No ID returned");
      res.status(500).json({ error: "Failed to insert IFC" });
    }
  } catch (err) {
    console.error("Error reading or inserting the ifc file: ", err);
    res.status(500).json({ error: "Failed to insert IFC: ", details: err instanceof Error ? err.message : String(err) });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Delete IFC
router.delete("/api/ifc/:id", async (req: Request, res: Response) => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const ifcid = parseInt(req.params.id as string, 10);
    if (Number.isNaN(ifcid)) {
      res.status(400).json({ error: "Invalid IFC ID" });
      return;
    }

    const result = await connection.execute(
      `DELETE FROM "ifc" WHERE "id" = :id`,
      { id: ifcid },
      { autoCommit: true },
    );
    if (result.rowsAffected && result.rowsAffected > 0) {
      res.status(200).json({ message: "IFC deleted successfully." });
    } else {
      console.warn(`IFC with ID ${ifcid} not found.`);
      res.status(404).json({ error: "IFC not found." });
    }
  } catch (err) {
    console.error("Error deleting IFC:", err);
    res.status(500).json({ error: "Failed to delete IFC" });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Get frags name
router.get("/api/frags/name", async (_req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const projectIdQuery = _req.query.projectId;
    let sql = `SELECT "id", "name" FROM "frag"`;
    const binds: any = {};
    if (projectIdQuery) {
      const projId = parseInt(projectIdQuery as string, 10);
      if (!isNaN(projId)) {
        sql += ` WHERE "project_id" = :project_id`;
        binds.project_id = projId;
      }
    }
    const result = await connection.execute(
      sql,
      binds,
      { outFormat: OracleDB.OUT_FORMAT_OBJECT },
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching frags: ", err);
    res.status(500).json({ error: "Failed to fetch frags" });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Get FRAG
router.get("/api/frag/:id", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const fragid = parseInt(req.params.id as string, 10);
    if (isNaN(fragid)) {
      res.status(400).json({ error: "frag id 가 숫자가 아님!" });
      return;
    }
    const result = await connection.execute(
      `SELECT "content", "name" FROM "frag" WHERE "id" = :id`,
      { id: fragid },
      {
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
        fetchInfo: { content: { type: OracleDB.BUFFER } },
      } as any
    );
    const frag = result.rows?.[0] as {
      content: Buffer | null,
      name: string | null
    };
    if (!frag || !frag.content) {
      console.warn(`FRAG data not found for id: ${fragid}`);
      res.status(404).json({ error: "FRAG data not found" });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    const encodedName = encodeURIComponent(frag.name || "model.frag");
    res.setHeader("x-file-name", encodedName);
    res.setHeader("Content-Disposition", `attachment; filename="${encodedName}"`);
    res.send(frag.content);
  } catch (err) {
    console.error("Error fetching FRAG:", err);
    res.status(500).json({ error: "Failed to fetch FRAG" });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Post FRAG
router.post("/api/frag", (req, res, next) => upload.single("file")(req, res, next), async (req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const name = req.file.originalname;
    const bufferContent = req.file.buffer;
    const projectIdRaw = req.body.projectId;
    let projectId: number | null = null;
    if (projectIdRaw !== undefined && projectIdRaw !== null && projectIdRaw !== "") {
      projectId = parseInt(projectIdRaw, 10);
      if (isNaN(projectId)) projectId = null;
    }

    const sql = `INSERT INTO "frag" ("name", "content", "project_id") VALUES (:name, :content, :project_id) RETURNING "id" INTO :id`;

    const result = await connection.execute<{ id: number[] }>(
      sql,
      {
        name: {
          val: name,
          type: OracleDB.DB_TYPE_VARCHAR,
        },
        content: {
          val: bufferContent,
          type: OracleDB.DB_TYPE_BLOB,
        },
        project_id: {
          val: projectId,
          type: OracleDB.DB_TYPE_NUMBER,
        },
        id: {
          type: OracleDB.DB_TYPE_NUMBER,
          dir: OracleDB.BIND_OUT,
        },
      },
      { autoCommit: true },
    );
    if (result.outBinds && Array.isArray(result.outBinds.id) && result.outBinds.id.length > 0) {
      res.status(201).json({
        message: "FRAG inserted successfully",
        id: result.outBinds.id[0],
      });
    } else {
      console.error("Error inserting FRAG: No ID returned");
      res.status(500).json({ error: "Failed to insert FRAG" });
    }
  } catch (err) {
    console.error("Error reading or inserting the frag file: ", err);
    res.status(500).json({ error: "Failed to insert FRAG: ", details: err instanceof Error ? err.message : String(err) });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Delete FRAG
router.delete("/api/frag/:id", async (req: Request, res: Response) => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const fragid = parseInt(req.params.id as string, 10);
    if (Number.isNaN(fragid)) {
      res.status(400).json({ error: "Invalid FRAG ID" });
      return;
    }

    const result = await connection.execute(
      `DELETE FROM "frag" WHERE "id" = :id`,
      { id: fragid },
      { autoCommit: true },
    );
    if (result.rowsAffected && result.rowsAffected > 0) {
      res.status(200).json({ message: "FRAG deleted successfully." });
    } else {
      console.warn(`FRAG with ID ${fragid} not found.`);
      res.status(404).json({ error: "FRAG not found." });
    }
  } catch (err) {
    console.error("Error deleting FRAG:", err);
    res.status(500).json({ error: "Failed to delete FRAG" });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

export default router;

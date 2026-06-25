import express, { Request, Response } from "express";
import OracleDB from "oracledb";
import { getConnection } from "../config/db.js";

const router = express.Router();

// Get all users
router.get("/api/users", async (_req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT "email", "name", "picture", "security" FROM "user" ORDER BY "name" ASC`,
      [],
      { outFormat: OracleDB.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { }
    }
  }
});

// Get projects accessible to a user
router.get("/api/projects", async (req: Request, res: Response): Promise<any> => {
  const email = req.query.email as string;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email parameter is required." });
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT 
        p."id", 
        p."name", 
        p."description", 
        pu."security" AS "security",
        (SELECT COUNT(*) FROM "ifc" i WHERE i."project_id" = p."id") AS "ifcCount",
        (SELECT COUNT(*) FROM "frag" f WHERE f."project_id" = p."id") AS "fragCount"
      FROM "project" p 
      JOIN "project_user" pu ON p."id" = pu."project_id" 
      WHERE pu."user_email" = :email
      ORDER BY p."name" ASC`,
      { email },
      { outFormat: OracleDB.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error fetching user projects:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { }
    }
  }
});

// Create a new project
router.post("/api/projects", async (req: Request, res: Response): Promise<any> => {
  const { name, description, creatorEmail } = req.body;
  if (!name || !creatorEmail) {
    return res.status(400).json({ error: "name and creatorEmail are required." });
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute<{ id: number[] }>(
      `INSERT INTO "project" ("name", "description") VALUES (:name, :description) RETURNING "id" INTO :id`,
      {
        name: { val: name, type: OracleDB.DB_TYPE_VARCHAR },
        description: { val: description || null, type: OracleDB.DB_TYPE_VARCHAR },
        id: { type: OracleDB.DB_TYPE_NUMBER, dir: OracleDB.BIND_OUT }
      },
      { autoCommit: false }
    );

    if (result.outBinds && result.outBinds.id && result.outBinds.id.length > 0) {
      const newProjId = result.outBinds.id[0];

      // Get all system-wide free users
      const freeUsersResult = await connection.execute(
        `SELECT "email" FROM "user" WHERE "security" = 'free'`,
        [],
        { outFormat: OracleDB.OUT_FORMAT_OBJECT }
      );
      const freeEmails = (freeUsersResult.rows || []).map((r: any) => r.email ?? r.EMAIL).filter(Boolean);

      // Auto-assign creator as free (admin)
      await connection.execute(
        `INSERT INTO "project_user" ("project_id", "user_email", "security") VALUES (:project_id, :user_email, :security)`,
        {
          project_id: newProjId,
          user_email: creatorEmail,
          security: "free"
        },
        { autoCommit: false }
      );

      // Ensure all system-wide free users are linked to this project
      for (const email of freeEmails) {
        if (email !== creatorEmail) {
          await connection.execute(
            `INSERT INTO "project_user" ("project_id", "user_email", "security") VALUES (:project_id, :user_email, :security)`,
            {
              project_id: newProjId,
              user_email: email,
              security: "free"
            },
            { autoCommit: false }
          );
        }
      }

      await connection.commit();
      res.status(201).json({ id: newProjId, name, description, security: "free" });
    } else {
      throw new Error("No ID returned from project insertion.");
    }
  } catch (err) {
    if (connection) {
      try { await connection.rollback(); } catch (e) { }
    }
    console.error("Error creating project:", err);
    res.status(500).json({ error: "Failed to create project" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { }
    }
  }
});

// Get users mapped to a specific project
router.get("/api/projects/:id/users", async (req: Request, res: Response): Promise<any> => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ error: "Invalid project ID." });
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT u."email", u."name", u."picture", pu."security" 
       FROM "project_user" pu 
       JOIN "user" u ON pu."user_email" = u."email" 
       WHERE pu."project_id" = :project_id
       ORDER BY u."name" ASC`,
      { project_id: projectId },
      { outFormat: OracleDB.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error fetching project users:", err);
    res.status(500).json({ error: "Failed to fetch project users" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { }
    }
  }
});

// Map user to project (add or update permissions)
router.post("/api/projects/:id/users", async (req: Request, res: Response): Promise<any> => {
  const projectId = parseInt(req.params.id as string, 10);
  const { email, security } = req.body;
  if (isNaN(projectId) || !email || !security) {
    return res.status(400).json({ error: "projectId, email, and security are required." });
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();

    // If changing security to 'general' (demoting), verify we are not demoting the last system-wide free user connected to the project.
    if (security === "general") {
      const freeUsersResult = await connection.execute(
        `SELECT pu."user_email" 
         FROM "project_user" pu 
         JOIN "user" u ON pu."user_email" = u."email" 
         WHERE pu."project_id" = :project_id AND u."security" = 'free' AND pu."security" = 'free'`,
        { project_id: projectId },
        { outFormat: OracleDB.OUT_FORMAT_OBJECT }
      );
      const freeUsers = (freeUsersResult.rows || []) as any[];
      const isTargetFreeUser = freeUsers.some(fu => (fu.user_email ?? fu.USER_EMAIL) === email);
      if (isTargetFreeUser && freeUsers.length <= 1) {
        return res.status(400).json({ error: "프로젝트에 최소 한 명 이상의 free 사용자(ADMIN)가 관리자(free)로 연결되어 있어야 합니다." });
      }
    }

    await connection.execute(
      `MERGE INTO "project_user" dest
       USING (SELECT :project_id AS "project_id", :user_email AS "user_email", :security AS "security" FROM DUAL) src
       ON (dest."project_id" = src."project_id" AND dest."user_email" = src."user_email")
       WHEN MATCHED THEN
         UPDATE SET dest."security" = src."security"
       WHEN NOT MATCHED THEN
         INSERT ("project_id", "user_email", "security")
         VALUES (src."project_id", src."user_email", src."security")`,
      {
        project_id: projectId,
        user_email: email,
        security: security
      },
      { autoCommit: true }
    );
    res.json({ message: "Project user role updated successfully." });
  } catch (err) {
    console.error("Error setting project user role:", err);
    res.status(500).json({ error: "Failed to set project user role" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { }
    }
  }
});

// Remove user access from a project
router.delete("/api/projects/:id/users/:email", async (req: Request, res: Response): Promise<any> => {
  const projectId = parseInt(req.params.id as string, 10);
  const email = req.params.email as string;
  if (isNaN(projectId) || !email) {
    return res.status(400).json({ error: "projectId and email are required." });
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();

    // Verify we are not removing the last system-wide free user connected to the project.
    const freeUsersResult = await connection.execute(
      `SELECT pu."user_email" 
       FROM "project_user" pu 
       JOIN "user" u ON pu."user_email" = u."email" 
       WHERE pu."project_id" = :project_id AND u."security" = 'free'`,
      { project_id: projectId },
      { outFormat: OracleDB.OUT_FORMAT_OBJECT }
    );
    const freeUsers = (freeUsersResult.rows || []) as any[];
    const isTargetFreeUser = freeUsers.some(fu => (fu.user_email ?? fu.USER_EMAIL) === email);
    if (isTargetFreeUser && freeUsers.length <= 1) {
      return res.status(400).json({ error: "프로젝트에 최소 한 명 이상의 free 사용자(ADMIN)가 연결되어 있어야 합니다." });
    }

    await connection.execute(
      `DELETE FROM "project_user" WHERE "project_id" = :project_id AND "user_email" = :user_email`,
      {
        project_id: projectId,
        user_email: email
      },
      { autoCommit: true }
    );
    res.json({ message: "User access removed successfully." });
  } catch (err) {
    console.error("Error deleting project user mapping:", err);
    res.status(500).json({ error: "Failed to remove user access" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { }
    }
  }
});

export default router;

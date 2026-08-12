import express, { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";

const router = express.Router();
const GROUPS_FILE_PATH = path.resolve(process.cwd(), "src", "setup", "groups.json");

// GET /api/groups - Read grouping data from src/setup/groups.json
router.get("/api/groups", async (_req: Request, res: Response): Promise<void> => {
  try {
    try {
      const data = await fs.readFile(GROUPS_FILE_PATH, "utf-8");
      res.json(JSON.parse(data));
    } catch (err: any) {
      if (err.code === "ENOENT") {
        const defaultData = { fragGroups: [] };
        await fs.mkdir(path.dirname(GROUPS_FILE_PATH), { recursive: true });
        await fs.writeFile(GROUPS_FILE_PATH, JSON.stringify(defaultData, null, 2), "utf-8");
        res.json(defaultData);
      } else {
        throw err;
      }
    }
  } catch (error) {
    console.error("Error reading groups file:", error);
    res.status(500).json({ error: "Failed to read groups data" });
  }
});

// POST /api/groups - Save grouping data immediately to src/setup/groups.json
router.post("/api/groups", async (req: Request, res: Response): Promise<void> => {
  try {
    const { fragGroups } = req.body;

    let currentData = { fragGroups: [] };
    try {
      const content = await fs.readFile(GROUPS_FILE_PATH, "utf-8");
      currentData = JSON.parse(content);
    } catch (e) {
      // file might not exist yet
    }

    const newData = {
      fragGroups: fragGroups !== undefined ? fragGroups : currentData.fragGroups,
    };

    await fs.mkdir(path.dirname(GROUPS_FILE_PATH), { recursive: true });
    await fs.writeFile(GROUPS_FILE_PATH, JSON.stringify(newData, null, 2), "utf-8");
    res.json({ success: true, data: newData });
  } catch (error) {
    console.error("Error saving groups file:", error);
    res.status(500).json({ error: "Failed to save groups data" });
  }
});

export default router;

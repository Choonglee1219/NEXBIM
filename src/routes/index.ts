import express, { Request, Response } from "express";
import projectsRouter from "./projects.js";
import modelsRouter from "./models.js";
import bcfRouter from "./bcf.js";
import clashRouter from "./clash.js";
import propertiesRouter from "./properties.js";
import chatRouter from "./chat.js";
import mapRouter from "./map.js";


const router = express.Router();

// Root
router.get("/", (_req: Request, res: Response): void => {
  try {
    res.json({ message: "IFC Viewer" });
  } catch (err) {
    console.error("Error in root endpoint:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Register domain routers
router.use(projectsRouter);
router.use(modelsRouter);
router.use(bcfRouter);
router.use(clashRouter);
router.use(propertiesRouter);
router.use(chatRouter);
router.use(mapRouter);


export default router;

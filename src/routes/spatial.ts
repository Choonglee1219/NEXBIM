import express, { Request, Response } from "express";
import { upload } from "../app.js";

const router = express.Router();

// Process IFC via Python microservice: Change Spatial Structure
router.post("/api/change-spatial-structure", (req, res, next) => upload.single("file")(req, res, next), async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const { siteName, buildingName, storeyName } = req.body;

    const formData = new FormData();
    const blob = new Blob([req.file.buffer as any], { type: req.file.mimetype || "application/octet-stream" });
    formData.append("file", blob, req.file.originalname);
    if (siteName) formData.append("siteName", siteName);
    if (buildingName) formData.append("buildingName", buildingName);
    if (storeyName) formData.append("storeyName", storeyName);

    const response = await fetch("http://127.0.0.1:8000/change-spatial-structure", {
      method: "POST",
      body: formData as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: "Error from Python microservice", details: errorText });
    }

    const arrayBuffer = await response.arrayBuffer();
    const processedBuffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
    res.send(processedBuffer);
  } catch (err) {
    console.error("Error processing IFC (Spatial Structure):", err);
    res.status(500).json({ error: "Internal Server Error", details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;

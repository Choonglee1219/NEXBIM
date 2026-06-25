import express, { Request, Response } from "express";
import { upload } from "../app.js";

const router = express.Router();

// Process IFC via Python microservice: Add EDB Data
router.post("/api/add-edb-data", (req, res, next) => upload.single("file")(req, res, next), async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // 데이터 마이크로서비스로 전송할 FormData 생성
    const formData = new FormData();
    const blob = new Blob([req.file.buffer as any], { type: req.file.mimetype || "application/octet-stream" });
    formData.append("file", blob, req.file.originalname);

    const response = await fetch("http://127.0.0.1:8000/add-edb-data", {
      method: "POST",
      body: formData as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: "Error from Python microservice", details: errorText });
    }

    // 데이터 서버로부터 처리된 IFC 파일을 받습니다.
    const arrayBuffer = await response.arrayBuffer();
    const processedBuffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
    res.send(processedBuffer);
  } catch (err) {
    console.error("Error processing IFC (EDB):", err);
    res.status(500).json({ error: "Internal Server Error", details: err instanceof Error ? err.message : String(err) });
  }
});

// Process IFC via Python microservice: Process Properties (Add/Delete)
router.post("/api/process-properties", (req, res, next) => upload.single("file")(req, res, next), async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const { action, expressIds, propertiesData } = req.body;

    if (!action || !expressIds || !propertiesData) {
      return res.status(400).json({ error: "Missing required property data." });
    }

    const formData = new FormData();
    const blob = new Blob([req.file.buffer as any], { type: req.file.mimetype || "application/octet-stream" });
    formData.append("file", blob, req.file.originalname);
    formData.append("action", action);
    formData.append("expressIds", expressIds); // JSON stringified array (e.g., "[123, 124]")
    formData.append("propertiesData", propertiesData); // JSON stringified array of Psets and Properties

    const response = await fetch("http://127.0.0.1:8000/process-properties", {
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
    console.error(`Error processing IFC (${req.body.action} Properties):`, err);
    res.status(500).json({ error: "Internal Server Error", details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;

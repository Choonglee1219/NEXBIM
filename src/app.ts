import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OracleDB from "oracledb";
import multer from "multer";

export const upload = multer({ storage: multer.memoryStorage() });

import { initPools } from "./config/db.js";
import apiRouter from "./routes/index.js";

dotenv.config();

const app = express();
const PORT: number = 3001;

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// 미들웨어 설정
app.use(cors(corsOptions));
app.use(express.json({ limit: "2000mb" }));
app.use(express.urlencoded({ limit: "2000mb", extended: true }));

// 마운트 통합 라우터
app.use(apiRouter);

app.listen(PORT, () => {
  console.log(`✅ Connected successfully on port ${PORT}`);
  console.log("Node:", process.version);
  console.log("oracledb:", OracleDB.versionString);
  console.log("Thin:", OracleDB.thin);
  console.log("Client:", OracleDB.oracleClientVersionString);
});

// Database pools initialization
initPools();

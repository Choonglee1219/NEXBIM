import express, { Request, Response } from "express";
import cors from "cors";
import OracleDB from "oracledb";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT: number = 3001;
let ifcPool: OracleDB.Pool | undefined;

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// 미들웨어 설정
app.use(cors(corsOptions));
app.use(express.json({ limit: "2000mb" }));
app.use(express.urlencoded({ limit: "2000mb", extended: true }));

// Multer 설정 (메모리 저장소 사용)
const upload = multer({ storage: multer.memoryStorage() });

// ✅ OracleDB Connection Pool 설정
const ifcPoolConfig = {
  user: "ifcAdmin",
  password: "123456",
  connectString: "localhost:1521/ORCLPDB",
  poolAlias: 'ifcPool',
  poolMax: 10,
  poolMin: 2,
  poolIncrement: 1,
};

// ✅ Connection Pool 생성
async function initPools() {
  try {
    ifcPool = await OracleDB.createPool(ifcPoolConfig);
    console.log("✅ Connection Pool 생성 완료");
    // 애플리케이션 종료 시 Connection Pool 종료
    process.on("SIGTERM", closeDatabase);
    process.on("SIGINT", closeDatabase);
  } catch (err) {
    console.error("❌ Connection Pool 생성 실패:", err);
    throw err; // 에러를 던져서 main() 함수에서 처리하도록 함
  }
}

app.listen(PORT, () => {
  console.log(`✅ Connected successfully on port ${PORT}`);
  console.log("Node:", process.version);
  console.log("oracledb:", OracleDB.versionString);
  console.log("Thin:", OracleDB.thin);
  console.log("Client:", OracleDB.oracleClientVersionString);
});    

// ✅ 공통 Connection Pool 연결 함수
async function getConnection(): Promise<OracleDB.Connection> {
  while (!ifcPool) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    return await ifcPool.getConnection();
  } catch (err) {
    throw new Error(`Connection failed: ${err}`);
  }
}

// ✅ 공통 Connection Pool 종료 함수
async function closePool() {
  if (ifcPool) { await ifcPool.close(10); }
  console.log("Oracle Database connection pools closed");
}

async function closeDatabase() {
  await closePool();
  console.log("Close Database.");
}

// Root
app.get("/", (_req: Request, res: Response) => {
  try {
    res.json({ message: "IFC Viewer" });
  } catch (err) {
    console.error("Error in root endpoint:", err);
    res.status(500).json({ error: "Internal server error" });
  }  
});  

// Proxy for Clash Detection
app.post("/api/clash", async (req: Request, res: Response) => {
  let connection: OracleDB.Connection | undefined;
  const createdFiles: string[] = [];
  try {
    const clashRequests = req.body;
    
    // Ensure temp directory exists
    const tempDir = path.join(__dirname, "../temp_ifc");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    connection = await getConnection();

    // Process each clash test request to download IFC files from DB
    for (const test of clashRequests) {
      const processGroup = async (group: any[]) => {
        for (const item of group) {
          if (item.file) {
            const fileName = item.file; // e.g., "model.ifc"
            let dbName = fileName;
            if (dbName.toLowerCase().endsWith(".ifc")) {
                dbName = dbName.substring(0, dbName.length - 4);
            }

            const filePath = path.join(tempDir, fileName);
            
            // Fetch from DB
            const result = await connection!.execute(
              `SELECT "content" FROM "ifc" WHERE "name" = :name`,
              { name: dbName },
              { fetchInfo: { content: { type: OracleDB.BUFFER } }, outFormat: OracleDB.OUT_FORMAT_OBJECT } as any
            );

            if (result.rows && result.rows.length > 0) {
               const row = result.rows[0] as any;
               const buffer = row.CONTENT || row.content; 
               
               if (buffer) {
                   fs.writeFileSync(filePath, buffer);
                   createdFiles.push(filePath);
                   // Update the item.file with absolute path for the clash service
                   item.file = path.resolve(filePath).replace(/\\/g, "/");
                   console.log(`Saved temporary IFC file from DB: ${item.file}`);
               }
            } else {
                console.warn(`Model '${dbName}' not found in DB. Passing original path: ${item.file}`);
                // Ensure path separators are compatible for direct paths
                item.file = item.file.replace(/\\/g, "/");
            }
          }
        }
      };

      if (test.a && Array.isArray(test.a)) await processGroup(test.a);
      if (test.b && Array.isArray(test.b)) await processGroup(test.b);
    }

    console.log("Forwarding clash request:", JSON.stringify(clashRequests, null, 2));

    const response = await fetch("http://127.0.0.1:8000/clash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clashRequests),
    });

    if (!response.ok) {
      res.status(response.status).send(await response.text());
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`Received ZIP size from service: ${buffer.length} bytes`);

    res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
    res.send(buffer);
  } catch (err) {
    console.error("Error proxying clash request:", err);
    res.status(500).json({ error: "Failed to proxy clash detection request", details: err instanceof Error ? err.message : String(err) });
  } finally {
    // Clean up temporary files
    for (const file of createdFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`Deleted temporary file: ${file}`);
        }
      } catch (cleanupErr) {
        console.error(`Failed to delete temporary file ${file}:`, cleanupErr);
      }
    }

    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

// Get ifcs name
app.get("/api/ifcs/name", async (_req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT "id", "name" FROM "ifc"`,
      [],
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
app.get("/api/ifc/:id", async (req: Request, res: Response): Promise<void> => {
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
    const base64Content = ifc.content.toString("base64");
    res.json({ name: ifc.name, content: base64Content });
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
app.post("/api/ifc", upload.single("file"), async (req: Request, res: Response) => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const name = req.file.originalname;
    const bufferContent = req.file.buffer;
    
    const sql = `INSERT INTO "ifc" ("name", "content") VALUES (:name, :content) RETURNING "id" INTO :id`;

    const result = await connection.execute<{ id: number[] }> (
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
app.delete("/api/ifc/:id", async (req: Request, res: Response) => {
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
      console.log(`IFC with ID ${ifcid} deleted successfully.`);
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
app.get("/api/frags/name", async (_req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT "id", "name" FROM "frag"`,
      [],
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
app.get("/api/frag/:id", async (req: Request, res: Response): Promise<void> => {
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
    const base64Content = frag.content.toString("base64");
    res.json({ name: frag.name, content: base64Content });
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
app.post("/api/frag", upload.single("file"), async (req: Request, res: Response) => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    
    const name = req.file.originalname;
    const bufferContent = req.file.buffer;
    
    const sql = `INSERT INTO "frag" ("name", "content") VALUES (:name, :content) RETURNING "id" INTO :id`;
    
    const result = await connection.execute<{ id: number[] }> (
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
app.delete("/api/frag/:id", async (req: Request, res: Response) => {
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
      console.log(`FRAG with ID ${fragid} deleted successfully.`);
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

// Get bcfs name
app.get("/api/bcfs/name", async (_req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT b."id", b."name", ib."ifc_id" as "ifcid" FROM "bcf" b JOIN "ifc_bcf" ib ON b."id" = ib."bcf_id"`,
      [],
      { outFormat: OracleDB.OUT_FORMAT_OBJECT },
    );  
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching bcfs: ", err);
    res.status(500).json({ error: "Failed to fetch bcfs" });
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

// Get BCF
app.get("/api/bcf/:id", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const bcfId = parseInt(req.params.id as string, 10);
    if (isNaN(bcfId)) {
      res.status(400).json({ error: "bcf id 가 숫자가 아님!" });
      return;
    }
    const result = await connection.execute(
      `SELECT "content", "name" FROM "bcf" WHERE "id" = :id`,
      { id: bcfId },
      { 
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
        fetchInfo: { content: { type: OracleDB.BUFFER } },
      } as any
    );  
    const bcf = result.rows?.[0] as {
      content: Buffer | null,
      name: string | null
    };
    if (!bcf || !bcf.content) {
      console.warn(`BCF data not found for id: ${bcfId}`);
      res.status(404).json({ error: "BCF data not found" });
      return;
    }  
    const base64Content = bcf.content.toString("base64");
    res.json({ name: bcf.name, content: base64Content });
  } catch (err) {
    console.error("Error fetching BCF:", err);
    res.status(500).json({ error: "Failed to fetch BCF" });
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

// Post BCF
app.post("/api/bcf", upload.single("file"), async (req: Request, res: Response) => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    
    const name = req.file.originalname;
    const bufferContent = req.file.buffer;
    
    // Validate ifcid
    const rawifcid = req.body.ifcid;
    if (rawifcid === undefined || rawifcid === null || rawifcid === "") {
      return res.status(400).json({ error: "ifcid is required." });
    }

    let ifcIds: number[] = [];
    try {
      if (typeof rawifcid === 'string' && rawifcid.trim().startsWith('[')) {
        const parsed = JSON.parse(rawifcid);
        if (Array.isArray(parsed)) {
          ifcIds = parsed.map((id: any) => Number(id)).filter((id: number) => Number.isInteger(id));
        }
      } else {
        const parsed = Number(rawifcid);
        if (Number.isInteger(parsed)) ifcIds.push(parsed);
      }
    } catch (e) {
      return res.status(400).json({ error: "Invalid ifcid format." });
    }
    
    if (ifcIds.length === 0) {
      return res.status(400).json({ error: "No valid ifcid provided." });
    }

    const sql = `INSERT INTO "bcf" ("name", "content") VALUES (:name, :content) RETURNING "id" INTO :id`;
    console.log("Executing SQL:", sql);
    
    const result = await connection.execute<{ id: number[] }> (
      sql,
      {
        name: {
          val: name,
          type: OracleDB.DB_TYPE_VARCHAR,
          dir: OracleDB.BIND_IN,
        },
        content: {
          val: bufferContent,
          type: OracleDB.DB_TYPE_BLOB,
          dir: OracleDB.BIND_IN,
        },
        id: { 
          type: OracleDB.DB_TYPE_NUMBER,
          dir: OracleDB.BIND_OUT,
        },
      },  
      { autoCommit: false, outFormat: OracleDB.OUT_FORMAT_OBJECT},
    );  
    if (result.outBinds && Array.isArray(result.outBinds.id) && result.outBinds.id.length > 0) {
      const bcfId = result.outBinds.id[0];
      
      const relationSql = `INSERT INTO "ifc_bcf" ("ifc_id", "bcf_id") VALUES (:ifc_id, :bcf_id)`;
      
      for (const ifcId of ifcIds) {
        await connection.execute(
          relationSql,
          {
            ifc_id: { val: ifcId, type: OracleDB.DB_TYPE_NUMBER },
            bcf_id: { val: bcfId, type: OracleDB.DB_TYPE_NUMBER },
          },
          { autoCommit: false }
        );
      }
      await connection.commit();
      
      res.status(201).json({
        message: "BCF inserted successfully",
        id: bcfId,
      });  
    } else {
      console.error("Error inserting BCF: No ID returned");
      res.status(500).json({ error: "Failed to insert BCF" });
    }  
  } catch (err) {
    console.error("Error reading or inserting the bcf file:", err);
    res.status(500).json({ error: "Failed to insert BCF", details: err instanceof Error ? err.message : String(err) });
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

// Delete BCF
app.delete("/api/bcf/:id", async (req: Request, res: Response) => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const bcfId = parseInt(req.params.id as string, 10);
    if (Number.isNaN(bcfId)) {
      res.status(400).json({ error: "Invalid BCF ID" });
      return;
    }

    await connection.execute(
      `DELETE FROM "ifc_bcf" WHERE "bcf_id" = :id`,
      { id: bcfId },
      { autoCommit: false },
    );

    const result = await connection.execute(
      `DELETE FROM "bcf" WHERE "id" = :id`,
      { id: bcfId },
      { autoCommit: true },
    );
    if (result.rowsAffected && result.rowsAffected > 0) {
      console.log(`BCF with ID ${bcfId} deleted successfully.`);
      res.status(200).json({ message: "BCF deleted successfully." });
    } else {
      console.warn(`BCF with ID ${bcfId} not found.`);
      res.status(404).json({ error: "BCF not found." });
    }
  } catch (err) {
    console.error("Error deleting BCF:", err);
    res.status(500).json({ error: "Failed to delete BCF" });
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

// Get BCF Clash Data (JSON 좌표만 독립적으로 가져오기)
app.get("/api/bcf/:id/clash", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const bcfId = parseInt(req.params.id as string, 10);
    if (isNaN(bcfId)) {
      res.status(400).json({ error: "Invalid BCF ID" });
      return;
    }
    const result = await connection.execute(
      `SELECT "clash_data" FROM "bcf" WHERE "id" = :id`,
      { id: bcfId },
      { 
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
        fetchInfo: { clash_data: { type: OracleDB.STRING } }
      } as any
    );  
    const row = result.rows?.[0] as any;
    if (row && row.clash_data) {
      res.json(JSON.parse(row.clash_data));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error("Error fetching BCF Clash Data:", err);
    res.status(500).json({ error: "Failed to fetch BCF Clash Data" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

// Put BCF Clash Data (간섭체크 직후 JSON 좌표 업데이트)
app.put("/api/bcf/:id/clash", async (req: Request, res: Response): Promise<void> => {
  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getConnection();
    const bcfId = parseInt(req.params.id as string, 10);
    if (isNaN(bcfId)) {
      res.status(400).json({ error: "Invalid BCF ID" });
      return;
    }
    const clashDataStr = JSON.stringify(req.body);
    await connection.execute(
      `UPDATE "bcf" SET "clash_data" = :clash_data WHERE "id" = :id`,
      {
        clash_data: { val: clashDataStr, type: OracleDB.DB_TYPE_CLOB },
        id: bcfId
      },
      { autoCommit: true }
    );
    res.status(200).json({ message: "Clash data saved successfully." });
  } catch (err) {
    console.error("Error updating BCF Clash Data:", err);
    res.status(500).json({ error: "Failed to update BCF Clash Data" });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

// Process IFC via Python microservice: Add EDB Data
app.post("/api/add-edb-data", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // 파이썬 마이크로서비스로 전송할 FormData 생성
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

    // 파이썬 서버로부터 처리된 IFC 파일을 받아옵니다.
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
app.post("/api/process-properties", upload.single("file"), async (req: Request, res: Response) => {
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

initPools();
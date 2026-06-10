import express, { Request, Response } from "express";
import cors from "cors";
import OracleDB from "oracledb";
import multer from "multer";

const app = express();
const PORT: number = 3001;
let ifcPool: OracleDB.Pool | undefined;
let mrimsPool: OracleDB.Pool | undefined;

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

const mrimsPoolConfig = {
  user: "mrims",
  password: "123456",
  connectString: "localhost:1521/ORCLPDB",
  poolAlias: 'mrimsPool',
  poolMax: 10,
  poolMin: 2,
  poolIncrement: 1,
};

// ✅ Connection Pool 생성
async function initPools() {
  try {
    ifcPool = await OracleDB.createPool(ifcPoolConfig);
    console.log("✅ IFC Connection Pool 생성 완료");
    mrimsPool = await OracleDB.createPool(mrimsPoolConfig);
    console.log("✅ MRIMS Connection Pool 생성 완료");
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

// ✅ 공통 Connection Pool 연결 함수 (IFC DB)
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

// ✅ 공통 Connection Pool 연결 함수 (MRIMS DB)
async function getMrimsConnection(): Promise<OracleDB.Connection> {
  while (!mrimsPool) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    return await mrimsPool.getConnection();
  } catch (err) {
    throw new Error(`MRIMS Connection failed: ${err}`);
  }
}

// ✅ 공통 Connection Pool 종료 함수
async function closePool() {
  if (ifcPool) { await ifcPool.close(10); }
  if (mrimsPool) { await mrimsPool.close(10); }
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

app.get("/api/bcf/comments", async (req: Request, res: Response): Promise<any> => {
  const mrimsNo = req.query.mrimsNo;
  if (!mrimsNo) {
    return res.status(400).json({ error: "mrimsNo parameter is required." });
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getMrimsConnection();

    const commentResult = await connection.execute(
      `SELECT COMMENT_NO, REVIEW_COMMENT, SOLVE_COMMENT, INSERT_DATE, 
              ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, RESOL_PREPARE_DATE
       FROM SI_BCF_COMMENT
       WHERE TOPIC_NO = :topic_no
       ORDER BY COMMENT_NO ASC`,
      { topic_no: Number(mrimsNo) },
      { 
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
        fetchInfo: { 
          REVIEW_COMMENT: { type: OracleDB.STRING },
          SOLVE_COMMENT: { type: OracleDB.STRING }
        }
      } as any
    );

    const comments = [];
    if (commentResult.rows) {
      for (const row of commentResult.rows as any[]) {
        const commentNo = (row.COMMENT_NO !== undefined && row.COMMENT_NO !== null) ? row.COMMENT_NO : row.comment_no;
        const reviewComment = row.REVIEW_COMMENT || row.review_comment || "";
        const solveComment = row.SOLVE_COMMENT || row.solve_comment || "";
        
        let parsedReviewAuthor = row.ISSUE_PREPARE_NAME || row.issue_prepare_name || "External System";
        let parsedReviewComment = reviewComment;
        let parsedReviewDate = row.ISSUE_PREPARE_DATE || row.issue_prepare_date || row.INSERT_DATE || row.insert_date || new Date().toISOString();

        // 하위 호환성 지원: author:comment(date) 파싱
        const rMatch = reviewComment.trim().match(/^([^:]+):(.*)\(([^)]+)\)$/);
        if (rMatch) {
          parsedReviewAuthor = rMatch[1];
          parsedReviewComment = rMatch[2];
          parsedReviewDate = rMatch[3];
        }

        let parsedSolveAuthor = row.RESOL_PREPARE_NAME || row.resol_prepare_name || "External System";
        let parsedSolveComment = solveComment;
        let parsedSolveDate = row.RESOL_PREPARE_DATE || row.resol_prepare_date || row.INSERT_DATE || row.insert_date || new Date().toISOString();

        const sMatch = solveComment.trim().match(/^([^:]+):(.*)\(([^)]+)\)$/);
        if (sMatch) {
          parsedSolveAuthor = sMatch[1];
          parsedSolveComment = sMatch[2];
          parsedSolveDate = sMatch[3];
        }

        comments.push({
          commentNo,
          reviewComment: reviewComment.trim() !== "" ? {
            comment: parsedReviewComment,
            author: parsedReviewAuthor,
            date: parsedReviewDate
          } : null,
          solveComment: solveComment.trim() !== "" ? {
            comment: parsedSolveComment,
            author: parsedSolveAuthor,
            date: parsedSolveDate
          } : null
        });
      }
    }

    res.json(comments);
  } catch (err) {
    console.error("Error fetching comments from TDVS DB:", err);
    res.status(500).json({ error: "Failed to fetch comments from TDVS", details: err instanceof Error ? err.message : String(err) });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

// GET BCF Topics & Comments from TDVS (SI_BCF_TOPIC & SI_BCF_COMMENT)
app.get("/api/bcf/sync", async (_req: Request, res: Response): Promise<any> => {
  const priFilesQuery = _req.query.priFiles;
  let priFiles: string[] = [];
  if (typeof priFilesQuery === "string" && priFilesQuery.trim() !== "") {
    priFiles = priFilesQuery.split(",").map(s => s.trim()).filter(s => s !== "");
  }

  if (priFiles.length === 0) {
    return res.json([]);
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getMrimsConnection();

    const bindParams: any = {};
    const placeholders = priFiles.map((_, index) => {
      const paramName = `priFile${index}`;
      bindParams[paramName] = priFiles[index];
      return `:` + paramName;
    }).join(", ");

    // 1. Topic 조회 (CLOB 컬럼인 REVIEW_COMMENT을 String으로 가져오도록 fetchInfo 설정)
    const topicResult = await connection.execute(
      `SELECT TOPIC_NO, MRIMS_TYPE, PRI_DISP, REVIEW_COMMENT, COORDX, COORDY, COORDZ, 
              INSERT_DATE, ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, DUE_DATE, PRI_FILE
       FROM SI_BCF_TOPIC
       WHERE PRI_FILE IN (${placeholders})`,
      bindParams,
      { 
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
        fetchInfo: { REVIEW_COMMENT: { type: OracleDB.STRING } }
      } as any
    );

    // 2. Comment 조회 (REVIEW_COMMENT 및 SOLVE_COMMENT 컬럼)
    const commentResult = await connection.execute(
      `SELECT COMMENT_NO, TOPIC_NO, REVIEW_COMMENT, SOLVE_COMMENT, COORDX, COORDY, COORDZ, INSERT_DATE, 
              ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, RESOL_PREPARE_DATE
       FROM SI_BCF_COMMENT
       WHERE TOPIC_NO IN (
         SELECT TOPIC_NO 
         FROM SI_BCF_TOPIC 
         WHERE PRI_FILE IN (${placeholders})
       )`,
      bindParams,
      { 
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
        fetchInfo: { 
          REVIEW_COMMENT: { type: OracleDB.STRING },
          SOLVE_COMMENT: { type: OracleDB.STRING }
        }
      } as any
    );

    const commentsMap = new Map<number, any[]>();
    if (commentResult.rows) {
      for (const row of commentResult.rows as any[]) {
        const topicNo = row.TOPIC_NO || row.topic_no;
        if (!commentsMap.has(topicNo)) {
          commentsMap.set(topicNo, []);
        }

        // Z-up -> Y-up 좌표 변환
        let coord: { x: number; y: number; z: number } | null = null;
        const cx = row.COORDX !== undefined ? row.COORDX : row.coordx;
        const cy = row.COORDY !== undefined ? row.COORDY : row.coordy;
        const cz = row.COORDZ !== undefined ? row.COORDZ : row.coordz;
        if (cx !== null && cy !== null && cz !== null && cx !== undefined && cy !== undefined && cz !== undefined) {
          coord = { x: Number(cx), y: Number(cz), z: -Number(cy) };
        }

        // 2-1. REVIEW_COMMENT 파싱
        const reviewText = row.REVIEW_COMMENT || row.review_comment || "";
        if (reviewText.trim() !== "") {
          let parsedAuthor = row.ISSUE_PREPARE_NAME || row.issue_prepare_name || "External System";
          let parsedComment = reviewText;
          let parsedDate = row.ISSUE_PREPARE_DATE || row.issue_prepare_date || row.INSERT_DATE || row.insert_date || new Date().toISOString();

          // 하위 호환성 지원: 만약 예전 방식의 author:comment(date) 형식인 경우 파싱
          const match = reviewText.trim().match(/^([^:]+):(.*)\(([^)]+)\)$/);
          if (match) {
            parsedAuthor = match[1];
            parsedComment = match[2];
            parsedDate = match[3];
          } else {
            // 구버전 포맷 지원용 차선책
            const firstColonIdx = reviewText.indexOf(":");
            if (firstColonIdx > -1 && reviewText.endsWith(")")) {
              const lastParenIdx = reviewText.lastIndexOf("(");
              if (lastParenIdx > firstColonIdx) {
                parsedAuthor = reviewText.substring(0, firstColonIdx);
                parsedComment = reviewText.substring(firstColonIdx + 1, lastParenIdx);
                parsedDate = reviewText.substring(lastParenIdx + 1, reviewText.length - 1);
              }
            }
          }

          commentsMap.get(topicNo)!.push({
            comment: parsedComment,
            author: parsedAuthor,
            date: parsedDate,
            coord: coord, // 모든 분산 댓글이 동일 좌표 공유
            commentVpGuid: (row.COMMENT_NO !== undefined && row.COMMENT_NO !== null) ? `vp_${row.COMMENT_NO}` : ((row.comment_no !== undefined && row.comment_no !== null) ? `vp_${row.comment_no}` : null) // 가상 viewpoint 식별자 추가
          });
        }

        // 2-2. SOLVE_COMMENT 파싱 및 동일 그룹 결합
        const solveText = row.SOLVE_COMMENT || row.solve_comment || "";
        if (solveText.trim() !== "") {
          let parsedAuthor = row.RESOL_PREPARE_NAME || row.resol_prepare_name || "External System";
          let parsedComment = solveText;
          let parsedDate = row.RESOL_PREPARE_DATE || row.resol_prepare_date || row.INSERT_DATE || row.insert_date || new Date().toISOString();

          // 하위 호환성 지원
          const match = solveText.trim().match(/^([^:]+):(.*)\(([^)]+)\)$/);
          if (match) {
            parsedAuthor = match[1];
            parsedComment = match[2];
            parsedDate = match[3];
          } else {
            // 구버전 포맷 지원용 차선책
            const firstColonIdx = solveText.indexOf(":");
            if (firstColonIdx > -1 && solveText.endsWith(")")) {
              const lastParenIdx = solveText.lastIndexOf("(");
              if (lastParenIdx > firstColonIdx) {
                parsedAuthor = solveText.substring(0, firstColonIdx);
                parsedComment = solveText.substring(firstColonIdx + 1, lastParenIdx);
                parsedDate = solveText.substring(lastParenIdx + 1, solveText.length - 1);
              }
            }
          }

          commentsMap.get(topicNo)!.push({
            comment: parsedComment,
            modifiedAuthor: parsedAuthor,
            modifiedDate: parsedDate,
            coord: coord,
            commentVpGuid: (row.COMMENT_NO !== undefined && row.COMMENT_NO !== null) ? `vp_${row.COMMENT_NO}` : ((row.comment_no !== undefined && row.comment_no !== null) ? `vp_${row.comment_no}` : null)
          });
        }
      }
    }

    const topics = [];
    if (topicResult.rows) {
      for (const row of topicResult.rows as any[]) {
        const topicNo = row.TOPIC_NO || row.topic_no;
        const reviewComment = row.REVIEW_COMMENT || row.review_comment || "";
        const parts = typeof reviewComment === 'string' ? reviewComment.split(";;") : [];
        const title = parts[0] || "No Title";
        const description = parts.slice(1).join(";;") || "";

        // Z-up -> Y-up 좌표 변환
        let coord: { x: number; y: number; z: number } | null = null;
        const tx = row.COORDX !== undefined ? row.COORDX : row.coordx;
        const ty = row.COORDY !== undefined ? row.COORDY : row.coordy;
        const tz = row.COORDZ !== undefined ? row.COORDZ : row.coordz;
        if (tx !== null && ty !== null && tz !== null && tx !== undefined && ty !== undefined && tz !== undefined) {
          coord = { x: Number(tx), y: Number(tz), z: -Number(ty) };
        }

        topics.push({
          mrimsNo: topicNo, // 프론트엔드 호환을 위해 mrimsNo로 매핑
          title,
          description,
          type: row.MRIMS_TYPE || row.mrims_type || "Info",
          priority: row.PRI_DISP || row.pri_disp || "Normal",
          creationAuthor: row.ISSUE_PREPARE_NAME || row.issue_prepare_name || "Admin",
          creationDate: row.ISSUE_PREPARE_DATE || row.issue_prepare_date || new Date().toISOString(),
          assignedTo: row.RESOL_PREPARE_NAME || row.resol_prepare_name || "",
          dueDate: row.DUE_DATE || row.due_date || null,
          coord,
          priFile: row.PRI_FILE || row.pri_file || "",
          comments: commentsMap.get(topicNo) || []
        });
      }
    }

    res.json(topics);
  } catch (err) {
    console.error("Error syncing BCF from TDVS DB:", err);
    res.status(500).json({ error: "Failed to sync BCF from TDVS", details: err instanceof Error ? err.message : String(err) });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
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


// POST BCF Topics & Comments to TDVS (SI_BCF_TOPIC & SI_BCF_COMMENT)
app.post("/api/bcf/send-to-tdvs", async (req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    const topics = req.body;

    if (!Array.isArray(topics) || topics.length === 0) {
      return res.status(400).json({ error: "전송할 토픽 데이터가 유효하지 않거나 비어 있습니다." });
    }

    connection = await getMrimsConnection();

    // 1. 최대 TOPIC_NO 및 COMMENT_NO의 초기값 조회
    const maxTopicResult = await connection.execute<any>(
      `SELECT NVL(MAX(TOPIC_NO), 0) AS MAX_NO FROM SI_BCF_TOPIC`,
      [],
      { outFormat: OracleDB.OUT_FORMAT_OBJECT }
    );
    const tRows = maxTopicResult.rows as any[];
    let nextTopicNo = tRows && tRows.length > 0 ? (tRows[0].MAX_NO || tRows[0].max_no || 0) : 0;

    const maxCommentResult = await connection.execute<any>(
      `SELECT NVL(MAX(COMMENT_NO), 0) AS MAX_NO FROM SI_BCF_COMMENT`,
      [],
      { outFormat: OracleDB.OUT_FORMAT_OBJECT }
    );
    const cRows = maxCommentResult.rows as any[];
    let nextCommentNo = cRows && cRows.length > 0 ? (cRows[0].MAX_NO || cRows[0].max_no || 0) : 0;

    const mapping: any[] = [];
    for (const topic of topics) {
      let isExisting = false;
      let topicNo = topic.mrimsNo ? Number(topic.mrimsNo) : null;

      if (topicNo && !isNaN(topicNo)) {
        // 이미 등록된 토픽인지 조회
        const checkResult = await connection.execute<any>(
          `SELECT COUNT(*) AS CNT FROM SI_BCF_TOPIC WHERE TOPIC_NO = :topic_no`,
          { topic_no: topicNo },
          { outFormat: OracleDB.OUT_FORMAT_OBJECT }
        );
        const cnt = checkResult.rows?.[0]?.CNT || checkResult.rows?.[0]?.cnt || 0;
        if (cnt > 0) {
          isExisting = true;
        }
      }

      // 새 토픽인 경우 신규 번호 할당
      if (!isExisting) {
        nextTopicNo++;
        topicNo = nextTopicNo;
      }

      const reviewComment = `${topic.title};;${topic.description || ""}`;
      const coordX = topic.coord ? topic.coord.x : null;
      const coordY = topic.coord ? topic.coord.y : null;
      const coordZ = topic.coord ? topic.coord.z : null;
      
      const insertDate = topic.creationDate ? new Date(topic.creationDate) : new Date();
      const issuePrepareDate = topic.creationDate ? new Date(topic.creationDate) : new Date();
      const dueDate = topic.dueDate ? new Date(topic.dueDate) : null;

      if (isExisting) {
        // 1. 기존 토픽인 경우 UPDATE 처리 (작성자와 최초작성일은 유지)
        const sqlUpdateTopic = `
          UPDATE SI_BCF_TOPIC SET
            MRIMS_TYPE = :mrims_type,
            PRI_DISP = :pri_disp,
            REVIEW_COMMENT = :review_comment,
            COORDX = :coordx,
            COORDY = :coordy,
            COORDZ = :coordz,
            RESOL_PREPARE_NAME = :resol_prepare_name,
            DUE_DATE = :due_date,
            PRI_FILE = :pri_file
          WHERE TOPIC_NO = :topic_no
        `;

        const bindsUpdateTopic = {
          topic_no: { val: topicNo, type: OracleDB.DB_TYPE_NUMBER },
          mrims_type: { val: topic.type || null, type: OracleDB.DB_TYPE_VARCHAR },
          pri_disp: { val: null, type: OracleDB.DB_TYPE_VARCHAR },
          review_comment: { val: reviewComment, type: OracleDB.DB_TYPE_CLOB },
          coordx: coordX !== null ? { val: coordX, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
          coordy: coordY !== null ? { val: coordY, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
          coordz: coordZ !== null ? { val: coordZ, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
          resol_prepare_name: { val: topic.assignedTo || null, type: OracleDB.DB_TYPE_VARCHAR },
          due_date: dueDate !== null ? { val: dueDate, type: OracleDB.DB_TYPE_DATE } : { val: null, type: OracleDB.DB_TYPE_DATE },
          pri_file: { val: topic.priFile || null, type: OracleDB.DB_TYPE_VARCHAR }
        };

        await connection.execute(sqlUpdateTopic, bindsUpdateTopic, { autoCommit: false });

        // 2. 기존 댓글이 있다면 삭제 후 재인서트하여 중복 방지 및 동기화 처리
        await connection.execute(
          `DELETE FROM SI_BCF_COMMENT WHERE TOPIC_NO = :topic_no`,
          { topic_no: topicNo },
          { autoCommit: false }
        );
      } else {
        // 3. 신규 토픽인 경우 INSERT 처리
        const sqlInsertTopic = `
          INSERT INTO SI_BCF_TOPIC (
            TOPIC_NO, MRIMS_TYPE, PRI_DISP, REVIEW_COMMENT, COORDX, COORDY, COORDZ, 
            INSERT_DATE, ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, DUE_DATE, PRI_FILE
          ) VALUES (
            :topic_no, :mrims_type, :pri_disp, :review_comment, :coordx, :coordy, :coordz,
            :insert_date, :issue_prepare_name, :issue_prepare_date, :resol_prepare_name, :due_date, :pri_file
          )
        `;

        const bindsInsertTopic = {
          topic_no: { val: topicNo, type: OracleDB.DB_TYPE_NUMBER },
          mrims_type: { val: topic.type || null, type: OracleDB.DB_TYPE_VARCHAR },
          pri_disp: { val: null, type: OracleDB.DB_TYPE_VARCHAR },
          review_comment: { val: reviewComment, type: OracleDB.DB_TYPE_CLOB },
          coordx: coordX !== null ? { val: coordX, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
          coordy: coordY !== null ? { val: coordY, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
          coordz: coordZ !== null ? { val: coordZ, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
          insert_date: { val: insertDate, type: OracleDB.DB_TYPE_DATE },
          issue_prepare_name: { val: topic.creationAuthor || null, type: OracleDB.DB_TYPE_VARCHAR },
          issue_prepare_date: { val: issuePrepareDate, type: OracleDB.DB_TYPE_DATE },
          resol_prepare_name: { val: topic.assignedTo || null, type: OracleDB.DB_TYPE_VARCHAR },
          due_date: dueDate !== null ? { val: dueDate, type: OracleDB.DB_TYPE_DATE } : { val: null, type: OracleDB.DB_TYPE_DATE },
          pri_file: { val: topic.priFile || null, type: OracleDB.DB_TYPE_VARCHAR }
        };

        await connection.execute(sqlInsertTopic, bindsInsertTopic, { autoCommit: false });
      }

      // 댓글들이 있는 경우 (새로 작성되었거나 기존의 최신화된 댓글들을 결합하여 일괄 인서트)
      if (topic.comments && Array.isArray(topic.comments) && topic.comments.length > 0) {
        for (const comment of topic.comments) {
          nextCommentNo++;
          const commentNo = nextCommentNo;

          const cCoordX = comment.coord ? comment.coord.x : null;
          const cCoordY = comment.coord ? comment.coord.y : null;
          const cCoordZ = comment.coord ? comment.coord.z : null;

          const sqlComment = `
            INSERT INTO SI_BCF_COMMENT (
              COMMENT_NO, TOPIC_NO, REVIEW_COMMENT, SOLVE_COMMENT, COORDX, COORDY, COORDZ, PRI_FILE,
              ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, RESOL_PREPARE_DATE
            ) VALUES (
              :comment_no, :topic_no, :review_comment, :solve_comment, :coordx, :coordy, :coordz, :pri_file,
              :issue_prepare_name, :issue_prepare_date, :resol_prepare_name, :resol_prepare_date
            )
          `;

          const bindsComment = {
            comment_no: { val: commentNo, type: OracleDB.DB_TYPE_NUMBER },
            topic_no: { val: topicNo, type: OracleDB.DB_TYPE_NUMBER },
            review_comment: { val: comment.reviewComment || null, type: OracleDB.DB_TYPE_CLOB },
            solve_comment: { val: comment.solveComment || null, type: OracleDB.DB_TYPE_CLOB },
            coordx: cCoordX !== null ? { val: cCoordX, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
            coordy: cCoordY !== null ? { val: cCoordY, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
            coordz: cCoordZ !== null ? { val: cCoordZ, type: OracleDB.DB_TYPE_NUMBER } : { val: null, type: OracleDB.DB_TYPE_NUMBER },
            pri_file: { val: topic.priFile || null, type: OracleDB.DB_TYPE_VARCHAR },
            issue_prepare_name: { val: comment.author || null, type: OracleDB.DB_TYPE_VARCHAR },
            issue_prepare_date: { val: comment.date ? new Date(comment.date) : null, type: OracleDB.DB_TYPE_DATE },
            resol_prepare_name: { val: comment.modifiedAuthor || null, type: OracleDB.DB_TYPE_VARCHAR },
            resol_prepare_date: { val: comment.modifiedDate ? new Date(comment.modifiedDate) : null, type: OracleDB.DB_TYPE_DATE }
          };

          await connection.execute(sqlComment, bindsComment, { autoCommit: false });
        }
      }

      mapping.push({ guid: topic.guid, mrimsNo: topicNo });
    }

    await connection.commit();
    res.status(201).json({ 
      message: "BCF Topics and Comments successfully saved to DB.",
      mapping
    });
  } catch (err) {
    console.error("Error saving BCF to TDVS DB:", err);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
    }
    res.status(500).json({ error: "Failed to send BCF to TDVS", details: err instanceof Error ? err.message : String(err) });
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

// Get Saved Clash Statuses
app.get("/api/clash-manager", async (_req: Request, res: Response): Promise<void> => {
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
app.post("/api/clash-manager/filter", async (req: Request, res: Response): Promise<void> => {
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
app.post("/api/clash-manager/upsert", async (req: Request, res: Response): Promise<void> => {
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
app.post("/api/clash-manager/delete-pairs", async (req: Request, res: Response): Promise<void> => {
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

initPools();
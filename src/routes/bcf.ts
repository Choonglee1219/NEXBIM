import express, { Request, Response } from "express";
import OracleDB from "oracledb";
import { getConnection, getMrimsConnection } from "../config/db.js";
import { upload } from "../app.js";

const router = express.Router();

// Get bcfs name
router.get("/api/bcfs/name", async (_req: Request, res: Response): Promise<any> => {
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

router.get("/api/bcf/comments", async (req: Request, res: Response): Promise<any> => {
  const mrimsNo = req.query.mrimsNo;
  if (!mrimsNo) {
    return res.status(400).json({ error: "mrimsNo parameter is required." });
  }

  let connection: OracleDB.Connection | undefined;
  try {
    connection = await getMrimsConnection();

    const commentResult = await connection.execute(
      `SELECT COMMENT_NO, REVIEW_COMMENT, SOLVE_COMMENT, INSERT_DATE, 
              ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, RESOL_PREPARE_DATE,
              COORDX, COORDY, COORDZ
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

        const coordX = row.COORDX !== undefined && row.COORDX !== null ? Number(row.COORDX) : (row.coordx !== undefined && row.coordx !== null ? Number(row.coordx) : null);
        const coordY = row.COORDY !== undefined && row.COORDY !== null ? Number(row.COORDY) : (row.coordy !== undefined && row.coordy !== null ? Number(row.coordy) : null);
        const coordZ = row.COORDZ !== undefined && row.COORDZ !== null ? Number(row.COORDZ) : (row.coordz !== undefined && row.coordz !== null ? Number(row.coordz) : null);

        const coord = (coordX !== null || coordY !== null || coordZ !== null) ? { x: coordX, y: coordY, z: coordZ } : null;

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
          } : null,
          coord
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
router.get("/api/bcf/sync", async (req: Request, res: Response): Promise<any> => {
  const priFilesQuery = req.query.priFiles;
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

    // 1. Topic 조회 (CLOB 컬럼인 REVIEW_COMMENT는 String으로 가져오도록 fetchInfo 설정)
    const topicResult = await connection.execute(
      `SELECT TOPIC_NO, MRIMS_TYPE, PRI_DISP, SEC_DISP, REVIEW_COMMENT, COORDX, COORDY, COORDZ, 
              INSERT_DATE, ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, DUE_DATE, PRI_FILE, ACK_COMMENT_NO
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

          // 하위 호환성 지원: 만약 예전 방식인 author:comment(date) 형식인 경우 파싱
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
            commentNo: Number(row.COMMENT_NO || row.comment_no || 0),
            comment: parsedComment,
            author: parsedAuthor,
            date: parsedDate,
            coord: coord, // 모든 분산 댓글은 동일 좌표 공유
            commentVpGuid: (row.COMMENT_NO !== undefined && row.COMMENT_NO !== null) ? `vp_${row.COMMENT_NO}` : ((row.comment_no !== undefined && row.comment_no !== null) ? `vp_${row.comment_no}` : null) // 개별 viewpoint 식별자 추가
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
            commentNo: Number(row.COMMENT_NO || row.comment_no || 0),
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

        const labels: string[] = [];
        const priDisp = row.PRI_DISP || row.pri_disp;
        const secDisp = row.SEC_DISP || row.sec_disp;
        if (priDisp) {
          labels.push(priDisp.trim());
        }
        if (secDisp) {
          const secLabels = secDisp.split(/[,;]+/).map((s: string) => s.trim()).filter((s: string) => s !== "");
          labels.push(...secLabels);
        }

        topics.push({
          mrimsNo: topicNo, // 프론트엔드 호환성을 위해 mrimsNo로 매핑
          title,
          description,
          type: row.MRIMS_TYPE || row.mrims_type || "Info",
          priority: "Normal",
          creationAuthor: row.ISSUE_PREPARE_NAME || row.issue_prepare_name || "Admin",
          creationDate: row.ISSUE_PREPARE_DATE || row.issue_prepare_date || new Date().toISOString(),
          assignedTo: row.RESOL_PREPARE_NAME || row.resol_prepare_name || "",
          dueDate: row.DUE_DATE || row.due_date || null,
          coord,
          priFile: row.PRI_FILE || row.pri_file || "",
          comments: commentsMap.get(topicNo) || [],
          ackCommentNo: Number(row.ACK_COMMENT_NO || 0),
          labels
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
router.get("/api/bcf/:id", async (req: Request, res: Response): Promise<void> => {
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
    res.setHeader("Content-Type", "application/octet-stream");
    const encodedName = encodeURIComponent(bcf.name || "model.bcf");
    res.setHeader("x-file-name", encodedName);
    res.setHeader("Content-Disposition", `attachment; filename="${encodedName}"`);
    res.send(bcf.content);
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
router.post("/api/bcf", (req, res, next) => upload.single("file")(req, res, next), async (req: Request, res: Response): Promise<any> => {
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

    const result = await connection.execute<{ id: number[] }>(
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
      { autoCommit: false, outFormat: OracleDB.OUT_FORMAT_OBJECT },
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
router.delete("/api/bcf/:id", async (req: Request, res: Response): Promise<any> => {
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
router.post("/api/bcf/send-to-tdvs", async (req: Request, res: Response): Promise<any> => {
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

      // 새 토픽일 경우 신규 번호 할당
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

      const labels = topic.labels || [];
      const priDisp = labels[0] || null;
      const secDisp = labels.slice(1).join(",") || null;

      if (isExisting) {
        // 1. 기존 토픽일 경우 UPDATE 처리 (작성자와 최초작성일은 유지)
        const sqlUpdateTopic = `
          UPDATE SI_BCF_TOPIC SET
            MRIMS_TYPE = :mrims_type,
            PRI_DISP = :pri_disp,
            SEC_DISP = :sec_disp,
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
          pri_disp: { val: priDisp, type: OracleDB.DB_TYPE_VARCHAR },
          sec_disp: { val: secDisp, type: OracleDB.DB_TYPE_VARCHAR },
          review_comment: { val: reviewComment, type: OracleDB.DB_TYPE_VARCHAR },
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
        // 3. 신규 토픽일 경우 INSERT 처리
        const sqlInsertTopic = `
          INSERT INTO SI_BCF_TOPIC (
            TOPIC_NO, MRIMS_TYPE, PRI_DISP, SEC_DISP, REVIEW_COMMENT, COORDX, COORDY, COORDZ, 
            INSERT_DATE, ISSUE_PREPARE_NAME, ISSUE_PREPARE_DATE, RESOL_PREPARE_NAME, DUE_DATE, PRI_FILE
          ) VALUES (
            :topic_no, :mrims_type, :pri_disp, :sec_disp, :review_comment, :coordx, :coordy, :coordz,
            :insert_date, :issue_prepare_name, :issue_prepare_date, :resol_prepare_name, :due_date, :pri_file
          )
        `;

        const bindsInsertTopic = {
          topic_no: { val: topicNo, type: OracleDB.DB_TYPE_NUMBER },
          mrims_type: { val: topic.type || null, type: OracleDB.DB_TYPE_VARCHAR },
          pri_disp: { val: priDisp, type: OracleDB.DB_TYPE_VARCHAR },
          sec_disp: { val: secDisp, type: OracleDB.DB_TYPE_VARCHAR },
          review_comment: { val: reviewComment, type: OracleDB.DB_TYPE_VARCHAR },
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
            review_comment: { val: comment.reviewComment || null, type: OracleDB.DB_TYPE_VARCHAR },
            solve_comment: { val: comment.solveComment || null, type: OracleDB.DB_TYPE_VARCHAR },
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

// POST Acknowledge Sync for a BCF Topic
router.post("/api/bcf/acknowledge-sync", async (req: Request, res: Response): Promise<any> => {
  let connection: OracleDB.Connection | undefined;
  try {
    const { mrimsNo, ackCommentNo } = req.body;
    if (!mrimsNo) {
      return res.status(400).json({ error: "mrimsNo is required" });
    }

    connection = await getMrimsConnection();
    await connection.execute(
      `UPDATE SI_BCF_TOPIC SET ACK_COMMENT_NO = :ack_comment_no WHERE TOPIC_NO = :topic_no`,
      {
        ack_comment_no: Number(ackCommentNo || 0),
        topic_no: Number(mrimsNo)
      },
      { autoCommit: true }
    );
    res.json({ message: "Sync acknowledged successfully." });
  } catch (err) {
    console.error("Error acknowledging BCF sync:", err);
    res.status(500).json({ error: "Failed to acknowledge sync", details: err instanceof Error ? err.message : String(err) });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error(err); }
    }
  }
});

export default router;

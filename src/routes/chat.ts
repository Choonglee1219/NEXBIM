import express, { Request, Response } from "express";
import { StateBridgeCoordinator } from "../services/StateBridge.js";

const router = express.Router();

// Supported Gemini models with automatic fallback on quota exhaustion / rate limits
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"];

interface GeminiCallParams {
  apiKey: string;
  contents: any[];
  systemInstructionText?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/**
 * Call Google Gemini with automatic model fallback
 */
async function callGemini(params: GeminiCallParams): Promise<{ text: string; model: string } | null> {
  const { apiKey, contents, systemInstructionText, temperature = 0.1, maxOutputTokens = 2048, timeoutMs = 12000 } = params;
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY" || apiKey.trim() === "") return null;

  const systemInstruction = systemInstructionText ? { parts: [{ text: systemInstructionText }] } : undefined;

  for (const model of GEMINI_MODELS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            ...(systemInstruction ? { systemInstruction } : {}),
            generationConfig: {
              temperature,
              maxOutputTokens,
            },
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return { text: text.trim(), model };
        }
      } else {
        console.warn(`[Gemini] Model ${model} returned status ${response.status}`);
      }
    } catch (err: any) {
      console.warn(`[Gemini] Model ${model} request failed:`, err.message || err);
    }
  }

  return null;
}

/**
 * Call OpenAI-compatible Custom LLM
 */
async function callCustomLLM(params: {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}): Promise<string | null> {
  const { baseUrl, apiKey, model, messages, temperature = 0.1, maxTokens = 2048 } = params;
  if (!baseUrl || !apiKey || apiKey.trim() === "") return null;

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content;
      return content ? content.trim() : null;
    }
  } catch (err: any) {
    console.warn("[CustomLLM] Call failed:", err.message || err);
  }

  return null;
}

// ------------------------------------------------------------------------------------------------
// 1. BIM AI Assistant Route
// ------------------------------------------------------------------------------------------------
router.post("/api/chat/assistant", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, history, context, mode = "viewport" } = req.body;
    const baseUrl = process.env.LLM_BASE_URL;
    const customApiKey = process.env.LLM_API_KEY;
    const customModel = process.env.LLM_MODEL || "LLM-120B";
    const geminiApiKey = process.env.GEMINI_API_KEY || "";

    // State context compilation
    const coordinator = new StateBridgeCoordinator();
    const compiledContext = await coordinator.compileContext(context);

    // Build system instructions based on mode
    let systemInstructionText = "";
    let modeSuffix = "";

    if (mode === "query") {
      systemInstructionText =
        "You are an AI Query Assistant specialized strictly in generating and configuring BIM Query Builder parameters. " +
        "Your primary task is to convert the user's natural language request into a Query Builder configuration. " +
        "STRICT ACTION PERMISSION SCOPE: You MUST ONLY output `queryBuilderAction` JSON payloads. DO NOT under any circumstances output `ruleBuilderAction`, `viewerAction`, or `queryModel`. " +
        "STRICT TRUTH CONSTRAINT: Answer using facts provided in the '[Application State Context]'. Always respond politely and concisely in Korean. " +
        "IMPORTANT FORMATTING RULE: Do NOT wrap regexes in slashes. Write raw pipe-separated names (e.g. 'Wall|Slab'). " +
        "Output a JSON action payload inside a ```json ``` block at the end:\n" +
        "{\n  \"queryBuilderAction\": { \"name\": string, \"entity\": string, \"attrName\"?: string, \"attrVal\"?: string, \"psetName\"?: string, \"propName\"?: string, \"propVal\"?: string, \"containedIn\"?: string, \"structureName\"?: string, \"autoExecute\": true }\n}";
      modeSuffix = "\n\nCRITICAL MANDATORY INSTRUCTION: You MUST output the `queryBuilderAction` JSON payload wrapped in a ```json ``` codeblock at the very end of your response.";
    } else if (mode === "rule") {
      systemInstructionText =
        "You are an AI Quality & Rule Assistant specialized strictly in generating and configuring BIM Rule Builder specifications. " +
        "STRICT ACTION PERMISSION SCOPE: You MUST ONLY output `ruleBuilderAction` JSON payloads. " +
        "FACET TYPES: property, quantity, attribute, material, classification, partof. " +
        "RESTRICTION PARAMETERS: exists, pattern, simple, enumeration, bounds, length. " +
        "STRICT TRUTH CONSTRAINT: Answer using facts provided in the '[Application State Context]'. Always respond politely and concisely in Korean. " +
        "Output a JSON action payload inside a ```json ``` block at the end:\n" +
        "{\n  \"ruleBuilderAction\": { \"entity\": string, \"reqType\": string, \"pset\"?: string, \"name\": string, \"condition\": string, \"value\": string, \"autoExecute\": true }\n}";
      modeSuffix = "\n\nCRITICAL MANDATORY INSTRUCTION: You MUST output the `ruleBuilderAction` JSON payload wrapped in a ```json ``` codeblock at the very end of your response.";
    } else {
      systemInstructionText =
        "You are NEXBIM AI Assistant, a full-featured general-purpose AI assistant for this 3D BIM Web Application. " +
        "Help the user query, analyze, inspect, and control the 3D model, create queries, write rule specifications, perform clash detections, and answer application/engineering concepts. " +
        "Always respond politely and concisely in Korean. " +
        "STRICT TRUTH CONSTRAINT: Answer ONLY using facts provided in the '[Application State Context]'. If not found, reply '제공된 모델 정보나 사용자 매뉴얼/지식 베이스에서 관련 내용을 찾을 수 없습니다.' " +
        "If an action is requested, output `viewerAction`, `queryBuilderAction`, or `ruleBuilderAction` inside a ```json ``` block at the end.";
      modeSuffix = "\n\nCRITICAL INSTRUCTION: If an action is required, output the appropriate JSON payload (`viewerAction`, `queryBuilderAction`, or `ruleBuilderAction`) wrapped in a ```json ``` codeblock at the very end.";
    }

    let userText = compiledContext ? `[Application State Context]:\n${compiledContext}\n\n` : "";
    userText += message + modeSuffix;

    const contents = [...(history || [])];
    contents.push({ role: "user", parts: [{ text: userText }] });

    // 1. Try Gemini
    const geminiResult = await callGemini({
      apiKey: geminiApiKey,
      contents,
      systemInstructionText,
      temperature: 0.1,
      maxOutputTokens: 1024,
    });

    if (geminiResult) {
      res.json({ reply: geminiResult.text });
      return;
    }

    // 2. Try Custom LLM fallback
    const openaiMessages = [{ role: "system", content: systemInstructionText }];
    if (history && Array.isArray(history)) {
      for (const h of history) {
        openaiMessages.push({
          role: h.role === "model" ? "assistant" : "user",
          content: h.parts?.[0]?.text || "",
        });
      }
    }
    openaiMessages.push({ role: "user", content: userText });

    const customReply = await callCustomLLM({
      baseUrl,
      apiKey: customApiKey || geminiApiKey,
      model: customModel,
      messages: openaiMessages,
      temperature: 0.1,
      maxTokens: 1024,
    });

    if (customReply) {
      res.json({ reply: customReply });
      return;
    }

    res.status(502).json({ error: "Failed to connect to any chat service." });
  } catch (err) {
    console.error("[Chat Assistant] Error:", err);
    res.status(500).json({ error: "Internal server error in chat proxy." });
  }
});

// ------------------------------------------------------------------------------------------------
// 2. BCF Topic Description Translation Route
// ------------------------------------------------------------------------------------------------
router.post("/api/chat/translate", async (req: Request, res: Response): Promise<void> => {
  try {
    const { texts, targetLang = "Korean" } = req.body;
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      res.json({ translations: [] });
      return;
    }

    const baseUrl = process.env.LLM_BASE_URL;
    const customApiKey = process.env.LLM_API_KEY;
    const customModel = process.env.LLM_MODEL || "LLM-120B";
    const geminiApiKey = process.env.GEMINI_API_KEY || "";

    // Robust Tagged XML Protocol
    const taggedInput = texts
      .map((t, idx) => `<item index="${idx}">${String(t).replace(/<\/?item[^>]*>/gi, "")}</item>`)
      .join("\n");

    const promptText = `You are a professional translator specialized in Architecture, Engineering, and Construction (BIM / BCF).
Translate the natural language descriptions inside each <item index="...">...</item> tag into ${targetLang}.
Rules:
- Keep technical terms (e.g. IFC class names, element IDs, GUIDs, coordinates, numbers, brand names) intact.
- Translate natural language descriptions naturally and accurately into ${targetLang}.
- Output ONLY the translated <item index="...">translated content</item> tags for each item in the same order.
- Do not output any markdown code fences, JSON, or explanatory text.

Input items:
${taggedInput}`;

    const parseTagResponse = (replyText: string): Map<number, string> => {
      const itemRegex = /<item\s+index="(\d+)">([\s\S]*?)<\/item>/gi;
      const map = new Map<number, string>();
      let match: RegExpExecArray | null;
      while ((match = itemRegex.exec(replyText)) !== null) {
        map.set(parseInt(match[1], 10), match[2].trim());
      }
      return map;
    };

    // 1. Try Gemini
    const geminiResult = await callGemini({
      apiKey: geminiApiKey,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      temperature: 0.1,
      maxOutputTokens: 8192,
      timeoutMs: 12000,
    });

    if (geminiResult) {
      const map = parseTagResponse(geminiResult.text);
      if (map.size > 0) {
        const translations = texts.map((orig, idx) => map.get(idx) ?? orig);
        res.json({ translations });
        return;
      }
    }

    // 2. Try Custom LLM fallback
    const customReply = await callCustomLLM({
      baseUrl,
      apiKey: customApiKey || geminiApiKey,
      model: customModel,
      messages: [
        {
          role: "system",
          content: `You are a professional AEC translator. Translate texts inside <item index="..."> tags into ${targetLang} and output ONLY the translated <item index="..."> tags.`,
        },
        { role: "user", content: promptText },
      ],
      temperature: 0.1,
      maxTokens: 4096,
    });

    if (customReply) {
      const map = parseTagResponse(customReply);
      if (map.size > 0) {
        const translations = texts.map((orig, idx) => map.get(idx) ?? orig);
        res.json({ translations });
        return;
      }
    }

    // Fallback: return original texts
    res.json({ translations: [...texts] });
  } catch (err) {
    console.error("[Translation API] Error:", err);
    res.json({ translations: req.body?.texts || [] });
  }
});

export default router;

import express, { Request, Response } from "express";
import { StateBridgeCoordinator } from "../services/StateBridge.js";

const router = express.Router();

// Gemini Chat API Proxy
router.post("/api/chat/assistant", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, history, context } = req.body;
    const baseUrl = process.env.LLM_BASE_URL;
    const customApiKey = process.env.LLM_API_KEY;
    const customModel = process.env.LLM_MODEL || "LLM-120B";

    // Compile unified context using StateBridgeCoordinator
    const coordinator = new StateBridgeCoordinator();
    const compiledContext = await coordinator.compileContext(context);

    // System instruction to guide model responses & viewer actions
    const systemInstructionText = "You are a professional BIM Assistant, an AI assistant integrated into a 3D BIM viewer (NEXBIM). " +
      "Your role is to help the user query, analyze, and control the 3D model, inspect/run clash detections, and understand application features. " +
      "You have access to the currently loaded model names, element counts by category, currently selected element properties, clash count statistics, and the NEXBIM User Manual. " +
      "Always respond politely and concisely. If the user asks about how to use the application or its specific layouts/features, answer using the information in the provided User Manual. " +
      "IMPORTANT: If the user asks you to perform a visual action, clash function, switch layout tabs, or query/count specific elements with attributes/properties (e.g. 'highlight columns', 'run clash detection', 'switch to BCF topics tab', 'Slab 에서 PredefinedType이 BASESLAB인 객체 수 알려줘'), you MUST output a JSON action payload at the very end of your response, wrapped inside a ```json ``` block. " +
      "The JSON block must match this structure EXACTLY (do not describe it, just output it):\n" +
      "{\n" +
      "  \"viewerAction\": {\n" +
      "    \"type\": \"highlight\" | \"isolate\" | \"hide\" | \"focus\" | \"showAll\" | \"ghostMode\" | \"clipperBox\" | \"runClash\" | \"filterClash\" | \"switchTab\" | \"queryModel\",\n" +
      "    \"target\": \"selection\" | \"category\" | \"id\" | \"search\" | \"layout\" | \"query\",\n" +
      "    \"value\": \"IfcColumn\" | 12345 | [12345, 67890] | \"search_query_string\" | \"Viewer\" | \"BCFManager\" | \"Queries\" | \"Properties\" | \"ViewPoints\" | \"IDSCheck\" | \"Quantities\" | \"ClashDetection\" | \"DrawingEditor\" | \"Timeline\" | {\"entity\": \"Slab\", \"attributeName\": \"PredefinedType\", \"attributeValue\": \"BASESLAB\", \"layout\": \"Quantities\"}\n" +
      "  }\n" +
      "}\n" +
      "- For highlighting/isolating/hiding a category, set target='category' and value=IfcClass (e.g. 'IfcColumn', 'IfcWall', 'IfcSlab').\n" +
      "- For focusing on selected items or resetting view, value is not required. Just set type='focus' or type='showAll'.\n" +
      "- For running clash detection, set type='runClash'.\n" +
      "- For filtering the clash list, set type='filterClash', target='search', and value='keyword' (e.g. 'IfcPipeSegment' or '기둥').\n" +
      "- For switching layout tabs (Viewer, BCFManager, Queries, Properties, ViewPoints, IDSCheck, Quantities, ClashDetection, DrawingEditor, Timeline), set type='switchTab', target='layout', and value=layoutName.\n" +
      "- For querying/filtering elements by category, attributes, or properties (like Query Builder), set type='queryModel', target='query', and value as an object:\n" +
      "  {\n" +
      "    \"entity\": \"Slab\" | \"Wall\" | \"Column\" | etc (optional),\n" +
      "    \"attributeName\": \"PredefinedType\" | \"Name\" | etc (optional),\n" +
      "    \"attributeValue\": \"BASESLAB\" | etc (optional),\n" +
      "    \"propertySetName\": \"Pset_WallCommon\" | etc (optional),\n" +
      "    \"propertyName\": \"IsExternal\" | etc (optional),\n" +
      "    \"propertyValue\": \"True\" | \"False\" | 123 | etc (optional),\n" +
      "    \"layout\": \"Quantities\" | \"Queries\" | etc (optional - set layout='Quantities' if user asks to see quantities/volume/water/cost/takeoff tables for the queried objects)\n" +
      "  }\n" +
      "- Only output the action payload if the user explicitly asks for visual controls, highlighting, camera adjustments, clash operations, tab switches, or element queries.";

    let replyText = "";
    let success = false;
    const errors: string[] = [];

    // 1. Try Google Gemini first
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (geminiApiKey && geminiApiKey !== "YOUR_GEMINI_API_KEY" && geminiApiKey.trim() !== "") {
      try {
        console.log("Trying Google Gemini API...");
        const systemInstruction = {
          parts: [{ text: systemInstructionText }]
        };

        // Combine history, current message, and context
        const contents = [...(history || [])];

        let userText = "";
        if (compiledContext) {
          userText += `[Application State Context]:\n${compiledContext}\n\n`;
        }
        userText += message;

        contents.push({
          role: "user",
          parts: [{ text: userText }]
        });

        // Add an AbortController with 15 seconds timeout to allow processing time
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents,
              systemInstruction,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 1024,
              }
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = (await response.json()) as any;
          replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No reply from Gemini.";
          success = true;
          console.log("Google Gemini API call succeeded.");
        } else {
          const errText = await response.text();
          errors.push(`Gemini API returned status ${response.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Gemini API request failed: ${err.message || err}`);
      }
    } else {
      errors.push("Gemini API key is not configured.");
    }

    // 2. If Gemini failed (e.g. ENOTFOUND when offline), try Custom LLM fallback
    if (!success && baseUrl) {
      try {
        console.log("Gemini failed. Falling back to Custom LLM API...");
        const activeApiKey = customApiKey || geminiApiKey;
        if (!activeApiKey || activeApiKey.trim() === "") {
          throw new Error("Custom LLM API key is not configured.");
        }

        // Map Gemini history format { role, parts: [{ text }] } to OpenAI format
        const openaiMessages: any[] = [];
        openaiMessages.push({ role: "system", content: systemInstructionText });

        if (history && Array.isArray(history)) {
          for (const h of history) {
            const role = h.role === "model" ? "assistant" : "user";
            const content = h.parts?.[0]?.text || "";
            openaiMessages.push({ role, content });
          }
        }

        let userText = "";
        if (compiledContext) {
          userText += `[Application State Context]:\n${compiledContext}\n\n`;
        }
        userText += message;
        openaiMessages.push({ role: "user", content: userText });

        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${activeApiKey}`,
          },
          body: JSON.stringify({
            model: customModel,
            messages: openaiMessages,
            temperature: 0.2,
            max_tokens: 1024,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          replyText = data.choices?.[0]?.message?.content || "No reply from custom LLM.";
          success = true;
          console.log("Custom LLM API call succeeded.");
        } else {
          const errText = await response.text();
          errors.push(`Custom LLM API returned status ${response.status}: ${errText}`);
        }
      } catch (err: any) {
        errors.push(`Custom LLM API request failed: ${err.message || err}`);
      }
    }

    if (success) {
      res.json({ reply: replyText });
    } else {
      console.error("All chat routes failed. Errors:", errors);
      res.status(502).json({ error: "Failed to connect to any chat service.", details: errors });
    }
  } catch (err) {
    console.error("Error in Gemini chat route:", err);
    res.status(500).json({ error: "Internal server error in Gemini chat proxy." });
  }
});

export default router;

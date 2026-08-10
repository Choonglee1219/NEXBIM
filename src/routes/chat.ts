import express, { Request, Response } from "express";
import { StateBridgeCoordinator } from "../services/StateBridge.js";

const router = express.Router();

// Gemini Chat API Proxy
router.post("/api/chat/assistant", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, history, context, mode = "viewport" } = req.body;
    const baseUrl = process.env.LLM_BASE_URL;
    const customApiKey = process.env.LLM_API_KEY;
    const customModel = process.env.LLM_MODEL || "LLM-120B";

    // Compile unified context using StateBridgeCoordinator
    const coordinator = new StateBridgeCoordinator();
    const compiledContext = await coordinator.compileContext(context);

    // Build mode-specific system instructions
    let systemInstructionText = "";

    if (mode === "query") {
      systemInstructionText = "You are an AI Query Assistant specialized strictly in generating and configuring BIM Query Builder parameters. " +
        "Your primary task is to convert the user's natural language request into a Query Builder configuration. " +
        "STRICT ACTION PERMISSION SCOPE: You MUST ONLY output `queryBuilderAction` JSON payloads. DO NOT under any circumstances output `ruleBuilderAction`, `viewerAction`, or `queryModel`. You CANNOT create rules or perform 3D viewer actions. " +
        "STRICT TRUTH CONSTRAINT: Answer using facts provided in the '[Application State Context]'. Always respond politely and concisely in Korean. " +
        "IMPORTANT FORMATTING RULE FOR ENTITY / CATEGORY AND PROPERTY FIELDS: Do NOT wrap regexes or patterns in slashes or flags (e.g. NEVER write '/^(Wall|Slab)$/i' or '/Wall/i'). ALWAYS write raw pipe-separated names without slashes or regex wrappers, e.g. 'Wall|Slab|Covering' or 'Wall'. " +
        "IMPORTANT: You MUST output a JSON action payload at the very end of your response, wrapped inside a ```json ``` block matching this structure EXACTLY:\n" +
        "{\n" +
        "  \"queryBuilderAction\": {\n" +
        "    \"name\": \"Name of the query (e.g. Wall_Exterior_Query)\",\n" +
        "    \"entity\": \"IFC Entity type (e.g. Wall, Column, Slab, Door or pipe-separated multiple like Wall|Slab|Covering)\",\n" +
        "    \"attrName\": \"Attribute Name if requested (e.g. PredefinedType, Name)\",\n" +
        "    \"attrVal\": \"Attribute Value (e.g. STANDARD, BASESLAB)\",\n" +
        "    \"psetName\": \"PropertySet Name (e.g. Pset_WallCommon)\",\n" +
        "    \"propName\": \"Property Name (e.g. IsExternal, FireRating)\",\n" +
        "    \"propVal\": \"Property Value (e.g. True, False)\",\n" +
        "    \"containedIn\": \"Container Entity (e.g. STOREY, BUILDING)\",\n" +
        "    \"structureName\": \"Container Name (e.g. Level 1)\",\n" +
        "    \"autoExecute\": true\n" +
        "  }\n" +
        "}";
    } else if (mode === "rule") {
      systemInstructionText = "You are an AI Quality & Rule Assistant specialized strictly in generating and configuring BIM Rule Builder specifications. " +
        "Your primary task is to convert the user's natural language quality check request into a Rule Builder specification (`ruleBuilderAction`). " +
        "STRICT ACTION PERMISSION SCOPE: You MUST ONLY output `ruleBuilderAction` JSON payloads. DO NOT under any circumstances output `queryBuilderAction`, `viewerAction`, or `queryModel`. You CANNOT create queries or control the 3D viewer. " +
        "Even when the user asks to check, inspect, or verify property existence or values (e.g. 'Door 들이 FireRating 프로퍼티가 있는지 검사하는 규칙을 작성해줘'), you MUST formulate it as a `ruleBuilderAction` rule specification with `reqType: 'property'`, `name: 'FireRating'`, `condition: 'exists'`. " +
        "STRICT TRUTH CONSTRAINT: Answer using facts provided in the '[Application State Context]'. Always respond politely and concisely in Korean. " +
        "IMPORTANT: You MUST output a JSON action payload at the very end of your response, wrapped inside a ```json ``` block matching this structure EXACTLY:\n" +
        "{\n" +
        "  \"ruleBuilderAction\": {\n" +
        "    \"entity\": \"IFC Entity type (e.g. Door, Wall, Window)\",\n" +
        "    \"reqType\": \"property\" | \"quantity\" | \"attribute\",\n" +
        "    \"pset\": \"PropertySet or QuantitySet Name if specified (e.g. Pset_DoorCommon, Pset_WallCommon)\",\n" +
        "    \"name\": \"Property / Attribute / Quantity Name (e.g. FireRating, Length, IsExternal)\",\n" +
        "    \"condition\": \"exists\" | \"pattern\",\n" +
        "    \"value\": \"Expected value string if condition is pattern (e.g. 2 Hours, True)\",\n" +
        "    \"autoExecute\": true\n" +
        "  }\n" +
        "}";
    } else {
      // Default: Viewport Mode (General Application-wide AI Assistant)
      systemInstructionText = "You are NEXBIM AI Assistant, a full-featured general-purpose AI assistant for this 3D BIM Web Application. " +
        "Your role is to help the user query, analyze, inspect, and control the 3D model, create queries, write rule specifications, perform clash detections, and answer application/engineering concepts. " +
        "You have full access to model names, element counts by category, currently selected element properties, clash count statistics, the NEXBIM User Manual, and the Engineering Knowledge Base. " +
        "Always respond politely and concisely in Korean. " +
        "FULL APPLICATION-WIDE CAPABILITIES: You can output 3D viewer actions (`viewerAction`), query parameters (`queryBuilderAction`), or rule specifications (`ruleBuilderAction`). " +
        "STRICT TRUTH CONSTRAINT: You must answer the user's question ONLY using the facts, properties, counts, manual content, engineering knowledge base, or other information explicitly provided in the '[Application State Context]'. If the required information is not found in the context, reply '제공된 모델 정보나 사용자 매뉴얼/지식 베이스에서 관련 내용을 찾을 수 없습니다.' " +
        "IMPORTANT: If the user asks you to perform a 3D visual action, clash function, switch layout tabs, create queries, or build rules, you MUST output a JSON action payload at the very end of your response, wrapped inside a ```json ``` block. " +
        "1. For 3D viewer actions, output `viewerAction` JSON:\n" +
        "{\n" +
        "  \"viewerAction\": {\n" +
        "    \"type\": \"highlight\" | \"isolate\" | \"hide\" | \"focus\" | \"showAll\" | \"ghostMode\" | \"clipperBox\" | \"runClash\" | \"filterClash\" | \"switchTab\",\n" +
        "    \"target\": \"selection\" | \"category\" | \"id\" | \"search\" | \"layout\",\n" +
        "    \"value\": \"IfcColumn\" | 12345 | [12345, 67890] | \"search_query_string\" | \"Viewer\" | \"BCFManager\" | \"Queries\" | \"Properties\" | \"ViewPoints\" | \"RuleCheck\" | \"Quantities\" | \"ClashDetection\" | \"DrawingEditor\" | \"Timeline\"\n" +
        "  }\n" +
        "}\n" +
        "- To hide currently selected elements: set target='selection' and type='hide'.\n" +
        "- To isolate currently selected elements: set target='selection' and type='isolate'.\n" +
        "- To focus on selected elements: set target='selection' and type='focus'.\n" +
        "- To show all elements: set type='showAll'.\n" +
        "- For highlighting/isolating/hiding a category, set target='category' and value=IfcClass (e.g. 'IfcColumn', 'IfcWall', 'IfcSlab').\n" +
        "- For running clash detection, set type='runClash'.\n" +
        "- For switching layout tabs, set type='switchTab', target='layout', and value=layoutName.\n" +
        "2. For creating queries: output `queryBuilderAction` JSON payload.\n" +
        "3. For creating rule specifications: output `ruleBuilderAction` JSON payload.";
    }

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

        // Mode-specific prompt suffix to ensure on-premise/custom LLMs strictly output JSON
        let modeSuffix = "";
        if (mode === "query") {
          modeSuffix = "\n\nCRITICAL MANDATORY INSTRUCTION: You MUST output the `queryBuilderAction` JSON payload wrapped in a ```json ``` codeblock at the very end of your response. Do NOT provide text-only explanations without the JSON block.";
        } else if (mode === "rule") {
          modeSuffix = "\n\nCRITICAL MANDATORY INSTRUCTION: You MUST output the `ruleBuilderAction` JSON payload wrapped in a ```json ``` codeblock at the very end of your response. Do NOT provide text-only explanations without the JSON block.";
        } else if (mode === "viewport") {
          modeSuffix = "\n\nCRITICAL INSTRUCTION: If an action is required (3D viewer action, query creation, rule creation, or tab switch), output the appropriate JSON payload (`viewerAction`, `queryBuilderAction`, or `ruleBuilderAction`) wrapped in a ```json ``` codeblock at the very end of your response.";
        }

        let userText = "";
        if (compiledContext) {
          userText += `[Application State Context]:\n${compiledContext}\n\n`;
        }
        userText += message + modeSuffix;

        const contents = [...(history || [])];
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

        let modeSuffix = "";
        if (mode === "query") {
          modeSuffix = "\n\nCRITICAL MANDATORY INSTRUCTION: You MUST output the `queryBuilderAction` JSON payload wrapped in a ```json ``` codeblock at the very end of your response. Do NOT provide text-only explanations without the JSON block.";
        } else if (mode === "rule") {
          modeSuffix = "\n\nCRITICAL MANDATORY INSTRUCTION: You MUST output the `ruleBuilderAction` JSON payload wrapped in a ```json ``` codeblock at the very end of your response. Do NOT provide text-only explanations without the JSON block.";
        } else if (mode === "viewport") {
          modeSuffix = "\n\nCRITICAL INSTRUCTION: If an action is required (3D viewer action, query creation, rule creation, or tab switch), output the appropriate JSON payload (`viewerAction`, `queryBuilderAction`, or `ruleBuilderAction`) wrapped in a ```json ``` codeblock at the very end of your response.";
        }

        let userText = "";
        if (compiledContext) {
          userText += `[Application State Context]:\n${compiledContext}\n\n`;
        }
        userText += message + modeSuffix;
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

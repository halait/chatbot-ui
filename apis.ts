import type { Message } from "./main.js";

export const apiMap: { [key: string]: Api } = {
  "openai.com": {
    defaultModel: "gpt-5-mini",
    paramsSchema: {
      type: "object",
      properties: {
        key: { type: "string", format: "password" },
        model: { type: "string" },
        temperture: { type: "number" },
        max_output_tokens: { type: "number" },
        stream: { type: "boolean", default: true },
        store: { type: "boolean" },
        reasoning: {
          type: "object",
          title: "reasoning",
          properties: {
            effort: {
              enum: ["none", "minimal", "low", "medium", "high", "xhigh"],
            },
            summary: {
              enum: ["auto", "concise", "detailed"],
            },
          },
        },
        prompt_cache_retention: {
          enum: ["in-memory", "24h"],
        },
        prompt_cache_key: { type: "string" },
      },
    },
    fetcher: async function* (
      messages: Message[],
      params: any,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const { key, ...regularParams } = params;
      if (!key) {
        throw new Error("API key is required");
      }
      const firstDeveloper =
        messages[0]?.role === "developer" ? messages[0].content : null;
      if (firstDeveloper) {
        messages = messages.slice(1);
      }
      const body = {
        input: messages,
        ...regularParams,
      } as any;
      if (firstDeveloper) body["instructions"] = firstDeveloper;
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "post",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const data = await response.json();
        const textItem = data.output?.find(
          (item: any) => item.type === "message",
        );
        yield textItem?.content[0]?.text;
        return;
      } else if (
        response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (!response.body)
          throw new Error("Response body is null for stream response");
        for await (const { event, data } of sseParser(
          response.body.getReader(),
        )) {
          if (event === "response.output_text.delta") {
            yield JSON.parse(data).delta;
          }
        }
      } else {
        throw new Error(
          "Unsupported response type: " + response.headers.get("Content-Type"),
        );
      }
    },
  },
  "deepseek.com": {
    defaultModel: "deepseek-chat",
    paramsSchema: {
      type: "object",
      properties: {
        key: { type: "string", format: "password" },
        model: { type: "string" },
        thinking: {
          enum: ["enabled", "disabled"],
        },
        frequency_penalty: { type: "number", min: -2, max: 2 },
        max_tokens: { type: "number" },
        presence_penalty: { type: "number", min: -2, max: 2 },
        response_format: { enum: ["text", "json_object"] },
        stream: { type: "boolean", default: true },
        temperature: { type: "number", min: 0, max: 2 },
        top_p: { type: "number", min: 0, max: 1 },
      },
    },
    fetcher: async function* (
      messages: Message[],
      params: any,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const { key, ...regularParams } = params;
      if (!key) {
        throw new Error("API key is required");
      }
      messages = messages.map((message: any) => {
        if (message.role === "developer") {
          return { role: "system", content: message.content };
        }
        return message;
      });
      const body = {
        messages,
        ...regularParams,
      } as any;
      const response = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "post",
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const data = await response.json();
        yield data.choices?.[0]?.message?.content;
        return;
      } else if (
        response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (!response.body)
          throw new Error("Response body is null for stream response");
        for await (const { event, data } of sseParser(
          response.body.getReader(),
        )) {
          if (data) {
            yield JSON.parse(data).choices?.[0]?.delta?.content;
          }
        }
      } else {
        throw new Error(
          "Unsupported response type: " + response.headers.get("Content-Type"),
        );
      }
    },
  },
  "mistral.ai": {
    defaultModel: "mistral-small-latest",
    paramsSchema: {
      type: "object",
      properties: {
        key: { type: "string", format: "password" },
        model: { type: "string" },
        frequency_penalty: { type: "number" },
        max_tokens: { type: "number" },
        n: { type: "number" },
        presence_penalty: { type: "number" },
        prompt_mode: { enum: ["reasoning"] },
        random_seed: { type: "number" },
        response_format: {
          type: "object",
          properties: {
            type: { enum: ["text", "json_object"] },
          },
        },
        safe_prompt: { type: "boolean" },
        stop: { type: "string" },
        stream: { type: "boolean", default: true },
        temperature: { type: "number" },
        top_p: { type: "number" },
      },
    },
    fetcher: async function* (
      messages: Message[],
      params: any,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const { key, ...regularParams } = params;
      if (!key) {
        throw new Error("API key is required");
      }
      messages = messages.map((message: any) => {
        if (message.role === "developer") {
          return { role: "system", content: message.content };
        }
        return message;
      });
      const body = {
        messages,
        ...regularParams,
      } as any;
      const response = await fetch(
        "https://api.mistral.ai/v1/chat/completions",
        {
          method: "post",
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const data = await response.json();
        yield data.choices[0]?.message?.content.find(
          (item: any) => item.type === "text",
        )?.text;
        return;
      } else if (
        response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (!response.body)
          throw new Error("Response body is null for stream response");
        for await (const { event, data } of sseParser(
          response.body.getReader(),
        )) {
          if (data) {
            const text = JSON.parse(data).choices?.[0]?.delta?.content;
            if (typeof text === "string") {
              yield text;
            }
          }
        }
      } else {
        throw new Error(
          "Unsupported response type: " + response.headers.get("Content-Type"),
        );
      }
    },
  },
  "x.ai": {
    defaultModel: "grok-4-1-fast-reasoning",
    paramsSchema: {
      type: "object",
      properties: {
        key: { type: "string", format: "password" },
        model: { type: "string" },
        frequency_penalty: { type: "number" },
        max_completion_tokens: { type: "number" },
        n: { type: "number" },
        presence_penalty: { type: "number" },
        reasoning_effort: { enum: ["low", "high"] },
        response_format: { enum: ["text", "json_object"] },
        seed: { type: "number" },
        stream: { type: "boolean", default: true },
        stream_options: {
          type: "object",
          properties: {
            include_usage: { type: "boolean" },
          },
        },
        temperature: { type: "number", min: 0, max: 2 },
        top_p: { type: "number", min: 0, max: 1 },
      },
    },
    fetcher: async function* (
      messages: Message[],
      params: any,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const { key, ...regularParams } = params;
      if (!key) {
        throw new Error("API key is required");
      }
      messages = messages.map((message: any) => {
        if (message.role === "developer") {
          return { role: "system", content: message.content };
        }
        return message;
      });
      const body = {
        messages,
        ...regularParams,
      } as any;
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "post",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const data = await response.json();
        yield data.choices?.[0]?.message?.content;
        return;
      } else if (
        response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (!response.body)
          throw new Error("Response body is null for stream response");
        for await (const { event, data } of sseParser(
          response.body.getReader(),
        )) {
          if (data) {
            yield JSON.parse(data).choices?.[0]?.delta?.content;
          }
        }
      } else {
        throw new Error(
          "Unsupported response type: " + response.headers.get("Content-Type"),
        );
      }
    },
  },
  "anthropic.com": {
    defaultModel: "claude-haiku-4-5",
    paramsSchema: {
      type: "object",
      properties: {
        key: { type: "string", format: "password" },
        model: { type: "string" },
        max_tokens: { type: "number", default: 1024 },
        cache_control: {
          type: "object",
          properties: {
            type: { enum: ["ephemeral"], default: "ephemeral" },
            ttl: { enum: ["5m", "1h"] },
          },
        },
        container: { type: "string" },
        inference_geo: { type: "string" },
        output_config: {
          type: "object",
          properties: {
            effort: { enum: ["low", "medium", "high", "max"] },
            format: {
              type: "object",
              properties: {
                schema: { type: "string" },
                type: { enum: ["json_schema"] },
              },
            },
          },
        },
        service_tier: { enum: ["auto", "standard_only"] },
        stream: { type: "boolean", default: true },
        temperature: { type: "number", min: 0, max: 1 },
        top_k: { type: "number", min: 0 },
        top_p: { type: "number", min: 0, max: 1 },
      },
    },
    fetcher: async function* (
      messages: Message[],
      params: any,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const { key, ...regularParams } = params;
      if (!key) {
        throw new Error("API key is required");
      }
      const firstDeveloper =
        messages[0]?.role === "developer" ? messages[0].content : null;
      if (firstDeveloper) {
        messages = messages.slice(1);
      }

      messages = messages.map((message: any) => {
        if (message.role === "developer") {
          return { role: "system", content: message.content };
        }
        return message;
      });

      const body = {
        messages,
        ...regularParams,
      } as any;
      if (firstDeveloper) body["system"] = firstDeveloper;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "post",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-dangerous-direct-browser-access": "true",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const data = await response.json();
        yield data.content?.[0]?.text;
        return;
      } else if (
        response.headers.get("Content-Type")?.includes("text/event-stream")
      ) {
        if (!response.body)
          throw new Error("Response body is null for stream response");
        for await (const { event, data } of sseParser(
          response.body.getReader(),
        )) {
          if (data) {
            let result = JSON.parse(data);
            if (result.type === "content_block_delta") {
              yield result.delta?.text;
            } else if (result.type === "message_stop") {
              return;
            }
          }
        }
      } else {
        throw new Error(
          "Unsupported response type: " + response.headers.get("Content-Type"),
        );
      }
    },
  },
  "google.com": {
    defaultModel: "gemini-3.0-flash",
    paramsSchema: {
      type: "object",
      properties: {
        key: { type: "string", format: "password" },
        model: { type: "string" },
        temperature: { type: "number", min: 0, max: 2 },
        top_p: { type: "number", min: 0, max: 1 },
        top_k: { type: "number" },
        max_output_tokens: { type: "number" },
      },
    },
    fetcher: async function* (
      messages: Message[],
      params: any,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const { key, model, ...generationConfig } = params;
      if (!key) throw new Error("API key is required");

      let systemInstruction = undefined;
      const contentMessages = messages.filter((m) => {
        if (m.role === "developer") {
          systemInstruction = { parts: [{ text: m.content }] };
          return false;
        }
        return true;
      });

      const contents = contentMessages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:streamGenerateContent".replace(
          "gemini-3.0-flash",
          model ?? this.defaultModel,
        ) + "?alt=sse",
        {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            contents,
            system_instruction: systemInstruction,
            generationConfig,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (!response.body) throw new Error("Response body is null");

      for await (const { data } of sseParser(response.body.getReader())) {
        try {
          console.log("Received SSE data:", data);
          const json = JSON.parse(data);
          console.log("Parsed JSON:", json);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            yield text;
          }
        } catch (e) {
          // Gemini sometimes sends a "metadata" event at the end which might not parse the same
        }
      }
    },
  },
  custom: {
    paramsSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "url" },
        key: { type: "string", format: "password" },
        model: { type: "string" },
        apiFormat: {
          type: "string",
          enum: ["ollama"],
          default: "ollama",
          description:
            "API format: openai (OpenAI-compatible, endpoint: /v1/chat/completions), gemini (Google Gemini), anthropic (Claude), ollama (self-hosted, endpoint: /api/chat or /api/generate)",
        },
        temperature: { type: "number", min: 0, max: 2 },
        top_p: { type: "number", min: 0, max: 1 },
        top_k: { type: "number" },
        max_output_tokens: { type: "number" },
      },
    },
    fetcher: async function* (
      messages: Message[],
      params: any,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const {
        key,
        url,
        model,
        apiFormat = "ollama",
        ...generationConfig
      } = params;
      if (!url) throw new Error("URL is required");
      if (!model) throw new Error("Model is required");

      // Prepare request based on API format
      let headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      let body: any;
      let streamEndpoint = url;

      switch (apiFormat) {
        case "gemini":
          if (!key) throw new Error("API key is required for Gemini format");
          headers["x-goog-api-key"] = key;
          let systemInstruction = undefined;
          const contentMessages = messages.filter((m) => {
            if (m.role === "developer") {
              systemInstruction = { parts: [{ text: m.content }] };
              return false;
            }
            return true;
          });
          const contents = contentMessages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          }));
          body = {
            contents,
            system_instruction: systemInstruction,
            generationConfig,
          };
          break;

        case "anthropic":
          if (!key) throw new Error("API key is required for Anthropic format");
          headers["x-api-key"] = key;
          headers["anthropic-version"] = "2023-06-01";
          headers["anthropic-dangerous-direct-browser-access"] = "true";

          const anthropicMessages = messages.map((m) => {
            if (m.role === "developer") {
              return { role: "system", content: m.content };
            }
            return {
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            };
          });
          body = {
            messages: anthropicMessages,
            model,
            max_tokens: generationConfig.max_output_tokens || 4096,
            temperature: generationConfig.temperature,
            top_p: generationConfig.top_p,
            top_k: generationConfig.top_k,
            stream: true,
          };
          break;

        case "ollama":
          // Ollama native API format (for /api/chat endpoint)
          // No authentication required by default, but supports bearer token if provided
          if (key) {
            headers["Authorization"] = `Bearer ${key}`;
          }

          // Prepare messages for Ollama's chat format
          const ollamaMessages = messages.map((m) => {
            if (m.role === "developer") {
              return { role: "system", content: m.content };
            }
            return {
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            };
          });

          // Build options object for Ollama's parameters
          const ollamaOptions: any = {};
          if (generationConfig.temperature !== undefined) {
            ollamaOptions.temperature = generationConfig.temperature;
          }
          if (generationConfig.top_p !== undefined) {
            ollamaOptions.top_p = generationConfig.top_p;
          }
          if (generationConfig.top_k !== undefined) {
            ollamaOptions.top_k = generationConfig.top_k;
          }
          if (generationConfig.max_output_tokens !== undefined) {
            ollamaOptions.num_predict = generationConfig.max_output_tokens;
          }

          body = {
            model,
            messages: ollamaMessages,
            stream: true,
          };

          // Only include options if we have any
          if (Object.keys(ollamaOptions).length > 0) {
            body.options = ollamaOptions;
          }
          break;
        case "openai":
        default:
          if (key) {
            headers["Authorization"] = `Bearer ${key}`;
          }
          const openaiMessages = messages.map((m) => {
            if (m.role === "developer") {
              return { role: "system", content: m.content };
            }
            return {
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            };
          });
          // For OpenAI format, map parameters
          const openaiConfig: any = {
            temperature: generationConfig.temperature,
            top_p: generationConfig.top_p,
            max_tokens: generationConfig.max_output_tokens,
            stream: true,
          };
          // Include additional parameters that might be supported
          if (generationConfig.top_k !== undefined) {
            openaiConfig.top_k = generationConfig.top_k;
          }
          // Filter out undefined values
          Object.keys(openaiConfig).forEach(
            (key) =>
              openaiConfig[key] === undefined && delete openaiConfig[key],
          );

          body = {
            messages: openaiMessages,
            model,
            ...openaiConfig,
          };
          break;
      }

      const response = await fetch(streamEndpoint, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      // Check for non-streaming JSON response
      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const data = await response.json();

        let text: string | undefined;

        switch (apiFormat) {
          case "gemini":
            text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            break;
          case "anthropic":
            text = data.content?.[0]?.text;
            break;
          case "ollama":
            text = data.message?.content || data.response;
            break;
          case "openai":
          default:
            text = data.choices?.[0]?.message?.content || data.content;
            break;
        }

        if (text) {
          yield text;
        }
        return;
      }

      if (!response.body) throw new Error("Response body is null");

      // Special handling for Ollama's JSON stream (newline-delimited or concatenated JSON)
      if (apiFormat === "ollama") {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Helper to extract complete JSON objects from buffer
        const extractJSONObjects = (
          buf: string,
        ): { objects: string[]; remaining: string } => {
          const objects: string[] = [];
          let current = buf;

          while (current.length > 0) {
            current = current.trim();
            if (current.length === 0) break;

            // Try to parse the entire current buffer as JSON
            // (for newline-delimited JSON where each object is complete)
            try {
              const obj = JSON.parse(current);
              objects.push(current);
              current = "";
              break;
            } catch (e) {
              // Not a complete JSON object, try to find object boundaries
            }

            // Look for the start of a JSON object
            const startIdx = current.indexOf("{");
            if (startIdx === -1) {
              // No JSON object start found
              break;
            }

            // Find matching closing brace
            let braceCount = 0;
            let inString = false;
            let escapeNext = false;
            let endIdx = -1;

            for (let i = startIdx; i < current.length; i++) {
              const char = current[i];

              if (escapeNext) {
                escapeNext = false;
                continue;
              }

              if (char === "\\") {
                escapeNext = true;
                continue;
              }

              if (char === '"') {
                inString = !inString;
                continue;
              }

              if (!inString) {
                if (char === "{") {
                  braceCount++;
                } else if (char === "}") {
                  braceCount--;
                  if (braceCount === 0) {
                    endIdx = i;
                    break;
                  }
                }
              }
            }

            if (endIdx !== -1) {
              // Found a complete JSON object
              const jsonStr = current.substring(startIdx, endIdx + 1);
              objects.push(jsonStr);
              current = current.substring(endIdx + 1);
            } else {
              // Incomplete JSON object, need more data
              break;
            }
          }

          return { objects, remaining: current };
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Extract complete JSON objects from buffer
            const { objects, remaining } = extractJSONObjects(buffer);
            buffer = remaining;

            for (const jsonStr of objects) {
              try {
                const json = JSON.parse(jsonStr);

                // Extract text from Ollama response
                let text: string | undefined;
                if (json.message?.content !== undefined) {
                  text = json.message.content;
                } else if (json.response !== undefined) {
                  // Fallback for /api/generate endpoint
                  text = json.response;
                } else if (json.content !== undefined) {
                  text = json.content;
                }

                if (text !== undefined && text !== null) {
                  yield text;
                }
              } catch (e) {
                console.debug("Failed to parse Ollama JSON:", e, jsonStr);
              }
            }
          }

          // Process any remaining data in buffer (should be empty if all objects extracted)
          if (buffer.trim()) {
            try {
              // Try one last time to parse any remaining complete JSON
              const { objects } = extractJSONObjects(buffer);
              for (const jsonStr of objects) {
                const json = JSON.parse(jsonStr);
                let text: string | undefined;
                if (json.message?.content !== undefined) {
                  text = json.message.content;
                } else if (json.response !== undefined) {
                  text = json.response;
                } else if (json.content !== undefined) {
                  text = json.content;
                }

                if (text !== undefined && text !== null) {
                  yield text;
                }
              }
            } catch (e) {
              console.debug("Failed to parse final Ollama JSON:", e, buffer);
            }
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        // Parse streaming response based on API format (SSE)
        for await (const { data } of sseParser(response.body.getReader())) {
          try {
            if (!data || data.trim() === "") continue;

            const json = JSON.parse(data);

            let text: string | undefined;

            switch (apiFormat) {
              case "gemini":
                text = json.candidates?.[0]?.content?.parts?.[0]?.text;
                break;

              case "anthropic":
                if (
                  json.type === "content_block_delta" &&
                  json.delta?.type === "text_delta"
                ) {
                  text = json.delta.text;
                } else if (
                  json.type === "content_block_start" &&
                  json.content_block?.text
                ) {
                  text = json.content_block.text;
                } else if (json.type === "message_start") {
                  // Initial message, skip
                  continue;
                }
                break;

              case "openai":
              default:
                if (json.choices?.[0]?.delta?.content !== undefined) {
                  text = json.choices[0].delta.content;
                } else if (json.choices?.[0]?.message?.content !== undefined) {
                  text = json.choices[0].message.content;
                } else if (json.content !== undefined) {
                  // Some OpenAI-compatible APIs return content directly
                  text = json.content;
                }
                break;
            }

            if (text !== undefined && text !== null) {
              yield text;
            }
          } catch (e) {
            // Ignore parsing errors for non-data events
            console.debug("Failed to parse SSE event:", e);
          }
        }
      }
    },
  },
};

const lineBreakRegex = /\r\n|\r|\n/;
async function* sseParser(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let lines = buffer.split(lineBreakRegex);

      buffer = lines.pop() || "";

      let currentEvent = "message";
      let currentData = "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === "") {
          if (currentData) {
            yield { event: currentEvent, data: currentData.trim() };
            currentData = "";
            currentEvent = "message";
          }
          continue;
        }

        if (line.startsWith(":")) continue;

        if (line.startsWith("data:")) {
          const data = line.slice(5);
          if (data.trim() === "[DONE]") return;
          currentData += data;
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("id:")) {
        }
      }
    }

    if (buffer.startsWith("data:")) {
      yield { event: "message", data: buffer.slice(5).trim() };
    }
  } finally {
    reader.releaseLock();
  }
}

export interface Api {
  defaultModel?: string;
  paramsSchema: any;
  fetcher: ApiFetcher;
}

export interface ApiFetcher {
  (
    messages: Message[],
    params: any,
    signal?: AbortSignal,
  ): AsyncIterable<string>;
}

export interface ApiParams {
  api: string;
  params: any;
}

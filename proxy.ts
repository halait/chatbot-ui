import http from "node:http";
import { URL } from "node:url";

const PORT = 3000;

const server = http.createServer(async (req, res) => {
  // 1. Manually handle CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "*");

  // Handle browser preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 2. Extract target URL from query params
  const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
  const targetUrl = reqUrl.searchParams.get("url");

  if (!targetUrl) {
    res.writeHead(400);
    res.end('Missing "url" parameter');
    return;
  }

  try {
    // 3. Forward the request using native fetch
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: Object.entries(req.headers)
        .filter(([key]) => key !== "host") // Strip host to avoid SSL/routing errors
        .reduce((acc, [key, val]) => ({ ...acc, [key]: val }), {}),
      body: ["GET", "HEAD"].includes(req.method!) ? undefined : (req as any),
      // @ts-ignore - Required for Node fetch to handle streaming bodies
      duplex: "half",
    });

    // 4. Pass through status and headers from the target
    res.writeHead(response.status, Object.fromEntries(response.headers));

    // 5. Pipe the body stream directly to the response
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err: any) {
    res.writeHead(500);
    res.end(`Proxy Error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Universal Proxy running on http://localhost:${PORT}`);
});

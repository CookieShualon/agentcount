import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import pg from "pg";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const USE_DB_SSL = process.env.DB_SSL === "true" || DATABASE_URL?.includes("sslmode=require");

let counter = 0;
const clients = new Set();
const pool = DATABASE_URL
  ? new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: USE_DB_SSL ? { rejectUnauthorized: false } : undefined
    })
  : null;

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastCounter(nextCounter) {
  const payload = { counter: nextCounter };
  for (const client of clients) {
    sendEvent(client, "counter", payload);
  }
}

async function initCounterStore() {
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);

  await pool.query(
    "INSERT INTO app_state (key, value) VALUES ('counter', 0) ON CONFLICT (key) DO NOTHING"
  );
}

async function getCounter() {
  if (!pool) {
    return counter;
  }

  const result = await pool.query("SELECT value FROM app_state WHERE key = 'counter'");
  counter = result.rows[0]?.value ?? 0;

  return counter;
}

async function updateCounter(amount) {
  if (!pool) {
    counter += amount;
    broadcastCounter(counter);
    return counter;
  }

  const result = await pool.query(
    "UPDATE app_state SET value = value + $1 WHERE key = 'counter' RETURNING value",
    [amount]
  );
  counter = result.rows[0].value;
  broadcastCounter(counter);

  return counter;
}

const app = express();

app.use(express.json());
app.use(express.static("public"));

function createMcpServer() {
  const mcp = new McpServer({
    name: "counter-site",
    version: "1.0.0"
  });

  mcp.registerResource(
    "counter-site-docs",
    "docs://counter-site",
    {
      title: "Counter Site MCP Usage",
      description: "Instructions for using the hosted counter website MCP server.",
      mimeType: "text/plain"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: [
            "Counter Site Hosted MCP Server",
            "",
            "Purpose:",
            "- This MCP server updates a live counter on the connected website.",
            "",
            "Remote connection:",
            "- Use the Streamable HTTP endpoint at /mcp on the hosted website.",
            "- For Render, the URL looks like https://your-service.onrender.com/mcp.",
            "- Do not use a command like node server.js for the hosted Render MCP connection.",
            "",
            "Available tools:",
            "- increment_counter: increments the counter shown on the website.",
            "",
            "Tool arguments:",
            "- amount: optional integer. Defaults to 1.",
            "",
            "Example tool call:",
            '{ "name": "increment_counter", "arguments": { "amount": 1 } }',
            "",
            "Expected successful result:",
            "- Counter updated to 1",
            "",
            "Persistence:",
            "- The website stores the counter in Postgres when DATABASE_URL is set, including Render Postgres.",
            "- Without DATABASE_URL, the website uses in-memory storage and resets on restart."
          ].join("\n")
        }
      ]
    })
  );

  mcp.registerTool(
    "increment_counter",
    {
      title: "Increment website counter",
      description: "Increment the counter shown on the connected website.",
      inputSchema: {
        amount: z.number().int().optional().describe("How much to add. Defaults to 1.")
      }
    },
    async ({ amount = 1 }) => {
      const nextCounter = await updateCounter(amount);

      return {
        content: [
          {
            type: "text",
            text: `Counter updated to ${nextCounter}`
          }
        ]
      };
    }
  );

  return mcp;
}

app.options("/mcp", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.sendStatus(204);
});

app.post("/mcp", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

  const mcp = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  } finally {
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST for MCP Streamable HTTP."
    },
    id: null
  });
});

app.get("/api/counter", async (_req, res, next) => {
  try {
    res.json({ counter: await getCounter() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/increment", async (req, res, next) => {
  try {
    const amount = Number.isInteger(req.body?.amount) ? req.body.amount : 1;
    const nextCounter = await updateCounter(amount);

    res.json({ counter: nextCounter });
  } catch (error) {
    next(error);
  }
});

app.get("/events", async (req, res, next) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    clients.add(res);
    sendEvent(res, "counter", { counter: await getCounter() });

    req.on("close", () => {
      clients.delete(res);
    });
  } catch (error) {
    clients.delete(res);
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

await initCounterStore();

app.listen(PORT, () => {
  console.log(`Counter website running at http://localhost:${PORT}`);
  console.log(pool ? "Counter persistence: Postgres" : "Counter persistence: in memory");
});

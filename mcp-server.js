import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SITE_URL = process.env.SITE_URL || "http://localhost:3000";

const mcp = new McpServer({
  name: "counter-site",
  version: "1.0.0"
});

mcp.registerResource(
  "counter-site-docs",
  "docs://counter-site",
  {
    title: "Counter Site MCP Usage",
    description: "Instructions for using the counter website MCP server.",
    mimeType: "text/plain"
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: [
          "Counter Site MCP Server",
          "",
          "Purpose:",
          "- This MCP server updates a live counter on the connected website.",
          "",
          "Server commands:",
          "- Website/API server: npm start",
          "- MCP stdio server: node /Users/omerrechavi/agentcount/mcp-server.js",
          "- Do not launch server.js as the MCP server. server.js is only the website/API server.",
          "",
          "Requirements:",
          `- The website must be running before tools are called. Default website URL: ${SITE_URL}`,
          "- The MCP server reads SITE_URL from the environment. If unset, it uses http://localhost:3000.",
          "- The website stores the counter in Postgres when DATABASE_URL is set, including Render Postgres.",
          "- Without DATABASE_URL, the website uses in-memory storage and resets on restart.",
          "",
          "Available tools:",
          "- increment_counter: increments the counter shown on the website.",
          "- get_counter: reads the current counter value without changing it.",
          "",
          "Tool arguments:",
          "- increment_counter amount: optional integer. Defaults to 1.",
          "- get_counter: no arguments.",
          "",
          "Example tool call:",
          '{ "name": "increment_counter", "arguments": { "amount": 1 } }',
          "",
          "Expected successful result:",
          "- Counter updated to 1",
          "",
          "Troubleshooting:",
          "- If updating fails, check that the website is running and reachable at SITE_URL.",
          "- If you see a JSON parse error containing 'Counter website running', the MCP client launched server.js instead of mcp-server.js."
        ].join("\n")
      }
    ]
  })
);

mcp.registerTool(
  "get_counter",
  {
    title: "Get website counter",
    description: "Read the current counter value shown on the connected website.",
    inputSchema: {}
  },
  async () => {
    const response = await fetch(`${SITE_URL}/api/counter`);

    if (!response.ok) {
      throw new Error(`Could not read counter at ${SITE_URL}`);
    }

    const data = await response.json();

    return {
      content: [
        {
          type: "text",
          text: `Counter is ${data.counter}`
        }
      ]
    };
  }
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
    const response = await fetch(`${SITE_URL}/api/increment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount })
    });

    if (!response.ok) {
      throw new Error(`Could not update counter at ${SITE_URL}`);
    }

    const data = await response.json();

    return {
      content: [
        {
          type: "text",
          text: `Counter updated to ${data.counter}`
        }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);

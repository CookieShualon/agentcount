# MCP Counter Site

A tiny website connected to an MCP server. Calling the MCP tool updates the counter on the page in real time.

The counter is stored in Postgres when `DATABASE_URL` is set. Without `DATABASE_URL`, it falls back to in-memory storage for local testing.

## Run it

```sh
npm install
npm start
```

Open `http://localhost:3000`.

## Render Postgres

To persist the counter on Render:

1. Create a Render PostgreSQL database.
2. Create or open your Render Web Service for this Node app.
3. Add an environment variable named `DATABASE_URL`.
4. Set it to the database's Internal Database URL from Render.
5. Deploy or restart the Web Service.

Render service settings:

- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `DATABASE_URL=<your Render Postgres internal database URL>`

On startup, the app automatically creates this table if needed:

```sql
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
```

It stores the counter in the row where `key = 'counter'`.

## Connect an MCP client

Use this server command in your MCP client config:

```sh
node /Users/omerrechavi/agentcount/mcp-server.js
```

The MCP server exposes one tool:

- `increment_counter`: increments the website counter. Pass `{ "amount": 5 }` to add more than one.

The website must be running separately with `npm start` before you call the MCP tool.

## Test with MCP Inspector

In one terminal, start the website:

```sh
npm start
```

In a second terminal, start the Inspector:

```sh
npx @modelcontextprotocol/inspector node /Users/omerrechavi/agentcount/mcp-server.js
```

Open `http://localhost:3000`, then call `increment_counter` in the Inspector.

For a quick MCP server command from this folder, you can also run:

```sh
npm run mcp
```

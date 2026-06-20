import express from "express";
import pg from "pg";

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

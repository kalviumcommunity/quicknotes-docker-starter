import cors from "cors";
import express from "express";
import pg from "pg";

const app = express();

// TODO 1: these three values are hardcoded. Read them from environment variables.
const port = 5000;
const pool = new pg.Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/quicknotes",
});

app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

// Retry until PostgreSQL is ready, then create the table
async function initDB() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS notes (
          id SERIAL PRIMARY KEY,
          text VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )`
      );
      console.log("Database ready");
      return;
    } catch (err) {
      console.log(`Waiting for database... (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error("Could not connect to the database after 10 attempts");
}

initDB();

// Does not touch the database, so it works even before the DB is ready
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/notes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM notes ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/notes", async (req, res) => {
  const text = (req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const result = await pool.query(
      "INSERT INTO notes (text) VALUES ($1) RETURNING *",
      [text]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.listen(port, () => console.log(`API running on port ${port}`));

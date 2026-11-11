// Self-check. Run: npm run check   (no Docker, no internet needed)
// Reads your files and prints PASS/FAIL per check. 20 checks, 1 mark each.
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : null);
const results = [];
const check = (task, name, ok) => results.push({ task, name, ok: !!ok });

// ---------- Task 1: environment variables ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runServer(env) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { PATH: process.env.PATH, ...env },
    stdio: "ignore",
  });
  await sleep(1200);
  return child;
}
const server = read("server.js") || "";
{
  const port = 5077;
  const child = await runServer({ PORT: String(port), CORS_ORIGIN: "http://allowed.test", DATABASE_URL: "postgresql://x:y@127.0.0.1:1/z" });
  let listening = false, cors = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: "http://allowed.test" } });
    listening = res.ok;
    cors = res.headers.get("access-control-allow-origin");
  } catch {}
  child.kill();
  check(1, "server listens on process.env.PORT", listening);
  check(1, "CORS origin comes from CORS_ORIGIN", cors === "http://allowed.test");
}
check(1, "server uses process.env.DATABASE_URL (no hardcoded URL)", /process\.env\.DATABASE_URL/.test(server) && !/postgresql:\/\/[^"'`]*localhost/.test(server));
const ex = read(".env.example") || "";
check(1, ".env.example lists all 6 names; DATABASE_URL host is db",
  ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DATABASE_URL", "PORT", "CORS_ORIGIN"].every((k) => new RegExp("^" + k + "=", "m").test(ex)) &&
  /^DATABASE_URL=.*@db:5432\//m.test(ex));
const gi = read(".gitignore") || "";
check(1, ".env is gitignored and not in the folder", /^\.env\s*$/m.test(gi) && !fs.existsSync(path.join(root, ".env")));

// ---------- Task 2: API Dockerfile ----------
const df = (read("Dockerfile") || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const idx = (re) => df.findIndex((l) => re.test(l));
const iFrom = idx(/^FROM\s+node:/i), iWork = idx(/^WORKDIR\s+\S+/i);
const iCopyPkg = idx(/^COPY\s+package.*\.json/i);
const iInstall = idx(/^RUN\s+npm\s+(ci|install)/i);
const iCopyAll = idx(/^COPY\s+\.\s+\./i);
check(2, "starts FROM a node image and sets WORKDIR", iFrom === 0 && iWork > iFrom);
check(2, "copies package files before installing", iCopyPkg > -1 && iInstall > iCopyPkg);
check(2, "installs dependencies BEFORE copying the rest of the code", iInstall > -1 && iCopyAll > iInstall);
check(2, "EXPOSE 5000", idx(/^EXPOSE\s+5000\b/i) > -1);
check(2, 'CMD runs node server.js', idx(/^CMD\s+\[?\s*"?node"?\s*,?\s*"?server\.js"?\s*\]?$/i) > -1);

// ---------- Task 3: docker-compose.yml ----------
let dc = null;
try { dc = yaml.load(read("docker-compose.yml") || ""); } catch {}
const db = dc?.services?.db, api = dc?.services?.api;
const envFiles = (s) => [].concat(s?.env_file ?? []).map(String);
check(3, "db: image postgres + env_file .env", /^postgres/.test(db?.image || "") && envFiles(db).some((f) => f.replace("./", "") === ".env"));
const dbVol = [].concat(db?.volumes ?? []).map(String).find((v) => /:\/var\/lib\/postgresql\/data\/?$/.test(v));
const volName = dbVol ? dbVol.split(":")[0] : null;
check(3, "db: named volume on /var/lib/postgresql/data, declared at top level", volName && !/[\/.]/.test(volName) && dc?.volumes && volName in dc.volumes);
check(3, "api: builds from . and publishes 5000:5000", (api?.build === "." || api?.build === "./" || api?.build?.context === ".") && [].concat(api?.ports ?? []).map(String).includes("5000:5000"));
check(3, "api: env_file .env and depends_on db", envFiles(api).some((f) => f.replace("./", "") === ".env") && (Array.isArray(api?.depends_on) ? api.depends_on.includes("db") : !!api?.depends_on?.db));
const dcText = read("docker-compose.yml") || "";
check(3, "no hardcoded password or localhost in compose", dc && !/POSTGRES_PASSWORD\s*[:=]\s*(?!\$)\S/.test(dcText) && !/localhost/.test(dcText.replace(/#.*$/gm, "")));

// ---------- Task 4: deploy proof files ----------
const dep = read("DEPLOYMENT.md") || "";
const val = (label) => (dep.match(new RegExp("^- " + label + ":\\s*(.*)$", "m")) || [, ""])[1].replace(/\(.*?\)\s*$/, "").trim();
const live = val("Live API URL"), health = val("Health check URL");
check(4, "Live API URL is an https://....onrender.com link", /^https:\/\/[a-z0-9-]+\.onrender\.com\/?$/i.test(live));
check(4, "Health check URL = live URL + /health", /^https:\/\/[a-z0-9-]+\.onrender\.com\/health$/i.test(health) && health.startsWith(live.replace(/\/$/, "")));
check(4, "Build and start commands filled in", /npm/.test(val("Build command")) && /(node server\.js|npm start)/.test(val("Start command")));
const envNames = val("Environment variables set on Render \\(names only, no values\\)") || val("Environment variables set on Render");
check(4, "Render env var names include DATABASE_URL and CORS_ORIGIN", /DATABASE_URL/.test(envNames) && /CORS_ORIGIN/.test(envNames));
const shotDir = path.join(root, "screenshots");
const shots = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter((f) => /\.(png|jpe?g)$/i.test(f)) : [];
check(4, "screenshots/ has at least 2 images", shots.length >= 2);

// ---------- Report ----------
let total = 0;
for (const t of [1, 2, 3, 4]) {
  const rs = results.filter((r) => r.task === t);
  const got = rs.filter((r) => r.ok).length;
  total += got;
  console.log(`\nTask ${t}: ${got}/5`);
  rs.forEach((r) => console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`));
}
console.log(`\nSCRIPT SCORE: ${total}/20  (a mentor still checks your screenshots)`);
process.exit(0);

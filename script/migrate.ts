import pkg from "pg";
const { Client } = pkg;

async function migrate() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const migrations = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS first_test_enabled_at TEXT",
  ];
  
  for (const sql of migrations) {
    await client.query(sql);
    console.log("OK:", sql.slice(0, 60));
  }
  
  await client.end();
  console.log("Migrations complete");
}

migrate().catch(e => { console.error(e); process.exit(1); });

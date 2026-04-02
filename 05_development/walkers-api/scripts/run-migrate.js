const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Read DATABASE_URL from .env.production.local
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.production.local'), 'utf-8');
const match = envFile.match(/DATABASE_URL="?([^"\n]+)"?/);
if (!match) { console.error('DATABASE_URL not found'); process.exit(1); }

const sql = neon(match[1]);
sql`ALTER TABLE skills ADD COLUMN IF NOT EXISTS content TEXT`
  .then(() => {
    console.log('Migration successful: content column added to skills table');
    process.exit(0);
  })
  .catch(e => {
    console.error('Migration failed:', e.message);
    process.exit(1);
  });

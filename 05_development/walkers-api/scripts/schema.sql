-- Walkers Shared API — Neon PostgreSQL Schema
-- Run this once to initialize the database

CREATE TABLE IF NOT EXISTS skills (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  content       TEXT DEFAULT '',
  creator       TEXT DEFAULT '',
  category      TEXT DEFAULT 'system',
  triggers      TEXT DEFAULT '',
  phases        INTEGER DEFAULT 0,
  lines         INTEGER DEFAULT 0,
  published_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gallery (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT 'gui',
  description   TEXT DEFAULT '',
  path          TEXT DEFAULT '',
  tech          JSONB DEFAULT '[]',
  creator       TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT DEFAULT 'draft',
  tags          JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS machines (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  host            TEXT NOT NULL,
  port            INTEGER DEFAULT 8080,
  machine_id      TEXT NOT NULL UNIQUE,
  access_scope    TEXT DEFAULT 'all',
  allowed_machines JSONB DEFAULT '[]',
  status          TEXT DEFAULT 'offline',
  last_seen       TIMESTAMPTZ,
  registered_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  machine_id      TEXT NOT NULL REFERENCES machines(machine_id),
  status          TEXT DEFAULT 'idle',
  skills          JSONB DEFAULT '[]',
  cron_expression TEXT DEFAULT '',
  cron_description TEXT DEFAULT '',
  created_by      TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_machine ON agents(machine_id);
CREATE INDEX IF NOT EXISTS idx_machines_machine_id ON machines(machine_id);

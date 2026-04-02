-- walkers-api schema v1

-- Drop existing tables (if re-running)
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS machines CASCADE;
DROP TABLE IF EXISTS gallery CASCADE;
DROP TABLE IF EXISTS skills CASCADE;

-- Skills (shared skill definitions)
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  icon TEXT,
  tags TEXT[] DEFAULT '{}',
  config JSONB DEFAULT '{}',
  content TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Gallery (shared gallery items)
CREATE TABLE gallery (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  thumbnail TEXT,
  url TEXT,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Machines (registered YourAI instances)
CREATE TABLE machines (
  machine_id TEXT PRIMARY KEY,
  machine_name TEXT NOT NULL,
  description TEXT,
  host TEXT,
  port INTEGER DEFAULT 8080,
  access_scope TEXT DEFAULT 'select' CHECK (access_scope IN ('all', 'select')),
  allowed_machines TEXT[] DEFAULT '{}',
  skills JSONB DEFAULT '[]',
  is_online BOOLEAN DEFAULT false,
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sub-agents (agents running on machines)
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  machine_id TEXT REFERENCES machines(machine_id) ON DELETE CASCADE,
  status TEXT DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'error')),
  skills TEXT[] DEFAULT '{}',
  cron_expression TEXT,
  cron_description TEXT,
  created_by TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- API keys for machine authentication
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  machine_id TEXT REFERENCES machines(machine_id) ON DELETE CASCADE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_agents_machine_id ON agents(machine_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_gallery_category ON gallery(category);

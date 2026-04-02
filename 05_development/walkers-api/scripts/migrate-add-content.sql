-- Migration: Add content column to skills table
-- Run this on Neon DB to enable skill content storage for Skill Hub preview
ALTER TABLE skills ADD COLUMN IF NOT EXISTS content TEXT;

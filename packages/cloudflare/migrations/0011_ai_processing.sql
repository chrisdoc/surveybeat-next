-- Organization setting: AI processing of comments (ADR 0015), off by default.
ALTER TABLE organization ADD COLUMN ai_processing INTEGER NOT NULL DEFAULT 0 CHECK (ai_processing IN (0, 1));

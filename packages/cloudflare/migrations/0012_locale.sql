-- Languages (ADR 0018). A Person's own choice (NULL: follow the browser), the browser language last
-- seen at sign-in (for emails, which have no browser), and the Organization's default.
ALTER TABLE person ADD COLUMN locale TEXT CHECK (locale IN ('en', 'de'));
ALTER TABLE person ADD COLUMN detected_locale TEXT CHECK (detected_locale IN ('en', 'de'));
ALTER TABLE organization ADD COLUMN default_locale TEXT NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en', 'de'));

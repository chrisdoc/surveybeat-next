ALTER TABLE auth_user ADD COLUMN role TEXT;
ALTER TABLE auth_user ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE auth_user ADD COLUMN banReason TEXT;
ALTER TABLE auth_user ADD COLUMN banExpires DATE;

ALTER TABLE auth_session ADD COLUMN impersonatedBy TEXT;
ALTER TABLE auth_session ADD COLUMN activeOrganizationId TEXT;

CREATE TABLE auth_organization (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  createdAt DATE NOT NULL,
  metadata TEXT
);

CREATE TABLE auth_member (
  id TEXT NOT NULL PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES auth_organization (id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES auth_user (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  createdAt DATE NOT NULL
);

CREATE TABLE auth_invitation (
  id TEXT NOT NULL PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES auth_organization (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  inviterId TEXT NOT NULL REFERENCES auth_user (id) ON DELETE CASCADE
);

CREATE TABLE auth_passkey (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_user (id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL,
  counter INTEGER NOT NULL,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL,
  transports TEXT,
  createdAt DATE,
  aaguid TEXT
);

CREATE INDEX auth_organization_slug_idx ON auth_organization (slug);
CREATE INDEX auth_member_organizationId_idx ON auth_member (organizationId);
CREATE INDEX auth_member_userId_idx ON auth_member (userId);
CREATE INDEX auth_invitation_organizationId_idx ON auth_invitation (organizationId);
CREATE INDEX auth_invitation_email_idx ON auth_invitation (email);
CREATE INDEX auth_passkey_userId_idx ON auth_passkey (userId);
CREATE INDEX auth_passkey_credentialID_idx ON auth_passkey (credentialID);

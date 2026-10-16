-- Apply after auditing users.phone duplicates. No legacy account is automatically bound.
CREATE TABLE IF NOT EXISTS user_phone_identities (
 user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 environment VARCHAR(128) NOT NULL,
 subject VARCHAR(64) NOT NULL,
 phone VARCHAR(11) NOT NULL UNIQUE CHECK (phone ~ '^1[0-9]{10}$'),
 PRIMARY KEY (environment,subject)
);

-- Phone-only accounts do not fabricate email addresses.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

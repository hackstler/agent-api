-- Migrate all current admins to super_admin (preserves functionality)
UPDATE users SET role = 'super_admin' WHERE role = 'admin';

-- Add CHECK constraint for allowed role values
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'admin', 'super_admin'));

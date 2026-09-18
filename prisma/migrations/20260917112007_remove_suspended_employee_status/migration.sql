-- No employees currently use `suspended` (verified before writing this migration).
ALTER TABLE `employee` MODIFY `status` ENUM('active', 'on_leave', 'terminated') NOT NULL DEFAULT 'active';

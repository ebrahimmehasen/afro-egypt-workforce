-- Adds the generic `staff` (اداري) role. Only appends an enum value, so existing rows are untouched.
ALTER TABLE `user` MODIFY `role` ENUM('admin', 'hr', 'supervisor', 'employee', 'staff') NOT NULL;

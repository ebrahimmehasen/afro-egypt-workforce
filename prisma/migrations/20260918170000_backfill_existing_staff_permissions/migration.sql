-- add_user_permissions added `permissions` as JSON NOT NULL with no default, so
-- every account that already existed came out of it as JSON null - which the
-- app reads as "no access at all". Give existing hr/supervisor accounts the
-- page access their role had before granular permissions existed, and everyone
-- else an empty list. Only touches JSON-null rows, so accounts that were given
-- an explicit list (including an intentionally empty one) are left alone.
UPDATE `User` SET `permissions` = JSON_ARRAY('employees', 'departments', 'shifts', 'attendance', 'leaves', 'overtime', 'deductions', 'payroll', 'reports', 'workforce_cost', 'audit_log')
WHERE `role` = 'hr' AND JSON_TYPE(`permissions`) = 'NULL';

UPDATE `User` SET `permissions` = JSON_ARRAY('employees', 'attendance', 'leaves', 'overtime', 'reports')
WHERE `role` = 'supervisor' AND JSON_TYPE(`permissions`) = 'NULL';

UPDATE `User` SET `permissions` = JSON_ARRAY()
WHERE JSON_TYPE(`permissions`) = 'NULL';

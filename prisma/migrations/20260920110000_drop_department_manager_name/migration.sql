-- Contract step of 20260920100000_department_manager_is_an_employee: the build
-- that stopped reading/writing the typed head name is live, so the column can go.
ALTER TABLE `Department` DROP COLUMN `managerName`;

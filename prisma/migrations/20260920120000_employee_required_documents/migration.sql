-- Which documents count as "required" differs from one employee to the next
-- (a military certificate only matters for some, a driving licence for drivers…).
-- NULL keeps the company default, so every existing employee behaves as before.
ALTER TABLE `Employee` ADD COLUMN `requiredDocuments` JSON NULL;

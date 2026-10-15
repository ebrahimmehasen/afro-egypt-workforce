-- The work schedules ("مواعيد العمل") are now the one list shown on /shifts and in the settings. Add the evening
-- and night hours next to the existing 08:00 → 18:00 so the list has morning, evening and night. Insert only: no
-- existing row changes and nobody is put on them (INSERT IGNORE keeps it safe to run where they already exist).
INSERT IGNORE INTO `WorkSchedule` (`id`, `name`, `startTime`, `endTime`, `overtimeStart`, `sortOrder`, `updatedAt`)
VALUES
    ('schedule-1600-0000', 'الوردية المسائية', '16:00', '00:00', NULL, 4, CURRENT_TIMESTAMP(3)),
    ('schedule-0000-0800', 'الوردية الليلية', '00:00', '08:00', NULL, 5, CURRENT_TIMESTAMP(3));

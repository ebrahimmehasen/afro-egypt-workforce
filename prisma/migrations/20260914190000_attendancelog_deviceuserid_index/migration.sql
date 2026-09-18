-- CreateIndex: the biometric-device user detail page queries the full punch
-- history by deviceUserId (see /biometric-device/users/[uid]) without a
-- cap, so this needs an index to stay fast as the table grows.
CREATE INDEX `AttendanceLog_deviceUserId_timestamp_idx` ON `AttendanceLog`(`deviceUserId`, `timestamp`);

-- Widen the document slots to the company's own HR-F-04 service-file checklist
-- and let a single slot hold more than one scan (ID front/back, multi-page
-- certificates), which the old one-row-per-type unique key made impossible.

ALTER TABLE `EmployeeDocument`
  MODIFY `type` ENUM(
    'national_id_photo',
    'birth_certificate',
    'criminal_record',
    'health_certificate',
    'work_contract',
    'social_insurance_form',
    'job_application_form',
    'qualification_certificate',
    'personal_photo',
    'military_certificate',
    'work_experience_certificate',
    'cv',
    'driving_license',
    'company_policy',
    'other'
  ) NOT NULL;

DROP INDEX `EmployeeDocument_employeeId_type_key` ON `EmployeeDocument`;

CREATE INDEX `EmployeeDocument_employeeId_type_idx` ON `EmployeeDocument`(`employeeId`, `type`);

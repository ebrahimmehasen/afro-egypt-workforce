-- Gender (drives the default required-document list — the military certificate is male-only),
-- an explicit "isDriver" flag (drives the driving-licence / vehicle-receipt requirement), and a
-- required-acknowledgments override list, mirroring the existing requiredDocuments column.
-- All additive: nullable or defaulted, so every existing row keeps behaving exactly as before.
ALTER TABLE `Employee`
    ADD COLUMN `gender` ENUM('male', 'female') NULL,
    ADD COLUMN `isDriver` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `requiredAcknowledgments` JSON NULL;

-- Widen the document type enum with "شهادة خبرة" (experience_certificate) — distinct from the existing
-- work_experience_certificate ("كعب عمل"). Only appends a value, so existing rows are untouched.
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
        'experience_certificate',
        'other'
    ) NOT NULL;

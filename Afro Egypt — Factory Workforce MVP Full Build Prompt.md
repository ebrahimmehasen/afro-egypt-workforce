# BUILD THE COMPLETE MVP — AFRO EGYPT FACTORY WORKFORCE MANAGEMENT

## 1. PROJECT CONTEXT

Build a complete, professional, fully interactive **Web Application MVP** for:

# Afro Egypt

The application is a **Factory Workforce Management & Payroll System**.

This is a real interactive demo that will be presented directly to the owner/management of **Afro Egypt**.

The system is being developed by:

# 404 Legends

Slogan:

**Where 404 Becomes Legend.**

---

# 2. CLIENT BRANDING

## Client

**Afro Egypt**

## Developer

**404 Legends**

## Product

**Factory Workforce**

## Product subtitle

**Workforce Management & Payroll**

## Arabic subtitle

**نظام إدارة العمالة والحضور والرواتب**

---

# 3. VERY IMPORTANT — LOGO

The client will provide the **Afro Egypt logo image** during development.

When the logo is provided:

### Analyze it carefully.

Extract:

- Primary colors
- Secondary colors
- Typography style
- Visual language
- Shapes
- Brand personality
- Contrast
- Overall visual identity

Then use the actual Afro Egypt logo and its visual identity throughout the application.

### Use the logo in:

- Login screen
- Sidebar
- Dashboard header where appropriate
- Company profile
- Payslip
- Reports
- Printable documents

Do NOT invent a completely different brand identity.

Do NOT replace the logo with a generic icon.

Do NOT distort the logo.

Do NOT change the logo colors.

The interface should feel like a real internal system built specifically for **Afro Egypt**.

---

# 4. 404 LEGENDS BRANDING

404 Legends is the software development company.

Do NOT make 404 Legends the primary brand inside the application.

Afro Egypt is the client and must be the dominant brand.

Use:

**Powered by 404 Legends**

in subtle places such as:

- Login footer
- Application footer
- Payslip footer
- About/system information

Use the slogan:

**Where 404 Becomes Legend.**

Only where appropriate.

---

# 5. PRODUCT GOAL

The goal of this MVP is to demonstrate how Afro Egypt can manage:

- Employees
- Attendance
- Biometric punches
- Shifts
- Late arrival
- Early departure
- Absence
- Leaves
- Excuses
- Overtime
- Deductions
- Penalties
- Allowances
- Payroll
- Workforce cost
- Reports

in one centralized system.

The main value proposition is:

```text id="w2f6aa"
Biometric Punch
       ↓
Attendance
       ↓
Late / Absence / Early Leave
       ↓
Overtime
       ↓
Leaves / Excuses
       ↓
Deductions / Penalties
       ↓
Payroll
       ↓
Net Salary
       ↓
Workforce Cost
```

---

# 6. THIS MUST BE A REAL MVP

Do NOT build a static UI mockup.

Do NOT create fake buttons.

Do NOT create navigation that does nothing.

Every major feature must actually work.

The user must be able to:

- Add employees
- Edit employees
- View employees
- Create departments
- Create shifts
- Simulate biometric punches
- View attendance
- Calculate lateness
- Calculate early departure
- Detect absence
- Add leaves
- Add excuses
- Add overtime
- Approve overtime
- Add deductions
- Add penalties
- Calculate payroll
- View salary breakdown
- View workforce cost
- View reports
- Export data
- View audit history

---

# 7. DEMO MODE

This is an MVP/demo.

Do NOT require an actual biometric device.

Instead build a:

# Simulated Biometric Device

Create a button:

**محاكاة البصمة**

The simulation should behave like a biometric device sending attendance records.

Clearly display:

**DEMO MODE**

and:

**Simulated biometric data**

Do NOT falsely claim that a real ZKTeco device is connected.

However, structure the code so that real ZKTeco integration can be added later.

---

# 8. TECHNOLOGY

Use:

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- Recharts

Use a PostgreSQL-compatible architecture.

Use Prisma if appropriate.

If a database would unnecessarily slow down the MVP setup, create a clean local/demo data layer but structure it so PostgreSQL can be added later.

The project must run with:

```bash
npm install
npm run dev
```

No broken imports.

No unfinished components.

No placeholder pages.

No TODO functionality.

---

# 9. LANGUAGE

Primary UI language:

# Arabic

The entire interface must support:

- RTL
- Arabic navigation
- Arabic forms
- Arabic tables
- Arabic notifications
- Arabic reports

Use professional Egyptian business terminology.

Examples:

```text id="m8a5vz"
لوحة التحكم
الموظفين
الأقسام
الورديات
الحضور والانصراف
الإجازات والأعذار
الإضافي
الخصومات والجزاءات
الرواتب
التقارير
تحليل تكلفة العمالة
سجل التعديلات
الإعدادات
```

Technical identifiers can remain English internally.

---

# 10. VISUAL DESIGN

Create a premium enterprise dashboard.

The design should feel:

- Professional
- Modern
- Industrial
- Clean
- Serious
- Trustworthy
- Corporate

Avoid:

- Cartoon design
- Excessive gradients
- Excessive animations
- Neon colors
- Generic startup templates
- Unnecessary decorative elements

Use the Afro Egypt logo as the main source for the visual identity.

Use:

- KPI cards
- Professional tables
- Charts
- Filters
- Search
- Status badges
- Modals
- Clean forms
- Clear hierarchy
- Good whitespace

The result should look like a real enterprise HR/workforce management product.

---

# 11. LOGIN SCREEN

Create a professional branded login screen.

Display:

# Afro Egypt

## Factory Workforce

**إدارة الحضور والعمالة والرواتب في نظام واحد**

Then subtly:

**Powered by 404 Legends**

**Where 404 Becomes Legend.**

Show:

**DEMO VERSION**

Demo credentials:

```text
Email:
admin@404legends.demo

Password:
demo123
```

Login must work.

After login:

Redirect to Dashboard.

---

# 12. MAIN NAVIGATION

Create a professional sidebar.

Navigation:

```text id="j2jbdv"
لوحة التحكم

الموظفين

الأقسام

الورديات

الحضور والانصراف

الإجازات والأعذار

الإضافي

الخصومات والجزاءات

الرواتب

التقارير

تحليل تكلفة العمالة

سجل التعديلات

الإعدادات
```

Top bar:

- Afro Egypt logo
- Current date
- Notifications
- Current user
- Demo Mode indicator

---

# 13. DEMO DATA

The system MUST NOT start empty.

Seed realistic demo data.

Create approximately:

# 50 employees

Departments:

```text id="u2c9ve"
الإنتاج
المخازن
الصيانة
الأمن
الموارد البشرية
الحسابات
```

Use realistic Arabic names.

Employee IDs:

```text id="s8z4tg"
EMP-1001
EMP-1002
EMP-1003
...
```

Salary range:

```text id="5frq8p"
7,000 – 25,000 EGP
```

Create realistic:

- Attendance
- Absence
- Late arrivals
- Leaves
- Overtime
- Deductions
- Penalties
- Allowances
- Payroll

---

# 14. EMPLOYEE MANAGEMENT

Create an Employees page.

Table columns:

```text id="5b0v3r"
الرقم الوظيفي
اسم الموظف
القسم
الوظيفة
الوردية
الراتب الأساسي
الحالة
```

Actions:

- View
- Edit
- Delete

Add Employee form:

```text id="c6r7tr"
الاسم
الرقم الوظيفي
القسم
الوظيفة
تاريخ التعيين
الوردية
الراتب الأساسي
البدلات
رقم الموظف على جهاز البصمة
الحالة
```

Employee profile must contain:

### البيانات الأساسية

### الحضور

### الإضافي

### الخصومات

### الرواتب

---

# 15. DEPARTMENTS

Create department management.

Departments:

```text id="xkqg4b"
الإنتاج
المخازن
الصيانة
الأمن
الموارد البشرية
الحسابات
```

Each department should show:

- Department name
- Manager
- Employee count
- Payroll cost
- Attendance rate

Allow:

- Add
- Edit
- View
- Delete

---

# 16. SHIFTS

Create:

## Morning Shift

```text id="x3jyd8"
08:00 → 16:00
Grace Period: 10 minutes
```

## Evening Shift

```text id="8c89kk"
16:00 → 00:00
Grace Period: 10 minutes
```

## Night Shift

```text id="p3z4yo"
00:00 → 08:00
Grace Period: 10 minutes
```

Allow editing.

Fields:

```text id="21b7jq"
اسم الوردية
وقت البداية
وقت النهاية
فترة السماح
أيام العمل
السماح بالإضافي
```

---

# 17. BIOMETRIC SIMULATION

Create a highly visible button:

# محاكاة البصمة

Modal:

```text id="xnygkj"
اختر الموظف
نوع البصمة
التاريخ
الوقت
الجهاز
```

Types:

```text id="8v3zsc"
دخول
خروج
```

Demo device:

```text id="v1k8q6"
ZK-DEMO-01
```

After clicking:

**تسجيل البصمة**

show:

**تم تسجيل البصمة بنجاح**

Then immediately recalculate attendance.

---

# 18. RAW BIOMETRIC LOGS

Create immutable raw attendance records.

Each record contains:

```text id="c1q1po"
Employee ID
Device ID
Timestamp
Punch Type
Source
```

Example:

```text id="f2w0kc"
EMP-1001
ZK-DEMO-01
21/08/2026 08:13
IN
SIMULATED
```

Never delete or overwrite the original biometric record when HR corrects attendance.

---

# 19. ATTENDANCE ENGINE

For each employee/day calculate:

- Shift start
- Shift end
- Actual IN
- Actual OUT
- Late minutes
- Early leave
- Worked hours
- Overtime
- Status

Rules:

### First Punch

First valid punch = IN.

### Last Punch

Last valid punch = OUT.

---

# 20. GRACE PERIOD

Example:

```text id="xqkly1"
Shift:
08:00

Grace:
10 minutes

Punch:
08:13
```

Show:

```text id="2k3s0j"
Actual lateness:
13 minutes

Deductible lateness:
3 minutes
```

Do not hide this distinction.

---

# 21. EARLY LEAVE

Example:

```text id="q4a0is"
Shift End:
16:00

Actual OUT:
15:32

Early Leave:
28 minutes
```

---

# 22. ATTENDANCE STATUSES

Use:

```text id="8es51c"
حاضر
متأخر
غائب
إجازة
مأمورية
غياب بعذر
انصراف مبكر
بصمة ناقصة
```

Use clear professional status badges.

---

# 23. MISSING PUNCH

If employee has only one punch:

Show:

**بصمة ناقصة**

Do NOT automatically mark the employee absent.

HR must be able to review and correct it.

---

# 24. MANUAL ATTENDANCE CORRECTION

HR can correct attendance.

Example:

```text id="2z9d4f"
Employee:
أحمد علي

Date:
21/08/2026

Original OUT:
غير موجود

Corrected OUT:
16:05

Reason:
الموظف نسي تسجيل الانصراف
```

Save correction.

Do not delete original raw biometric record.

Create an Audit Log entry.

---

# 25. LEAVES & EXCUSES

Create leave management.

Types:

```text id="6xipd0"
إجازة سنوية
إجازة عارضة
إجازة مرضية
إجازة بدون أجر
مأمورية
إذن
غياب بعذر
```

Fields:

```text id="czn10h"
الموظف
نوع الطلب
من
إلى
السبب
الحالة
المعتمد بواسطة
```

Statuses:

```text id="qg7l5u"
معلق
معتمد
مرفوض
```

Approved leave must prevent absence calculation.

---

# 26. OVERTIME

Create overtime management.

Fields:

```text id="2x6z9g"
الموظف
التاريخ
عدد الساعات
سعر الساعة
القيمة
حالة الاعتماد
ملاحظات
```

Statuses:

```text id="3y98l5"
معلق
معتمد
مرفوض
```

Only approved overtime enters payroll.

---

# 27. DEDUCTIONS & PENALTIES

Types:

```text id="c7o2qf"
تأخير
غياب
انصراف مبكر
جزاء
سلفة
خصم إداري
خصومات أخرى
```

Fields:

```text id="h2f4b5"
الموظف
نوع الخصم
القيمة
التاريخ
السبب
ملاحظات
```

---

# 28. ALLOWANCES & INCENTIVES

Support:

```text id="t2w4v8"
بدل مواصلات
بدل وجبة
بدل ثابت
حافز
مكافأة
```

For MVP use monthly fixed amounts.

---

# 29. PAYROLL ENGINE

Build a real payroll calculation engine.

Formula:

```text id="8d9g4m"
Gross Salary
=
Basic Salary
+
Allowances
+
Approved Overtime
+
Incentives
+
Bonuses
```

Then:

```text id="0q0r1z"
Net Salary
=
Gross Salary
-
Late Deductions
-
Absence Deductions
-
Early Leave Deductions
-
Penalties
-
Advances
-
Other Deductions
```

Do NOT hardcode final salaries.

Calculate them dynamically from the employee's actual data.

---

# 30. DEMO PAYROLL EXAMPLE

Employee:

# أحمد علي

Use:

```text id="7v8qkw"
الراتب الأساسي       12,000 EGP
البدلات                1,000 EGP
الإضافي                  800 EGP
--------------------------------
الإجمالي              13,800 EGP

خصم التأخير              200 EGP
خصم الغياب               400 EGP
جزاء                      300 EGP
سلفة                    1,000 EGP
--------------------------------
صافي المرتب            11,900 EGP
```

These values should be generated by the calculation engine.

---

# 31. SALARY EXPLANATION

Every payroll record must have:

# عرض تفاصيل الحساب

When clicked show:

```text id="3h2jvz"
الراتب الأساسي
12,000 EGP

البدلات
1,000 EGP

الإضافي
800 EGP

----------------

الإجمالي
13,800 EGP

خصم التأخير
200 EGP

خصم الغياب
400 EGP

الجزاءات
300 EGP

السلف
1,000 EGP

----------------

صافي المرتب
11,900 EGP
```

The user must understand exactly where every number came from.

---

# 32. PAYROLL PERIOD

Create payroll periods.

Example:

# August 2026

Statuses:

```text id="t2g0xk"
مسودة
تم الحساب
معتمد
مغلق
```

Workflow:

```text id="m5d3xx"
مسودة
↓
حساب الرواتب
↓
مراجعة
↓
اعتماد
↓
إغلاق
```

Locked payroll cannot be edited by normal users.

---

# 33. DASHBOARD

Create a professional management dashboard.

Top KPI cards:

```text id="7r5y2m"
إجمالي الموظفين
50

الحاضر اليوم
42

الغائب اليوم
3

المتأخر اليوم
4

في إجازة
1

بصمة ناقصة
2
```

Monthly KPIs:

```text id="s7k7j5"
إجمالي الرواتب
XXX,XXX EGP

الإضافي
XX,XXX EGP

الخصومات
XX,XXX EGP

تكلفة الغياب
XX,XXX EGP

تكلفة التأخير
XX,XXX EGP
```

Charts:

- Attendance trend
- Attendance by department
- Payroll by department
- Overtime
- Absence
- Late employees

---

# 34. WORKFORCE COST ANALYSIS

Create a management-focused page.

Show:

```text id="6u5qk9"
إجمالي تكلفة العمالة
إجمالي الرواتب
الإضافي
تكلفة الغياب
تكلفة التأخير
الجزاءات
```

Cost by department:

```text id="8x1c5h"
الإنتاج
2,400,000 EGP

المخازن
850,000 EGP

الصيانة
620,000 EGP

الأمن
500,000 EGP
```

Also show:

### أكثر الأقسام تأخيرًا

### أكثر الموظفين تأخيرًا

### أكثر الأقسام في الإضافي

### تكلفة الغياب

Use charts.

The goal is to demonstrate where labor cost is being lost.

---

# 35. REPORTS

Create:

## Attendance Report

Filters:

- Date
- Employee
- Department
- Status

Columns:

```text id="8o8kgl"
الموظف
التاريخ
الوردية
الدخول
الخروج
التأخير
الانصراف المبكر
ساعات العمل
الحالة
```

Also create:

- تقرير الغياب
- تقرير التأخير
- تقرير الإضافي
- تقرير الخصومات
- تقرير الجزاءات
- تقرير الرواتب

---

# 36. EXPORT

Implement:

```text id="3x5a6n"
تصدير Excel
تصدير CSV
طباعة
```

Exports must be clean and readable.

---

# 37. PAYSLIP

Create a professional printable salary slip.

Use the actual Afro Egypt logo.

Display:

```text id="4o8u1n"
AFRO EGYPT

Factory Workforce

كشف مرتب

اسم الموظف
الرقم الوظيفي
القسم
الشهر

الراتب الأساسي
البدلات
الإضافي
الإجمالي

الخصومات
الجزاءات
السلف

صافي المرتب
```

Footer:

**Powered by 404 Legends**

Keep this subtle.

---

# 38. AUDIT LOG

Track sensitive modifications.

Track:

- Attendance corrections
- Salary changes
- Deductions
- Penalties
- Overtime approvals
- Leave approvals
- Employee edits

Each log:

```text id="x6y1m0"
المستخدم
العملية
الموديول
القيمة القديمة
القيمة الجديدة
التاريخ والوقت
السبب
```

Example:

```text id="6o3o6q"
Ahmed HR

Attendance Edit

OUT:
16:00 → 16:05

Reason:
Forgot checkout
```

---

# 39. USER ROLES

Create:

## Admin

Full access.

## HR

Access to:

- Employees
- Attendance
- Leaves
- Overtime
- Deductions
- Payroll
- Reports

## Supervisor

Access to:

- Department employees
- Overtime approval
- Selected request approvals

## Employee

Access to:

- Own attendance
- Own leaves
- Own payslip

Basic permission enforcement must work.

---

# 40. DEMO SCENARIO

Create a prominent button:

# تشغيل العرض التجريبي

When clicked, demonstrate:

```text id="0q1mb6"
اختيار أحمد علي
↓
تسجيل بصمة دخول 08:13
↓
النظام يكتشف التأخير
↓
تسجيل بصمة خروج 16:05
↓
عرض نتيجة الحضور
↓
إضافة إضافي
↓
اعتماد الإضافي
↓
إضافة خصم
↓
حساب المرتب
↓
عرض تفاصيل المرتب
↓
عرض تأثير التكلفة
```

The entire workflow must work without modifying code.

---

# 41. DEMO EMPLOYEES

Create employees with different scenarios.

### Employee 1

Perfect attendance.

### Employee 2

Late.

### Employee 3

Absent.

### Employee 4

Approved leave.

### Employee 5

Missing checkout.

### Employee 6

Overtime.

### Employee 7

Penalty.

### Employee 8

Multiple deductions.

This makes the application immediately understandable.

---

# 42. FIXED DEMO DATE

Use:

# 21 August 2026

as the main demo date.

Seed predictable data around this date.

The demo should behave consistently.

---

# 43. PAYROLL DISCLAIMER

Do NOT claim that the MVP automatically calculates:

- Egyptian income tax
- Social insurance
- Egyptian legal payroll
- Labor-law compliance

unless explicitly implemented and verified.

For the MVP use:

**حساب تجريبي وفق قواعد المصنع**

Payroll rules should be configurable.

---

# 44. SETTINGS

Create:

## Company Settings

```text id="7s2n7n"
اسم الشركة
اللوجو
العنوان
رقم الهاتف
```

Default company:

**Afro Egypt**

## Attendance Settings

```text id="t5l0n0"
فترة السماح
قواعد التأخير
قواعد الانصراف المبكر
```

## Payroll Settings

```text id="y6r8pr"
سعر الإضافي
قواعد الخصم
```

Keep this simple.

---

# 45. DATA ARCHITECTURE

Use logical entities:

```text id="b6txgi"
User
Role
Employee
Department
Shift
AttendanceLog
DailyAttendance
Leave
Overtime
Deduction
Allowance
PayrollPeriod
PayrollRecord
AuditLog
CompanySettings
```

Important architecture:

```text id="h9t2od"
AttendanceLog
```

is immutable raw biometric data.

```text id="4q2f6j"
DailyAttendance
```

contains calculated attendance.

```text id="t9jj5e"
PayrollRecord
```

contains financial results.

---

# 46. CRITICAL BUSINESS RULE

Never destroy raw biometric data.

If HR corrects attendance:

```text id="8xpy8u"
Raw Punch
     ↓
Remain unchanged

Attendance Correction
     ↓
Separate record

Audit Log
     ↓
Track who changed it
```

This is important for trust and accountability.

---

# 47. USER EXPERIENCE

Every important action must provide feedback.

Examples:

```text id="k9t2gf"
تم تسجيل البصمة بنجاح

تم حفظ الموظف

تم اعتماد الإجازة

تم إضافة الخصم

تم اعتماد الإضافي

تم حساب الرواتب

تم اعتماد الرواتب
```

Use toast notifications.

Use confirmation dialogs before destructive actions.

---

# 48. LOADING / ERROR / EMPTY STATES

Implement:

- Loading states
- Error states
- Empty states
- Toast notifications
- Skeletons where appropriate

Do not leave empty white areas.

---

# 49. SEARCH & FILTERS

Implement useful search and filters.

Employees:

- Search by name
- Search by employee ID
- Filter by department
- Filter by status

Attendance:

- Date
- Department
- Employee
- Status

Payroll:

- Month
- Department
- Employee

Reports:

- Date range
- Department
- Status

---

# 50. RESPONSIVE DESIGN

Primary target:

**Desktop**

Because HR and factory management will mainly use desktop computers.

But also support:

- Tablet
- Mobile

Do not sacrifice desktop quality.

---

# 51. CODE QUALITY

Use:

- TypeScript
- Reusable components
- Clean folder structure
- Centralized business logic
- Centralized attendance calculations
- Centralized payroll calculations
- Clear types
- Clear database models

Do not put payroll calculations directly inside UI components.

Business logic must be reusable and testable.

---

# 52. DO NOT BUILD THESE FEATURES

Do NOT waste time on:

- Mobile app
- Recruitment
- Performance management
- AI
- WhatsApp
- ERP integration
- Accounting integration
- Face recognition
- Real biometric hardware integration
- Multi-country payroll
- Advanced legal compliance
- Complex employee self-service
- Multi-company enterprise architecture

Focus on:

```text id="6umj0c"
Employees
↓
Biometric Simulation
↓
Attendance
↓
Leaves
↓
Overtime
↓
Deductions
↓
Payroll
↓
Reports
↓
Cost Analysis
```

---

# 53. MAIN DEMO STORY

The whole application should make this story obvious:

```text id="5m3q2c"
أحمد وصل متأخر
        ↓
سجل بصمة
        ↓
النظام اكتشف التأخير
        ↓
الحضور اتحسب
        ↓
الخصم اتحسب
        ↓
أحمد عمل إضافي
        ↓
الإضافي اتعتمد
        ↓
المرتب اتحسب
        ↓
تفاصيل المرتب ظهرت
        ↓
تكلفة العمالة اتحدثت
```

This is the core sales story.

---

# 54. VALUE PROPOSITION

The UI should communicate that the system helps Afro Egypt:

### Save HR Time

Less manual attendance and payroll work.

### Reduce Human Errors

Standardized calculations.

### Improve Payroll Accuracy

Every salary has a clear calculation breakdown.

### Control Labor Cost

Management can see overtime, absence, and lateness costs.

### Improve Accountability

Every sensitive modification is logged.

### Centralize Information

Employees, attendance, leaves, deductions, overtime, and payroll are connected.

---

# 55. FINAL ACCEPTANCE TEST

The MVP is complete only if I can perform this entire flow from the browser:

```text id="9j7yab"
Login
↓
Dashboard
↓
Employees
↓
Open Ahmed Ali
↓
Simulate IN
↓
Simulate OUT
↓
Attendance updates
↓
Late calculation updates
↓
Add overtime
↓
Approve overtime
↓
Add deduction
↓
Open Payroll
↓
Calculate payroll
↓
Open Ahmed salary
↓
View salary explanation
↓
Open Workforce Cost
↓
See updated cost
↓
Export report
↓
Open Audit Log
↓
See all changes
```

No code editing should be required.

---

# 56. FINAL UI REQUIREMENT

The final application must look like a **real commercial product customized for Afro Egypt**, not an AI-generated generic dashboard.

The first impression should be:

> **"This is a real workforce management system built for our factory."**

not:

> "This is a demo website."

Keep the design polished, coherent, and professional.

---

# 57. FINAL INSTRUCTION

Build the complete working MVP now.

Do NOT only explain how to build it.

Do NOT only generate a plan.

Do NOT stop at UI mockups.

Create:

- The complete application
- All pages
- All navigation
- All components
- All demo data
- All calculations
- All interactions
- Attendance engine
- Payroll engine
- Simulated biometric integration
- Leaves
- Overtime
- Deductions
- Penalties
- Reports
- Workforce cost analysis
- Audit logs
- Roles
- Settings
- Branding

Use **Afro Egypt** as the client/company name everywhere.

Use **404 Legends** only as the software developer/technology provider.

When the Afro Egypt logo is provided, analyze it and immediately use it as the primary visual identity.

The final result must be runnable locally and ready to demonstrate to the Afro Egypt factory management.

## Core message of the product:

# From Attendance to Payroll — Everything Connected.
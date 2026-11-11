# Afro Egypt — Factory Workforce · الخطة والوثيقة الكاملة للمشروع

> وثيقة مرجعية واحدة لكل ما يخص المشروع: الفكرة، التقنيات، الأدوار، الوحدات، قاعدة البيانات، قواعد الحساب، جهاز البصمة، الأمان، النشر، تاريخ المراحل، وما هو مفتوح.
> **مصدر الحقيقة هو الكود.** الوثيقة بتلخّصه وبتشاور على الملفات. آخر مراجعة: 2026-10-11 (على فرع `ibrahim`).
>
> الوثائق التانية في الريبو: `README.md` (تشغيل ونشر) · `PLAN.md` (خطة تحويل الديمو لنظام حقيقي، المراحل 1–7) · `PLAN-payroll-hr.md` (المراحل 8–12) · `docs/DEMO-GUIDE.md` (سيناريو العرض) · `Afro Egypt — Factory Workforce MVP Full Build Prompt.md` (المواصفة الأصلية للـMVP). الوثيقة دي بتجمعهم وبتضيف اللي اتبنى بعدهم.

---

## 1. نظرة عامة

**المنتج:** نظام إدارة العمالة والحضور والرواتب لمصنع **Afro Egypt** (مصنع أثاث في مصر). تطوير **404 Legends**.

**بيعمل إيه:** بيربط جهاز بصمة ZKTeco بحضور يومي محسوب تلقائيًا، وبيحوّل الحضور إلى خصومات وإضافي ورواتب حسب لائحة الشركة، وبيدير ملف كل موظف (بيانات + مستندات + إقرارات موقّعة)، مع صلاحيات دقيقة وسجل تدقيق لكل تعديل حساس.

**الوضع:** نظام حقيقي في الإنتاج (مش ديمو). بدأ كـMVP ديمو في الذاكرة (2026-09-02) واتحوّل لنظام فعلي على MySQL بمصادقة حقيقية، ونُشر على سيرفر الشركة بـCI تلقائي.

**اللغات والواجهة:** عربي (RTL، الأساسي) + إنجليزي، مع تبديل لحظي. الأرقام دايمًا لاتيني حتى في العربي (`ar-EG-u-nu-latn`).

**العلامة:** العميل Afro Egypt · المطوّر 404 Legends · المنتج "Factory Workforce".

---

## 2. التقنيات والبنية

| الطبقة | الاختيار |
|---|---|
| Framework | Next.js **15** (App Router) — Server Components + Server Actions، `output: "standalone"` |
| اللغة | TypeScript، React 18 |
| قاعدة البيانات | **MySQL 8** عبر Prisma 6 (على السيرفر الحي بتتعامل مع MariaDB — راجع §14) |
| الواجهة | Tailwind CSS 3 + shadcn/ui (Radix) + lucide-react + Recharts + sonner (toasts) |
| النماذج | react-hook-form + zod |
| المصادقة | جدول `User` + bcrypt + كوكي جلسة موقّع HMAC-SHA256 |
| الجهاز | `node-zklib` (SDK لأجهزة ZKTeco على TCP) |
| الصور | `sharp` (صور مصغّرة للصورة الشخصية) |
| التصدير | `xlsx` (SheetJS) → Excel حقيقي |
| الاختبارات | Vitest |
| المساعد الذكي | Claude CLI بحساب Claude المسجّل على السيرفر (اختياري) |

### مبادئ معمارية اتفقنا عليها

1. **محرّكات حساب نقية** (بدون I/O) منفصلة عن الـUI: `attendance-engine.ts`, `payroll-engine.ts`, `pay-engine.ts`, `pay-rules.ts`. **ما نلمسهاش إلا لإصلاح bug مؤكّد باختبار** (أو تطوير مقصود باختبارات، زي فصل اليومي/الشهري).
2. **قناة تدقيق واحدة** `src/lib/audit.ts`: `recordChange(entry, write)` بتكتب التغيير وصف التدقيق في `prisma.$transaction` واحدة (يهبطوا سوا أو يترجعوا سوا). `recordChangeAs` بدون جلسة، `writeAudit(tx,…)` جوّا transaction قايمة.
3. **قناة صلاحية صفحات واحدة** `requireAccess(path)` في `src/lib/auth.ts` — بتتحقق من الجلسة الموقّعة **و** صلاحية الصفحة. الـmiddleware توجيه UX بس؛ الفرض الحقيقي في الـserver.
4. **قراءة مقصورة بنطاق (Scope):** `src/lib/scope.ts` — `Scope = { all: true } | { all: false, ids }` و`viewerScope` / `inScope` / `employeesInScope` / `rowsInScope` / `scopedSnapshot` / `canViewEmployee`. الـselectors بتاخد `Scope` **أول باراميتر إجباري**.
5. **`getDb()` = snapshot كامل لكل request** (`src/lib/data.ts`): بيحمّل الجداول الأساسية بشكل `Store`، والـserializers في `serialize.ts` بتحوّل التواريخ لـISO. ده قرار مقصود، **ما نحوّلوش لاستعلامات مقصورة من غير سبب أداء**. جداول append-only الكبيرة (`AttendanceLog`، `AuditLogEntry`) **مش** جواه.
6. **الفلوس `Int` بالجنيه** في كل حته (المحرّكات بتقرّب لأقرب جنيه).
7. **`AttendanceLog` append-only** — بصمات الجهاز الخام ما بتتعدّلش ولا بتتمسح (قاعدة العمل الحرجة).
8. **الحذف الناعم** (`deletedAt`) على `Employee` / `Department` / `Shift` / `PayType` / `WorkSchedule`.

### خريطة الكود

```
src/app/(app)/*            صفحات النظام المحمية (layout بيفرض الجلسة)
src/app/api/               punch · events (SSE) · notifications · employees/[id]/{documents,acknowledgments}
src/app/login, payslip     دخول وكشف المرتب (خارج الـlayout الرئيسي)
src/lib/actions/*          كل الكتابة (Server Actions)
src/lib/*-engine.ts        محرّكات نقية
src/lib/zk-device.ts, attendance-{realtime,sync,ingest,service}.ts   جهاز البصمة
src/lib/assistant/*        المساعد الذكي
src/lib/i18n/              dictionary.ts (مصدر الحقيقة) + dictionaries/{ar,en}.ts
src/components/            ui (shadcn) · skeletons · shared · وحدة لكل صفحة
prisma/                    schema.prisma · migrations (29) · seed-prod.ts · seed-sample.ts
tests/                     Vitest (29 ملف)
```

---

## 3. الأدوار والصلاحيات

### الأدوار (`Role`)
`admin` · `hr` · `supervisor` · `employee` · `staff`

- **admin** — كل حاجة دايمًا. الوحيد اللي بيدير المستخدمين والصلاحيات وجهاز البصمة.
- **employee** — خدمة ذاتية: بياناته بس (حضوره، كشف مرتبه، طلب إجازة).
- **hr / supervisor / staff** ("اداري") — بيتحكم فيهم **قايمة صلاحيات** يحدّدها الأدمن واحدة واحدة.
  - **حساب بدون أي صلاحية = خدمة ذاتية وقراءة فقط** (زي الموظف). أول ما الأدمن يمنحه صلاحية بيخرج من الخدمة الذاتية.
  - **النطاق:** `departmentIds` (مصفوفة أقسام) — فاضية = الشركة كلها.

### الصلاحيات القابلة للمنح (`PERMISSION_DEFS`)
`employees` · `departments` · `shifts` · `attendance` · `leaves` · `overtime` · `deductions` · `payroll` · `reports` · `workforce_cost` · `audit_log` · `settings`

**أبدًا مش قابلة للمنح (أدمن فقط):** `/users` · `/permissions` · `/change-requests` · `/biometric-device`.

### رفع/حذف ملفات الموظف
`canManageEmployeeFiles`: الأدمن، أو HR معاه صلاحية `employees`. المشرف **مفيش** (مش قابلة للتفويض).

### الموافقات (Change Requests)
أي كتابة بيعملها "اداري" بتعدّي على `gate()` (`src/lib/change-requests.ts`):
- **الأدمن:** بينفّذ فورًا.
- **اداري عادي:** الكتابة بتتخزّن `ChangeRequest` معلّقة (`payload` متحقّق منه + ملخّص قديم→جديد) ولا تتطبّق لحد ما الأدمن يوافق من `/change-requests` (بتتطبّق منسوبة لصاحب الطلب في التدقيق) أو يرفض.
- **`directEdit` ("كل الصلاحيات"):** بينفّذ فورًا لكن بيتسجّل في `/change-requests` كتنفيذ مباشر. **الحذف دايمًا بيحتاج موافقة.**
- **خدمة ذاتية:** مش بس مقروء، حتى ما يقدرش يقدّم طلب تعديل.

### فرض النطاق (مش إخفاء واجهة)
الفرض على مستويين: القراءة (`scope.ts`) والوصول للصفحة (`requireAccess`). المشرف شايف قسمه بس، والموظف نفسه بس. صفحة موظف خارج النطاق → 404.

> ملاحظة: جدول الأدوار في `README.md` قديم في نقطة الـHR (كان "كل الموظفين"). الصح دلوقتي ما فوق (HR = اداري بصلاحيات ممنوحة).

---

## 4. الوحدات والصفحات

| المسار | الوصف | الصلاحية |
|---|---|---|
| `/dashboard` | KPIs يومية وشهرية، اتجاه الحضور 14 يوم، حسب القسم، أكثر المتأخرين. مقصورة بالنطاق. للموظف لوحة بسيطة | الكل |
| `/employees` | قائمة الموظفين: بحث، فلتر قسم/حالة/فترة التعيين (جديد <3 شهور)، **صورة مصغّرة بجانب الاسم**، حالة جهاز البصمة، تنبيه الأوراق الناقصة. **المنتهية خدمتهم في آخر القائمة** | `employees` |
| `/employees/[id]` | ملف الموظف (الرابط بـ`employeeNumber`): بيانات أساسية، مستندات، حضور، إضافي، خصومات، رواتب، تبويب "إجراءات" (تعديل/حذف) | `employees` |
| `/departments`, `/shifts` | الأقسام (رئيس القسم موظف حقيقي) والورديات | `departments` / `shifts` |
| `/attendance` | الحضور اليومي حسب التاريخ + السجل الخام للبصمات + تسجيل حضور يدوي | `attendance` |
| `/leaves` | طلبات الإجازات والأعذار + اعتماد/رفض (الأدمن يقدر يحذف حتى بعد القرار) | `leaves` |
| `/overtime` | الإضافي (تلقائي من النظام + يدوي) + اعتماد | `overtime` |
| `/deductions` | الخصومات والجزاءات + البدلات والمكافآت. فتح أي صف كامل بالضغط عليه | `deductions` |
| `/payroll` | فتح فترة، حساب، اعتماد، إغلاق، تفصيل الاحتساب، تنبيه اكتمال الأوراق | `payroll` |
| `/payslip/[recordId]` | كشف مرتب قابل للطباعة | صاحبه/المخوّلين |
| `/reports` | تقارير حضور/إضافي/خصومات/رواتب + تصدير Excel/CSV | `reports` |
| `/workforce-cost` | تحليل تكلفة العمالة | `workforce_cost` |
| `/audit-log` | آخر 200 تعديل حساس | `audit_log` |
| `/settings` | الشركة، الحضور، الرواتب، **أنواع الأجر**، **جداول الدوام**، **الإجازات الرسمية** | `settings` |
| `/users`, `/users/[id]` | إدارة المستخدمين (إنشاء من موظف قائم، تعديل، تفعيل/تعطيل، إعادة تعيين كلمة المرور، الصلاحيات) | أدمن |
| `/change-requests` | مراجعة طلبات التعديل المعلّقة وسجل التنفيذ المباشر | أدمن |
| `/biometric-device`, `…/users/[uid]` | إدارة جهاز البصمة: اتصال، مزامنة، مستخدمو الجهاز، ربطهم بالموظفين | أدمن |
| `/permissions` | صفحة صلاحيات (متخبّية — بقت جزء من صفحة المستخدم) | أدمن |

**عام في كل الصفحات:** جرس إشعارات حقيقي · تحديث لحظي عند تغيّر البيانات · Skeleton loading لكل route (`loading.tsx` × 15، مطابق لتخطيط الصفحة) · المساعد الذكي في صفحات الموظفين.

---

## 5. نموذج البيانات (Prisma / MySQL)

**الكيانات الأساسية:** `User` · `Department` · `DepartmentNumberSequence` · `Shift` · `Employee` · `PayType` · `WorkSchedule` · `Device` · `AttendanceLog` · `DailyAttendance` · `Leave` · `Overtime` · `Deduction` · `Allowance` · `PayrollPeriod` · `PayrollRecord` · `EmployeeDocument` · `EmployeeAcknowledgment` · `AssistantMessage` · `AuditLogEntry` · `ChangeRequest` · `Holiday`
**الإعدادات (صف واحد `singleton`):** `CompanySettings` · `AttendanceSettings` · `PayrollSettings` · `BiometricDeviceSettings`

### نقاط مهمة
- **`Employee`**
  - `employeeNumber` فريد بصيغة `<كود القسم>-<تسلسل>` (مثل `ACC-001`)، بيتولّد تلقائيًا من `DepartmentNumberSequence` ومابيتعدّلش. ده اللي بيظهر للمستخدم وفي الـURL (مش الـ`id` الداخلي).
  - `payTypeId` / `workScheduleId` / أوقات مخصّصة (`customWorkStart/End/OvertimeStart`) — الأوقات المخصّصة بتكسب.
  - `salaryType` (شهري/يومي) + `basicSalary` + `dailyRate` + `dailyWorkingHours` + `overtimeEligible` ("له إضافي").
  - `biometricDeviceUserId` (فريد) + `biometricLinkedAt` (الغياب بيتسجّل من تاريخ الربط).
  - بيانات شخصية: `nationalId` (14 رقم، فريد) · `phone` · `address` · `qualification` · `militaryStatus` · `gender` · `isDriver`. كلها nullable في الـDB (عشان الـmigration على صفوف قديمة) والفورم **بيفرضها**.
  - `requiredDocuments` / `requiredAcknowledgments` — قائمة مطلوبات خاصة بالموظف (`null` = الافتراضي المحسوب).
  - `status`: `active` · `on_leave` · `terminated`.
- **`DailyAttendance`** فريد `(employeeId, date)` · حالاته: `present` `late` `absent` `leave` `mission` `excused_absence` `early_leave` `missing_punch`.
- **`PayrollPeriod`** فريد `(year, month)` · حالاته: `draft → calculated → approved → closed`.
- **`PayrollRecord`** فيه `paidDaysCount` و`dailyRateApplied` للموظف اليومي (توثيق وقت الاحتساب).
- **`Allowance`**: النوع `bonus` مرة واحدة مربوطة بشهرها (`effectiveYear/Month`)، والباقي (`transport/meal/fixed/incentive`) شهري متكرر.
- **`Deduction.type`**: `late` `absence` `early_leave` `permission` `unauthorized_exit` `penalty` `advance` `admin_deduction` `other`. و**`Overtime`** و`Deduction` فيهم صفوف "النظام" (تلقائية) بـ`systemKey` و`voidedAt` (§6.4).
- **`Leave.type`**: `annual` `casual` `sick` `unpaid` `mission` `permission` `excused_absence`.
- **`User`**: `permissions` (JSON) · `directEdit` · `departmentIds` (JSON) · `active` · `lastLoginAt`.
- **migrations:** 29 migration (أولها `20260902195742_init`)، كلها بتتطبّق بـ`prisma migrate deploy`. الـmigrations اللي فيها تغييرات هدّامة بتتكتب يدويًا (Prisma `migrate dev` مش بيشتغل non-interactive لما بتضيف unique على صفوف موجودة).

---

## 6. قواعد العمل

### 6.1 محرّك الحضور (`attendance-engine.ts`)
- أول بصمة = دخول، آخر بصمة = خروج، داخل **نافذة الوردية الفعلية (±6 ساعات)** — بيدعم الورديات اللي بتعدّي منتصف الليل (ده كان bug اتصلّح في المرحلة 5).
- فترة سماح، تأخير، انصراف مبكر، إضافي، **بصمة ناقصة** (`missing_punch`)، إجازة معتمدة، تصحيح يدوي من HR.
- موظف "على الوردية لسه" (بصمة واحدة ولم تنتهِ ورديته) بيتحسب **حاضر** (`withOpenShift`).
- التواريخ بتتعامل بتوقيت محلي صح (اتصلّح bug "التاريخ ينزلق يوم").
- **تسجيل الغياب** بيشتغل لمن عندهم جهاز بصمة مربوط، **من `2026-09-21` فصاعدًا** (`ABSENCE_TRACKING_FROM`) ومن يوم الربط، والجمعة إجازة (الافتراضي `weeklyOffDays = 5`) + الإجازات الرسمية.

### 6.2 أنواع الأجر (PayType) — قابلة للتعديل من `/settings`
مفيش حاجة ثابتة في الكود؛ كل نوع أجر ليه قواعده. الافتراضيين:

| القاعدة | شهري | يومية |
|---|---|---|
| أساس الأجر | الراتب كامل (`basis=monthly`) | أيام العمل × أجر اليوم |
| قاسم اليوم | 30 | 26 |
| الدوام | 08:00 → 18:00 | 08:00 → 18:30 |
| قاعدة الخميس | لا | نعم: ينتهي 16:30 |
| مضاعف التأخير | 1.5 | 1.5 |
| مضاعف الإضافي | 1.5 (حد أدنى 60 دقيقة، خطوة 30) | نفسه |
| الإضافي تلقائي | يتعتمد فورًا | نفسه |
| عمل يوم الإجازة الأسبوعية | ×2 | ×2 |
| عمل الإجازة الرسمية | ×2 | ×2 |
| خروج بدون إذن | ×1.5 | ×1.5 |
| إذن لباقي اليوم | ×1 | ×1 |
| غياب بإذن (إخطار 48 ساعة) | يوم | يوم |
| غياب بدون إذن | يومين | يومين |

لو نوع أجر الموظف مش لاقيه، بيتحسب بالقيم الافتراضية دي (`pay-defaults.ts`) بدل ما الحساب يكسر.

### 6.3 الأجر اليومي مقابل الشهري
- **شهري:** الراتب كامل + بدلات + إضافي − خصومات (تأخير/غياب/…).
- **يومي:** `الأساس = أيام مدفوعة × أجر اليوم`. الأيام المدفوعة (`dailyPaidDays`): أيام الشغل (`present/late/early_leave/missing_punch/mission`) + (من تاريخ بدء تتبّع الغياب) أيام الغياب/الإجازة/العذر لأنها بتتحمّل عبر خصم الغياب (عشان ما تتخصمش مرتين). الشغل في الإجازة الأسبوعية/الرسمية بيتدفع **بالساعة** بمضاعفه، مش يوم.
- **بصمة واحدة للموظف اليومي = يوم مدفوع كامل** (قرار محسوم).

### 6.4 الخصومات والإضافي التلقائي (لائحة الشركة الداخلية)
`attendance-deductions.ts` بيحسب كل يوم منتهي ويكتب:
- **خصومات** (`late` · `absence` · `permission` · `unauthorized_exit`) في جدول `Deduction`.
- **إضافات** (`overtime` · `friday` · `holiday` · `thursday_extra`) في جدول `Overtime`.
- كل صف "نظام" له `systemKey = employeeId|date|type`. تعديله بيحافظ على القيمة المحسوبة الأصلية. **حذفه** بيعلّمه `voidedAt` (مش بيتمسح) عشان ما يتبعتش تاني. الأسباب بتتكتب بالعربي وفيها القاعدة والرقم.

### 6.5 فترة الرواتب
- **الشهر المحاسبي يبدأ يوم 26** من الشهر اللي قبله لحد 25 (`payPeriodStartDay`، قابل للتعديل؛ 1 = شهر تقويمي).
- **يوم الصرف:** أول الشهر اللي بعده.
- `calculatePayroll` كله جوّا `prisma.$transaction`، و`PayrollPeriod` فريد `(year, month)`.
- **المكافأة** (`bonus`) بتظهر في شهرها بس (كان bug إنها بتتكرر كل شهر — اتصلّح).
- **الأوراق:** كشف الرواتب بيعلّم الموظفين اللي أوراقهم ناقصة (بدون ما يوقف صرفهم).

### 6.6 الإجازات الرسمية
`Holiday` (من/إلى، ممكن أيام متعددة زي العيد) من `/settings`. محدّش بيتسجّل غايب فيها، ومن اشتغل بيتحاسب بمضاعف الإجازة.

---

## 7. جهاز البصمة (ZKTeco)

ثلاث مسارات لدخول البصمات (كلها بتنتهي في `AttendanceLog` ثم إعادة حساب `DailyAttendance`):

1. **Real-time (الأساسي):** `attendance-realtime.ts` + `zk-device.ts` — مستمع دايم (CMD_REG_EVENT) على بورت الجهاز (افتراضي `4370`). بيبدأ مرة واحدة لكل process من `src/lib/startup.ts` (مستورد من الـroot layout) — **مش بيشتغل أثناء `next build` ولا على Vercel**. الحالة مشتركة عبر `globalThis` لأن الموديول ممكن يتجمّع في أكتر من bundle.
2. **Pull / مزامنة:** `attendance-sync.ts` بيسحب سجل الجهاز كله ويكتب الجديد بس (آمن للتكرار والتوازي). بيتشغّل كـcatch-up بعد كل إعادة اتصال، وكـ**شبكة أمان كل 10 دقايق**، ويدويًا من الصفحة.
3. **Push:** `POST /api/punch` بـheader `X-Punch-Key` = `PUNCH_API_KEY`. Body: `{deviceUserId, timestamp?, punchType?, deviceId?}`. بيستنتج in/out لو ما اتبعتش. (لازم الجهاز نفسه يتظبّط يبعت — حاليًا المشروع مش بيظبّطه.)

**مرونة الاتصال (`device-resilience.ts`):** مهلة اتصال 4 ثواني، إعادة اتصال بتأخير متصاعد، حالة اتصال صادقة (مفيش "منفصل" كاذب)، والجهاز المقطوع ما بيعلّقش الصفحة.

**ربط الجهاز بالموظف:** من `/biometric-device` (مش من فورم الموظف). الربط بيعمل backfill لكل التاريخ وبيحفظ `biometricLinkedAt`؛ فك الربط بيمسح التاريخ المرتبط. حذف مستخدم من الجهاز بيفكّ ربط الموظف. وفي زرار فك ربط لما يكون الربط يتيم. اسم الجهاز لكل موظف بيظهر في قائمة الموظفين (بيتجاب بعد ظهور القائمة، ومابيعطّلهاش لو الجهاز مطفي).

---

## 8. ملف الموظف: المستندات والإقرارات

### المستندات (`EmployeeDocument`)
مبنية على نموذج الشركة **HR-F-04 "فهرس ملف الخدمة"** بثلاث مستويات:
- **المستوى الأول (مطلوب للجميع، بيتحسب "ناقص"):** `cv` · `birth_certificate` · `qualification_certificate` · `criminal_record` · `work_experience_certificate` · `personal_photo` · `national_id_photo` · `job_application_form` · `social_insurance_form`
- **مشروط:** `military_certificate` (للذكور) · `driving_license` (للسواق)
- **المستوى الثالث (اختياري، عمره ما بيتطلب):** `health_certificate` · `experience_certificate` · `work_contract` · `company_policy` · `other`

كل موظف ممكن تتخصّص له قايمة المطلوب (`requiredDocuments`)؛ ولو رجعت للافتراضي بترجع `null`. تنبيه "الأوراق غير مكتملة (N)" في الملف وأيقونة تحذير في الجدول. يدعم **أكتر من ملف** لنفس النوع.

### الإقرارات الموقّعة (`EmployeeAcknowledgment`)
رفع فقط (مفيش توليد/طباعة): خانات ثابتة + خانات مخصّصة باسم يكتبه المستخدم (`key = custom-<id>`):
- **المطلوبة (المستوى الثاني):** `address_confirmation` إقرار صحة عنوان · `employment_terms` عقد عمل · `work_receipt` إقرار استلام عمل · `internal_bylaws` اللائحة الداخلية · `vehicle_receipt` إقرار استلام عربية (للسواق)
- **اختيارية/قديمة:** `custody_receipt` استلام عهدة · `confidentiality` سرية

### التخزين والأمان (قرار أمني مهم)
- الملفات في **`storage/uploads/employees/<id>/…`** (**برّه `public/`**، في `.gitignore`)، مش static.
- الاستعراض عبر `GET /api/employees/:id/documents?docId=…` (وللإقرارات `?key=…`) — بيتحقق من الجلسة **و** `canViewEmployee` قبل أي بايت، والمسار الفعلي بييجي من صف الـDB مش من الطلب.
- المقبول: JPEG / PNG / WebP / PDF، حد أقصى **8 MB**. الرفع/الحذف بيتسجّل في التدقيق.
- **معاينة داخل التطبيق:** صور (تكبير/تدوير/سحب، والتدوير بيتحفظ) وPDF بعارض المتصفح، مع تنزيل و"فتح في تبويب".
- **صور مصغّرة (فرع `ibrahim`):** `?thumb=1` بيرجّع webp 96×96 مخزّن جنب الأصل (`<ملف>.thumb.webp`)، بيتبني أول طلب وبيتمسح مع الأصل.
- ⚠️ **النسخ الاحتياطي:** فولدر `storage/uploads/` فيه بيانات حقيقية (بطاقات، شهادات، إقرارات) غير موجودة في الـDB — لازم يدخل في روتين النسخ الاحتياطي. في Docker اعمل volume لـ`/app/storage/uploads`.
- **تاريخ:** كان التخزين تحت `public/uploads/` وأي مستخدم مسجّل كان يقدر يفتح مستند أي موظف. اتصلّح 2026-09-12 (`PLAN.md` §3-ب).

---

## 9. المساعد الذكي (اختياري)

- مساعد **للأدمن فقط**، وأيقونته عايمة في **كل صفحات النظام**. أي حساب تاني مايظهرلوش ومايقدرش يستخدمه حتى لو كلّم الخادم مباشرة (`canUseAssistant` بتتراجع في كل action وفي كل نداء أدوات). الرد بيتكتب قدام الأدمن لحظة بلحظة (استريم) عبر `POST /api/assistant/stream`، وزر إيقاف بيوقّف السؤال من غير ما يتحفظ. بتقرا كل اللي الأدمن بيشوفه: الطلبات المعلقة (إجازات/أوفر تايم/طلبات تعديل/طلبات سهر)، سجل المراجعة، الحسابات والصلاحيات، الإعدادات والإجازات الرسمية وأجهزة البصمة (أدوات في `admin-tools.ts`). وتقدر تجهّز نماذج (إجازة/أوفر تايم/خصم/طلب سهر) عبر `prepare_form`: بتتفتح الصفحة والنموذج متعبّي ويفضل الأدمن هو اللي يدوس حفظ.
- **كل أدمن له محادثته المنفصلة** (`AssistantMessage` بـ`userId`، والـrate limit والـbusy لكل مستخدم). كل سؤال بيشغّل Claude CLI من الأول، من غير جلسة محفوظة، وبتوكن خاص بالسؤال، فمحادثات الأدمنز عمرها ما بتتخلط.
- المخ: **Claude CLI** بحساب Claude المسجّل على السيرفر، عبر خدمة محلية صغيرة (`assistant-bridge/`، خدمة Windows `AfroEgyptAssistant`) على `127.0.0.1:4100`. من غيرها بيرد "لسه متظبطش" وباقي النظام مش معتمد عليه. مفيش أي اعتماد على مزوّد خارجي أو مفتاح API.
- **قواعده في ملف:** `INSTRUCTIONS.md` (على السيرفر في `tools\assistant\`، بيتقرا مع كل سؤال فتعديله ساري فورًا). بيحدد الأسلوب والمسموح والممنوع، لكن **الحدود الأمنية في الكود** (الصلاحيات، قراءة فقط، أدوات محددة) مش في النص.
- **الأدوات (قراءة فقط):** `search_employees` · `get_employee` · `find_missing_items` · `company_overview` · `attendance_summary` · `leaves_overview` · `overtime_overview` · `deductions_overview` · `payroll_overview` · `departments_and_shifts`. الـCLI بيشتغل من غير أي أدوات ويندوز (لا shell ولا ملفات ولا ويب)، وبيوصل للأدوات عبر MCP (`mcp-afro.mjs`) على `/api/assistant/tool` بتوكن عمره 3 دقايق، متوقّع بمفتاح مشتق من `SESSION_SECRET`.
- **اقتراح إجراء:** بيدّي رابط للصفحة (`[افتح صفحة الخصومات](/deductions)`). بس الروابط الداخلية المعروفة (`links.ts`) هي اللي بتتفتح، والأدمن هو اللي يضغط حفظ.
- **الأسلوب والتأريض:** عامية مصرية مهذبة وقصير افتراضيًا، والإجابات من أرقام الشركة + نتائج الأدوات بس ومايخترعش حاجة. النص جوّه بيانات الموظفين = معلومة مش تعليمات.

---

## 10. الإشعارات والتحديث اللحظي

- **جرس الإشعارات** (`notifications.ts`, `/api/notifications`): بنود تنتظر قرار المستخدم (طلبات إجازة/تعديل معلّقة) تفضل معدودة لحد ما يتصرّف، والباقي معلومات تتعدّ لحد ما تتشاف.
- **تحديث لحظي** (`events.ts`, `/api/events`): SSE — أي تغيير بيبث "حدّث" لكل التابات المفتوحة. **في الذاكرة داخل process واحد**: صح للنشر الأحادي المعتمد؛ لو اتحوّل لعدة instances لازم bus مشترك (Redis).

---

## 11. الأمان

- **جلسة:** كوكي `base64url(json).HMAC-SHA256` بمفتاح `SESSION_SECRET` (**إجباري** — التطبيق يرفض يشتغل من غيره)، `httpOnly`، `secure` في الإنتاج، 8 ساعات. كوكي متلاعب فيه = مرفوض. `SECURE_COOKIES=false` للتشغيل على HTTP خلف بروكسي موثوق.
- **كلمات المرور:** bcrypt. تسجيل الدخول بيتأكد من `active` ويحدّث `lastLoginAt`.
- **فرض:** `requireAccess` لكل صفحة + `Scope` للقراءة + `gate()` للكتابة + `canViewEmployee` للملفات. الأدمن ما يقدرش يقفل على نفسه.
- **التدقيق:** كل تعديل حساس في `AuditLogEntry` داخل نفس الـtransaction.
- **الريبو عام (public)** → ما فيش بيانات حقيقية فيه؛ الـseed وهمي، و`.env` و`storage/uploads/` و`public/uploads/` في `.gitignore`.
- **معلّق/مؤجّل (من `PLAN.md` §3):** rate limiting على الدخول، CSRF/security headers إضافية، سجل دخول المستخدمين (من/متى).

---

## 12. الواجهة والتدويل

- **i18n:** `Dictionary` في `src/lib/i18n/dictionary.ts` هو **مصدر الحقيقة** (النوع)، و`ar.ts` + `en.ts` بينفّذوه — أي مفتاح جديد لازم يدخل في التلاتة. اللغة بكوكي، الاتجاه RTL للعربي.
- **Skeleton loading:** `loading.tsx` لكل route في `(app)` (15 ملف) بمكوّنات في `src/components/skeletons` (header, KPIs, table, cards grid, chart, list, tabs, form, details). كل container عليه `role="status"` + `aria-busy` + نص `sr-only`، والمحتوى الحقيقي بيدخل بـfade (معطّل مع `prefers-reduced-motion`). أزرار التنقّل اليدوي (`date-nav`, اختيار الفترة) بتستخدم `useTransition`.
- **الجداول:** الصف كله قابل للضغط (`ClickableRow`) مع لينك حقيقي للاسم؛ الفلاتر متعددة الاختيار (`MultiSelectFilter`).
- **النماذج:** `useActionState` + `useActionFeedback` + toasts؛ رسائل التحقق بتقول أنهي حقل غلط وبتحتفظ بالقيم المكتوبة.
- **ترتيب القوائم:** المنتهية خدمتهم في آخر قوائم الموظفين والرواتب وتقرير الرواتب والحضور اليومي (`terminatedLast` في `employee-order.ts`)؛ القوائم الزمنية (إجازات/إضافي/خصومات/تقرير الحضور) بترتيب التاريخ عمدًا.

---

## 13. الاختبارات (Vitest — `npm test`)

29 ملف في `tests/`، أبرزهم: `attendance-engine` · `payroll-engine` · `pay-engine` · `absences` · `attendance-dates` · `attendance-open-shift` · `monthly-bonus` · `scope` · `audit` · `employee-files-scope` (مصفوفة الأدوار على الملفات) · `documents` · `acknowledgments` · `employee-order` · `validation` · `device-*` / `zk-device-*` (مرونة الاتصال) · `assistant-*` · `image-view` · `tabs-direction` · `sample-seed`.

- اختبارات التكامل بتشتغل على **MySQL حقيقي** وبتتخطّى نفسها لو مفيش DB أو مفيش بيانات sample (`sample-seed`, `monthly-bonus`).
- الـCI بيشغّل `npm test` قبل أي نشر.

---

## 14. التشغيل والنشر

### تشغيل محلي
```bash
npm install
cp .env.example .env            # عدّل DATABASE_URL و SESSION_SECRET و PUNCH_API_KEY
npx prisma migrate deploy
npm run db:seed:sample          # 50 موظف وهمي + 4 حسابات (كلمة السر demo123)
npm run dev                     # http://localhost:3000
```
على جهاز التطوير MySQL 8.4 portable في `C:\Users\User\afro-mysql` (شغّل `start.bat` لو الـDB مش متاحة).

حسابات الـsample (كلمة السر `demo123`): `admin@404legends.demo` · `hr@afroegypt.demo` · `supervisor@afroegypt.demo` · `ahmed@afroegypt.demo`.

### متغيّرات البيئة
| المتغيّر | وصفه |
|---|---|
| `DATABASE_URL` | اتصال MySQL (**إجباري**) |
| `SESSION_SECRET` | مفتاح توقيع الجلسة (**إجباري**، `openssl rand -base64 32`) |
| `PUNCH_API_KEY` | مفتاح `X-Punch-Key` لـ`/api/punch` |
| `SECURE_COOKIES` | `false` فقط للتشغيل على HTTP خلف بروكسي موثوق |
| `ASSISTANT_BRIDGE_SECRET` | تفعيل المساعد الذكي: سر مشترك بين التطبيق وخدمة المساعد (اختياري) |
| `ASSISTANT_BRIDGE_URL` / `ASSISTANT_TOOL_URL` | عنوان خدمة المساعد، وعنوان نداء الأدوات من الخدمة للتطبيق (اختياري) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | للـseed الإنتاجي مرة واحدة |

### الـseeds
- `npm run db:seed` = **إنتاجي**: 6 أقسام + 3 ورديات + إعدادات + أدمن واحد.
- `npm run db:seed:sample` = عالم وهمي كامل للاستكشاف (**مش للإنتاج**).

### النشر (CI تلقائي)
`.github/workflows/deploy.yml` — **أي push على `main` بينشر على السيرفر الحي** (runner ذاتي الاستضافة على Windows):
`npm ci` → `npm test` → `npm run build` → `prisma migrate deploy` (بيسحب `DATABASE_URL` من ملف أسرار خارج الريبو، ومعاه `scripts/repair-failed-migration.mjs`) → نسخ `.next/static` و`public` في الـstandalone → إيقاف خدمة `AfroEgyptApp` → مزامنة المخرجات للمجلد الحي (بيستثني `.env` و`uploads`) → استعادة `.env` من النسخة الأصلية → تشغيل الخدمة.

> ⚠️ لأن `main` = الإنتاج، **ما بنرفعش على `main` إلا لما المستخدم يقول** (راجع §15).

### بدائل
- **Standalone يدوي:** `next build` ما بينسخش `static` و`public` — لازم تتنسخ (الوصفة في `README.md`)، وبعدين `node .next/standalone/server.js`.
- **Docker:** `Dockerfile` متعدد المراحل (الـmigrations مش بتتشغّل لوحدها؛ اعمل volume لـ`/app/storage/uploads`).
- **Vercel:** المستمع اللحظي للجهاز بيتعطّل (مش بيوصل لشبكة المصنع).

### نسخ احتياطي
1. `mysqldump` دوري للـDB (جدول `AttendanceLog` append-only ومفيش مصدر تاني ليه).
2. فولدر `storage/uploads/` (مستندات الموظفين).

---

## 15. سير العمل والفروع

| الفرع | الغرض | الحالة |
|---|---|---|
| `main` | **الإنتاج** — أي push بينشر | `698b217` |
| `development` | مطابق لـ`main` (اتحدّث 2026-10-11) | `698b217` |
| `ibrahim` | **فرع الشغل الحالي** — الشغل الجديد بيترفع هنا على طول | `520551c` (3 commits قدّام `main`) |
| `hosny` | فرع زميل — ما نرفعش عليه | — |

**القواعد المتفق عليها:**
- الشغل والرفع على **`ibrahim`**. **`main` ما يتلمسش إلا لما المستخدم يقول** صراحةً (مثال: "ارفعها على المين").
- لما المستخدم يقول "ادمجها محليًا" بعد أي فرع/PR: `git checkout <target> && git merge --ff-only <branch> && git push` ثم مسح الفرع — (الـ`gh pr merge` مش متاح).
- رسائل الـcommit بتنتهي بـ`Co-Authored-By: Claude …`، وأوصاف الـPR بـ`🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- بعد كل مرحلة: `tsc` + `lint` + `npm test` + `build`، وجولة متصفح.
- لو GitHub Desktop مفتوح على نفس الفولدر: يفضل على نفس الفرع، وإلا ممكن يرجّع الملفات لشجرة فرع تاني (حصل مرة وصلّحناه).

**آخر شغل على `ibrahim` (لسه مش على `main`):**
1. عمود صورة شخصية مصغّرة قبل اسم الموظف في `/employees`.
2. صور مصغّرة مخزّنة (`?thumb=1`، 96×96 webp) بدل تحميل الأصل (من ~131KB لـ~0.9KB في الاختبار) + `sharp` كاعتماد صريح.
3. الموظف المنتهي خدمته بينزل آخر القوائم.

---

## 16. تاريخ المشروع (المراحل)

| التاريخ | المرحلة | ملخّص |
|---|---|---|
| 09-02 | 1–3 | أساس git، اختبارات (Vitest)، ترقية Next 15 وسدّ ثغرات الأمان |
| 09-02 | 4–5 | Prisma + MySQL، تحويل كل الـactions لقاعدة بيانات حقيقية، `/api/punch`، Excel حقيقي، إصلاح ثغرة منتصف الليل |
| 09-03 | 6 / 6-ب | إزالة وضع الديمو نهائيًا، دخول حقيقي بجلسات موقّعة، إدارة المستخدمين وفرض النطاق |
| 09-03 | ريفاكتور معماري | قنوات التدقيق والصلاحية والنطاق، إصلاح تسرّب في `/workforce-cost` |
| 09-05 | 7 | تجهيز النشر (README، Docker، standalone، دليل الديمو) |
| 09-06 | 8–12 | أجر يومي/شهري · مكافأة مرتبطة بشهرها · ملف الموظف الكامل · المستندات · الإقرارات (ثم أُعيد تصميمها كخانات رفع فقط) |
| 09-06/07 | معاينة + Skeleton | معاينة وتنزيل الملفات داخل التطبيق · skeleton loading لكل صفحة |
| 09-12 | أمني | نقل المستندات برّه `public/` وخدمتها عبر API محمي بنطاق |
| 09-13 | CI | نشر تلقائي على السيرفر الحي بـGitHub Actions (ذاتي الاستضافة) |
| 09-14 → 16 | جهاز البصمة | اتصال بـZKTeco، مزامنة، real-time، ربط/فك ربط، أرقام موظفين تلقائية، إزالة محاكاة البصمة |
| 09-18/19 | الصلاحيات | دور `staff`، صلاحيات granular، طلبات التعديل والموافقات، الإشعارات، صفحة المستخدم |
| 09-20 | HR-F-04 + المساعد | مطابقة مستندات الشركة، مستندات مطلوبة لكل موظف، معاينة بصور قابلة للتكبير، المساعد الذكي |
| 09-21 | اللائحة | الغياب من الجهاز، الإجازات الرسمية، اللائحة الداخلية للحضور والخصومات والرواتب |
| 09-21/22 | محرّك الأجر | أنواع أجر وجداول دوام قابلة للضبط + محرّك قواعد |
| 09-28/29 | تحسينات | حضور يدوي، "له إضافي"، فلاتر حضور الموظف، مستندات حسب النوع/السواق، قوائم إقرارات |
| 10-01 → 04 | إصلاحات | فك ارتباط الجهاز اليتيم، تعطيل المستمع على Vercel |
| 10-10 | حضور | إزالة عمود "ساعات العمل" من جدول الحضور وتقريره |
| 10-11 | `ibrahim` | صورة مصغّرة بجانب الاسم، thumbnails مخزّنة، المنتهي خدمتهم في آخر القوائم |

---

## 17. قرارات اتّخذت (وأسبابها)

| القرار | السبب |
|---|---|
| MySQL بدل SQLite/Postgres | سيرفر الشركة فيه MySQL |
| إزالة وضع الديمو بالكامل (مش flag) | النظام حقيقي |
| `getDb()` snapshot كامل | بساطة وأداء كافي للحجم الحالي؛ ما نعقّدش من غير سبب |
| حقول الملف الشخصي nullable في الـDB والفورم يفرضها | عشان الـmigration على صفوف قديمة يعدّي بأمان |
| بصمة واحدة للموظف اليومي = يوم كامل | طبيعة عمل الشركة |
| الإقرارات رفع فقط (مش توليد/طباعة) | طلب المستخدم |
| المستندات في `storage/` برّه `public/` | أمان بيانات الموظفين |
| الشهر المحاسبي يبدأ 26 | لائحة الشركة |
| `main` = إنتاج ولا رفع عليه إلا بأمر | النشر تلقائي |
| الاستمرار على `employeeNumber` في الـURL والواجهة | الـ`id` الداخلي ما يتعرضش |

---

## 18. المفتوح والمقترح

**أمور تحتاج انتباه:**
- **صور مصغّرة وعمود الصورة** لسه على `ibrahim` — محتاجة قرار الدمج في `main`.
- **`ABSENCE_TRACKING_FROM` ثابت في الكود** (`2026-09-21`) — لو احتجنا نغيّره بيحتاج تعديل كود.
- **`/api/events` (SSE) في الذاكرة** — صح لـinstance واحد فقط.
- **المستمع اللحظي للجهاز** مش بيشتغل على Vercel (متعمّد).
- **حد 8 MB للملف** و**الأنواع المقبولة** ثابتين في `src/lib/documents.ts`.
- **جدول الأدوار في `README.md`** محتاج تحديث (HR/اداري بصلاحيات).
- نسخة postcss 8.4.31 المدمجة جوّا Next 15 (وقت البناء فقط) هتتحل بالترقية لـNext 16.

**أفكار لسه ما اتنفّذتش (من `PLAN.md` §3 وغيره):**
1. رفع لوجو الشركة فعليًا من الإعدادات (دلوقتي `logoUrl` نص).
2. rate limiting على تسجيل الدخول + security headers إضافية.
3. سجل دخول المستخدمين (من دخل ومتى).
4. نسخ احتياطي تلقائي (سكربت) للـDB و`storage/uploads`.
5. استيراد موظفين من CSV (قرار البدء بـ`db:seed:sample` ولا `db:seed` + إدخال حقيقي).
6. KPI "الأوراق الناقصة" على الداشبورد (كان اختياري في الخطة).
7. عمود "هل احتُسب؟" للأجر اليومي في التقارير (اتغطّى بكشف المرتب).
8. ديالوج تفاصيل الإدخال لسه فيه سطر "ساعات العمل" بعد إزالته من الجدول والتقرير — لو عايزه يتشال.
9. bus مشترك (Redis) للتحديث اللحظي لو اتحوّل النشر لعدة instances.

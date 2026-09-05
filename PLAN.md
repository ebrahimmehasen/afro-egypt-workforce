# خطة تحويل Afro Egypt — Factory Workforce من ديمو إلى نظام حقيقي

> وثيقة حيّة — بنحدّثها مع كل مرحلة. آخر تحديث: 2026-09-02

---

## 0. نتيجة الفحص (الوضع الحالي)

| البند | الحالة | ملاحظة |
|---|---|---|
| `npm install` + `npm run build` | ✅ ينجح | 20 route، بدون أخطاء TypeScript |
| بنية الكود | ✅ نظيفة | محرّكات نقية (`attendance-engine`, `payroll-engine`) منفصلة عن الـ UI — سهلة الربط بقاعدة بيانات |
| طبقة البيانات | ⚠️ in-memory | `src/lib/store.ts` — كل شيء في الذاكرة، يُفقد عند إعادة تشغيل السيرفر |
| المصادقة | ⚠️ ديمو | 4 مستخدمين ثابتين في `src/lib/auth.ts`، كلمة مرور نصّية، كوكي JSON غير موقّع |
| الثغرات الأمنية | ⚠️ 5 high | كلها داخل `next@14.2.35` / `postcss` / `glob` (أدوات البناء) — الحل: ترقية Next 15 |
| git | ❌ غير مهيّأ | المشروع نُزّل كـ zip — لا يوجد repo ولا تاريخ |
| الاختبارات | ❌ لا يوجد | صفر tests رغم أن المنطق قابل للاختبار |

### ثغرات صغيرة اكتُشفت أثناء الفحص (نصلحها في مرحلة الباك اند)
1. **بناء التوقيت من نص** — `simulatePunch` و`recalculateDailyAttendance` يستخدمان `${date}T${time}` و`timestamp.startsWith(date)`. صح للوردية الصباحية، لكن الوردية المسائية/الليلية اللي تعبر منتصف الليل ممكن تحسب البصمة على يوم غلط. (الـ seed نفسه بيتجنّب ده — الكود التفاعلي لأ).
2. **توليد المعرّفات** — `LOG-${length+1}` / `DA-${length+1}` — يكفي للديمو، لكن قاعدة البيانات هتدّي معرّفات حقيقية (cuid/uuid).
3. **لا فرض صلاحيات على مستوى الحقول** — `supervisor` مفروض يشوف قسمه فقط؛ حاليًا الـ middleware بيحمي المسارات بس مش الـ scoping داخل الصفحة.

---

## 1. القرارات المتفق عليها

| القرار | الاختيار |
|---|---|
| مستودع GitHub | repo **عام (public)** جديد باسم `afro-egypt-workforce` تحت حساب `ebrahimmehasen` |
| قاعدة البيانات | **SQLite + Prisma** (الأخف نشرًا، ملف واحد، ترقية لـ Postgres لاحقًا بتغيير سطر واحد في `schema.prisma`) |
| ترقية Next.js | **Next 15** |
| المصادقة | جدول `User` + كلمات مرور **bcrypt** + جلسات كوكي موقّعة |

> ملاحظة: الريبو هيبقى عام حسب طلبك. الـ seed كله بيانات وهمية — لا يوجد بيانات عملاء حقيقية. تقدر تحوّله private أي وقت من إعدادات GitHub.

---

## 2. المراحل

### المرحلة 1 — تأمين نقطة البداية ✅ (اكتملت)
- [x] `git init` + `.gitignore` (موجود)
- [x] أول commit: `chore: baseline working MVP (in-memory demo)` (`be2890f`)
- [x] إنشاء repo عام `afro-egypt-workforce` وربطه + push → https://github.com/ebrahimmehasen/afro-egypt-workforce
- [ ] الشغل من هنا على فروع `feat/*` + PR لكل مرحلة

### المرحلة 2 — اختبار شامل قبل أي تعديل ✅ (اكتملت — فرع `feat/tests-baseline`)
هدف: نثبّت "خط الأساس شغّال" مكتوبًا قبل ما نغيّر أي حاجة.
- [x] إضافة Vitest (`npm test`) — 20 اختبار أخضر
- [x] اختبارات وحدة لـ `attendance-engine` (تأخير، سماح، انصراف مبكر، بصمة ناقصة، إضافي، وردية ليلية عبر منتصف الليل، إجازة معتمدة، تصحيح HR)
- [x] اختبارات وحدة لـ `payroll-engine` (المثال الرسمي §30: صافي 11,900 ✓ + صيغة الصافي الديناميكية + تقريب الإضافي)
- [x] اختبار تكامل لسيناريو §55 على `seed` + `attendance-service` + `payroll-engine` مباشرة (بدون طبقة HTTP)
- [x] فحص يدوي في المتصفح: build + login + dashboard + attendance + modal البصمة ✓
- [x] توثيق الثغرات الصغيرة (انظر أعلاه) — ثغرة التوقيت عبر منتصف الليل مؤكّدة، تُصلَح في المرحلة 5 مع الـ DB

### المرحلة 3 — ترقية Next 15 + حل الثغرات ✅ (اكتملت — فرع `feat/next-15-security`)
- [x] ترقية `next` 14.2.35 → **15.5.25** + `eslint-config-next` 15 + `postcss` 8.5.26 + `vitest` 3
- [x] **الثغرات الـ5 الأصلية (Next.js) اتحلّت بالكامل** — `npm audit` نضيف من ثغرات Next
- [x] معالجة تغييرات الكسر:
      - `cookies()` بقت async → `getSession` / `getLocale` / `getT` / `setSessionCookie` / `setLocaleCookie` كلها async + كل نقاط الاستدعاء (~40 ملف) بقت `await`
      - `params` / `searchParams` في الصفحات بقت `Promise` → `await` (6 صفحات)
      - `useFormState` (react-dom) → `useActionState` (react) في 11 ملف
      - مكوّنات الصفحات + الـ layouts بقت `async`
- [x] `npm test` = 20/20 أخضر · `npm run lint` نضيف · `npm run build` نضيف
- [x] جولة متصفح: login → dashboard → تبديل اللغة (ar/en) → reports → **حساب رواتب كامل لـ50 موظف** (صافي 564,607 ج.م) — بدون أخطاء console
- [ ] **متبقّي (بسيط، مؤجّل):** نسخة postcss 8.4.31 مدمجة **جوّا** حزمة Next 15 نفسها (استخدام وقت البناء فقط، مخاطر عملية شبه معدومة) — تتحل بالكامل لما ننتقل لـ Next 16 لاحقًا

### المرحلة 4 — قاعدة البيانات (Prisma + **MySQL**) ✅ (اكتملت — فرع `feat/db-prisma`)
> القرار اتغيّر: **MySQL** بدل SQLite (طلب المستخدم — سيرفره فيه MySQL). الـ migration اتأجّل لحد ما يبقى فيه MySQL شغّال.
- [x] `schema.prisma` (provider = mysql) — كل الكيانات + الـ enums الأصلية + إضافات:
      - **حذف ناعم:** `deletedAt` على `Employee` / `Department` / `Shift`
      - **بصمات ZKTeco:** موديل `Device` + `AttendanceLog` فيه `deviceUserId` / `rawPayload` / `receivedAt` + قيمة `biometric` في `PunchSource`
      - **موديل `User`** كامل (للمرحلة 6): email, passwordHash, role, employeeId?, departmentId?, active, lastLoginAt
      - `DailyAttendance` عليه `@@unique([employeeId, date])` — يدعم الترحيل اليومي التلقائي (upsert)
      - `PayrollPeriod` عليه `@@unique([year, month])` — يدعم "فتح شهر جديد"
      - الفلوس كلها `Int` (جنيه صحيح) — مطابق للمحرّكات النقية
- [x] `AttendanceLog` = append-only (مفيش `updatedAt`، تعليق صريح في السكيمة)
- [x] Prisma Client singleton (`src/lib/prisma.ts`)
- [x] `prisma/seed.ts` — نفس بيانات الـ demo بالظبط (6 أقسام، 3 ورديات، 50 موظف، 13 يوم تاريخ، سيناريوهات 21 أغسطس، فترة أغسطس 2026) + الـ4 حسابات التجريبية بكلمات مرور **bcrypt** + جهاز `ZK-DEMO-01`. idempotent (بيمسح ويعيد)
- [x] `.env.example` + سكربتات `db:migrate` / `db:seed` / `db:deploy` / `db:studio` (اتشال `docker-compose.yml` بطلب المستخدم — MySQL بيتنصّب مباشرة على الجهاز/السيرفر)
- [x] المحرّكات النقية **ما اتلمستش**
- [x] `tsc` + `npm test` + `npm run build` + `npm run lint` — كلها نضيفة
- [x] **MySQL 8.4 اتنصب محليًا** (portable zip) · `prisma migrate dev --name init` ✅ (`prisma/migrations/20260902195742_init/`) · `npm run db:seed` ✅ (50 موظف، 599 حضور يومي، 1088 بصمة، 4 مستخدمين)

### المرحلة 5 — الباك اند (تحويل الـ server actions) ✅ (اكتملت — فرع `feat/prisma-backend`)
- [x] **الكتابة:** كل الـ13 ملف actions بقت Prisma حقيقي (create/update/upsert/delete) — `getDb()`/`db.X.push` اختفت
- [x] **القراءة:** `getDb()` بقت async — بتحمّل snapshot كامل من الـ DB بشكل `Store` (mappers في `serialize.ts` بترجّع التواريخ كـ ISO strings). الصفحات والـ selectors محتفظة بمنطقها زي ما هو، بس `await getDb()`. (تفاصيل في memory: [[getdb-snapshot-hydrator]])
- [x] `selectors.ts` + `attendance-service.ts` → async Prisma
- [x] `addAuditLog` → جدول `AuditLogEntry` حقيقي · `calculatePayroll` كله جوّا `prisma.$transaction`
- [x] **إصلاح ثغرة منتصف الليل:** `recalculateDailyAttendance` بيجمع البصمات بنافذة الوردية الفعلية (±6 ساعات) مش بمطابقة نص التاريخ
- [x] **فتح فترة رواتب جديدة:** `openPayrollPeriod` action (شهر/سنة → `PayrollPeriod` draft، `@@unique([year,month])` يمنع التكرار) + `PayrollPeriodBar` (قائمة اختيار الفترة عبر `?period=` + ديالوج فتح شهر) فوق صفحة الرواتب
- [x] **الحذف الناعم:** `deleteEmployee` / `deleteDepartment` / `updateShift` تفلتر وتضبط `deletedAt`؛ `getDb()` بيستبعد المحذوف
- [x] **`POST /api/punch`:** `src/app/api/punch/route.ts` — header `X-Punch-Key`، zod validation، مطابقة `deviceUserId`→موظف، استنتاج in/out، كتابة `AttendanceLog` (source=biometric + rawPayload) + إعادة حساب `DailyAttendance`
- [x] **تصدير xlsx حقيقي:** `exportExcel` بقت SheetJS (`xlsx`) → ملف `.xlsx` صحيح بأعمدة مضبوطة
- [x] `tsc` + `npm run lint` + `npm run build` (0 أخطاء prisma بعد `force-dynamic`) — كلها نضيفة
- [x] **اختبار فعلي على MySQL:** كل الاختبارات 18/18 (بما فيها الـ integration ضد DB حقيقي) · فحص متصفح: login → dashboard → **حساب رواتب 50 موظف (563,532 ج.م) عبر `$transaction`** → فتح فترة سبتمبر → تبديل الفترة → **حذف ناعم مؤكّد في الـ DB** (الصف باقٍ، `deletedAt` متسجّل، مستبعد من الـ UI) → سجل التدقيق بيكتب فعليًا
- [x] **`/api/punch` مختبر بـ curl:** بصمة دخول → `missing_punch` · مفتاح غلط → 401 · بصمة خروج → `late` (استنتاج in/out شغّال)

### المرحلة 6 — المصادقة الحقيقية + إزالة وضع الديمو نهائيًا ✅ (اكتملت — فرع `feat/remove-demo-real-auth`)
> المستخدم قرر: النظام حقيقي مش ديمو → **وضع الديمو اتشال بالكامل** (مش flag).
- [x] **إزالة الديمو:** اتحذف `/demo` + `demo-runner` + `actions/demo.ts` + `demo-mode.ts` + كل البادجات + بيانات الدخول على اللوجين + `DEMO_DATE`/`DEMO_EMPLOYEE_ID`/`DEMO_PERIOD_ID` + قسم `demo` في القواميس
- [x] **`src/lib/today.ts`** — `today()` / `currentYearMonth()` بالساعة الحقيقية فقط
- [x] **تسجيل دخول حقيقي:** `loginAction` بيدوّر على `User` بالإيميل → يتأكد `active` → `bcrypt.compare` → يحدّث `lastLoginAt` → جلسة. مفيش `DEMO_USERS` ولا كلمات مرور نصّية
- [x] **كوكي جلسة موقّع:** `src/lib/session.ts` — `base64url(json).HMAC-SHA256` بمفتاح `SESSION_SECRET` (مطلوب، التطبيق بيرفض يشتغل من غيره). كوكي متلاعب فيه → مرفوض. `httpOnly` + `secure` في الإنتاج + 8 ساعات
- [x] `requireSession()` helper — الصفحات المحمية تعمل redirect لـ `/login` لو مفيش جلسة
- [x] middleware بيقرا الدور من الكوكي (توجيه UX فقط؛ الفرض الحقيقي في الـ layout)
- [x] **الـ seeds:** `npm run db:seed` = **الإنتاجي** (هيكل + admin واحد) · `npm run db:seed:sample` = 50 موظف وهمي + تاريخ منتهي **النهارده الحقيقي** + 4 حسابات (كلمة مرور `demo123`) — للاستكشاف فقط
- [x] `tsc` + `lint` + `build` + 18/18 test — نضيفة · تحقّق: session signing + bcrypt ضد الـ DB الحقيقي · تشغيل إنتاجي (`npm start`) + دخول فعلي في المتصفح
- [x] إصلاح: `SECURE_COOKIES=false` للتشغيل الإنتاجي خلف HTTP/بروكسي

### المرحلة 6-ب — إدارة المستخدمين + فرض النطاق ✅ (اكتملت — فرع `feat/user-mgmt-scoping`)
- [x] **`src/lib/scope.ts`** — `visibleEmployeeIds` / `scopeEmployees` / `scopeByEmployee` / `canSeeEmployee`. admin+hr = الكل · المشرف = قسمه فقط · الموظف = نفسه فقط
- [x] فرض النطاق موحّد في: `/employees` · `/employees/[id]` (→404 لو برّا النطاق) · `/attendance` · `/leaves` · `/overtime` · `/reports` (الـ4 تبويبات) · **الداشبورد** (KPIs + الرسوم للمشرف مقصورة على قسمه عبر `scope` اختياري في الـ selectors)
- [x] **صفحة `/users`** (admin فقط، بادج درع في القائمة) — جدول: الاسم/الإيميل/الدور/النطاق/الحالة/آخر دخول · إضافة مستخدم · تعديل (دور، تفعيل/تعطيل، ربط بموظف/قسم) · إعادة تعيين كلمة المرور
- [x] `actions/users.ts` — `createUser` / `updateUser` / `resetUserPassword` (bcrypt، حارس `canManageUsers`، منع الأدمن يقفل على نفسه، تسجيل تدقيق) + `canManageUsers` في permissions + `/users` في nav الأدمن
- [x] `tsc` + `lint` + `build` + 18/18 test نضيفة · تحقّق بسكربت: admin→الكل، مشرف DEP-1→20/50، موظف→نفسه، منع رؤية قسم آخر · create/update/delete مستخدم بـ bcrypt · تحقّق بالمتصفح: صفحة `/users` بالإنتاج + ديالوج الإضافة
- [ ] **قرار للمستخدم:** يبدأ بالـ 50 موظف (`db:seed:sample`) ويعدّلهم، ولا `db:seed` ويدخّل موظفينه (استيراد CSV؟)

### مرحلة الريفاكتور المعماري ✅ (اكتملت — فرع `refactor/architecture-pass`)
> جولة تعميق قبل النشر — بناءً على تقرير `improve-codebase-architecture`. المحرّكات النقية ما اتلمستش.
- [x] **قناة التدقيق (candidate 3):** `src/lib/audit.ts` — `recordChange(entry, write)` بيكتب التغيير وصفّ التدقيق في `prisma.$transaction` واحدة (يهبطوا سوا أو يترجعوا سوا)؛ `recordChangeAs` النواة بدون جلسة؛ `writeAudit(tx,…)` جوّا transaction قايمة (calculatePayroll). كل الـ~20 action اتحوّلوا. `addAuditLog` اتشال من `store.ts`. اختبار: `tests/audit.test.ts`
- [x] **موديول إعادة حساب الحضور (candidate 4):** `attendance-service` و`actions/attendance` بيستخدموا `toShift` الموجود بدل بناء الكائن يدوي؛ `recalculateRange(employeeId, from, to)` مشترك (كان loop داخلي في `decideLeave`)
- [x] **قناة صلاحية الصفحات (candidate 5):** `requireAccess(path)` في `auth.ts` — تتحقق من الجلسة الموقّعة **و** `canAccess(role, path)`. كل صفحات `(app)` المحمية بتستخدمها. `/audit-log` و`/workforce-cost` كانوا بلا حارس صفحة نهائيًا
- [x] **قراءة مقصورة موحّدة (candidates 1 + 2):** `scope.ts` أعيد تصميمه — `Scope` واحد + `viewerScope` / `inScope` / `employeesInScope` / `rowsInScope` / `scopedSnapshot`. الـ selectors بتاخد `Scope` **أول باراميتر إجباري**. `getDb()` اتشال منه جدولا `attendanceLogs` و`auditLog` (append-only غير محدودين) → `getAttendanceLogsForDate` / `getAuditLog(200)` بقيود DB. **إصلاح تسرّب:** `/workforce-cost` كان بيحسب تكلفة الشركة كاملة بلا scope. اختبار: `tests/scope.test.ts`
- [x] `tsc` + `lint` + **24/24 test** + `build` نضيفة · تحقّق شامل بالمتصفح (كل الصفحات المتغيّرة، بدون أخطاء console) · تحقّق بجلسة مشرف موقّعة: `/workforce-cost` + `/audit-log` → 307 لـ `/dashboard`؛ `/employees` = 20 (DEP-1) مقابل 50 للأدمن

### المرحلة 7 — تثبيت وتجهيز النشر
- [x] `.env.example` (DATABASE_URL, SESSION_SECRET, PUNCH_API_KEY)
- [x] `prisma migrate deploy` جاهز (ملف الـ migration متعمل commit)
- [x] `npm run build` + `npm start` نظيف على MySQL — تحقّق كمان `POST /api/punch` شغّال (401 بلا مفتاح، 200 بمفتاح صحيح)
- [x] إصلاح تحذير Next عن workspace root (`outputFileTracingRoot` في `next.config.mjs`)
- [x] `README` محدّث بالكامل: التقنيات الحالية (Next 15 + Prisma/MySQL)، التشغيل محلي، خطوات النشر، النسخ الاحتياطي، جدول الأدوار والصلاحيات
- [x] دليل ديمو (`docs/DEMO-GUIDE.md`) — سيناريو §55 كامل خطوة بخطوة بالعربي (تسجيل دخول → بصمة → إضافي → خصم → رواتب → تكلفة عمالة → تصدير → تدقيق) + سيناريوهات إضافية (بصمة ناقصة، تصحيح يدوي، إجازة، الأدوار المختلفة)
- [x] `Dockerfile` + `output: "standalone"` — تحقّق بتشغيل السيرفر standalone فعليًا (`node .next/standalone/server.js`) بنفس تخطيط الملفات اللي الـDockerfile بينسخه؛ الـ`docker build` نفسه ما اتجربش (مفيش Docker على جهاز التطوير)

---

## 3. حاجات محتملة نضيفها — **للنقاش سوا قبل التنفيذ**

هذه ليست في المواصفة الأصلية لكنها منطقية لنظام حقيقي:

1. **رفع اللوجو فعليًا من الإعدادات** — حاليًا `logoUrl` نص ثابت. نضيف رفع ملف؟
2. **حذف/تعطيل بدل الحذف النهائي** — الموظف المحذوف حاليًا يختفي. الأفضل `terminated` + إخفاء. (المواصفة §52 تقول لا تعقيد زائد — قرارك).
3. **ترحيل الحضور اليومي التلقائي** — job يحسب `DailyAttendance` لكل يوم/موظف تلقائيًا بدل ما يتولّد وقت الـ seed فقط. مهم للاستخدام الحقيقي المستمر.
4. **استيراد بصمات حقيقية من ZKTeco** — المواصفة قالت "هيّئ الكود لها لاحقًا". نعمل endpoint `POST /api/punch` جاهز يستقبل من الجهاز؟
5. **تصدير Excel حقيقي** — حاليًا `exportExcel` بيصدّر HTML باسم `.xls` (يفتح لكن Excel يحذّر). نستخدم مكتبة `xlsx` لملف حقيقي؟
6. **نسخ احتياطي** — سكربت backup تلقائي لملف SQLite.
7. **تعدّد الفترات** — حاليًا فترة رواتب واحدة مزروعة. نضيف "إنشاء فترة شهر جديد" تلقائيًا؟
8. **سجل دخول المستخدمين** (من دخل ومتى) — مفيد للمحاسبية.
9. **تحصين إضافي** — rate limiting على تسجيل الدخول، CSRF، security headers.

---

## 4. مبادئ نلتزم بيها

- **لا نلمس المحرّكات النقية** (`attendance-engine.ts`, `payroll-engine.ts`) إلا لإصلاح bug مؤكّد بـ test.
- كل مرحلة = فرع + PR + كل الاختبارات خضراء قبل الدمج.
- بعد كل مرحلة: جولة متصفح كاملة لسيناريو §55.
- البيانات التجريبية تفضل شغّالة (نفس الحسابات، نفس تاريخ 21 أغسطس 2026) للعرض على الإدارة.
- الحفاظ على `AttendanceLog` غير قابل للتعديل — قاعدة العمل الحرجة §46.

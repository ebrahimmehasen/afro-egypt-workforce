# خطة: نظام الرواتب (يومي/شهري) + المكافآت + ملف الموظف الكامل والمستندات

> وثيقة تكميلية لـ `PLAN.md` — بتغطي 3 مطالب جديدة: (أ) تمييز الراتب يومي/شهري في الحساب والتقارير، (ب) مكافأة تُصرف مرة واحدة وتظهر في إقرار شهرها فقط، (ج) بيانات الموظف الشخصية الكاملة + رفع المستندات مع تنبيه اكتمال الأوراق.
> آخر تحديث: 2026-09-06

---

## ✅ الحالة: مكتملة بالكامل (2026-09-06)

اتنفّذت في 5 مراحل، كل واحدة فرع + PR مدموج في `main`:

| المرحلة | القسم | PR | الحالة |
|---|---|---|---|
| 8 — الأجر اليومي/الشهري | §1 | #8 | ✅ مدموج |
| 9 — المكافأة المرتبطة بشهرها | §2 | #9 | ✅ مدموج |
| 10 — بيانات الموظف الكاملة | §3.1، §3.3 (الحقول) | #10 | ✅ مدموج |
| 11 — مستندات الموظف + تنبيه الاكتمال | §3.2، §3.5 (المستندات)، §3.3 (التنبيه) | #11 | ✅ مدموج |
| 12 — الإقرارات الموقّعة | §3.4، §3.5 (الإقرارات) | #12 | ✅ مدموج |

**فروقات عن الخطة الأصلية (كلها متعمّدة):**
- **§1.3** — عرض اليومي/الشهري اتعمل في **جدول الرواتب** (`يومي (N أيام)`) و**كشف المرتب** (`الراتب الأساسي (N أيام × السعر)` + سطر خصم الغياب اختفى لليومي). عمود "هل احتُسب؟" المنفصل في `attendance-report`/`payroll-report` **ما اتعملش** — الشفافية اتغطّت من خلال الكشف والجدول.
- **§3.1** — كل الحقول الجديدة (`phone`, `address`, `qualification`, `militaryStatus`, `nationalId`) **`nullable` في الـ DB** عشان migration الـ50 صف الموجودين يعدّي بأمان، والـ **فورم يفرضها إجبارية** لكل موظف جديد/معدّل — نفس الاستراتيجية اللي الخطة اقترحتها للهاتف، مطبّقة على الكل.
- **§3.3** — `getMissingDocuments` اتعملت في `src/lib/documents.ts` (نقية: `missingDocumentTypes` / `documentsComplete`) مش `selectors.ts` (الـ selectors دلوقتي بتاخد `Scope` كأول باراميتر إجباري بعد ريفاكتور معماري). KPI الداشبورد (اختياري) **ما اتعملش**.
- **§3.5** — أُضيف كمان: `DELETE` endpoints + سيرفر أكشن حذف · تعديل `middleware` (`/uploads` + `/acknowledgment` في `ALWAYS_ALLOWED` — يُخدَموا لأي مستخدم مسجّل، redirect للمجهول) · `getDb()` snapshot بقى يحمّل `employeeDocuments` + `employeeAcknowledgments`.
- **migration** — اتقسمت 5 migrations (واحد لكل مرحلة) مش migration واحد كبير.

**التحقق:** `tsc` + `lint` + `npm run build` نضيفة في كل مرحلة · **34 اختبار** (بينهم 3 للأجر اليومي، 3 للمكافأة الشهرية، 4 للمستندات) · فحص فعلي على MySQL + endpoints بـ curl (رفع/حذف مستندات، طباعة الإقرار، رفع الموقّع، رفض mime غلط، 401 بلا جلسة).

---

## 0. الوضع الحالي (بعد الفحص)

- `Employee.basicSalary` رقم واحد بيتفسّر دايمًا على إنه **راتب شهري**. `payroll-engine.ts` بيحسب `dailyRate = basicSalary / workingDaysPerMonth` بس عشان يخصم أيام الغياب من راتب شهري — مفيش أي مفهوم لموظف **يومي الأجر** بيتحسبله يوم يوم على حسب حضوره.
- `Allowance` (اللي بيتسجل منه نوع `bonus`) **مالوش أي ربط بشهر/فترة** — `calculatePayroll` بيجيب كل صفوف الموظف من غير فلترة تاريخ، يعني أي مكافأة بتتسجل مرة هتتحسب **كل شهر جاي كمان** لحد ما حد يمسحها يدويًا. ده لازم يتصلّح قبل ما نضيف زرار "مكافأة".
- `Employee` فيه بس: `name, phone?, avatarColor?`. **مفيش** عنوان، مؤهل، موقف تجنيد، ولا أي جدول لملفات/مستندات.
- مفيش حاليًا أي آلية رفع ملفات في المشروع كله (حتى `CompanySettings.logoUrl` نص ثابت مش رفع حقيقي — نفس الملاحظة رقم 1 في `PLAN.md` §3).

---

## 1. نظام الرواتب: يومي مقابل شهري ✅ (المرحلة 8 — PR #8)

### 1.1 التعديل على `prisma/schema.prisma`

```prisma
enum SalaryType {
  monthly
  daily
}

model Employee {
  // ...الحقول الحالية...
  salaryType        SalaryType @default(monthly)
  basicSalary       Int        // شهري: الراتب الكامل. يومي: يُستخدم كقيمة احتياطية فقط — الاعتماد على dailyRate
  dailyRate         Int?       // إجباري لو salaryType = daily — أجر اليوم الواحد
  dailyWorkingHours Float      @default(8) // ساعات يوم العمل بتاعت الموظف — تُستخدم لحساب سعر الساعة (إضافي/خصومات جزئية)
}
```

- ليه `dailyRate` منفصل عن `basicSalary` بدل ما نستخدم عمود واحد؟ عشان لو موظف اتحول من يومي لشهري (أو العكس) يفضل تاريخه القديم واضح، ولإن الاستعلامات (تقارير، فرز) هتفرق بسهولة.
- `dailyWorkingHours` بديل لاعتماد ساعات العمل من الوردية بس — الموظف ممكن يكون على وردية عامة لكن تعاقده الفردي على عدد ساعات مختلف (دوام جزئي مثلاً).

### 1.2 التعديل على `src/lib/payroll-engine.ts`

المنطق الحالي (سطر ~30-33) بيحسب `dailyRate = basicSalary / workingDaysPerMonth` ثم يخصم أيام الغياب من إجمالي شهري. هنفرّعه:

- **شهري (الحالي زي ما هو):** `grossSalary = basicSalary + allowances + overtime + incentives + bonuses` ثم خصومات (تأخير/غياب/انصراف مبكر/جزاءات/سلف) زي ما هي دلوقتي.
- **يومي (جديد):** الأساس مش "شهر كامل ناقص غياب" — الأساس هو **مجموع الأيام اللي فعلاً اشتغلها**:
  ```
  paidDays = عدد أيام DailyAttendance في الشهر بحالة (present | late | early_leave | missing_punch)
  baseFromDays = paidDays × dailyRate
  grossSalary = baseFromDays + allowances + overtime + incentives + bonuses
  ```
  خصم التأخير/الانصراف المبكر لسه بينطبق (بيتخصم من نفس اليوم المدفوع)، لكن **مفيش "خصم غياب"** لأن يوم الغياب أصلاً مش متحسوب في `paidDays` من الأول (فرق مهم عن الشهري اللي بيدفع الراتب كامل وبعدين يخصم).
  > **قرار محسوم:** الموظف اليومي بياخد بصمة واحدة بس (مش لازم دخول وخروج). يعني حالة `missing_punch` بالنسبالها **يوم مدفوع كامل** — مش معلّق ومش نص يوم. الفرق عن الموظف الشهري: عند الشهري لسه `missing_punch` معناها "يحتاج مراجعة HR" وميتحسبش تلقائي، لكن عند اليومي هي المعيار الطبيعي (بصمة دخول واحدة = يوم شغل).
- نضيف حقلين جديدين في `PayrollRecord` للشفافية في كشف الراتب:
  ```prisma
  model PayrollRecord {
    // ...
    paidDaysCount   Int?  // يُملأ فقط لو الموظف يومي
    dailyRateApplied Int? // قيمة يوم العمل وقت الاحتساب (توثيق تاريخي لو الأجر اليومي اتغيّر بعدين)
  }
  ```

### 1.3 التقارير — "نشط = يتحسبله يوم / مش نشط = معطّل"

مفيش داعي لعمود جديد في `DailyAttendance` — الحالة (`status`) موجودة بالفعل (`present/late/absent/leave/mission/excused_absence/early_leave/missing_punch`). الشغل هنا في **طبقة العرض فقط**:

- في `components/reports/attendance-report.tsx` و`payroll-report.tsx`: لما `employee.salaryType === "daily"`، عمود الحالة يعرض تسمية مختلفة للأيام اللي معندهاش حضور: بدل "غائب" تظهر **"معطّل / لا يُحتسب"**، ولازم عمود "هل احتُسب له يوم؟" (✓ / ✗) بجانب كل صف.
- يوم فيه بصمة واحدة بس (`missing_punch`) للموظف اليومي يظهر في التقرير كيوم **محتسب** عادي (✓)، مش "معطّل" — حسب القرار في §1.2.

---

## 2. المكافأة (تُصرف مرة واحدة، تظهر في إقرار شهرها بس) ✅ (المرحلة 9 — PR #9)

المشكلة الحالية: `Allowance.type = "bonus"` بيتحسب كل شهر لحد الأبد لأنه مالوش تاريخ. الحل:

### 2.1 تعديل `prisma/schema.prisma` — موديل `Allowance`

```prisma
model Allowance {
  id             String        @id @default(cuid())
  employeeId     String
  employee       Employee      @relation(fields: [employeeId], references: [id])
  type           AllowanceType
  amount         Int
  monthly        Boolean       @default(true) // بدل/حافز/انتقال/وجبة: متكرر شهريًا
  effectiveYear  Int?          // إجباري لو monthly = false (يعني نوع "مكافأة" بالذات)
  effectiveMonth Int?          // 1-12
  notes          String?       @db.Text
  createdAt      DateTime      @default(now())

  @@index([employeeId])
  @@index([effectiveYear, effectiveMonth])
}
```

- قاعدة عمل: لما المستخدم يختار نوع `bonus` في نموذج الإضافة (`allowance-form-dialog.tsx`)، الفورم يفرض `monthly = false` تلقائيًا ويطلب الشهر/السنة (افتراضيًا = الفترة المفتوحة حاليًا في `/payroll`).
- باقي الأنواع (`transport/meal/fixed/incentive`) تفضل زي ما هي `monthly = true` بدون تاريخ (بدلات ثابتة مستمرة) — إلا لو حبيت تسمح بحافز شهر واحد بس بنفس الآلية (مفيدة، اختياري).

### 2.2 تعديل `src/lib/actions/payroll.ts` (سطر ~90 تقريبًا، فلترة `empAllowances`)

الاستعلام الحالي بيجيب كل صفوف `Allowance` للموظف من غير أي فلتر تاريخ. لازم يبقى:

```ts
const empAllowances = await tx.allowance.findMany({
  where: {
    employeeId: employee.id,
    OR: [
      { monthly: true },
      { monthly: false, effectiveYear: period.year, effectiveMonth: period.month },
    ],
  },
});
```

بكده المكافأة تظهر في إقرار شهرها بالظبط وتختفي تلقائيًا الشهر اللي بعده — بدون حذف يدوي، والسجل التاريخي فاضل موجود في القاعدة (يظهر في تقرير شهره القديم لو رجعت تفتحه).

---

## 3. بيانات الموظف الكاملة + المستندات ✅ (المراحل 10–12 — PRs #10 #11 #12)

### 3.1 حقول نصية إجبارية جديدة على `Employee` ✅ (المرحلة 10)

```prisma
enum MilitaryStatus {
  completed       // أدى الخدمة
  exempted        // إعفاء
  postponed       // مؤجل
  not_applicable  // لا ينطبق
}

model Employee {
  // ...
  phone           String          // كانت اختيارية (String?) — تبقى إجبارية
  address         String          // العنوان
  qualification   String          // المؤهل الدراسي
  militaryStatus  MilitaryStatus  // الموقف من التجنيد
  nationalId      String   @unique // الرقم القومي — حقل نصي إجباري، بجانب صورة البطاقة (national_id_photo) في EmployeeDocument
}
```

> ملاحظة migration: `phone` حاليًا `String?` وفيه بيانات قديمة (seed) ممكن تكون فاضية. لازم قبل ما نخلّيه إجباري: إما نعمل backfill بقيمة placeholder، أو نسيبه اختياري فترة انتقالية والفورم بس هو اللي يفرض الإجبارية على القيود الجديدة.

### 3.2 موديل جديد: `EmployeeDocument` (لكل الملفات المرفوعة) ✅ (المرحلة 11)

بدل ما نضيف عمود لكل نوع ملف في `Employee` (7 أعمدة + توسّع صعب لاحقًا)، جدول واحد قابل للتوسعة:

```prisma
enum EmployeeDocumentType {
  national_id_photo            // صورة البطاقة
  birth_certificate            // شهادة الميلاد
  qualification_certificate    // شهادة المؤهل
  criminal_record              // صورة الفيش والتشبيه
  military_certificate         // شهادة الموقف من التجنيد
  work_experience_certificate  // كعب عمل
  cv                           // السيرة الذاتية
}
```
> الإقرارات الموقّعة **مش** من ضمن الـ enum ده — أنواعها متعددة وليها دورة حياة مختلفة (توليد → توقيع)، فبقالها موديل منفصل في §3.5.

model EmployeeDocument {
  id         String               @id @default(cuid())
  employeeId String
  employee   Employee             @relation(fields: [employeeId], references: [id])
  type       EmployeeDocumentType
  fileUrl    String               // مسار التخزين
  fileName   String?
  mimeType   String?
  uploadedAt DateTime             @default(now())
  uploadedBy String?              // اسم المستخدم اللي رفع الملف (تدقيق)

  @@unique([employeeId, type]) // رفع جديد لنفس النوع يستبدل القديم (نسخة واحدة فعّالة لكل نوع)
  @@index([employeeId])
}
```

وفي `Employee`:
```prisma
model Employee {
  // ...
  documents       EmployeeDocument[]
  acknowledgments EmployeeAcknowledgment[]
}
```

### 3.3 قاعدة الإجباري/الاختياري + تنبيه اكتمال الأوراق ✅ (المراحل 10–11)

- **كل حقول النص** (الاسم، الهاتف، العنوان، المؤهل، الموقف من التجنيد) → إجبارية في `zod` schema بتاع `src/lib/actions/employees.ts` (زي باقي الحقول الحالية).
- **كل حقول الرفع** (أنواع `EmployeeDocumentType` كلها) → اختيارية عند إضافة/تعديل الموظف. مفيش validation يمنع الحفظ لو ملف ناقص.
- **التنبيه:** دالة مساعدة `getMissingDocuments(employeeId)` في `src/lib/selectors.ts` بترجع الأنواع الناقصة (الفرق بين كل الأنواع السبعة وإللي فعلاً مرفوع). تُستخدم في:
  - بادچ/تحذير في صفحة تفاصيل الموظف (`employees/[id]`): "الأوراق غير مكتملة (3 مستندات ناقصة)".
  - عمود/أيقونة تحذير في جدول الموظفين (`employees-table.tsx`).
  - (اختياري) KPI في الداشبورد: عدد الموظفين اللي أوراقهم ناقصة.

### 3.4 الإقرارات الموقّعة — أنواع متعددة (قرار محسوم) ✅ (المرحلة 12 + إعادة تصميم بعدها)

> **تحديث (2026-09-06):** بطلب المستخدم، اتشال فلو "توليد PDF → طباعة → توقيع → رفع الموقّع" وصفحة الطباعة. الإقرارات بقت **3 خانات رفع ثابتة** (شروط التعاقد / استلام عهدة / سرية) — زي تبويب المستندات بالظبط — **+ زرار "إضافة إقرار"** لإضافة خانة باسم مخصص يكتبه المستخدم (`key = custom-<uuid>`). الموديل اتبسّط: `type` (enum) → `key` + `label` (string) · اتشالت `title`/`generatedAt`/`signedAt`/`createdBy` · `@@unique([employeeId, key])` (خانة واحدة نشطة لكل مفتاح، الرفع الجديد يستبدل). migration `20260906100000_acknowledgment_upload_slots`.

عندك احتياج مختلف عن باقي المستندات: **توليد PDF من النظام نفسه** بعد ما الموظف يوقّع (مش مجرد رفع ملف جاهز)، وأنواعها متعددة (إقرار شروط تعاقد، إقرار استلام عهدة، إقرار سرية، إلخ). عشان كده موديل منفصل عن `EmployeeDocument`:

```prisma
enum AcknowledgmentType {
  employment_terms   // إقرار شروط التعاقد
  custody_receipt    // إقرار استلام عهدة
  confidentiality    // إقرار سرية
  code_of_conduct     // إقرار السلوك الوظيفي / اللوائح
  other
}

model EmployeeAcknowledgment {
  id          String              @id @default(cuid())
  employeeId  String
  employee    Employee            @relation(fields: [employeeId], references: [id])
  type        AcknowledgmentType
  title       String              // نص/عنوان الإقرار وقت التوقيع (لو النص القياسي اتغيّر لاحقًا يفضل القديم موثّق)
  fileUrl     String              // مسار ملف الـ PDF الموقّع بعد التوليد
  generatedAt DateTime            @default(now())
  signedAt    DateTime?           // فاضية لحد ما الموظف يوقّع فعليًا
  createdBy   String?             // اسم المستخدم اللي ولّد/سجّل الإقرار

  @@index([employeeId])
  @@index([type])
}
```

- موظف واحد ممكن يكون عنده أكتر من صف بنفس `type` عبر الزمن (لو الإقرار اتجدد أو اتوقّع تاني) — من غير `@@unique` على `[employeeId, type]` عكس `EmployeeDocument`.
- الشاشة: قائمة "الإقرارات" جوه صفحة الموظف، زرار "توليد وإرسال للتوقيع" لكل نوع، وبعد التوقيع يترفع الـ PDF النهائي ويتسجّل `signedAt`.

### 3.5 التخزين — لوكال (قرار محسوم) ✅ (المراحل 11–12)

كل الملفات (مستندات + إقرارات) تتخزن على قرص السيرفر تحت `public/uploads/employees/<employeeId>/...`، و`fileUrl` بيسجّل المسار النسبي بس:

```
public/uploads/employees/<employeeId>/documents/<type>-<timestamp>.<ext>        # EmployeeDocument
public/uploads/employees/<employeeId>/acknowledgments/<type>-<timestamp>.pdf    # EmployeeAcknowledgment
```

- Endpoints جديدة:
  - `POST /api/employees/[id]/documents` — رفع مستند (صورة/PDF) وتسجيله في `EmployeeDocument` (استبدال لو نفس النوع موجود).
  - `POST /api/employees/[id]/acknowledgments` — توليد/حفظ إقرار موقّع في `EmployeeAcknowledgment`.
- لأن التخزين على قرص السيرفر نفسه: لازم `public/uploads/` تتضاف لـ `.gitignore` (زي ما `node_modules` مضاف) عشان الملفات الحقيقية للموظفين ميترفعوش على GitHub بالغلط — الريبو عندك **عام (public)** حسب `PLAN.md` §1.
- التوصية بالنسخ الاحتياطي: نفس نقطة `PLAN.md` §3.6 (باكاب SQLite) — لازم `public/uploads/` يتضاف لسكربت الباكاب كمان لأنه بيانات حقيقية (بطاقات، شهادات) مش ديمو.

---

## 4. ملخص التعديلات على `schema.prisma` (Checklist) ✅

- [x] `enum SalaryType { monthly, daily }` — migration `20260906074634_salary_type`
- [x] `enum MilitaryStatus { completed, exempted, postponed, not_applicable }` — migration `20260906090000_employee_profile_fields`
- [x] `enum EmployeeDocumentType { ... 7 قيم — بدون الإقرارات }` — migration `20260906084245_employee_documents`
- [x] `enum AcknowledgmentType { employment_terms, custody_receipt, confidentiality, code_of_conduct, other }` — migration `20260906090748_employee_acknowledgments`
- [x] `Employee`: + `salaryType`, `dailyRate`, `dailyWorkingHours`, `address`, `qualification`, `militaryStatus`, `nationalId` (`@unique`)، + علاقتَي `documents` و`acknowledgments`. **ملاحظة:** الحقول النصية الجديدة + `phone` بقيت `nullable` في الـ DB (الفورم يفرضها) — انظر الفروقات أعلاه.
- [x] `Allowance`: + `effectiveYear`, `effectiveMonth` (+ index) — migration `20260906080142_allowance_effective_month`
- [x] `PayrollRecord`: + `paidDaysCount`, `dailyRateApplied`
- [x] موديل جديد `EmployeeDocument` (`@@unique([employeeId, type])`)
- [x] موديل جديد `EmployeeAcknowledgment` (بدون unique — أنواع متعددة عبر الزمن)
- [x] **5 migrations** بدل واحد (`prisma migrate dev` لكل مرحلة)

## 5. ملخص التعديلات على الكود (خارج الـ schema) ✅

- [x] `src/lib/payroll-engine.ts` — تفريع حساب يومي/شهري (بصمة واحدة = يوم مدفوع كامل لليومي) + 3 اختبارات
- [x] `src/lib/actions/payroll.ts` — فلترة `Allowance` بالشهر (`OR` monthly / effectiveYear+Month) + حساب `paidDays` + تمرير `salaryType`/`dailyRate`
- [x] `src/lib/actions/employees.ts` — حقول إجبارية جديدة في zod schema + منع تكرار `nationalId`
- [x] `src/lib/actions/allowances.ts` — `type=bonus` ⇒ `monthly=false` + `effectiveYear/Month` إجباريين (zod refine)
- [x] `src/lib/actions/acknowledgments.ts` (جديد) — `generateAcknowledgment` / `deleteAcknowledgment`
- [x] `src/lib/documents.ts` (جديد) — `missingDocumentTypes` / `documentsComplete` + ثوابت MIME/حجم مشتركة · `src/lib/acknowledgments.ts` (جديد) — النصوص القياسية
- [x] `components/employees/employee-form-dialog.tsx` — Toggle يومي/شهري + قسم "البيانات الشخصية"
- [x] `components/employees/documents-panel.tsx` + `acknowledgments-panel.tsx` (جديدان) — في تبويب "المستندات"
- [x] `components/employees/employees-table.tsx` — أيقونة تحذير أوراق ناقصة
- [x] `app/(app)/employees/[id]/page.tsx` — قسم البيانات الشخصية + تبويب المستندات + تحذير "الأوراق غير مكتملة (N)"
- [x] `payslip/[recordId]` — سطر "الراتب الأساسي (N أيام × السعر)" + إخفاء خصم الغياب لليومي · جدول `/payroll` — `يومي (N أيام)`
- [x] `app/acknowledgment/[id]/page.tsx` (جديد) — صفحة الإقرار القابلة للطباعة
- [x] `app/api/employees/[id]/documents/route.ts` — POST + DELETE (رفع/حذف مستند)
- [x] `app/api/employees/[id]/acknowledgments/route.ts` — POST (رفع الإقرار الموقّع)
- [x] `.gitignore` — `+ /public/uploads/`
- [x] `src/middleware.ts` — `/uploads` + `/acknowledgment` في `ALWAYS_ALLOWED`
- [x] `prisma/seed-sample.ts` — موظفين يومية (~30% من الإنتاج) + بيانات شخصية كاملة لكل الـ50
- [ ] سكربت الباكاب يشمل `public/uploads/` — **متبقّي** (لسه مفيش سكربت باكاب رسمي؛ انظر `PLAN.md` §7)

## 6. القرارات المحسومة (من كلامك) — كلها اتنفّذت

- ✅ الموظف اليومي بياخد بصمة واحدة بس — `missing_punch` بالنسباله يوم مدفوع كامل، مش معلّق. **(اتنفّذ في `payroll-engine.ts` — `PAID_STATUSES` تشمل `missing_punch`)**
- ✅ الإقرارات أنواع متعددة — موديل `EmployeeAcknowledgment` منفصل (§3.4). **(اتنفّذ)**
- ✅ التخزين لوكال على قرص السيرفر (§3.5). **(اتنفّذ — `public/uploads/employees/<id>/...`)**
- ✅ `nationalId` حقل نصي إجباري منفصل جنب صورة البطاقة (§3.1). **(اتنفّذ — 14 رقم، `@unique`)**
- ✅ تسجيل الموظف اليومي في نفس شاشة "إضافة موظف" مع Toggle (يومي/شهري). **(اتنفّذ)**

## 7. المتبقّي (مؤجّل، مش جزء من الخطة دي)

- **عمود "هل احتُسب؟"** في `attendance-report` / `payroll-report` لليومي (§1.3) — الشفافية اتغطّت في الكشف والجدول؛ لو محتاج العمود المنفصل نعمله لوحده.
- **KPI الداشبورد** لعدد الموظفين ناقصي الأوراق (§3.3 اختياري).
- **سكربت الباكاب** يشمل `public/uploads/` — يتعمل مع سكربت باكاب الـ DB في `PLAN.md` §7.

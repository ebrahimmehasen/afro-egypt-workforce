# Afro Egypt — Factory Workforce

نظام إدارة العمالة والحضور والرواتب لشركة **Afro Egypt**، تطوير **404 Legends**. نظام حقيقي (مش ديمو) — قاعدة بيانات MySQL، مصادقة حقيقية بكلمات مرور مشفّرة، وسجل تدقيق كامل لكل تعديل حساس.

## التقنيات

Next.js 15 (App Router) · TypeScript · Prisma + MySQL · Tailwind CSS · shadcn/ui (Radix) · Recharts · Server Actions

## التشغيل محليًا

### المتطلبات

- Node.js 20+
- سيرفر MySQL 8 شغّال (محلي أو بعيد)

### الخطوات

```bash
npm install
cp .env.example .env
```

عدّل `.env`:

- `DATABASE_URL` — رابط اتصال MySQL (شوف التعليمات جوّا `.env.example` لإنشاء قاعدة البيانات والمستخدم)
- `SESSION_SECRET` — **إجباري**، التطبيق يرفض يشتغل من غيره. ولّده بـ:
  ```bash
  openssl rand -base64 32
  ```
- `PUNCH_API_KEY` — المفتاح اللي أجهزة البصمة (ZKTeco) هتبعته في هيدر `X-Punch-Key`

طبّق الـmigrations وازرع البيانات:

```bash
npx prisma migrate deploy

# للاستكشاف: منظمة وهمية كاملة (50 موظف، ~13 يوم تاريخ، 4 حسابات دخول)
npm run db:seed:sample

# أو للإنتاج: هيكل فاضي + حساب أدمن واحد فقط
ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' npm run db:seed
```

شغّل السيرفر:

```bash
npm run dev
```

افتح [http://localhost:3000](http://localhost:3000) — هيوجّهك تلقائيًا لصفحة الدخول.

**بيانات الدخول (بعد `db:seed:sample`)، كلمة المرور لكل الحسابات `demo123`:**

| الدور | البريد الإلكتروني |
|---|---|
| مدير النظام (Admin) | admin@404legends.demo |
| الموارد البشرية (HR) | hr@afroegypt.demo |
| مشرف قسم (Supervisor) | supervisor@afroegypt.demo |
| موظف (Employee) | ahmed@afroegypt.demo |

> بعد `db:seed` الإنتاجي فيه حساب أدمن واحد بس، بالإيميل وكلمة المرور اللي حدّدتهم في `ADMIN_EMAIL` / `ADMIN_PASSWORD`. من هناك تقدر تعمل باقي الحسابات من صفحة `/users`.

## النشر على سيرفر إنتاج

1. **جهّز MySQL** — قاعدة بيانات + مستخدم (التعليمات في `.env.example`)
2. **حط متغيرات البيئة** — `DATABASE_URL`, `SESSION_SECRET` (قيمة عشوائية جديدة، **مش** نفس بيئة التطوير), `PUNCH_API_KEY`. سيب `SECURE_COOKIES` غير محدّدة إلا لو السيرفر بيخدم HTTP بدون TLS خلف بروكسي موثوق — في الحالة دي حطها `false`
3. **ثبّت وابنِ:**
   ```bash
   npm ci
   npx prisma migrate deploy
   npm run build
   ```
4. **ازرع بيانات الإنتاج** (مرة واحدة، أول تشغيل):
   ```bash
   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='strong-password' npm run db:seed
   ```
5. **شغّل:**
   ```bash
   npm start
   ```
   خليه شغّال دايمًا عبر process manager (pm2، systemd، أو Docker — شوف `Dockerfile`) ووصّله بريفرس بروكسي (nginx/Caddy) لو محتاج TLS.

### بديل: Docker

```bash
docker build -t afro-egypt-workforce .
docker run -p 3000:3000 --env-file .env afro-egypt-workforce
```

الـmigrations **مش** بتتشغّل تلقائيًا جوّا الكونتينر — شغّل `npx prisma migrate deploy` (والزرع أول مرة) ضد قاعدة البيانات قبل ما تبعت أي traffic للكونتينر.

### نسخ احتياطي

قاعدة البيانات هي مصدر الحقيقة الوحيد. اعمل نسخة احتياطية دورية بـ `mysqldump` (أو أداة النسخ الاحتياطي بتاعة مزوّد الاستضافة) — الجدول `AttendanceLog` تحديدًا append-only ومفيش طريقة تانية تسترجعه.

## أهم المسارات

| المسار | الوصف |
|---|---|
| `/dashboard` | لوحة التحكم — KPIs يومية وشهرية، مقصورة على نطاق كل دور |
| `/attendance` | الحضور اليومي + محاكاة البصمة يدويًا + السجل الخام للبصمات |
| `/leaves`, `/overtime`, `/deductions` | طلبات واعتمادات |
| `/payroll` | فتح فترة رواتب، حساب، اعتماد، إغلاق |
| `/payslip/[recordId]` | كشف مرتب قابل للطباعة |
| `/reports` | تقارير حضور/إضافي/خصومات/رواتب قابلة للتصدير (Excel/CSV) |
| `/workforce-cost` | تحليل تكلفة العمالة (أدمن/HR) |
| `/audit-log` | سجل كل التعديلات الحساسة (أدمن/HR) |
| `/users` | إدارة المستخدمين والصلاحيات (أدمن فقط) |
| `/settings` | إعدادات الشركة والحضور والرواتب (أدمن فقط) |
| `POST /api/punch` | استقبال بصمات من أجهزة ZKTeco — شوف التفاصيل في `src/app/api/punch/route.ts` |

## الأدوار والصلاحيات

| الدور | يشوف إيه |
|---|---|
| Admin | كل حاجة + إدارة المستخدمين والإعدادات |
| HR | كل الموظفين، الرواتب، التقارير — بدون إدارة مستخدمين |
| Supervisor | قسمه فقط (الموظفين، الحضور، الطلبات، التقارير) |
| Employee | بياناته الشخصية فقط (حضوره، رواتبه، طلباته) |

النطاق مفروض على مستوى القراءة (`src/lib/scope.ts`) وعلى مستوى الوصول للصفحة (`requireAccess` في `src/lib/auth.ts`) — مش مجرد إخفاء عناصر في الواجهة.

## البنية

- `src/lib/attendance-engine.ts`, `src/lib/payroll-engine.ts` — محرّكات حساب نقية (بدون I/O)، مغطّاة باختبارات (`npm test`)
- `src/lib/data.ts` — قراءة موحّدة من قاعدة البيانات (read model)
- `src/lib/scope.ts` — مين يشوف إيه
- `src/lib/audit.ts` — كل تعديل حساس بيتسجّل transactionally مع نفس عملية الكتابة
- `src/lib/actions/*` — Server Actions (كل الكتابة على قاعدة البيانات)
- `prisma/schema.prisma` — نموذج البيانات الكامل

## الاختبارات

```bash
npm test
```

اختبارات وحدة للمحرّكين النقيين + اختبارات تكامل ضد قاعدة بيانات حقيقية (بتتخطّى تلقائيًا لو مفيش DB متاح أو لو مش عليه بيانات sample).

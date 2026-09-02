# Afro Egypt — Factory Workforce

نظام إدارة العمالة والحضور والرواتب — MVP تفاعلي كامل لشركة **Afro Egypt**، تطوير **404 Legends**.

## التشغيل محليًا

```bash
npm install
npm run dev
```

افتح [http://localhost:3000](http://localhost:3000). سيتم توجيهك تلقائيًا لصفحة الدخول.

**بيانات الدخول التجريبية:**

| الدور | البريد الإلكتروني | كلمة المرور |
|---|---|---|
| مدير النظام (Admin) | admin@404legends.demo | demo123 |
| الموارد البشرية (HR) | hr@afroegypt.demo | demo123 |
| مشرف قسم (Supervisor) | supervisor@afroegypt.demo | demo123 |
| موظف (Employee) | ahmed@afroegypt.demo | demo123 |

## التقنيات

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui (Radix) · Recharts · Server Actions

## طبقة البيانات

هذا MVP **بدون قاعدة بيانات حقيقية** — البيانات محفوظة في الذاكرة (in-memory store) ويتم توليدها تلقائيًا عند أول تشغيل (`src/lib/seed.ts`). إعادة تشغيل السيرفر (`npm run dev`) تعيد ضبط البيانات على حالتها الأصلية. الكود مُهيكل بحيث يسهل استبدال طبقة البيانات بـ PostgreSQL + Prisma لاحقًا دون تغيير منطق العمل (`src/lib/attendance-engine.ts`, `src/lib/payroll-engine.ts`).

## أهم المسارات

- `/dashboard` — لوحة التحكم الرئيسية
- `/demo` — عرض تجريبي موجّه خطوة بخطوة (بصمة → تأخير → إضافي → خصم → راتب → تكلفة العمالة)
- `/attendance` — محاكاة البصمة + الحضور اليومي + السجل الخام
- `/payroll` — حساب واعتماد الرواتب
- `/payslip/[recordId]` — كشف مرتب قابل للطباعة

## ملاحظة أمنية

تبعية `next@14.2.35` تحمل تحذيرًا معروفًا من `npm audit` بخصوص `postcss` (تبعية داخلية لأدوات البناء الخاصة بـ Next نفسه، وليست مساسة بمسار الطلبات وقت التشغيل). مقبول لمشروع MVP تجريبي محلي؛ يُنصح بترقية Next عند التحويل لبيئة إنتاج فعلية.

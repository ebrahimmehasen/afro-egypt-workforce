# خدمة المساعد الذكي (`assistant-bridge`)

المساعد الذكي في النظام **للأدمن فقط** وبيظهر كأيقونة في كل الصفحات. المخ بتاعه **Claude CLI** بحساب Claude المسجّل على السيرفر، وبيشتغل من خلال خدمة Windows صغيرة اسمها `AfroEgyptAssistant` على `127.0.0.1:4100` (مش مفتوحة على الشبكة).

## إزاي بيشتغل

```
الأدمن يسأل في الأيقونة
   └─ التطبيق (Server Action) ── يتأكد إنه أدمن ── يبعت السؤال + توكن قصير العمر ──► خدمة المساعد (127.0.0.1:4100)
                                                                                         └─ تشغّل Claude CLI لسؤال واحد
                                                                                              (من غير أي أدوات ويندوز، من غير جلسة محفوظة)
   التطبيق ◄── الأدوات (قراءة فقط) عبر /api/assistant/tool ◄── mcp-afro.mjs ◄──────────────────┘
```

- كل سؤال = عملية CLI جديدة بمجلد مؤقت وتوكن خاص بيه، فمحادثات الأدمنز **عمرها ما بتتخلط** (التاريخ محفوظ لكل أدمن لوحده في قاعدة البيانات).
- الـ CLI **مفيهوش أي أداة من أدوات ويندوز** (لا shell ولا ملفات ولا ويب). أدواته الوحيدة هي أدوات التطبيق (قراءة فقط) عبر MCP.
- الحدود الأمنية (أدمن فقط، قراءة فقط، توكن بـ3 دقايق) **في الكود**. ملف `INSTRUCTIONS.md` بيحدد الأسلوب والمسموح والممنوع بس، ومش هو الحماية.

## التركيب (مرة واحدة)

1. **تجهيز الفولدر** (PowerShell عادي، مش محتاج Admin):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Users\Host\Desktop\main\afro-egypt-workforce\assistant-bridge\install.ps1
   ```
   بينسخ الخدمة والـ CLI في `C:\Users\Host\Desktop\main\tools\assistant\` وبيعمل السر المشترك في `assistant.env`. تقدر تشغّله تاني في أي وقت: مابيمسحش تعديلاتك على `INSTRUCTIONS.md` ولا تسجيل دخول Claude.

2. **تسجيل دخول Claude للمساعد** (بحسابك، مرة واحدة، من نفس حساب ويندوز اللي هتشغّل بيه الخدمة):
   ```powershell
   $env:CLAUDE_CONFIG_DIR = 'C:\Users\Host\Desktop\main\tools\assistant\claude-home'
   & 'C:\Users\Host\Desktop\main\tools\assistant\claude\claude.exe'
   ```
   اكتب `/login` وكمّل في المتصفح، وبعدين اخرج. تسجيل الدخول ده معزول عن أي تسجيل تاني على الجهاز.

3. **تركيب الخدمة** (PowerShell **كـ Administrator**):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Users\Host\Desktop\main\afro-egypt-workforce\assistant-bridge\install-service.ps1
   ```
   هيسألك على حساب ويندوز وباسورده (في نافذة مخفية). لازم يكون نفس الحساب اللي سجّل دخول Claude، لأن التسجيل محفوظ في ملفاته.

4. **ربط التطبيق بالخدمة**: ضيف سطر `ASSISTANT_BRIDGE_SECRET=...` (القيمة من `tools\assistant\assistant.env`) في `tools\secrets\afro-egypt.env`، وبعدين اعمل deploy أو `Restart-Service AfroEgyptApp`.

5. **تجربة**: `Invoke-RestMethod http://127.0.0.1:4100/health` لازم يرجّع `ok`. وبعدها افتح أيقونة المساعد كأدمن واسأل "إيه حالة الحضور النهارده؟".

## تعديل قواعد المساعد

عدّل `C:\Users\Host\Desktop\main\tools\assistant\INSTRUCTIONS.md`. بيتقرا من جديد مع كل سؤال، فالتعديل ساري فورًا من غير إعادة تشغيل. لو الملف اتمسح أو بقى فاضي بيرجع تلقائيًا لنسخة الـ repo (`assistant-bridge/INSTRUCTIONS.md`).

## الإعدادات (متغيّرات بيئة الخدمة، اختيارية)

| المتغيّر | الافتراضي | الوصف |
|---|---|---|
| `ASSISTANT_MODEL` | `sonnet` | الموديل (`sonnet` أو `haiku` أسرع وأرخص أو `opus` أقوى) |
| `ASSISTANT_BUDGET_USD` | `1.00` | سقف تكلفة السؤال الواحد |
| `ASSISTANT_TIMEOUT_MS` | `150000` | أقصى وقت للسؤال |
| `ASSISTANT_MAX_PARALLEL` | `3` | عدد الأسئلة اللي تشتغل مع بعض (الباقي بيستنى لحد دقيقة) |
| `ASSISTANT_BRIDGE_PORT` | `4100` | بورت الخدمة (على `127.0.0.1` بس) |

لتغيير أي منهم: `nssm set AfroEgyptAssistant AppEnvironmentExtra ...` (النص كله بيتبدّل، فاكتب كل المتغيّرات اللي في `install-service.ps1` معاه) وبعدين `Restart-Service AfroEgyptAssistant`.

## لو في مشكلة

| الأعراض | السبب المحتمل |
|---|---|
| "المساعد لسه متظبطش" | الخدمة واقفة، أو `ASSISTANT_BRIDGE_SECRET` مش موجود في إعدادات التطبيق، أو تسجيل دخول Claude مش متعمل |
| الرد بيقول إنه مش مسجّل دخول | كرّر الخطوة 2 بنفس حساب ويندوز بتاع الخدمة، وبعدها `Restart-Service AfroEgyptAssistant` |
| "كتر عدد الأسئلة" بعد استخدام كتير | وصلت لحد استخدام حساب Claude (الحصة مشتركة مع استخدامك التاني للحساب) |
| بطيء | جرّب `ASSISTANT_MODEL=haiku` |

اللوجات: `tools\assistant\logs\assistant-out.log` و`assistant-err.log`. بتسجّل بس النتيجة والوقت وعدد الأدوات، **مش نص الأسئلة ولا الأجوبة**.

## تحديث الـ CLI

الـ CLI منسوخ نسخة ثابتة. لتحديثه من نسخة تطبيق Claude: `install.ps1 -UpdateCli` وبعدين `Restart-Service AfroEgyptAssistant`.

## ملاحظات أمان

- حساب Claude المسجّل على السيرفر سر مهم: أي حد عنده وصول لملفات `tools\assistant\claude-home` يقدر يستخدم الحساب.
- بيانات الموظفين (مرتبات، أرقام قومية) بتتبعت لـ Anthropic عبر الحساب ده. راجع إعدادات الخصوصية وشروط الاستخدام للحساب قبل الاعتماد عليه لخدمة الشركة.
- الأسئلة بتتسجّل في سجل المراجعة (النص ببدايته، وأسماء الأدوات اللي اتنادت).

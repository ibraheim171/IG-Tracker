# مصدر جامع إحصائيات إنستغرام

الملفان `Code.gs` و`AnalyticsSync.gs` هما النسخة المحفوظة في Git من الجزء المسؤول عن جمع التحليلات ومزامنتها في مشروع Google Apps Script الخارجي. لا يعملان تلقائيًا من Vercel ولا يحتويان على أسرار أو معرّفات Spreadsheet أو Project.

## Script Properties المطلوبة

تُحفظ القيم في إعدادات مشروع Apps Script فقط، ولا تُنسخ إلى الملفات:

- `IG_TOKEN`
- `ANALYTICS_SYNC_URL`
- `ANALYTICS_SYNC_SECRET`
- `ANALYTICS_ACCOUNT_SENT_THROUGH`

ينشئ الجامع الخاصية `ANALYTICS_ACCOUNT_STOCK_SENT_THROUGH` بعد أول chunk مقبول من رصدات الرصيد. لا تضبط لها قيمة ابتدائية عند إنشاء ورقة فارغة. إذا احتوت الورقة رصدات سابقة، لا تضبطها يدويًا إلا على `observed_at` لرصد ثبت قبوله في قاعدة البيانات.

يستخدم `BACKFILL_CURSOR` داخليًا فقط عند تشغيل `backfillPosts` اليدوي.

## التحديث اليدوي

لا تنفذ هذه الخطوات قبل اعتماد اختبار Staging:

1. افتح مشروع Apps Script الحالي، واترك `Portal.gs` و`Migrate.gs` وبقية الملفات غير التحليلية كما هي.
2. استبدل محتوى `Code.gs` بمحتوى `apps-script/Code.gs`.
3. استبدل محتوى `AnalyticsSync.gs` بمحتوى `apps-script/AnalyticsSync.gs`، أو أنشئ الملف بهذا الاسم إن لم يكن محفوظًا بهذا الاسم.
4. من Project Settings، اضبط المنطقة الزمنية للمشروع على `Asia/Hebron`. يستخدم المصدر هذه المنطقة صراحة أيضًا ولا يعتمد على `Session.getScriptTimeZone()`.
5. تأكد أن خصائص الاتصال الثلاث الموجودة مسبقًا ما زالت محفوظة في Script Properties دون نسخ قيمها إلى المصدر.
6. أضف القيمة الابتدائية التالية يدويًا:

   `ANALYTICS_ACCOUNT_SENT_THROUGH=2026-09-20`

   لا توجد قيمة افتراضية في الكود. غياب الخاصية يوقف Account برسالة واضحة، ولا يتجاوزه إلى تاريخ لاحق.
7. شغّل `setup()` مرة واحدة لإنشاء ورقة `account_stock` بعناوينها الثابتة. لا يكتب ذلك إلى Supabase ولا يجمع من Meta.
8. احفظ الملفات. لا تشغّل `backfillAccount` قبل ضبط watermark اليومي.
9. بعد موافقة Staging فقط، شغّل `dailyPull` مرة واحدة يدويًا. يبدأ Account من `2026-09-21`، ولا يجمع يومًا أحدث من اليوم المغلق قبل يومين. يسجل Account Stock لحظة الجمع الفعلية ولا يرجع بها إلى تاريخ سابق.
10. راجع ورقة `log`. كل سطر مزامنة يقتصر على `stream` و`status` و`count` و`date`، ولا يحتوي payload أو secret.
11. تأكد أن triggers الحالية تشير إلى `dailyPull` يوميًا وإلى `pullDemographics` أسبوعيًا. لا حاجة لإعادة تثبيتها إن كانت موجودة؛ عند الحاجة فقط شغّل `installTriggers` مرة واحدة.

## السلوك المقصود

- صف Account الموجود لا يُستبدل ولا يُعدّل.
- Account يرسل الأيام التي تلي الـwatermark وحتى اليوم النهائي فقط، في chunks لا تتجاوز 500 صف.
- الـwatermark يتقدم بعد قبول كل chunk. فشل chunk يوقف Account عند آخر يوم مقبول.
- Posts وAccount وDemographics وCollabs streams مستقلة؛ فشل إحداها لا يمنع محاولة البقية.
- `pullDemographics` تجمع Audience وتزامنها في trigger الأسبوعي نفسه.
- Account Stock رصد مستقل: يعيد retry إرسال الصف المخزن لليوم نفسه ولا يعيد استدعاء Meta، ولا يتقدم watermark إلا بعد قبول الـchunk.
- القياس غير المتاح يبقى فارغًا في Sheets و`NULL` في payload؛ لا يتحول إلى صفر.

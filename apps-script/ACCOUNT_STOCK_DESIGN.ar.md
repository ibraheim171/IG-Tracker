# خيارات رصيد الحساب (`followers` و`media_count`)

## الوضع الحالي

يجمع مسار Account المقاييس اليومية النهائية بعد مهلة يومين. أما `followers_count` و`media_count` من `/me` فهما رصيد حالي لحظة الطلب، ولا يثبتان قيمة اليوم التاريخي الذي انتهى قبل يومين. لذلك يترك `pullAccountDay_` الحقلين فارغين عمدًا، ولا يجوز إسناد الرصيد الحالي إلى ذلك التاريخ.

يعني تاريخ Account الحديث في شاشة Health حاليًا أن **المقاييس اليومية** حديثة فقط، ولا يثبت حداثة رصيد المتابعين أو عدد المواد. التعديل الآمن الحالي هو تسمية هذا الصف «مقاييس الحساب اليومية» وإظهار أن الرصيد غير متاح ضمنه. بعد اختيار أحد البدائل أدناه، يضاف صف Health مستقل لرصيد الحساب ولا يُدمج حكمه مع المقاييس اليومية.

## A) جدول مستقل لملاحظات الرصيد وقت الرصد

هذا هو النموذج الأدق إذا كان المطلوب الاحتفاظ برصيد يومي من الآن فصاعدًا.

- **قاعدة البيانات:** migration جديدة لجدول server-only مثل `ig_account_stock_observations` يحتوي `observed_at timestamptz` و`followers` و`media_count` nullable و`missing_metrics` و`source_timestamp` و`sync_run_id`، مع مفتاح idempotency واضح وRLS/grants مماثلة للجداول الخام.
- **API/Apps Script:** stream مستقل يجلب `/me` مرة واحدة ويسجل وقت الرصد الحقيقي في `Asia/Hebron` دون backdating، مع validation وingestion ذري immutable وحد 500.
- **UI/Health:** قراءة أحدث `observed_at` وعرض «رصيد الحساب» بحالة freshness مستقلة؛ تستخدم Insights فروق الرصيد بين رصدين فقط وتعرض غياب الحدود كـ`—`.
- **التحقق:** PostgreSQL integration لاختبار identical/divergent duplicates والـrollback والصلاحيات، واختبار API للـtimestamp وNULL، وتجربة Staging تثبت أن الرصيد لا يُنسب إلى تاريخ سابق وأن retry لا ينشئ قراءة ثانية.

## B) استخدام `ig_account_range_snapshots` بعد مراجعة provenance

قد يقلل هذا الخيار schema الجديد، لكنه غير جاهز قبل إثبات معنى `snapshot_date/range_start/range_end` ومصدر إنشاء الجدول. يوجد RPC ingestion في migrations الحالية بينما تعريف إنشاء الجدول نفسه غير ظاهر في migrations المتتبعة، لذلك يجب أولًا إثبات provenance للـschema الفعلي وأن `followers` يعني رصيدًا **وقت الرصد** لا رصيدًا منسوبًا إلى نهاية range، وأن generated types محدثة بصورة صحيحة.

- **قاعدة البيانات:** بعد المراجعة فقط، migration تصحيحية عند الحاجة لتثبيت provenance/constraints/grants؛ لا يعاد استعمال الصف إذا كان مفتاحه يوحي بتاريخ تاريخي غير حقيقي.
- **API/Apps Script:** stream `account_range` منفصل يرسل `observed_at`/`snapshot_date` الحقيقي ومصدرًا صريحًا، ولا يملأ ranges تاريخية بقيمة `/me` الحالية.
- **UI/Health:** مصدر مستقل لرصيد الحساب من أحدث snapshot مثبت provenance؛ لا تستخدمه حسابات daily إلا إذا كان المعنى الزمني متطابقًا.
- **التحقق:** مقارنة schema المحلي والفعلي، اختبار RPC على PostgreSQL للذرية والتعارض والصلاحيات، ثم Staging يطابق request timestamp والصف المخزن والعرض.

## C) إبقاؤه غير متاح صراحة

هذا هو الأصغر ولا يحتاج schema أو ingestion جديدًا.

- **قاعدة البيانات/API:** لا تغيير؛ يبقى `followers` و`media_count` في الصفوف المؤخرة `NULL` ويظلان ضمن `missing_metrics`.
- **UI/Health:** يبقى صف المقاييس اليومية مستقلًا، ويعرض «رصيد الحساب: لم يُجمع» بلا اشتقاق فروق أو أصفار.
- **التحقق:** اختبارات UI/API تثبت عرض `—` وعدم احتساب follower deltas، ومراجعة Health تثبت أن حداثة daily لا تحول stock إلى «حديثة».

## القرار المطلوب

يلزم اختيار A أو B أو C قبل أي سلوك schema-dependent. لا توجد migration أو backfill ضمن هذا التغيير المحلي.

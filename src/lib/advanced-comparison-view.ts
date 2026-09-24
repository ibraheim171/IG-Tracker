import type { AdvancedEvidenceRow, AdvancedMetric, AdvancedTimelinePoint } from "./advanced-comparison.ts";
export const advancedMetricLabels: Record<AdvancedMetric,string>={reach:"وسيط الوصول",save_rate:"وسيط معدل الحفظ %",share_rate:"وسيط معدل المشاركة %",follow_rate:"وسيط معدل المتابعة %",visit_rate:"وسيط معدل زيارة الملف %",signal:"وسيط قوة الإشارة",item_count:"عدد المواد"};
export function advancedValue(value:number|null){return value===null?"—":value.toLocaleString("en-US",{maximumFractionDigits:2});}
export function advancedSampleLabel(n:number){return n===1?"حالة منفردة":n>=2&&n<=3?"عيّنة صغيرة":null;}
export function differenceUnit(metric:AdvancedMetric){return ["save_rate","share_rate","follow_rate","visit_rate"].includes(metric)?"نقطة مئوية":"";}
export function advancedReelsWarning(metric:AdvancedMetric,evidence:AdvancedEvidenceRow[]){return ["follow_rate","visit_rate","signal"].includes(metric)&&evidence.some(row=>row.media_type==="REELS"&&row.exclusion_reasons[metric]==="missing_component");}
export function timelineMetricRows(points:AdvancedTimelinePoint[],metric:AdvancedMetric){return points.filter(point=>point.metric===metric).map(point=>({...point,n:point.measured_n}));}

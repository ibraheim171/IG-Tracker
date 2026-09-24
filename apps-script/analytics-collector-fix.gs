/** Paste these replacements into the existing Apps Script project's Code.gs. */
function dailyPull() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var today = fmt_(new Date());
  try {
    pullAccount_(ss, today);
    pullPosts_(ss, today);
    syncAnalyticsToTracker();
    CacheService.getScriptCache().remove('portal');
    logRun_('INFO', 'dailyPull + analytics sync ok ' + today);
  } catch (e) { logRun_('ERROR', 'dailyPull failed: ' + e.message); throw e; }
}
function metricValue_(value) { return typeof value === 'number' && isFinite(value) ? value : ''; }
function accountViews_() {
  var res = igGet_('/me/insights', { metric: 'views', period: 'day', metric_type: 'total_value' });
  if (!res.error && res.data && res.data[0]) {
    var d = res.data[0];
    if (d.total_value && Object.prototype.hasOwnProperty.call(d.total_value, 'value') && typeof d.total_value.value === 'number') return d.total_value.value;
    if (d.values && d.values[0] && Object.prototype.hasOwnProperty.call(d.values[0], 'value') && typeof d.values[0].value === 'number') return d.values[0].value;
  }
  if (res.error) logRun_('WARN', 'account views: ' + res.error.message);
  return '';
}
function snapRow_(m, today, age) {
  var pool = (m.media_product_type === 'REELS') ? M_REEL : M_POST;
  var ins = insights_('/' + m.id, pool, {});
  return [today, m.id, age, metricValue_(m.like_count), metricValue_(m.comments_count), metricValue_(ins.reach), metricValue_(ins.views), metricValue_(ins.saved), metricValue_(ins.shares), metricValue_(ins.total_interactions), metricValue_(ins.profile_visits), metricValue_(ins.follows), metricValue_(ins.ig_reels_avg_watch_time)];
}
function insights_(path, metrics, extra) {
  var pool = metrics.slice(), out = {};
  for (var attempt = 0; attempt < 8 && pool.length; attempt++) {
    var p = { metric: pool.join(',') };
    for (var k in extra) p[k] = extra[k];
    var res = igGet_(path + '/insights', p);
    if (!res.error) {
      (res.data || []).forEach(function (d) {
        var value = d.total_value && Object.prototype.hasOwnProperty.call(d.total_value, 'value') ? d.total_value.value : (d.values && d.values[0] && Object.prototype.hasOwnProperty.call(d.values[0], 'value') ? d.values[0].value : null);
        out[d.name] = metricValue_(value);
      });
      return out;
    }
    var bad = pool.filter(function (m) { return res.error.message.indexOf(m) > -1; })[0];
    if (!bad) { logRun_('WARN', path + ' insights: ' + res.error.message); return out; }
    logRun_('WARN', 'metric dropped: ' + bad); pool = pool.filter(function (m) { return m !== bad; });
  }
  return out;
}
